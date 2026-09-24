import SwiftUI

struct RoomDisplayRoot: View {
    private func makeStore() -> DisplayStore {
        let store = DisplayStore(settings: settings)
        #if DEBUG
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-demoDisplay") {
            store.startDemo(event: args.dropFirst(i + 1).first == "event")
        }
        #endif
        return store
    }

    @Environment(AppSettings.self) private var settings
    @State private var store: DisplayStore?

    var body: some View {
        Group {
            if let store {
                Group {
                    if store.isPaired {
                        RoomDisplayView()
                    } else {
                        DisplaySetupView()
                    }
                }
                .environment(store)
            } else {
                // A placeholder so the modifiers below (store creation) run.
                Color(.systemBackground).ignoresSafeArea()
            }
        }
        // Rebuilt per server so a debug environment switch reads that server's token.
        .task(id: settings.environment) { store = makeStore() }
        // Wall-mounted: never dim or lock, and keep the system chrome out of the way.
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
    }
}
