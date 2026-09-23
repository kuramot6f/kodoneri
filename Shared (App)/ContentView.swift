import AuthenticationServices
import CryptoKit
import SafariServices
import StoreKit
import SwiftUI

/// A grouped form, so the window reads like Settings on both platforms.
struct ContentView: View {

    /// Everything in the Keychain, the gateway token included; `nil` until the first read finishes.
    @State private var keys: [String: String]?

    var body: some View {
        Form {
            if keys?.isEmpty == true {
                Section {
                    Text("Sign in with Apple to use Kodoneri’s free plan, or add your own OpenAI, Anthropic, or DeepSeek API key.")
                } header: {
                    Text("Get Started for Free")
                }
            }

            ExtensionSection()

            if let keys = Binding($keys) {
                GatewaySection(keys: keys)
                ApiKeysSection(keys: keys)
            }
        }
        .formStyle(.grouped)
        // Keychain reads can stall on first access, so keep them off the main thread.
        .task {
            keys = await Task.detached { ApiKeyStore.all() }.value
        }
    }

}

/// One row per provider. Edits go straight to the Keychain; the extension reads them when a conversation starts.
private struct ApiKeysSection: View {

    private static let rows = [("openai", "OpenAI"), ("anthropic", "Anthropic"), ("deepseek", "DeepSeek")]

    @Binding var keys: [String: String]

    var body: some View {
        Section {
            ForEach(Self.rows, id: \.0) { provider, label in
                LabeledContent(label) {
                    HStack {
                        SecureField("", text: binding(provider), prompt: Text("API key"))
                        if keys[provider] != nil {
                            Button {
                                keys[provider] = nil
                                ApiKeyStore.delete(provider)
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundStyle(.secondary)
                            }
                            .buttonStyle(.borderless)
                            .accessibilityLabel("Clear \(label) API key")
                        }
                    }
                }
            }
        } header: {
            Text("API Keys")
        } footer: {
            Text("Keys are encrypted and kept in your iCloud Keychain.")
        }
    }

    private func binding(_ provider: String) -> Binding<String> {
        Binding(
            get: { keys[provider, default: ""] },
            set: { value in
                keys[provider] = value.isEmpty ? nil : value
                ApiKeyStore.write(provider, value)
            }
        )
    }

}

/// Sign in with Apple is traded for a gateway token, which is kept in the Keychain like an API key.
private struct GatewaySection: View {

    private static let productIDs = ["plus", "pro"]

    @Binding var keys: [String: String]
    @State private var nonce: String?
    @State private var usage: GatewayUsage?
    @State private var showsSubscriptions = false
    @State private var isLoading = false
    @State private var error: String?

    private var token: String? { keys["chatext"] }
    private var isSignedIn: Bool { token != nil }

    var body: some View {
        Section {
            if isSignedIn {
                LabeledContent("Signed in with Apple") {
                    Button("Sign Out") {
                        ApiKeyStore.delete("chatext")
                        keys["chatext"] = nil
                        usage = nil
                    }
                }
                if let usage {
                    LabeledContent("Plan") {
                        Text(usage.plan.capitalized)
                    }
                    LabeledContent("This period") {
                        Text("\(usage.estimatedCostUsd.formatted(.currency(code: usage.currency).precision(.fractionLength(2...6)))) / \(usage.allowanceUsd.formatted(.currency(code: usage.currency)))")
                    }
                    LabeledContent("Usage") {
                        Text("\(usage.requests.formatted()) requests · \((usage.inputTokens + usage.outputTokens).formatted()) tokens")
                            .foregroundStyle(.secondary)
                    }
                }
                Button(usage?.plan == "free" ? "Subscribe" : "Change Subscription") {
                    showsSubscriptions = true
                }
                .disabled(isLoading || usage == nil)
                Button("Restore Purchases") {
                    Task { await perform { try await AppStore.sync(); try await loadAccount() } }
                }
                .disabled(isLoading)
                Button("Refresh Usage") {
                    Task { await perform { usage = try await gateway("usage") } }
                }
                .disabled(isLoading)
            } else {
                SignInWithAppleButton(.signIn) { request in
                    request.requestedScopes = []
                    request.nonce = nonce.map(Self.sha256)
                } onCompletion: { result in
                    Task { await perform { try await signIn(result) } }
                }
                .frame(height: 36)
                .disabled(nonce == nil || isLoading)
            }
            if let error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        } header: {
            Text("Kodoneri")
        } footer: {
            Text(isSignedIn ? "Usage is recorded after each response and may take a moment to appear." : "Kodoneri doesn’t receive your name or email address when you sign in with Apple.")
        }
        // Runs again on sign-in and sign-out.
        .task(id: isSignedIn) {
            guard isSignedIn else { return await perform(prepareNonce) }
            await perform(loadAccount)
            for await verification in Transaction.updates {
                await perform { try await submit(verification) }
            }
        }
        .sheet(isPresented: $showsSubscriptions) {
            SubscriptionStoreView(productIDs: Self.productIDs)
                .storeButton(.visible, for: .cancellation)
                .inAppPurchaseOptions { _ in
                    guard let usage else { return [] }
                    return [.appAccountToken(usage.appAccountToken)]
                }
                .onInAppPurchaseCompletion { _, result in
                    await perform {
                        guard case .success(let verification) = try result.get() else { return }
                        showsSubscriptions = false
                        try await submit(verification)
                    }
                }
                .frame(minWidth: 360, minHeight: 400)
        }
    }

