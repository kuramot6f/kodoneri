import SwiftUI

let extensionBundleIdentifier = "kuramot6f.chatext.Extension"
/// The Cloudflare Worker in `gateway/`, from `GATEWAY_HOST` in `Secrets.xcconfig`; the extension reads `.env.local`.
let gatewayURL = URL(string: Bundle.main.object(forInfoDictionaryKey: "GatewayURL") as! String)!

@main
struct ChatextApp: App {

    var body: some Scene {
#if os(macOS)
        // A single `Window` scene quits the app once its window closes, and
        // adds no "New Window" command — both of which suit a one-off
        // informational window.
        Window("Kodoneri", id: "main") {
            ContentView()
        }
        .defaultSize(width: 440, height: 540)
#else
        WindowGroup {
            NavigationStack {
                ContentView()
            }
        }
#endif
    }

}
