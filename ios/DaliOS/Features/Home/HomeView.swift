import SwiftUI

struct HomeView: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        ContentUnavailableView {
            Label("DALI OS", systemImage: "square.grid.2x2")
        } description: {
            Text("Connected to \(settings.environment.baseURL.host() ?? "server")")
        }
        .navigationTitle("Home")
    }
}

#Preview {
    NavigationStack { HomeView() }
        .environment(AppSettings())
}
