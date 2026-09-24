import AuthenticationServices
import CryptoKit
import SafariServices
import StoreKit
import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// A grouped form, so the window reads like Settings on both platforms.
/// Tasks and sheets hang off the `Form`: on iOS it's a `List`, which copies a `Section`'s modifiers onto every row.
struct ContentView: View {

    @Environment(\.scenePhase) private var scenePhase
    @State private var account = Account()
    /// `nil` until Safari reports the extension's state, or if it can't.
    @State private var isExtensionEnabled: Bool?

    var body: some View {
        Form {
            if account.keys?.isEmpty == true {
                Section {
                    Text("Sign in with Apple to use Kodoneri’s free plan, or add your own OpenAI, Anthropic, or DeepSeek API key.")
                } header: {
                    Text("Get Started for Free")
                }
            }

            ExtensionSection(isEnabled: isExtensionEnabled)

            if account.keys != nil {
                GatewaySection(account: account)
                ApiKeysSection(account: account)
            }

            MoreSection(account: account)
        }
        .formStyle(.grouped)
        .navigationTitle("Kodoneri")
        .refreshable {
            await account.reload()
        }
        // Keychain reads can stall on first access, so keep them off the main thread.
        .task {
            account.keys = await Task.detached { ApiKeyStore.all() }.value
        }
        // The toggle lives in Safari's settings, and usage grows while the user chats, so check both whenever the user comes back.
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            isExtensionEnabled = await SafariExtension.isEnabled()
            await account.reload()
        }
        // Starts once the keys load, and again on sign-in and sign-out.
        .task(id: account.keys.map { $0["chatext"] != nil }) {
            await account.run()
        }
        // Picks up restored purchases, which don't arrive through `onInAppPurchaseCompletion`.
        .sheet(isPresented: $account.showsSubscriptions, onDismiss: {
            Task { await account.perform(account.loadAccount) }
        }) {
            SubscriptionStoreView(productIDs: Account.productIDs)
                .storeButton(.visible, for: .cancellation, .restorePurchases)
                .inAppPurchaseOptions { _ in
                    guard let token = account.usage?.appAccountToken else { return [] }
                    return [.appAccountToken(token)]
                }
                .onInAppPurchaseCompletion { _, result in
                    await account.perform {
                        guard case .success(let verification) = try result.get() else { return }
                        account.showsSubscriptions = false
                        try await account.submit(verification)
                    }
                }
                .frame(minWidth: 360, minHeight: 400)
        }
    }

}

/// Last on the page, with sign-out at the very bottom as in Settings.
private struct MoreSection: View {

    let account: Account
    @State private var status: String?
    @State private var isConfirmingSignOut = false

    var body: some View {
        Section {
            Button("Copy Debug Logs") {
                do {
                    let contents = try SharedDebugLog.export()
#if os(macOS)
                    NSPasteboard.general.clearContents()
                    guard NSPasteboard.general.setString(contents, forType: .string) else {
                        throw CocoaError(.fileWriteUnknown)
                    }
#else
                    UIPasteboard.general.string = contents
#endif
                    status = String(localized: "Debug Logs Copied")
                } catch {
                    status = String(localized: "Could Not Copy Debug Logs")
                }
            }
            if let status {
                Text(status)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Link(destination: URL(string: "https://github.com/kuramot6f/kodoneri")!) {
                Text(verbatim: "GitHub")
            }
            if account.token != nil {
                Button("Sign Out", role: .destructive) {
                    isConfirmingSignOut = true
                }
                .confirmationDialog("Are you sure you want to sign out?", isPresented: $isConfirmingSignOut, titleVisibility: .visible) {
                    Button("Sign Out", role: .destructive) { account.signOut() }
                }
            }
        }
    }

}

/// The Keychain's keys and the Kodoneri account. Sign in with Apple is traded for a gateway token, kept in the Keychain like an API key.
@Observable
final class Account {

    static let productIDs = ["plus", "pro"]

