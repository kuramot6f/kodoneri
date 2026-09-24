import Foundation
import Security

/// API keys shared by the app and the extension through the iCloud-synchronized Keychain.
/// The chatext gateway token lives here too, under the "chatext" provider.
nonisolated enum ApiKeyStore {

    static let providers = ["openai", "anthropic", "deepseek", "chatext"]

    private static let service = "kuramot6f.chatext.apiKeys"

    static func read(_ provider: String) -> String? {
        var query = baseQuery(provider)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// An empty key removes the entry. An unchanged key is not written, so iCloud has nothing to sync.
    static func write(_ provider: String, _ key: String) {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed != read(provider) ?? "" else { return }
        guard !trimmed.isEmpty else { return delete(provider) }
        // Updated in place, so the extension never reads the key missing mid-write.
        let data = Data(trimmed.utf8)
        guard SecItemUpdate(baseQuery(provider) as CFDictionary, [kSecValueData as String: data] as CFDictionary) == errSecItemNotFound else { return }
        var attributes = baseQuery(provider)
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(attributes as CFDictionary, nil)
    }

    static func delete(_ provider: String) {
        SecItemDelete(baseQuery(provider) as CFDictionary)
    }

    static func all() -> [String: String] {
        Dictionary(uniqueKeysWithValues: providers.compactMap { provider in read(provider).map { (provider, $0) } })
    }

    // The data protection keychain keeps macOS from prompting and is what iCloud Keychain syncs.
    private static func baseQuery(_ provider: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: provider,
         kSecAttrSynchronizable as String: true,
         kSecUseDataProtectionKeychain as String: true]
    }

}