    /// Tracks `isLoading` and shows any failure below the section.
    private func perform(_ work: () async throws -> Void) async {
        isLoading = true
        defer { isLoading = false }
        do {
            try await work()
            error = nil
        } catch ASAuthorizationError.canceled {
            // The user dismissed the sheet; nothing to report.
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// A GET, or a JSON POST when there's a body, authorized with the gateway token once signed in.
    private func gateway<Response: Decodable>(_ path: String, body: [String: String]? = nil) async throws -> Response {
        var request = URLRequest(url: gatewayURL.appending(path: path))
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        return try JSONDecoder().decode(Response.self, from: data)
    }

    private func prepareNonce() async throws {
        let response: [String: String] = try await gateway("auth/apple/nonce", body: [:])
        guard let nonce = response["nonce"] else { throw URLError(.badServerResponse) }
        self.nonce = nonce
    }

    private func signIn(_ result: Result<ASAuthorization, Error>) async throws {
        guard let credential = try result.get().credential as? ASAuthorizationAppleIDCredential,
              let identityToken = credential.identityToken.flatMap({ String(data: $0, encoding: .utf8) }),
              let nonce else { throw URLError(.userAuthenticationRequired) }
        // Each nonce works once, so a failed attempt needs a fresh one.
        self.nonce = nil
        do {
            let response: [String: String] = try await gateway("auth/apple", body: ["identityToken": identityToken, "nonce": nonce])
            guard let token = response["token"] else { throw URLError(.badServerResponse) }
            ApiKeyStore.write("chatext", token)
            keys["chatext"] = token
        } catch {
            try? await prepareNonce()
            throw error
        }
    }

    /// Loads usage, then hands the gateway any subscription it may have missed.
    private func loadAccount() async throws {
        usage = try await gateway("usage")
        for await verification in Transaction.currentEntitlements {
            try await submit(verification)
        }
    }

    /// The gateway links the subscription to this account and answers with the updated usage.
    private func submit(_ verification: VerificationResult<StoreKit.Transaction>) async throws {
        guard case .verified(let transaction) = verification,
              Self.productIDs.contains(transaction.productID) else { return }
        usage = try await gateway("billing/transaction", body: ["signedTransaction": verification.jwsRepresentation])
        await transaction.finish()
    }

    private nonisolated static func sha256(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

}

private struct GatewayUsage: Decodable {
    let plan: String
    let currency: String
    let allowanceUsd: Double
    let estimatedCostUsd: Double
    let inputTokens: Int
    let outputTokens: Int
    let requests: Int
    let appAccountToken: UUID
}

/// Safari reports the extension's state and opens its settings on macOS and iOS 26.2+; older iOS gets directions instead.
private struct ExtensionSection: View {

    @Environment(\.scenePhase) private var scenePhase
    /// `nil` until Safari reports the extension's state, or if it can't be found.
    @State private var isEnabled: Bool?
    @AppStorage(AppSettings.chatButtonKey, store: AppSettings.defaults) private var chatButton = AppSettings.chatButtonDefault

    var body: some View {
        Section {
            Toggle("Chat Button on Web Pages", isOn: $chatButton)
            if Self.canManage {
                LabeledContent("Status") {
                    switch isEnabled {
                    case true: Text("Enabled")
                    case false: Text("Disabled")
                    case nil: Text("Unknown")
                    }
                }
                Button(isEnabled == true ? "Manage in Safari Settings…" : "Enable in Safari Settings…") {
                    Task { await openSettings() }
                }
            } else if #available(iOS 18, *) {
                // Safari can't report the state here, so the directions read the same whether the extension is on or off.
                Text("If you haven’t turned on Kodoneri yet, go to Settings > Apps > Safari > Extensions.")
            } else {
                Text("If you haven’t turned on Kodoneri yet, go to Settings > Safari > Extensions.")
            }
        } header: {
            Text("Safari Extension")
        } footer: {
            Text("Shows a button at the bottom right of web pages that opens the chat.")
        }
        // The toggle lives in Safari's settings, so check again whenever the user comes back.
        .task(id: scenePhase) {
            guard Self.canManage, scenePhase == .active else { return }
            isEnabled = await currentState()
        }
    }

    private static var canManage: Bool {
#if os(macOS)
        true
#else
        if #available(iOS 26.2, *) { true } else { false }
#endif
    }

    private func currentState() async -> Bool? {
#if os(macOS)
        try? await SFSafariExtensionManager.stateOfSafariExtension(withIdentifier: extensionBundleIdentifier).isEnabled
#else
        guard #available(iOS 26.2, *) else { return nil }
        return try? await SFSafariExtensionManager.stateOfExtension(withIdentifier: extensionBundleIdentifier).isEnabled
#endif
    }

    private func openSettings() async {
#if os(macOS)
        try? await SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier)
#else
        guard #available(iOS 26.2, *) else { return }
        try? await SFSafariSettings.openExtensionsSettings(forIdentifiers: [extensionBundleIdentifier])
#endif
    }

}

#Preview {
    ContentView()
}
