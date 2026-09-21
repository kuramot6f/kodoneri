//
//  ChatextApp.swift
//  Shared (App)
//
//  Created by Daichi on 9/19/26.
//

import SwiftUI

let extensionBundleIdentifier = "kuramot6f.chatext.Extension"

@main
struct ChatextApp: App {

    var body: some Scene {
#if os(macOS)
        // A single `Window` scene quits the app once its window closes, and
        // adds no "New Window" command — both of which suit a one-off
        // informational window.
        Window("chatext", id: "main") {
            ContentView()
        }
        .defaultSize(width: 440, height: 540)
#else
        WindowGroup {
            ContentView()
        }
#endif
    }

}
