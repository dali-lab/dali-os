import SwiftUI

/// iPad runs as a room door display; iPhone gets the member app (not built yet).
struct RootView: View {
    var body: some View {
        if UIDevice.current.userInterfaceIdiom == .pad {
            RoomDisplayRoot()
        } else {
            MemberTabs()
        }
    }
}

struct MemberTabs: View {
    @State private var selection: AppTab = .home

    var body: some View {
        TabView(selection: $selection) {
            Tab("Home", systemImage: "house", value: AppTab.home) {
                NavigationStack { HomeView() }
            }
            Tab("Settings", systemImage: "gearshape", value: AppTab.settings) {
                NavigationStack { SettingsView() }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
    }
}

enum AppTab: Hashable {
    case home
    case settings
}

#Preview {
    RootView()
        .environment(AppSettings())
}
