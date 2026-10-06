import SwiftUI

struct SettingsView: View {
    @Environment(AppSettings.self) private var settings

    var body: some View {
        @Bindable var settings = settings

        Form {
            #if DEBUG
            Section {
                Picker("Server", selection: $settings.environment) {
                    ForEach(AppEnvironment.allCases) { env in
                        Text(env.displayName).tag(env)
                    }
                }
            } header: {
                Text("Developer")
            } footer: {
                Text(settings.environment.baseURL.absoluteString)
            }
            #endif

            Section("About") {
                LabeledContent("Version", value: Bundle.main.appVersion)
            }
        }
        .navigationTitle("Settings")
    }
}

#Preview {
    NavigationStack { SettingsView() }
        .environment(AppSettings())
}
