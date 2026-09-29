import SwiftUI

@main
struct DaliOSApp: App {
    @State private var settings = AppSettings()

    init() {
        OS.registerFonts()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(settings)
        }
    }
}
