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

        VStack(alignment: .leading, spacing: 20) {
            Text("Set up room display")
                .font(OS.font(36, .medium))
                .foregroundStyle(OS.fg)
            Text("In DALI OS, open Core ▸ Rooms, pick the room this iPad is mounted outside, and choose Add display. Enter the code it shows.")
                .font(OS.font(17))
                .foregroundStyle(OS.grey)

            VStack(alignment: .leading, spacing: 8) {
                Text("Setup code").osEyebrow()
                TextField("XXXX-XXXX", text: $code)
                    .font(OS.font(32, .semibold))
                    .tracking(4)
                    .foregroundStyle(OS.fg)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(OS.well, in: .rect(cornerRadius: OS.fieldRadius))
                    .overlay(RoundedRectangle(cornerRadius: OS.fieldRadius).strokeBorder(OS.container))
                    .onSubmit(activate)
                if let error {
                    Text(error)
                        .font(OS.font(14, .semibold))
                        .foregroundStyle(OS.danger)
                }
            }
            .padding(.top, 8)

            Button(action: activate) {
                Group {
                    if isWorking { ProgressView().tint(OS.bg) } else { Text("Pair display") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(OSPillButtonStyle())
            .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty || isWorking)
            .opacity(code.trimmingCharacters(in: .whitespaces).isEmpty ? 0.5 : 1)

            #if DEBUG
            VStack(alignment: .leading, spacing: 8) {
                Text("Server").osEyebrow()
                Picker("Server", selection: $settings.environment) {
                    ForEach(AppEnvironment.allCases) { env in
                        Text(env.displayName).tag(env)
                    }
                }
                .pickerStyle(.segmented)
            }
            .padding(.top, 8)
            #endif
        }
        .frame(maxWidth: 520)
        .osCard(padding: 36)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(OS.bg.ignoresSafeArea())
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
