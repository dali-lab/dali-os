import SwiftUI

/// Camera + result overlay for scanning a DALI wallet pass. Runs continuously:
/// each scan shows its outcome for a few seconds, then it's ready for the next
/// person. Repeat reads of the same code are ignored while it's on screen.
struct PassScanPanel: View {
    let prompt: String
    let submit: (String) async throws -> ScannedMember
    let successTitle: (ScannedMember) -> String
    var onSuccess: (ScannedMember) -> Void = { _ in }

    private enum Phase: Equatable {
        case ready
        case working
        case success(ScannedMember)
        case failure(String)
    }

    private static let resultDuration: Duration = .seconds(3)

    @State private var phase: Phase = .ready
    @State private var lastCode: String?
    #if DEBUG
    @State private var debugToken = ""
    #endif

    var body: some View {
        ZStack {
            if QRScannerView.isCameraAvailable {
                QRScannerView { code in handle(code) }
            } else {
                noCamera
            }
            overlay
        }
        .clipShape(.rect(cornerRadius: 28))
    }

    @ViewBuilder
    private var overlay: some View {
        switch phase {
        case .ready:
            VStack {
                Spacer()
                Label(prompt, systemImage: "qrcode.viewfinder")
                    .font(.title2.weight(.semibold))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 14)
                    .background(.ultraThinMaterial, in: .capsule)
                    .padding(.bottom, 32)
            }
        case .working:
            ProgressView()
                .controlSize(.extraLarge)
                .padding(40)
                .background(.ultraThinMaterial, in: .rect(cornerRadius: 24))
        case .success(let member):
            resultCard(
                symbol: "checkmark.circle.fill",
                tint: .green,
                title: successTitle(member),
                detail: "\(member.firstName) \(member.lastName)"
            )
        case .failure(let message):
            resultCard(symbol: "xmark.octagon.fill", tint: .red, title: "Couldn't scan that pass", detail: message)
        }
    }

    private func resultCard(symbol: String, tint: Color, title: String, detail: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: symbol)
                .font(.system(size: 88))
                .foregroundStyle(tint)
            Text(title)
                .font(.largeTitle.bold())
                .multilineTextAlignment(.center)
            Text(detail)
                .font(.title3)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(48)
        .frame(maxWidth: 520)
        .background(.regularMaterial, in: .rect(cornerRadius: 32))
        .transition(.scale.combined(with: .opacity))
    }

    private var noCamera: some View {
        VStack(spacing: 16) {
            Image(systemName: "video.slash")
                .font(.system(size: 56))
                .foregroundStyle(.secondary)
            Text("Camera unavailable")
                .font(.title3.weight(.semibold))
            #if DEBUG
            Button("Simulate a scan") { handle("simulated-\(UUID().uuidString)") }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            TextField("…or paste a real pass token", text: $debugToken)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .frame(maxWidth: 420)
                .onSubmit {
                    handle(debugToken)
                    debugToken = ""
                }
            #endif
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.secondarySystemBackground))
    }

    private func handle(_ code: String) {
        guard phase == .ready, code != lastCode, !code.isEmpty else { return }
        lastCode = code
        phase = .working
        Task {
            do {
                let member = try await submit(code)
                withAnimation(.spring) { phase = .success(member) }
                onSuccess(member)
            } catch {
                withAnimation(.spring) { phase = .failure(error.localizedDescription) }
            }
            try? await Task.sleep(for: Self.resultDuration)
            withAnimation { phase = .ready }
            lastCode = nil
        }
    }
}
