import Foundation

/// A stretch of time picked on the day slider.
struct BookingWindow: Equatable {
    var start: Date
    var end: Date

    var duration: TimeInterval { end.timeIntervalSince(start) }
    var minutes: Int { Int((duration / 60).rounded()) }
}

/// One day on the Custom booking slider: when it runs, what's free, and the
/// rules that keep a window inside a free stretch, so every picked time is
/// bookable and there's no invalid state to show an error for.
struct BookingDay {
    static let openingHour = 8
    static let closingHour = 22
    /// The slider's snap. Finer steps are narrower than a fingertip.
    static let sliderStep = 15
    /// The time wheels' step, and the shortest window.
    static let wheelStep = 5
    /// What a tap on a free time books.
    static let tapMinutes = 60
    /// The server's own limit.
    static let maxMinutes = 8 * 60
    /// How far ahead the server takes bookings, in days.
    static let leadDays = 90

    let opens: Date
    let closes: Date
    /// Before this has passed; `opens` on any day but today.
    let earliest: Date
    /// Free stretches, in order, on `wheelStep` marks.
    let gaps: [ClosedRange<Date>]

    init(day: Date, items: [ScheduleItem], now: Date, calendar: Calendar = .current) {
        let opens = calendar.date(bySettingHour: Self.openingHour, minute: 0, second: 0, of: day)!
        let closes = calendar.date(bySettingHour: Self.closingHour, minute: 0, second: 0, of: day)!
        self.opens = opens
        self.closes = closes
        earliest = min(max(opens, now), closes)

        var gaps: [ClosedRange<Date>] = []
        func addGap(from: Date, to: Date) {
            let lower = Self.snap(from, step: Self.wheelStep, from: opens, rule: .up)
            let upper = Self.snap(min(to, closes), step: Self.wheelStep, from: opens, rule: .down)
            if upper.timeIntervalSince(lower) >= Self.seconds(Self.wheelStep) { gaps.append(lower...upper) }
        }

        var cursor = max(opens, now)
        let booked = items.filter { $0.end > $0.start }.sorted { $0.start < $1.start }
        for item in booked where item.end > cursor {
            addGap(from: cursor, to: item.start)
            cursor = max(cursor, item.end)
        }
        addGap(from: cursor, to: closes)
        self.gaps = gaps
    }

    /// How far through the day `date` is, 0…1.
    func fraction(of date: Date) -> Double {
        date.timeIntervalSince(opens) / closes.timeIntervalSince(opens)
    }

    func date(atFraction fraction: Double) -> Date {
        opens.addingTimeInterval(closes.timeIntervalSince(opens) * min(1, max(0, fraction)))
    }

    /// The window from dragging between two points, or nil if the drag began
    /// on a booked time. It stops at the bookings either side of `anchor`.
    func window(dragFrom anchor: Date, to current: Date) -> BookingWindow? {
        guard let gap = gap(containing: anchor) else { return nil }
        let fixed = snapped(anchor, in: gap)
        let moving = snapped(current, in: gap)
        let limit = Self.seconds(Self.maxMinutes)
        var start = min(fixed, moving)
        var end = max(fixed, moving)
        if moving >= fixed {
            end = min(end, fixed.addingTimeInterval(limit))
        } else {
            start = max(start, fixed.addingTimeInterval(-limit))
        }
        if start == end {
            return fitted(start: start, minutes: Self.sliderStep, in: gap)
        }
        return BookingWindow(start: start, end: end)
    }

    /// The window from tapping a free time, or nil on a booked one.
    func window(tappedAt date: Date) -> BookingWindow? {
        guard let gap = gap(containing: date) else { return nil }
        return fitted(start: snapped(date, in: gap), minutes: Self.tapMinutes, in: gap)
    }

    /// `window` with its start dragged to `date`; its end stays put.
    func movingStart(of window: BookingWindow, to date: Date) -> BookingWindow {
        let gap = gap(of: window)
        let shortest = window.end.addingTimeInterval(-Self.seconds(Self.wheelStep))
        let longest = window.end.addingTimeInterval(-Self.seconds(Self.maxMinutes))
        let start = snapped(date, in: gap).clamped(to: max(gap.lowerBound, longest)...shortest)
        return BookingWindow(start: start, end: window.end)
    }

    /// `window` with its end dragged to `date`; its start stays put.
    func movingEnd(of window: BookingWindow, to date: Date) -> BookingWindow {
        BookingWindow(start: window.start, end: snapped(date, in: gap(of: window)).clamped(to: endRange(for: window)))
    }

    /// Where the start wheel can go. The length stays the same, so it stops
    /// when the end would hit the next booking.
    func startRange(for window: BookingWindow) -> ClosedRange<Date> {
        let gap = gap(of: window)
        return gap.lowerBound...gap.upperBound.addingTimeInterval(-window.duration)
    }

    /// Where the end wheel can go.
    func endRange(for window: BookingWindow) -> ClosedRange<Date> {
        let upper = min(gap(of: window).upperBound, window.start.addingTimeInterval(Self.seconds(Self.maxMinutes)))
        return window.start.addingTimeInterval(Self.seconds(Self.wheelStep))...upper
    }

    /// `window` with its start wheel set to `date`, moving the end with it.
    func settingStart(of window: BookingWindow, to date: Date) -> BookingWindow {
        let start = date.clamped(to: startRange(for: window))
        return BookingWindow(start: start, end: start.addingTimeInterval(window.duration))
    }

    /// `window` with its end wheel set to `date`.
    func settingEnd(of window: BookingWindow, to date: Date) -> BookingWindow {
        BookingWindow(start: window.start, end: date.clamped(to: endRange(for: window)))
    }

    private func gap(containing date: Date) -> ClosedRange<Date>? {
        gaps.first { $0.contains(date) }
    }

    /// The window's free stretch. A window left open past "now" on today's
    /// slider falls out of the gaps, so it stands in for its own.
    private func gap(of window: BookingWindow) -> ClosedRange<Date> {
        gap(containing: window.start).flatMap { $0.contains(window.end) ? $0 : nil } ?? window.start...window.end
    }

    private func snapped(_ date: Date, in gap: ClosedRange<Date>) -> Date {
        Self.snap(date, step: Self.sliderStep, from: opens, rule: .toNearestOrAwayFromZero).clamped(to: gap)
    }

    /// `minutes` from `start`, slid back if that runs into the next booking.
    private func fitted(start: Date, minutes: Int, in gap: ClosedRange<Date>) -> BookingWindow {
        let end = min(start.addingTimeInterval(Self.seconds(minutes)), gap.upperBound)
        return BookingWindow(start: max(gap.lowerBound, end.addingTimeInterval(-Self.seconds(minutes))), end: end)
    }

    private static func seconds(_ minutes: Int) -> TimeInterval { TimeInterval(minutes * 60) }

    private static func snap(_ date: Date, step: Int, from origin: Date, rule: FloatingPointRoundingRule) -> Date {
        let size = seconds(step)
        return origin.addingTimeInterval((date.timeIntervalSince(origin) / size).rounded(rule) * size)
    }
}

private extension Date {
    func clamped(to range: ClosedRange<Date>) -> Date {
        min(max(self, range.lowerBound), range.upperBound)
    }
}
