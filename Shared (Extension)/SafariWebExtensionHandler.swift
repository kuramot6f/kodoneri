import SafariServices
#if os(macOS)
import AppKit
#endif

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey] as? [String: Any]

        let payload: [String: Any]
        switch message?["type"] as? String {
        case "apiKeys":
            // The background script keeps the keys in memory; this is its only way to read the Keychain.
            payload = ApiKeyStore.all()
        case "settings":
            payload = ["chatButton": AppSettings.chatButton]
        case "openSettings":
            // iOS extensions cannot launch the app, so the content script opens the chatext:// scheme there instead.
            #if os(macOS)
            // The extension lives at chatext.app/Contents/PlugIns/chatext Extension.appex.
            let appURL = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            NSWorkspace.shared.openApplication(at: appURL, configuration: NSWorkspace.OpenConfiguration())
            #endif
            payload = [:]
        default:
            payload = ["error": "unknown message"]
        }

        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: payload]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

}
