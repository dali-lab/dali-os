import SwiftUI

/// The at-a-glance status, read from down the hall: one flat wash of the
/// status color, a big countdown of the free (or remaining) time, one line of
/// context, and — while in use — who has it and what's next. Booking lives
/// behind the display's + button.
struct StatusHero: View {
    let snapshot: RoomSnapshot

    private var isFree: Bool { snapshot.current == nil }
    private var tone: Color { isFree ? OS.green : OS.danger }
    /// Flat role fills, matched in weight so free and in-use read as a pair.
    private var palette: OS.Category { isFree ? OS.roleGreen : OS.roleRed }
    private var wash: Color { isFree ? OS.roleGreen.fill : OS.busyWash }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                PulsingDot(color: tone)
                Text(isFree ? "Available" : "In use")
                    .font(OS.font(16, .bold))
                    .tracking(1.6)
                    .textCase(.uppercase)
                    .foregroundStyle(palette.ink)
                if let current = snapshot.current {
                    HStack(spacing: 10) {
                        Avatar(organizer: current.organizer, size: 36, ink: palette.ink)
                        Text(current.organizerName)
                            .font(OS.font(18, .semibold))
                            .foregroundStyle(OS.fg)
                    }
                    .padding(.leading, 12)
                }
            }

            // Countdown and its context side by side keeps the card short, so
            // the day's calendar gets the height.
            HStack(alignment: .center, spacing: 28) {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(remainingText)
                        .font(OS.font(72, .bold).monospacedDigit())
                        .foregroundStyle(OS.fg)
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                    if remaining != nil {
                        Text(isFree ? "free" : "left")
                            .font(OS.font(26, .medium))
                            .foregroundStyle(palette.ink)
                    }
                }
                .fixedSize()
                VStack(alignment: .leading, spacing: 4) {
                    Text(headline)
                        .font(OS.font(24, .semibold))
                        .foregroundStyle(OS.fg)
                        .lineLimit(1)
                    if let detail {
                        Text(detail)
                            .font(OS.font(20))
                            .foregroundStyle(OS.grey)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.top, 4)

            if let current = snapshot.current {
                MeetingProgressBar(item: current, now: snapshot.now, tone: tone)
                    .padding(.top, 16)
            }

            if !isFree, let next = snapshot.next {
                upNext(next).padding(.top, 20)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(wash, in: .rect(cornerRadius: OS.cardRadius))
        .animation(.easeInOut(duration: 0.3), value: isFree)
    }

    // MARK: Next

    private func upNext(_ next: ScheduleItem) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Rectangle().fill(palette.ink.opacity(0.15)).frame(height: 1)
            HStack(alignment: .firstTextBaseline, spacing: 16) {
                Text("Next")
                    .font(OS.eyebrow)
                    .tracking(1.2)
                    .textCase(.uppercase)
                    .foregroundStyle(palette.ink)
                Text(next.title)
                    .font(OS.font(20, .semibold))
                    .foregroundStyle(OS.fg)
                    .lineLimit(1)
                Spacer(minLength: 12)
                Text(next.timeRange)
                    .font(OS.font(18).monospacedDigit())
                    .foregroundStyle(OS.grey)
            }
        }
    }

    // MARK: Countdown

    private var remaining: TimeInterval? {
        if let current = snapshot.current { return current.end.timeIntervalSince(snapshot.now) }
        return snapshot.next.map { $0.start.timeIntervalSince(snapshot.now) }
    }

    private var remainingText: String {
        guard let remaining else { return "All day" }
        let minutes = Int(remaining / 60)
        if minutes < 60 { return "\(max(minutes, 1)) min" }
        return minutes % 60 == 0 ? "\(minutes / 60)h" : "\(minutes / 60)h \(minutes % 60)m"
    }

    // MARK: Copy

    private var headline: String {
        if let current = snapshot.current { return current.title }
        if let next = snapshot.next { return "Until \(next.start.formatted(date: .omitted, time: .shortened))" }
        return "Nothing else booked today"
    }

    private var detail: String? {
        if snapshot.current != nil { return nil }
        if let next = snapshot.next { return "Then \(next.title)" }
        return nil
    }
}

/// How far through the current meeting we are, labeled with its start and end.
private struct MeetingProgressBar: View {
    let item: ScheduleItem
    let now: Date
    let tone: Color

    private var elapsed: CGFloat {
        guard item.duration > 0 else { return 1 }
        return CGFloat(max(0, min(1, now.timeIntervalSince(item.start) / item.duration)))
    }

    var body: some View {
        VStack(spacing: 8) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(OS.card)
                    Capsule().fill(tone.opacity(0.7)).frame(width: geo.size.width * elapsed)
                }
            }
            .frame(height: 10)
            HStack {
                Text(item.start.formatted(date: .omitted, time: .shortened))
                Spacer()
                Text("ends \(item.end.formatted(date: .omitted, time: .shortened))")
            }
            .font(OS.font(18, .semibold).monospacedDigit())
            .foregroundStyle(OS.grey)
        }
    }
}

/// A live indicator: a solid dot with a soft ring breathing out from it.
private struct PulsingDot: View {
    let color: Color
    @State private var pulsing = false

    var body: some View {
        ZStack {
            Circle()
                .fill(color.opacity(0.35))
                .scaleEffect(pulsing ? 2.2 : 1)
                .opacity(pulsing ? 0 : 1)
            Circle().fill(color)
        }
        .frame(width: 14, height: 14)
        .onAppear {
            withAnimation(.easeOut(duration: 1.8).repeatForever(autoreverses: false)) { pulsing = true }
        }
    }
}

/// The booker's photo, or their initials when there isn't one (or it fails
/// to load).
private struct Avatar: View {
    let organizer: ScheduleItem.Organizer
    let size: CGFloat
    let ink: Color

    var body: some View {
        AsyncImage(url: organizer.photoUrl.flatMap(URL.init(string:))) { phase in
            if let image = phase.image {
                image.resizable().scaledToFill()
            } else {
                Text(initials)
                    .font(OS.font(size * 0.4, .bold))
                    .foregroundStyle(ink)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(OS.card)
            }
        }
        .frame(width: size, height: size)
        .clipShape(.circle)
        .overlay(Circle().strokeBorder(OS.card, lineWidth: 2))
    }

    private var initials: String {
        "\(organizer.firstName.prefix(1))\(organizer.lastName.prefix(1))".uppercased()
    }
}
