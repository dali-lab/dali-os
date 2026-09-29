import SwiftUI

/// iPad scanning switched on from Attendance: the whole screen is the camera,
/// checking wallet passes in to one event from any room.
struct AttendanceScanView: View {
    let scan: AttendanceScan
    @Environment(DisplayStore.self) private var store

    var body: some View {
        PassScanPanel(
            prompt: "Hold your DALI pass up to the camera",
            submit: { token in try await store.checkIn(memberToken: token) },
            successTitle: { member in "Welcome, \(member.firstName)!" },
            cornerRadius: 0
        )
        .ignoresSafeArea()
        .overlay(alignment: .top) {
            VStack(spacing: 6) {
                OSStatusPill(text: "Attendance check-in", dot: OS.green)
                Text(scan.title)
                    .font(OS.font(32, .medium))
                    .foregroundStyle(OS.fg)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                if let timeRange = scan.timeRange {
                    Text(timeRange)
                        .font(OS.font(18).monospacedDigit())
                        .foregroundStyle(OS.grey)
                }
            }
            .padding(.horizontal, 32)
            .padding(.vertical, 20)
            .background(OS.card, in: .rect(cornerRadius: OS.cardRadius))
            .shadow(color: OS.shadow, radius: 20, y: 8)
            .padding(.top, 32)
        }
    }
}
