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
