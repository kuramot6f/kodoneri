//
//  SafariWebExtensionHandler.swift
//  Shared (Extension)
//
//  Created by Daichi on 9/19/26.
//

import SafariServices

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey] as? [String: Any]

        // The background script keeps the keys in memory; this is its only way to read the Keychain.
        let payload: [String: Any] = message?["type"] as? String == "apiKeys"
            ? ApiKeyStore.all()
            : ["error": "unknown message"]

        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: payload]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

}
