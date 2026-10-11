import SafariServices
#if os(macOS)
import AppKit
#endif

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey] as? [String: Any] ?? [:]

        Task {
            let response = NSExtensionItem()
            response.userInfo = [SFExtensionMessageKey: await respond(to: message)]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        }
    }

    private func respond(to message: [String: Any]) async -> [String: Any] {
        switch message["type"] as? String {
        case "apiKeys":
            // The background script keeps the keys in memory; this is its only way to read the Keychain.
            return ApiKeyStore.all()
        case "settings":
            return ["chatButton": AppSettings.chatButton]
        case "debugRecord":
            if let event = message["event"] as? String,
               let metadata = message["metadata"] as? String {
                SharedDebugLog.record(event, metadata: metadata)
            }
            return [:]
        case "openSettings":
            // iOS extensions cannot launch the app, so the content script opens the chatext:// scheme there instead.
            #if os(macOS)
            // The extension lives at chatext.app/Contents/PlugIns/chatext Extension.appex.
            let appURL = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            NSWorkspace.shared.openApplication(at: appURL, configuration: NSWorkspace.OpenConfiguration(), completionHandler: nil)
            #endif
            return [:]
        case "cloudList":
            return await cloud { ["items": try await CloudStore.list()] }
        case "cloudGet":
            guard let keys = message["keys"] as? [String] else { break }
            return await cloud { ["values": try await CloudStore.get(keys)] }
        case "cloudPut":
            guard let key = message["key"] as? String,
                  let value = message["value"] as? String,
                  let updatedAt = message["updatedAt"] as? Double else { break }
            return await cloud { try await CloudStore.put(key, value: value, updatedAt: updatedAt); return [:] }
        default:
            break
        }
        return ["error": "unknown message"]
    }

    private func cloud(_ body: () async throws -> [String: Any]) async -> [String: Any] {
        do {
            return try await body()
        } catch {
            return ["error": error.localizedDescription]
        }
    }

}
