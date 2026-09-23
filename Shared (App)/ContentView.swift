//
//  ContentView.swift
//  Shared (App)
//
//  Created by Daichi on 9/19/26.
//

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

    private static let subscriptionProductIDs = [
        "plus",
        "pro"
    ]

    @Binding var keys: [String: String]
    @State private var nonce: String?
    @State private var usage: GatewayUsage?
    @State private var products: [Product] = []
    @State private var productLoadError: String?
    @State private var showsSubscriptions = false
    @State private var isLoading = false
    @State private var purchasingProductID: String?
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
                        products = []
                        Task { await prepareNonce() }
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
                .disabled(isLoading || purchasingProductID != nil)
                Button("Restore Purchases") {
                    Task { await restorePurchases() }
                }
                .disabled(isLoading || purchasingProductID != nil)
                Button("Refresh Usage") {
                    Task { await loadAccount() }
                }
                .disabled(isLoading)
            } else {
                SignInWithAppleButton(.signIn) { request in
                    request.requestedScopes = []
                    request.nonce = nonce.map(Self.sha256)
                } onCompletion: { result in
                    Task { await signIn(result) }
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
        .task {
            if isSignedIn {
                await loadAccount()
            } else {
                await prepareNonce()
            }
        }
        .task(id: isSignedIn) {
            guard isSignedIn else { return }
            for await verification in Transaction.updates {
                await handle(verification)
            }
        }
        .sheet(isPresented: $showsSubscriptions) {
            subscriptionSheet
        }
    }

    private var subscriptionSheet: some View {
        NavigationStack {
            Form {
                Section {
                    if products.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            if productLoadError == nil {
                                ProgressView()
                            }
                            Text(productLoadError ?? String(localized: "Loading subscriptions…"))
                                .foregroundStyle(.secondary)
                        }
                        .task { await loadProducts() }
                    } else {
                        ForEach(products, id: \.id) { product in
                            Button {
                                Task { await purchase(product) }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(product.displayName)
                                        Text(product.description)
                                            .font(.footnote)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if purchasingProductID == product.id {
                                        ProgressView()
                                            .controlSize(.small)
                                    } else {
                                        Text(product.displayPrice)
                                    }
                                }
                            }
                            .disabled(purchasingProductID != nil || usage?.productID == product.id)
                        }
                    }
                } footer: {
                    if products.isEmpty, productLoadError != nil {
                        Text("Check that the Plus and Pro subscriptions are available in App Store Connect for this app.")
                    }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Subscribe")
            .toolbar {
                Button("Done") { showsSubscriptions = false }
            }
        }
        .frame(minWidth: 360, minHeight: 280)
    }

    private func signIn(_ result: Result<ASAuthorization, Error>) async {
        do {
            guard let nonce else { throw URLError(.userAuthenticationRequired) }
            guard let credential = try result.get().credential as? ASAuthorizationAppleIDCredential,
                  let identityToken = credential.identityToken.flatMap({ String(data: $0, encoding: .utf8) }) else { return }
            var request = URLRequest(url: gatewayURL.appending(path: "auth/apple"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(["identityToken": identityToken, "nonce": nonce])
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let token = try JSONDecoder().decode([String: String].self, from: data)["token"] else {
                throw URLError(.badServerResponse)
            }
            ApiKeyStore.write("chatext", token)
            keys["chatext"] = token
            self.nonce = nil
            error = nil
            await loadAccount()
        } catch ASAuthorizationError.canceled {
            // The user dismissed the sheet; nothing to report.
        } catch {
            self.error = error.localizedDescription
            nonce = nil
            await prepareNonce()
        }
    }

    private func prepareNonce() async {
        guard nonce == nil, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            var request = URLRequest(url: gatewayURL.appending(path: "auth/apple/nonce"))
            request.httpMethod = "POST"
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let value = try JSONDecoder().decode([String: String].self, from: data)["nonce"] else {
                throw URLError(.badServerResponse)
            }
            nonce = value
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadUsage() async {
        guard !isLoading, let token else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            var request = URLRequest(url: gatewayURL.appending(path: "usage"))
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
            usage = try JSONDecoder().decode(GatewayUsage.self, from: data)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadAccount() async {
        await loadUsage()
        await loadProducts()
        await syncCurrentEntitlements()
        await loadUsage()
    }

    private func loadProducts() async {
        do {
            products = try await Product.products(for: Self.subscriptionProductIDs)
                .sorted { Self.subscriptionProductIDs.firstIndex(of: $0.id)! < Self.subscriptionProductIDs.firstIndex(of: $1.id)! }
            productLoadError = products.isEmpty ? String(localized: "Subscriptions are currently unavailable.") : nil
        } catch {
            productLoadError = error.localizedDescription
        }
    }

    private func purchase(_ product: Product) async {
        guard let accountToken = usage.flatMap({ UUID(uuidString: $0.appAccountToken) }) else { return }
        purchasingProductID = product.id
        defer { purchasingProductID = nil }
        do {
            switch try await product.purchase(options: [.appAccountToken(accountToken)]) {
            case .success(let verification):
                await handle(verification)
                showsSubscriptions = false
            case .pending, .userCancelled:
                break
            @unknown default:
                break
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func restorePurchases() async {
        guard !isLoading else { return }
        isLoading = true
        do {
            try await AppStore.sync()
            await syncCurrentEntitlements()
            isLoading = false
            await loadUsage()
        } catch {
            isLoading = false
            self.error = error.localizedDescription
        }
    }

    private func syncCurrentEntitlements() async {
        for await verification in Transaction.currentEntitlements {
            guard Self.subscriptionProductIDs.contains(verification.unsafePayloadValue.productID) else { continue }
            await handle(verification)
        }
    }

    private func handle(_ verification: VerificationResult<StoreKit.Transaction>) async {
        guard case .verified(let transaction) = verification,
              Self.subscriptionProductIDs.contains(transaction.productID) else { return }
        do {
            try await submit(verification.jwsRepresentation)
            await transaction.finish()
            await loadUsage()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func submit(_ signedTransaction: String) async throws {
        guard let token else { throw URLError(.userAuthenticationRequired) }
        var request = URLRequest(url: gatewayURL.appending(path: "billing/transaction"))
        request.httpMethod = "POST"
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["signedTransaction": signedTransaction])
        let (_, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
    }

    private nonisolated static func sha256(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

}

private struct GatewayUsage: Decodable {
    let plan: String
    let productID: String?
    let currency: String
    let allowanceUsd: Double
    let estimatedCostUsd: Double
    let remainingUsd: Double
    let inputTokens: Int
    let outputTokens: Int
    let requests: Int
    let appAccountToken: String
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
