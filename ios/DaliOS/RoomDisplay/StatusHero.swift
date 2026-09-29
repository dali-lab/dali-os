import SwiftUI

/// The at-a-glance status: a flat wash of the status color, a big countdown
/// of the free (or remaining) time, and the state in words. While a meeting
/// runs, a bar under it shows how much of the meeting is left.
struct StatusHero: View {
    let snapshot: RoomSnapshot

    private var isFree: Bool { snapshot.current == nil }
    private var tone: Color { isFree ? OS.green : OS.danger }
    /// Flat role fills, matched in weight so free and in-use read as a pair.
    private var wash: Color { isFree ? OS.roleGreen.fill : OS.roleRed.fill }

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(spacing: 32) {
                countdown
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 12) {
                        PulsingDot(color: tone)
                        Text(isFree ? "Available" : "In use")
                            .font(OS.font(40, .bold))
                            .foregroundStyle(tone)
                    }
                    Text(headline)
                        .font(OS.font(24, .semibold))
                        .foregroundStyle(OS.fg)
                        .lineLimit(2)
                    Text(detail)
                        .font(OS.font(20))
                        .foregroundStyle(OS.grey)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            if let current = snapshot.current {
                MeetingProgressBar(item: current, now: snapshot.now, tone: tone)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(wash, in: .rect(cornerRadius: OS.cardRadius))
        .animation(.easeInOut(duration: 0.3), value: isFree)
    }

    // MARK: Countdown

    private var countdown: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(remainingText)
                .font(OS.font(56, .bold).monospacedDigit())
                .foregroundStyle(OS.fg)
                .minimumScaleFactor(0.5)
                .lineLimit(1)
            Text(isFree ? "free" : "left")
                .font(OS.font(18, .semibold))
                .foregroundStyle(tone)
        }
        .frame(minWidth: 148, alignment: .leading)
        .padding(.trailing, 32)
        .overlay(alignment: .trailing) {
            Rectangle().fill(OS.container).frame(width: 1)
        }
    }

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
        if let next = snapshot.next { return "Free until \(next.start.formatted(date: .omitted, time: .shortened))" }
        return "Free for the rest of the day"
    }

    private var detail: String {
        if let current = snapshot.current {
            return "\(current.organizerName) · until \(current.end.formatted(date: .omitted, time: .shortened))"
        }
        if let next = snapshot.next { return "Then \(next.title)" }
        return "Nothing else booked today"
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
        VStack(spacing: 6) {
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
        .frame(width: 16, height: 16)
        .onAppear {
            withAnimation(.easeOut(duration: 1.8).repeatForever(autoreverses: false)) { pulsing = true }
        }
    }
}
