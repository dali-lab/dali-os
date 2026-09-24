import SwiftUI

/// The glanceable half of the door display: free/busy in color big enough to
/// read from down the hall, the current and next booking, and walk-up booking.
struct StatusPanel: View {
    let room: DisplayRoom?
    let items: [ScheduleItem]
    let now: Date
    let isOffline: Bool
    let onBook: (Int) -> Void

    private var snapshot: RoomSnapshot { RoomSnapshot(items: items, now: now) }

    var body: some View {
        let snapshot = snapshot
        let color = snapshot.current == nil ? DisplayTheme.available : DisplayTheme.busy
        VStack(alignment: .leading, spacing: 28) {
            header
            Spacer(minLength: 0)
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
            utilization
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .foregroundStyle(.white)
        .background(color.gradient)
        .animation(.easeInOut, value: snapshot.current?.occurrenceID)
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 4) {
                Text(room?.name ?? "Room")
                    .font(.largeTitle.bold())
                if let detail = [room?.description, room?.capacity.map { "Seats \($0)" }]
                    .compactMap({ $0 }).joined(separator: " · ").nilIfEmpty {
                    Text(detail).font(.title3).opacity(0.85)
                }
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(now, format: .dateTime.hour().minute())
                    .font(.largeTitle.monospacedDigit().weight(.semibold))
                if isOffline {
                    Label("Offline", systemImage: "wifi.slash").font(.subheadline.weight(.semibold))
                }
            }
        }
    }

    private func status(_ snapshot: RoomSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(snapshot.current == nil ? "Available" : "In use")
                .font(.system(size: 76, weight: .bold, design: .rounded))
            Text(statusDetail(snapshot))
                .font(.title2.weight(.medium))
                .opacity(0.9)
        }
    }

    private func statusDetail(_ snapshot: RoomSnapshot) -> String {
        if let current = snapshot.current {
            let left = Duration.seconds(current.end.timeIntervalSince(now))
                .formatted(.units(allowed: [.hours, .minutes], width: .wide))
            return "Until \(current.end.formatted(date: .omitted, time: .shortened)) · \(left) left"
        }
        if let next = snapshot.next {
            return "Free until \(next.start.formatted(date: .omitted, time: .shortened))"
        }
        return "Free for the rest of the day"
    }

    private func itemCard(label: String, item: ScheduleItem) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased())
                .font(.caption.weight(.bold))
                .opacity(0.75)
            Text(item.title)
                .font(.title2.weight(.semibold))
                .lineLimit(2)
            Text("\(item.timeRange) · \(item.durationText) · \(item.organizerName)")
                .font(.body.monospacedDigit())
                .opacity(0.85)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.white.opacity(0.14), in: .rect(cornerRadius: 20))
    }

    private func bookNow(_ options: [Int]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("BOOK NOW")
                .font(.caption.weight(.bold))
                .opacity(0.75)
            HStack(spacing: 12) {
                ForEach(options, id: \.self) { minutes in
                    Button {
                        onBook(minutes)
                    } label: {
                        Text(Duration.seconds(minutes * 60).formatted(.units(allowed: [.hours, .minutes], width: .abbreviated)))
                            .font(.title3.weight(.semibold))
                            .frame(maxWidth: .infinity, minHeight: 56)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(DisplayTheme.available)
                    .background(.white, in: .rect(cornerRadius: 16))
                }
            }
        }
    }

    private var utilization: some View {
        let calendar = Calendar.current
        let dayStart = calendar.date(bySettingHour: 8, minute: 0, second: 0, of: now)!
        let dayEnd = calendar.date(bySettingHour: 22, minute: 0, second: 0, of: now)!
        let fraction = RoomSnapshot.bookedFraction(items, dayStart: dayStart, dayEnd: dayEnd)
        return VStack(alignment: .leading, spacing: 8) {
            Text("Booked \(fraction.formatted(.percent.precision(.fractionLength(0)))) of today (8am–10pm)")
                .font(.subheadline.weight(.medium))
                .opacity(0.85)
            GeometryReader { proxy in
                Capsule().fill(.white.opacity(0.25))
                    .overlay(alignment: .leading) {
                        Capsule().fill(.white).frame(width: proxy.size.width * fraction)
                    }
            }
            .frame(height: 8)
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
