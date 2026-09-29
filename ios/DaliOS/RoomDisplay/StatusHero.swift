import SwiftUI

/// The at-a-glance status, read from down the hall: one flat wash of the
/// status color, a big countdown of the free (or remaining) time, one line of
/// context, and what you can do about it — book now while free, see what's
/// next while in use.
struct StatusHero: View {
    let snapshot: RoomSnapshot
    let bookable: [Int]
    let onBook: (Int) -> Void

    private var isFree: Bool { snapshot.current == nil }
    private var tone: Color { isFree ? OS.green : OS.danger }
    /// Flat role fills, matched in weight so free and in-use read as a pair.
    private var palette: OS.Category { isFree ? OS.roleGreen : OS.roleRed }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                PulsingDot(color: tone)
                Text(isFree ? "Available" : "In use")
                    .font(OS.font(18, .bold))
                    .tracking(1.6)
                    .textCase(.uppercase)
                    .foregroundStyle(palette.ink)
            }

            HStack(alignment: .firstTextBaseline, spacing: 14) {
                Text(remainingText)
                    .font(OS.font(96, .bold).monospacedDigit())
                    .foregroundStyle(OS.fg)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
                if remaining != nil {
                    Text(isFree ? "free" : "left")
                        .font(OS.font(32, .medium))
                        .foregroundStyle(palette.ink)
                }
            }
            .padding(.top, 8)

            Text(headline)
                .font(OS.font(26, .semibold))
                .foregroundStyle(OS.fg)
                .lineLimit(2)
                .padding(.top, 4)
            if let detail {
                Text(detail)
                    .font(OS.font(20))
                    .foregroundStyle(OS.grey)
                    .lineLimit(1)
                    .padding(.top, 4)
            }

            if let current = snapshot.current {
                MeetingProgressBar(item: current, now: snapshot.now, tone: tone)
                    .padding(.top, 28)
            }

            if isFree, !bookable.isEmpty {
                bookNow.padding(.top, 32)
            } else if !isFree, let next = snapshot.next {
                upNext(next).padding(.top, 28)
            }
        }
        .padding(36)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.fill, in: .rect(cornerRadius: OS.cardRadius))
        .animation(.easeInOut(duration: 0.3), value: isFree)
    }

    // MARK: Actions

    private var bookNow: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Book now")
                .font(OS.eyebrow)
                .tracking(1.2)
                .textCase(.uppercase)
                .foregroundStyle(palette.ink)
            HStack(spacing: 12) {
                ForEach(bookable, id: \.self) { minutes in
                    Button {
                        onBook(minutes)
                    } label: {
                        Text(Duration.seconds(minutes * 60).formatted(.units(allowed: [.hours, .minutes], width: .abbreviated)))
                            .frame(maxWidth: .infinity, minHeight: 60)
                    }
                    .buttonStyle(WashButtonStyle(ink: palette.ink))
                }
            }
        }
    }

    private func upNext(_ next: ScheduleItem) -> some View {
        VStack(alignment: .leading, spacing: 16) {
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
        if let current = snapshot.current { return current.organizerName }
        if let next = snapshot.next { return "Then \(next.title)" }
        return nil
    }
}

/// White pills on the status wash: quieter than the accent button, so the
/// countdown stays the loudest thing on the card.
private struct WashButtonStyle: ButtonStyle {
    let ink: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(OS.font(20, .semibold))
            .foregroundStyle(ink)
            .background(OS.card.opacity(configuration.isPressed ? 0.7 : 1), in: .capsule)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
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
                    Capsule().fill(tone).frame(width: geo.size.width * elapsed)
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
