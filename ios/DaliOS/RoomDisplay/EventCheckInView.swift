import SwiftUI

/// Event mode: the display is a wallet-pass check-in station for the DALI event
/// running in this room.
struct EventCheckInView: View {
    let event: ScheduleItem
    let room: DisplayRoom?
    let now: Date
    @Environment(DisplayStore.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("DALI EVENT · CHECK IN")
                        .font(.headline.weight(.bold))
                        .opacity(0.8)
                    Text(event.title)
                        .font(.system(size: 52, weight: .bold, design: .rounded))
                        .lineLimit(2)
                    Text("\(event.timeRange) · \(room?.name ?? "")")
                        .font(.title2.monospacedDigit())
                        .opacity(0.85)
                }
                Spacer()
                Text(now, format: .dateTime.hour().minute())
                    .font(.largeTitle.monospacedDigit().weight(.semibold))
            }
            .foregroundStyle(.white)

            PassScanPanel(
                prompt: "Hold your DALI pass up to the camera",
                submit: { token in try await store.checkIn(memberToken: token) },
                successTitle: { member in "Welcome, \(member.firstName)!" }
            )
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DisplayTheme.event.gradient)
    }
}
