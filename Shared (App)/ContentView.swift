//
//  ContentView.swift
//  Shared (App)
//
//  Created by Daichi on 9/19/26.
//

import AuthenticationServices
import CryptoKit
import SwiftUI

/// A grouped form, so the window reads like Settings on both platforms.
struct ContentView: View {

    var body: some View {
        Form {
            Section {
                ExtensionRows()
            } header: {
                AppHeader()
            }

            GatewaySection()
            ApiKeysSection()
        }
        .formStyle(.grouped)
    }

}

private struct AppHeader: View {

    var body: some View {
        VStack(spacing: 8) {
            Image("LargeIcon")
                .resizable()
                .frame(width: 96, height: 96)
                .accessibilityHidden(true)
            Text("chatext")
                .font(.title2.weight(.semibold))
                .foregroundStyle(.primary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .textCase(nil)
    }

}

/// One row per provider. Edits go straight to the Keychain; the extension reads them when a conversation starts.
private struct ApiKeysSection: View {

    private static let rows = [("openai", "OpenAI"), ("anthropic", "Anthropic"), ("deepseek", "DeepSeek")]

    @State private var keys: [String: String] = [:]

    var body: some View {
        Section {
            ForEach(Self.rows, id: \.0) { provider, label in
                LabeledContent(label) {
                    HStack {
                        SecureField("", text: binding(provider), prompt: Text("API key"))
                        if !keys[provider, default: ""].isEmpty {
                            Button {
                                keys[provider] = ""
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
            Text("Keys are kept in your iCloud Keychain and shared with the extension.")
        }
        // Keychain reads can stall on first access, so keep them off the main thread.
        .task {
            keys = await Task.detached { ApiKeyStore.all() }.value
        }
    }

    private func binding(_ provider: String) -> Binding<String> {
        Binding(
            get: { keys[provider, default: ""] },
            set: { value in
                keys[provider] = value
                ApiKeyStore.write(provider, value)
            }
        )
    }

}

/// Sign in with Apple is traded for a gateway token, which is kept in the Keychain like an API key.
private struct GatewaySection: View {

    @State private var isSignedIn = false
    @State private var nonce: String?
    @State private var usage: GatewayUsage?
    @State private var isLoading = false
    @State private var error: String?

    var body: some View {
        Section {
            if isSignedIn {
                LabeledContent("Apple ID") {
                    Button("Sign Out") {
                        ApiKeyStore.delete("chatext")
                        isSignedIn = false
                        usage = nil
                        Task { await prepareNonce() }
                    }
                }
                if let usage {
                    LabeledContent("This month") {
                        Text(usage.estimatedCostUsd, format: .currency(code: usage.currency))
                    }
                    LabeledContent("Usage") {
                        Text("\(usage.requests.formatted()) requests · \((usage.inputTokens + usage.outputTokens).formatted()) tokens")
                            .foregroundStyle(.secondary)
                    }
                }
                Button("Refresh Usage") {
                    Task { await loadUsage() }
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
            Text("chatext")
        } footer: {
            Text(isSignedIn ? "Usage is estimated by Cloudflare AI Gateway and may be delayed." : "Signing in adds a model that needs no API key.")
        }
        .task {
            isSignedIn = await Task.detached { ApiKeyStore.read("chatext") != nil }.value
            if isSignedIn {
                await loadUsage()
            } else {
                await prepareNonce()
            }
        }
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
            isSignedIn = true
            self.nonce = nil
            error = nil
            await loadUsage()
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
        guard !isLoading,
              let token = await Task.detached(operation: { ApiKeyStore.read("chatext") }).value else { return }
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

    private static func sha256(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

}

private struct GatewayUsage: Decodable {
    let currency: String
    let estimatedCostUsd: Double
    let inputTokens: Int
    let outputTokens: Int
    let requests: Int
}

#if os(macOS)

import SafariServices

/// Only macOS can ask Safari whether the extension is on, and jump to where it's toggled.
private struct ExtensionRows: View {

    /// `nil` until Safari reports the extension's state, or if it can't be found.
    @State private var isEnabled: Bool?

    var body: some View {
        LabeledContent("Safari Extension") {
            switch isEnabled {
            case true: Text("On")
            case false: Text("Off")
            case nil: Text("Unknown")
            }
        }
        Button("Quit and Open Safari Settings…") {
            Task { await openSafariExtensionSettings() }
        }
        .task {
            isEnabled = await currentExtensionState()
        }
    }

    /// `SFSafariExtensionManager` only vends a completion-handler API, so it is
    /// bridged here rather than at the call site.
    private func currentExtensionState() async -> Bool? {
        await withCheckedContinuation { continuation in
            SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { state, _ in
                continuation.resume(returning: state?.isEnabled)
            }
        }
    }

    private func openSafariExtensionSettings() async {
        let didOpen: Bool = await withCheckedContinuation { continuation in
            SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
                continuation.resume(returning: error == nil)
            }
        }

        // Safari didn't open; leave the window up so the user can retry.
        guard didOpen else { return }

        NSApp.terminate(nil)
    }

}

#else

private struct ExtensionRows: View {

    var body: some View {
        Text("Turn on chatext under Extensions in Safari’s settings.")
    }

}

#endif

#Preview {
    ContentView()
}
