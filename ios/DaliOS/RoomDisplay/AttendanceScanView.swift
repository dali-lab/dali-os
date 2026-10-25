import SwiftUI

/// iPad scanning switched on from a meeting's page: the camera fills the
/// screen, with the event and a live "12 of 48 checked in" floating on top.
/// Every door display in the lab does this at once, so the count comes from
/// the server and includes scans at the other iPads.
struct AttendanceScanView: View {
    let scan: AttendanceScan
    let now: Date
    @Environment(DisplayStore.self) private var store
    @State private var confirmingExit = false

    private var checkIns: CheckIns { scan.checkIns ?? CheckIns(count: 0, expected: 0, recent: []) }

    var body: some View {
        PassScanPanel(
            prompt: "Hold your DALI pass up to the camera",
            submit: { token in
                let response = try await store.checkIn(roomID: nil, memberToken: token)
                let member = response.member
                let already = response.alreadyCheckedIn == true
                return ScanResult(
                    member: member,
                    title: already ? "You're already in, \(member.firstName)" : "Welcome, \(member.firstName)!",
                    detail: already ? "Your attendance is already recorded." : member.fullName
                )
            },
            size: .lg,
            rounded: false,
            simulateAtBottom: true
        )
        .ignoresSafeArea()
        .overlay(alignment: .top) {
            HStack(alignment: .top, spacing: 16) {
                eventCard
                Spacer(minLength: 0)
                countCard
            }
            .padding(24)
        }
        .confirmationDialog("Exit attendance mode?", isPresented: $confirmingExit, titleVisibility: .visible) {
            Button("Exit") { store.exitAttendanceScan() }
            Button("Keep scanning", role: .cancel) {}
        } message: {
            Text("The display will go back to showing both rooms. Check-ins so far are saved.")
        }
    }

    private var eventCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                DaliLogo(color: .white, width: 72)
                Text("All-lab attendance")
                    .brandEyebrow(.white, size: 12, tracking: 1.9)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 4)
                    .background(Brand.teal, in: .capsule)
            }
            Text(scan.title)
                .font(Brand.heading(36))
                .foregroundStyle(.white)
                .lineLimit(2)
                .padding(.top, 16)
            if let timeRange = scan.timeRange {
                Text(timeRange)
                    .font(Brand.body(15))
                    .foregroundStyle(Brand.paleBlue)
                    .padding(.top, 4)
            }
            Button { confirmingExit = true } label: {
                Label("Exit attendance mode", systemImage: "rectangle.portrait.and.arrow.right")
            }
            .buttonStyle(BrandButtonStyle(variant: .ghost, tint: .navy, size: .sm, rounded: true))
            .foregroundStyle(Brand.paleBlue)
            .environment(\.colorScheme, .dark)
            .padding(.leading, -12)
            .padding(.top, 12)
        }
        .padding(20)
        .frame(maxWidth: 440, alignment: .leading)
        .background(Brand.darkNavy.opacity(0.85), in: .rect(cornerRadius: Brand.panelRadius))
    }

    private var countCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(DisplayFormat.time(now))
                .font(Brand.heading(24).monospacedDigit())
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity, alignment: .trailing)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(checkIns.count)")
                    .font(Brand.heading(48).monospacedDigit())
                    .foregroundStyle(.white)
                    .contentTransition(.numericText())
                Text(checkIns.expected > 0 ? "of \(checkIns.expected) checked in" : "checked in")
                    .font(Brand.body(15))
                    .foregroundStyle(Brand.paleBlue)
            }
            .padding(.top, 16)
            .accessibilityElement(children: .combine)
            if checkIns.expected > 0 {
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.white.opacity(0.15))
                        Capsule()
                            .fill(Brand.lightTeal)
                            .frame(width: proxy.size.width * min(1, Double(checkIns.count) / Double(checkIns.expected)))
                    }
                }
                .frame(height: 8)
                .padding(.top, 12)
                .animation(.spring(duration: 0.4), value: checkIns.count)
                .accessibilityHidden(true)
            }
            if !checkIns.recent.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(checkIns.recent.prefix(4), id: \.id) { member in
                        HStack(spacing: 12) {
                            MemberAvatar(firstName: member.firstName, lastName: member.lastName, photoUrl: member.photoUrl, size: 24)
                            Text("\(member.firstName) \(member.lastName)")
                                .font(Brand.body(15, .semibold))
                                .foregroundStyle(.white)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                            Text(DisplayFormat.time(member.at))
                                .font(Brand.mono(12))
                                .foregroundStyle(Brand.paleBlue)
                        }
                        .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                }
                .padding(.top, 16)
                .overlay(alignment: .top) { Rectangle().fill(.white.opacity(0.1)).frame(height: 1) }
                .padding(.top, 16)
                .animation(.easeOut(duration: 0.2), value: checkIns.recent.map(\.id))
                .accessibilityLabel("Recent check-ins")
            }
        }
        .padding(20)
        .frame(width: 300)
        .background(Brand.darkNavy.opacity(0.85), in: .rect(cornerRadius: Brand.panelRadius))
    }
}