    /// Everything in the Keychain, the gateway token included; `nil` until the first read finishes.
    var keys: [String: String]?
    var nonce: String?
    var usage: GatewayUsage?
    var showsSubscriptions = false
    var isLoading = false
    var error: String?

    var token: String? { keys?["chatext"] }

    /// Goes straight to the Keychain; the extension reads keys when a conversation starts. An empty value removes the key.
    func setKey(_ provider: String, _ value: String) {
        keys?[provider] = value.isEmpty ? nil : value
        ApiKeyStore.write(provider, value)
    }

    /// Fetches a nonce while signed out; once signed in, loads the account and forwards new transactions until cancelled.
    func run() async {
        guard keys != nil else { return }
        guard token != nil else { return await perform(prepareNonce) }
        await perform(loadAccount)
        for await verification in Transaction.updates {
            await perform { try await submit(verification) }
        }
    }

    /// Retries whatever `run()` left missing after a failure, or else refreshes usage. Skipped before the keys load and while
    /// something is loading, so the first activation leaves the work to `run()`.
    func reload() async {
        guard keys != nil, !isLoading else { return }
        if token == nil {
            if nonce == nil { await perform(prepareNonce) }
        } else {
            await perform(usage == nil ? loadAccount : refreshUsage)
        }
    }

    /// Tracks `isLoading` and keeps any failure in `error`.
    func perform(_ work: () async throws -> Void) async {
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

    func signIn(_ result: Result<ASAuthorization, Error>) async throws {
        guard let credential = try result.get().credential as? ASAuthorizationAppleIDCredential,
              let identityToken = credential.identityToken.flatMap({ String(data: $0, encoding: .utf8) }),
              let nonce else { throw URLError(.userAuthenticationRequired) }
        // Each nonce works once, so a failed attempt needs a fresh one.
        self.nonce = nil
        do {
            let response: [String: String] = try await gateway("auth/apple", body: ["identityToken": identityToken, "nonce": nonce])
            guard let token = response["token"] else { throw URLError(.badServerResponse) }
            setKey("chatext", token)
        } catch {
            try? await prepareNonce()
            throw error
        }
    }

    func signOut() {
        setKey("chatext", "")
        usage = nil
    }

    func refreshUsage() async throws {
        usage = try await gateway("usage")
    }

    /// Loads usage, then hands the gateway any subscription it may have missed.
    func loadAccount() async throws {
        try await refreshUsage()
        for await verification in Transaction.currentEntitlements {
            try await submit(verification)
        }
    }

    /// The gateway links the subscription to this account and answers with the updated usage.
    func submit(_ verification: VerificationResult<StoreKit.Transaction>) async throws {
        guard case .verified(let transaction) = verification,
              Self.productIDs.contains(transaction.productID) else { return }
        usage = try await gateway("billing/transaction", body: ["signedTransaction": verification.jwsRepresentation])
        await transaction.finish()
    }

    private func prepareNonce() async throws {
        let response: [String: String] = try await gateway("auth/apple/nonce", body: [:])
        guard let nonce = response["nonce"] else { throw URLError(.badServerResponse) }
        self.nonce = nonce
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
        let decoder = JSONDecoder()
        // The gateway sends `Date.toISOString()`, which has milliseconds.
        decoder.dateDecodingStrategy = .custom {
            try Date(try $0.singleValueContainer().decode(String.self), strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true))
        }
        return try decoder.decode(Response.self, from: data)
    }

    nonisolated static func sha256(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

}

struct GatewayUsage: Decodable {
    let plan: String
    let currency: String
    let allowanceUsd: Double
    let estimatedCostUsd: Double
    let period: Period?
    let appAccountToken: UUID

    struct Period: Decodable {
        let end: Date
    }

    var fraction: Double { allowanceUsd > 0 ? min(estimatedCostUsd / allowanceUsd, 1) : 1 }
}

/// One row per provider.
private struct ApiKeysSection: View {

