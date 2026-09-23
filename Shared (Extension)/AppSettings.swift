import Foundation

/// Settings the app writes and the extension reads, kept in the App Group's defaults.
nonisolated enum AppSettings {

    static let defaults = UserDefaults(suiteName: "group.kuramot6f.chatext")!

    static let chatButtonKey = "chatButton"
    /// Safari on iPhone and iPad keeps the extension's toolbar button out of sight, so the page button starts on there.
#if os(macOS)
    static let chatButtonDefault = false
#else
    static let chatButtonDefault = true
#endif

    static var chatButton: Bool {
        defaults.object(forKey: chatButtonKey) as? Bool ?? chatButtonDefault
    }

}

/// A copy of Safari's recent diagnostic events for the containing app's Copy button.
nonisolated enum SharedDebugLog {

    private static let eventsKey = "debugEvents"
    private static let metadataKey = "debugMetadata"
    private static let limit = 500

    static func record(_ event: String, metadata: String) {
        var events = AppSettings.defaults.stringArray(forKey: eventsKey) ?? []
        events.append(event)
        AppSettings.defaults.set(Array(events.suffix(limit)), forKey: eventsKey)
        AppSettings.defaults.set(metadata, forKey: metadataKey)
    }

    static func clear() {
        AppSettings.defaults.removeObject(forKey: eventsKey)
    }

    static func export() throws -> String {
        let events = try (AppSettings.defaults.stringArray(forKey: eventsKey) ?? []).map { event in
            try JSONSerialization.jsonObject(with: Data(event.utf8))
        }
        let metadata = try AppSettings.defaults.string(forKey: metadataKey).map {
            try JSONSerialization.jsonObject(with: Data($0.utf8))
        } ?? [:]
        let data = try JSONSerialization.data(withJSONObject: [
            "generatedAt": ISO8601DateFormatter().string(from: Date()),
            "metadata": metadata,
            "events": events
        ], options: [.prettyPrinted, .sortedKeys])
        return String(decoding: data, as: UTF8.self)
    }

}
