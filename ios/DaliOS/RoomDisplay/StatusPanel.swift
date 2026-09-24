import SwiftUI

/// The glanceable half of the door display: free/busy big enough to read from
/// down the hall, the current and next booking, and walk-up booking. Sits on
/// the page ground; only the status and the bookings are cards.
struct StatusPanel: View {
    let room: DisplayRoom?
    let items: [ScheduleItem]
    let now: Date
    let isOffline: Bool
    let onBook: (Int) -> Void

    var body: some View {
        let snapshot = RoomSnapshot(items: items, now: now)
        VStack(alignment: .leading, spacing: 20) {
            header
            status(snapshot)
            if let current = snapshot.current {
                itemCard(label: "Now", item: current)
            }
            if let next = snapshot.next {
                itemCard(label: "Next", item: next)
            }
            Spacer(minLength: 0)
            if !snapshot.bookableMinutes.isEmpty {
                bookNow(snapshot.bookableMinutes)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .animation(.easeInOut(duration: 0.15), value: snapshot.current?.occurrenceID)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 4) {
                Text(room?.name ?? "Room")
                    .font(OS.font(36, .medium))
                    .foregroundStyle(OS.fg)
                let detail = [room?.description, room?.capacity.map { "Seats \($0)" }].compactMap { $0 }
                if !detail.isEmpty {
                    Text(detail.joined(separator: " · "))
                        .font(OS.font(17))
                        .foregroundStyle(OS.grey)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 8) {
                Text(now, format: .dateTime.hour().minute())
                    .font(OS.font(36, .medium).monospacedDigit())
                    .foregroundStyle(OS.fg)
                if isOffline {
                    OSStatusPill(text: "Offline", dot: OS.amber)
                }
            }
        }
    }

    private func status(_ snapshot: RoomSnapshot) -> some View {
        let free = snapshot.current == nil
        let tone = free ? OS.green : OS.danger
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 18) {
                Circle().fill(tone).frame(width: 30, height: 30)
                Text(free ? "Available" : "In use")
                    .font(OS.font(72, .bold))
                    .foregroundStyle(tone)
            }
            Text(statusDetail(snapshot))
                .font(OS.font(22, .medium))
                .foregroundStyle(OS.grey)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .osCard(padding: 28)
    }

    private func statusDetail(_ snapshot: RoomSnapshot) -> String {
        if let current = snapshot.current {
            let left = Duration.seconds(current.end.timeIntervalSince(now))
                .formatted(.units(allowed: [.hours, .minutes], width: .wide))
            return "Until \(current.end.formatted(date: .omitted, time: .shortened)), \(left) left"
        }
        if let next = snapshot.next {
            return "Free until \(next.start.formatted(date: .omitted, time: .shortened))"
        }
        return "Free for the rest of the day"
    }

    private func itemCard(label: String, item: ScheduleItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).osEyebrow()
            Text(item.title)
                .font(OS.font(22, .semibold))
                .foregroundStyle(OS.fg)
                .lineLimit(2)
            Text("\(item.timeRange) · \(item.durationText) · \(item.organizerName)")
                .font(OS.font(15).monospacedDigit())
                .foregroundStyle(OS.grey)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .osCard(padding: 20)
    }

    private func bookNow(_ options: [Int]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Book now").osEyebrow()
            HStack(spacing: 12) {
                ForEach(options, id: \.self) { minutes in
                    Button {
                        onBook(minutes)
                    } label: {
                        Text(Duration.seconds(minutes * 60).formatted(.units(allowed: [.hours, .minutes], width: .abbreviated)))
                            .frame(maxWidth: .infinity, minHeight: 56)
                    }
                    .buttonStyle(OSPillButtonStyle(size: 19))
                }
            }
        }
    }
}
