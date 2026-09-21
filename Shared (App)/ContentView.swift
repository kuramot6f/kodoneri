//
//  ContentView.swift
//  Shared (App)
//
//  Created by Daichi on 9/19/26.
//

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
