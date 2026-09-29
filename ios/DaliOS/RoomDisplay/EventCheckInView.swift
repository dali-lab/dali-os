import SwiftUI

/// Event mode: the display is a wallet-pass check-in station for the DALI event
/// running in this room.
struct EventCheckInView: View {
    let event: ScheduleItem
    let room: DisplayRoom?
    let now: Date
    @Environment(DisplayStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 8) {
                    OSStatusPill(text: "DALI event check-in", dot: OS.violet.ink)
                    Text(event.title)
                        .font(OS.font(48, .medium))
                        .foregroundStyle(OS.fg)
                        .lineLimit(2)
                    Text([event.timeRange, room?.name].compactMap { $0 }.joined(separator: " · "))
                        .font(OS.font(20).monospacedDigit())
                        .foregroundStyle(OS.grey)
                }
                Spacer()
                Text(now, format: .dateTime.hour().minute())
                    .font(OS.font(36, .medium).monospacedDigit())
                    .foregroundStyle(OS.fg)
            }

            PassScanPanel(
                prompt: "Hold your DALI pass up to the camera",
                submit: { token in try await store.checkIn(memberToken: token) },
                successTitle: { member in "Welcome, \(member.firstName)!" }
            )
        }
        .padding(36)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(OS.bg.ignoresSafeArea())
    }
}
