import Foundation

/// Turns taps and drags on the timeline into a bookable slot: snapped to 15
/// minutes, never in the past, never overlapping what's already booked.
struct SlotPicker {
    static let step: TimeInterval = 15 * 60
    static let tapLength: TimeInterval = 30 * 60
    /// Matches the server's longest single booking.
    static let maxLength: TimeInterval = 8 * 60 * 60

    let items: [ScheduleItem]
    let now: Date

    struct Slot: Equatable {
        let interval: DateInterval
        let isValid: Bool
    }

    /// A drag from `anchor` to `current`, in either direction.
    func drag(from anchor: Date, to current: Date) -> Slot {
        let start = max(floor(min(anchor, current)), floorToMinute(now))
        var end = ceil(max(anchor, current))
        if end.timeIntervalSince(start) < Self.step { end = start.addingTimeInterval(Self.step) }
        return slot(start, end)
    }

    /// A tap: a 30-minute slot from the tapped quarter hour, shortened to fit
    /// before the next booking.
    func tap(at time: Date) -> Slot? {
        let start = max(floor(time), floorToMinute(now))
        guard !items.contains(where: { $0.start <= start && $0.end > start }) else { return nil }
        var end = start.addingTimeInterval(Self.tapLength)
        if let next = items.first(where: { $0.start > start && $0.start < end }) { end = next.start }
        return slot(start, end)
    }

    private func slot(_ start: Date, _ end: Date) -> Slot {
        let interval = DateInterval(start: start, end: max(start, end))
        let overlaps = items.contains { $0.start < interval.end && $0.end > interval.start }
        let valid = !overlaps
            && interval.end > now
            && interval.duration >= 5 * 60
            && interval.duration <= Self.maxLength
        return Slot(interval: interval, isValid: valid)
    }

    private func floor(_ date: Date) -> Date {
        Date(timeIntervalSinceReferenceDate: (date.timeIntervalSinceReferenceDate / Self.step).rounded(.down) * Self.step)
    }

    private func ceil(_ date: Date) -> Date {
        Date(timeIntervalSinceReferenceDate: (date.timeIntervalSinceReferenceDate / Self.step).rounded(.up) * Self.step)
    }

    private func floorToMinute(_ date: Date) -> Date {
        Date(timeIntervalSinceReferenceDate: (date.timeIntervalSinceReferenceDate / 60).rounded(.down) * 60)
    }
}
