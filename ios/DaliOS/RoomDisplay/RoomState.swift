import Foundation

/// What a room is doing at `now`, derived from its day: the band color and
/// copy at the top of its panel, and which door actions are open.
struct RoomState: Equatable {
    enum Status: Equatable {
        case available
        /// Free, but the next booking starts within `soonThreshold`.
        case soon
        case busy
    }

    /// The "Book now" lengths, in minutes.
    static let bookingOptions = [15, 30, 60, 90]
    static let soonThreshold = 10

    let status: Status
    let current: ScheduleItem?
    let next: ScheduleItem?
    /// Until the current booking ends, or the next one starts. 0 with neither.
    let minutesUntilChange: Int
    /// "Book now" lengths that end before the next booking; empty while in use.
    let bookableDurations: [Int]
    /// The current booking can be ended or extended from the door.
    let canChange: Bool
    /// …and pushed out by `BookingChange.extendMinutes` without hitting the next.
    let canExtend: Bool

    init(items: [ScheduleItem], now: Date) {
        let sorted = items.filter { $0.end > $0.start }.sorted { $0.start < $1.start }
        let current = sorted.first { $0.start <= now && $0.end > now }
        let next = sorted.first { $0.start > now }
        self.current = current
        self.next = next

        if let current {
            minutesUntilChange = Self.minutes(from: now, to: current.end)
        } else if let next {
            minutesUntilChange = Self.minutes(from: now, to: next.start)
        } else {
            minutesUntilChange = 0
        }

        if current != nil {
            status = .busy
        } else if next != nil, minutesUntilChange <= Self.soonThreshold {
            status = .soon
        } else {
            status = .available
        }

        bookableDurations = current != nil ? [] : Self.bookingOptions.filter { minutes in
            guard let next else { return true }
            return now.addingTimeInterval(TimeInterval(minutes * 60)) <= next.start
        }

        let canChange = current?.isChangeableAtDoor ?? false
        self.canChange = canChange
        if let current, canChange {
            let extended = current.end.addingTimeInterval(TimeInterval(BookingChange.extendMinutes * 60))
            canExtend = next.map { extended <= $0.start } ?? true
        } else {
            canExtend = false
        }
    }

    /// How far through the current booking we are, 0…1.
    func progress(now: Date) -> Double {
        guard let current, current.duration > 0 else { return 0 }
        return min(1, max(0, now.timeIntervalSince(current.start) / current.duration))
    }

    /// Whole minutes, rounded up, never negative.
    static func minutes(from: Date, to: Date) -> Int {
        max(0, Int((to.timeIntervalSince(from) / 60).rounded(.up)))
    }
}