    private static let rows = [("openai", "OpenAI"), ("anthropic", "Anthropic"), ("deepseek", "DeepSeek")]

    let account: Account

    var body: some View {
        Section {
            ForEach(Self.rows, id: \.0) { provider, label in
                LabeledContent(label) {
                    HStack {
                        SecureField("", text: binding(provider), prompt: Text("API key"))
                            .autocorrectionDisabled()
#if os(iOS)
                            .textInputAutocapitalization(.never)
#endif
                        if account.keys?[provider] != nil {
                            Button {
                                account.setKey(provider, "")
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
            get: { account.keys?[provider] ?? "" },
            set: { account.setKey(provider, $0) }
        )
    }

}

private struct GatewaySection: View {

    @Environment(\.colorScheme) private var colorScheme
    let account: Account

    var body: some View {
        Section {
            if account.token != nil {
                if let usage = account.usage {
                    LabeledContent("Plan") {
                        Text(usage.plan.capitalized)
                    }
                    VStack(alignment: .leading) {
                        Gauge(value: usage.fraction) {
                            Text("Usage")
                        } currentValueLabel: {
                            Text(usage.fraction, format: .percent.precision(.fractionLength(0)))
                        }
                        .gaugeStyle(.linearCapacity)
                        if let end = usage.period?.end {
                            Text("Resets \(end, format: .relative(presentation: .named))")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                Button(account.usage?.plan == "free" ? "Subscribe" : "Change Subscription") {
                    account.showsSubscriptions = true
                }
                .disabled(account.isLoading || account.usage == nil)
            } else {
                SignInWithAppleButton(.signIn) { request in
                    request.requestedScopes = []
                    request.nonce = account.nonce.map(Account.sha256)
                } onCompletion: { result in
                    Task { await account.perform { try await account.signIn(result) } }
                }
                .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
                .frame(height: 36)
                .disabled(account.nonce == nil || account.isLoading)
            }
            if let error = account.error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(.red)
            }
        } header: {
            Text("Kodoneri Plan")
        } footer: {
            Text(account.token != nil ? "Usage is recorded after each response and may take a moment to appear." : "Kodoneri doesn’t receive your name or email address when you sign in with Apple.")
        }
    }

}

private struct ExtensionSection: View {

    let isEnabled: Bool?
    @AppStorage(AppSettings.chatButtonKey, store: AppSettings.defaults) private var chatButton = AppSettings.chatButtonDefault

    var body: some View {
        Section {
            Toggle("Show Chat Button on Web Pages", isOn: $chatButton)
            if SafariExtension.canManage {
                if let isEnabled {
                    LabeledContent("Status") {
                        if isEnabled { Text("Enabled") } else { Text("Disabled") }
                    }
                }
                Button(isEnabled == true ? "Manage in Safari Settings…" : "Enable in Safari Settings…") {
                    Task { await SafariExtension.openSettings() }
                }
            } else if #available(iOS 18, *) {
                // Safari can't report the state here, so the directions read the same whether the extension is on or off.
                Text("If you haven’t turned on Kodoneri yet, go to Settings > Apps > Safari > Extensions.")
            } else {
                Text("If you haven’t turned on Kodoneri yet, go to Settings > Safari > Extensions.")
            }
        } header: {
            Text("Safari Extension")
        }
    }

}

/// Safari reports the extension's state and opens its settings on macOS and iOS 26.2+; older iOS gets directions instead.
private enum SafariExtension {

    static var canManage: Bool {
#if os(macOS)
        true
#else
        if #available(iOS 26.2, *) { true } else { false }
#endif
    }

    static func isEnabled() async -> Bool? {
#if os(macOS)
        try? await SFSafariExtensionManager.stateOfSafariExtension(withIdentifier: extensionBundleIdentifier).isEnabled
#else
        guard #available(iOS 26.2, *) else { return nil }
        return try? await SFSafariExtensionManager.stateOfExtension(withIdentifier: extensionBundleIdentifier).isEnabled
#endif
    }

    static func openSettings() async {
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
