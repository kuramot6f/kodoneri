//
//  ContentView.swift
//  Shared (App)
//
//  Created by Daichi on 9/19/26.
//

import SwiftUI

#if os(macOS)
import AppKit
import SafariServices
#endif

struct ContentView: View {

    var body: some View {
#if os(macOS)
        content
            .padding(40)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
#else
        // A scroll view keeps the key fields reachable while the keyboard is up.
        ScrollView {
            content
                .padding(20)
                .frame(maxWidth: .infinity)
        }
#endif
    }

    private var content: some View {
        VStack(spacing: 20) {
            Image("LargeIcon")
                .resizable()
                .frame(width: 128, height: 128)
                .accessibilityHidden(true)

#if os(macOS)
            ExtensionStateView()
#else
            Text("You can turn on chatext’s Safari extension in Settings.")
                .multilineTextAlignment(.center)
#endif

            ApiKeysView()
        }
    }

}

/// One text box per provider. Edits go straight to the Keychain; the extension reads them when a conversation starts.
private struct ApiKeysView: View {

    private static let rows = [("openai", "OpenAI"), ("anthropic", "Anthropic"), ("deepseek", "DeepSeek")]

    @State private var keys: [String: String] = [:]

    var body: some View {
        VStack(spacing: 12) {
            ForEach(Self.rows, id: \.0) { provider, label in
                HStack(spacing: 8) {
                    Text(label)
                        .frame(minWidth: 72, alignment: .leading)
                    TextField("API key", text: binding(provider))
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled()
#if os(iOS)
                        .textInputAutocapitalization(.never)
#endif
                    Button {
                        keys[provider] = ""
                        ApiKeyStore.delete(provider)
                    } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.borderless)
                    .disabled(keys[provider, default: ""].isEmpty)
                    .accessibilityLabel("Delete \(label) API key")
                }
            }
        }
        .frame(maxWidth: 420)
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

#if os(macOS)

/// Reports whether the Safari extension is currently enabled, and offers a
/// shortcut to the place in Safari where it can be turned on or off.
private struct ExtensionStateView: View {

    /// `nil` until Safari reports the extension's state, or if it can't be found.
    @State private var isEnabled: Bool?

    private var statusText: String {
        switch isEnabled {
        case true:
            return "chatext’s extension is currently on. You can turn it off in the Extensions section of Safari Settings."
        case false:
            return "chatext’s extension is currently off. You can turn it on in the Extensions section of Safari Settings."
        case nil:
            return "You can turn on chatext’s extension in the Extensions section of Safari Settings."
        }
    }

    var body: some View {
        VStack(spacing: 20) {
            Text(statusText)
                .multilineTextAlignment(.center)

            Button("Quit and Open Safari Settings…") {
                Task { await openSafariExtensionSettings() }
            }
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

#endif

#Preview {
    ContentView()
}
