import SwiftUI

/// The at-a-glance status: a soft wash of the status color, a ring counting
/// down the free (or remaining) time, and the state in words.
struct StatusHero: View {
    let snapshot: RoomSnapshot

    /// The free-time ring is measured against this window, so "free for 20
    /// minutes" reads as nearly empty and "free for hours" as full.
    private static let freeWindow: TimeInterval = 2 * 60 * 60

    private var isFree: Bool { snapshot.current == nil }
    private var tone: Color { isFree ? OS.green : OS.danger }

    var body: some View {
        HStack(spacing: 32) {
            ring
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
                    .font(OS.font(17))
                    .foregroundStyle(OS.grey)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(28)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: OS.cardRadius)
                .fill(OS.card)
                .overlay(
                    LinearGradient(
                        colors: [tone.opacity(0.16), tone.opacity(0.04)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    in: .rect(cornerRadius: OS.cardRadius)
                )
        }
        .animation(.easeInOut(duration: 0.3), value: isFree)
    }

    // MARK: Ring

    private var ring: some View {
        ZStack {
            Circle().stroke(tone.opacity(0.15), lineWidth: 14)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(tone, style: StrokeStyle(lineWidth: 14, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 2) {
                Text(remainingText)
                    .font(OS.font(28, .bold).monospacedDigit())
                    .foregroundStyle(OS.fg)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                Text(isFree ? "free" : "left")
                    .font(OS.font(14, .semibold))
                    .foregroundStyle(OS.grey)
            }
            .padding(20)
        }
        .frame(width: 148, height: 148)
    }

    private var remaining: TimeInterval? {
        if let current = snapshot.current { return current.end.timeIntervalSince(snapshot.now) }
        return snapshot.next.map { $0.start.timeIntervalSince(snapshot.now) }
    }

    private var progress: CGFloat {
        if let current = snapshot.current {
            return CGFloat(max(0, min(1, current.end.timeIntervalSince(snapshot.now) / current.duration)))
        }
        guard let remaining else { return 1 }
        return CGFloat(max(0.03, min(1, remaining / Self.freeWindow)))
    }

    private var remainingText: String {
        guard let remaining else { return "All day" }
        let minutes = Int(remaining / 60)
        if minutes < 60 { return "\(max(minutes, 1))m" }
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
