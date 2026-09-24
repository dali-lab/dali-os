import SwiftUI

/// Tab bar on iPhone, collapsible sidebar on iPad — `.sidebarAdaptable` picks per size class.
struct RootView: View {
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
