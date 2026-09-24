import SwiftUI

/// First run: pair this iPad to a room with the code from Core ▸ Rooms.
struct DisplaySetupView: View {
    @Environment(DisplayStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @State private var code = ""
    @State private var isWorking = false
    @State private var error: String?

    var body: some View {
        @Bindable var settings = settings

        VStack(spacing: 28) {
            Image(systemName: "door.left.hand.open")
                .font(.system(size: 64))
                .foregroundStyle(.tint)
            VStack(spacing: 8) {
                Text("Set up room display")
                    .font(.largeTitle.bold())
                Text("In DALI OS, go to Core ▸ Rooms, pick the room this iPad is mounted outside, and choose Add display. Enter the code it shows.")
                    .font(.title3)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            TextField("XXXX-XXXX", text: $code)
                .font(.system(size: 40, weight: .semibold, design: .monospaced))
                .multilineTextAlignment(.center)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .padding(.vertical, 14)
                .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 16))
                .frame(maxWidth: 420)
                .onSubmit(activate)
            if let error {
                Text(error).foregroundStyle(.red)
            }
            Button(action: activate) {
                Group {
                    if isWorking { ProgressView() } else { Text("Pair display") }
                }
                .font(.title3.weight(.semibold))
                .frame(maxWidth: 420, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty || isWorking)

            #if DEBUG
            Picker("Server", selection: $settings.environment) {
                ForEach(AppEnvironment.allCases) { env in
                    Text(env.displayName).tag(env)
                }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 420)
            #endif
        }
        .padding(48)
        .frame(maxWidth: 640)
    }

    private func activate() {
        guard !isWorking else { return }
        isWorking = true
        error = nil
        Task {
            defer { isWorking = false }
            do {
                try await store.activate(code: code)
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
