import SwiftUI

/// What a successful scan shows: who it was and what happened.
struct ScanResult: Equatable {
    let member: ScannedMember
    let title: String
    let detail: String
}

/// Camera + result overlay for scanning a DALI wallet pass. Each scan shows
/// its outcome, then it's ready for the next person; repeat reads of the same
/// code are ignored while it's on screen. With `onSuccessDone`, a success
/// flashes briefly and hands back instead (the booking sheet closes).
struct PassScanPanel: View {
    enum Size { case md, lg }

    let prompt: String
    let submit: (String) async throws -> ScanResult
    var onSuccessDone: ((ScanResult) -> Void)? = nil
    var size: Size = .md
    var rounded = true
    /// Where the debug Simulate buttons sit: top right, or above the prompt.
    var simulateAtBottom = false

    private enum Phase: Equatable {
        case ready
        case working
        case success(ScanResult)
        case failure(String)
    }

    private static let resultDuration: Duration = .seconds(3)
    private static let closeDelay: Duration = .milliseconds(900)

    @Environment(DisplayStore.self) private var store
    @State private var phase: Phase = .ready
    @State private var lastCode: String?
    #if DEBUG
    @State private var debugToken = ""
    #endif

    private var big: Bool { size == .lg }

    var body: some View {
        ZStack {
            Brand.coolBlack
            if QRScannerView.isCameraAvailable {
                QRScannerView { code in handle(code) }
                ScanFrame(scanning: phase == .ready)
            } else {
                noCamera
            }

            #if DEBUG
            if phase == .ready, store.isDemo || !QRScannerView.isCameraAvailable {
                simulateButtons
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: simulateAtBottom ? .bottomTrailing : .topTrailing)
                    .padding(simulateAtBottom ? EdgeInsets(top: 0, leading: 0, bottom: 96, trailing: 24) : EdgeInsets(top: 12, leading: 0, bottom: 0, trailing: 12))
            }
            #endif

            promptPill
                .frame(maxHeight: .infinity, alignment: .bottom)
                .padding(16)

            if phase != .ready {
                overlay
                    .transition(.opacity.combined(with: .scale(scale: 0.98)))
            }
        }
        .clipShape(.rect(cornerRadius: rounded ? Brand.cardRadius : 0))
        .animation(.easeOut(duration: 0.2), value: phase)
    }

    private var promptPill: some View {
        Label(prompt, systemImage: "qrcode.viewfinder")
            .font(Brand.body(big ? 22 : 17, .semibold))
            .foregroundStyle(.white)
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .background(Brand.darkNavy.opacity(0.85), in: .capsule)
    }

    @ViewBuilder
    private var overlay: some View {
        ZStack {
            switch phase {
            case .ready:
                EmptyView()
            case .working:
                Brand.darkNavy.opacity(0.85)
                VStack(spacing: 12) {
                    ProgressView().controlSize(.large).tint(.white)
                    Text("Checking pass…")
                        .font(Brand.body(19, .semibold))
                        .foregroundStyle(.white)
                }
            case .success(let result):
                Brand.teal
                VStack(spacing: 12) {
                    MemberAvatar(
                        firstName: result.member.firstName, lastName: result.member.lastName,
                        photoUrl: result.member.photoUrl, size: big ? 112 : 80, ring: true
                    )
                    .overlay(alignment: .bottomTrailing) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 28))
                            .foregroundStyle(Brand.teal)
                            .background(.white, in: .circle)
                            .offset(x: 4, y: 4)
                    }
                    Text(result.title)
                        .font(Brand.heading(big ? 40 : 26))
                        .foregroundStyle(.white)
                    Text(result.detail)
                        .font(Brand.body(17))
                        .foregroundStyle(.white.opacity(0.85))
                }
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
            case .failure(let message):
                Brand.coral
                VStack(spacing: 12) {
                    Image(systemName: "xmark.circle")
                        .font(.system(size: 48))
                        .foregroundStyle(.white)
                    Text("Couldn't scan that pass")
                        .font(Brand.heading(big ? 40 : 26))
                        .foregroundStyle(.white)
                    Text(message)
                        .font(Brand.body(17))
                        .foregroundStyle(.white.opacity(0.9))
                        .frame(maxWidth: 420)
                }
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
    }

    private var noCamera: some View {
        VStack(spacing: 8) {
            Image(systemName: "video.slash")
                .font(.system(size: 32))
                .foregroundStyle(Brand.mediumGray)
            Text("Camera unavailable")
                .font(Brand.body(19, .semibold))
                .foregroundStyle(.white)
            Text("Allow camera access for this display to scan DALI passes.")
                .font(Brand.body(15))
                .foregroundStyle(Brand.mediumGray)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 320)
            #if DEBUG
            TextField("Or paste a real pass token", text: $debugToken)
                .font(Brand.body(14))
                .padding(10)
                .background(.white, in: .rect(cornerRadius: Brand.rowRadius))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .frame(maxWidth: 340)
                .padding(.top, 8)
                .onSubmit {
                    handle(debugToken)
                    debugToken = ""
                }
            #endif
        }
        .padding(24)
    }

    #if DEBUG
    private var simulateButtons: some View {
        HStack(spacing: 8) {
            Button("Simulate a scan") { handle("simulated-\(UUID().uuidString)") }
                .buttonStyle(BrandButtonStyle(variant: .secondary, tint: .navy, size: .sm, rounded: true))
            Button("Invalid pass") { handle("\(DisplayStore.demoInvalidPrefix)\(UUID().uuidString)") }
                .buttonStyle(BrandButtonStyle(variant: .ghost, tint: .navy, size: .sm, rounded: true))
                .foregroundStyle(.white)
                .environment(\.colorScheme, .dark)
        }
    }
    #endif

    private func handle(_ code: String) {
        guard phase == .ready, code != lastCode, !code.isEmpty else { return }
        lastCode = code
        phase = .working
        Task {
            do {
                let result = try await submit(code)
                phase = .success(result)
                if let onSuccessDone {
                    try? await Task.sleep(for: Self.closeDelay)
                    lastCode = nil
                    onSuccessDone(result)
                    return
                }
            } catch {
                phase = .failure(error.localizedDescription)
            }
            try? await Task.sleep(for: Self.resultDuration)
            phase = .ready
            lastCode = nil
        }
    }
}

/// The QR target: four white corner brackets and a teal line sweeping
/// through while it's ready for a pass.
private struct ScanFrame: View {
    let scanning: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var sweep = false

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width * 0.56, proxy.size.height * 0.56, 260)
            ZStack {
                ForEach(0..<4, id: \.self) { corner in
                    CornerBracket()
                        .stroke(.white, style: StrokeStyle(lineWidth: 4, lineCap: .round))
                        .frame(width: 40, height: 40)
                        .rotationEffect(.degrees(Double(corner) * 90))
                        .frame(width: side, height: side, alignment: [.topLeading, .topTrailing, .bottomTrailing, .bottomLeading][corner])
                }
                if scanning, !reduceMotion {
                    Capsule()
                        .fill(Brand.lightTeal)
                        .frame(width: side - 24, height: 2)
                        .offset(y: (sweep ? 0.42 : -0.42) * side)
                        .onAppear {
                            withAnimation(.easeInOut(duration: 1.3).repeatForever(autoreverses: true)) { sweep = true }
                        }
                }
            }
            .frame(width: side, height: side)
            .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// A top-left corner: down the left edge, round the corner, along the top.
private struct CornerBracket: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let r: CGFloat = 12
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + r))
        path.addQuadCurve(to: CGPoint(x: rect.minX + r, y: rect.minY), control: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
        return path
    }
}
