import SwiftUI

/// The glanceable half of the door display: free/busy big enough to read from
/// down the hall, and the current and next booking. Sits on
/// the page ground; the status card carries everything about "right now".
/// Booking is behind the display's + button.
struct StatusPanel: View {
    let room: DisplayRoom?
    let items: [ScheduleItem]
    let now: Date
    let isOffline: Bool

    var body: some View {
        let snapshot = RoomSnapshot(items: items, now: now)
        VStack(alignment: .leading, spacing: 20) {
            header
            StatusHero(snapshot: snapshot)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .animation(.easeInOut(duration: 0.15), value: snapshot.current?.occurrenceID)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 4) {
                Text(room?.name ?? "Room")
                    .font(OS.font(32, .bold))
                    .foregroundStyle(OS.fg)
                let detail = [room?.description, room?.capacity.map { "Seats \($0)" }].compactMap { $0 }
                if !detail.isEmpty {
                    Text(detail.joined(separator: " · "))
                        .font(OS.font(16))
                        .foregroundStyle(OS.grey)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 8) {
                Text(now, format: .dateTime.hour().minute())
                    .font(OS.font(32, .regular).monospacedDigit())
                    .foregroundStyle(OS.grey)
                if isOffline {
                    OSStatusPill(text: "Offline", dot: OS.amber)
                }
            }
        }
    }
}
