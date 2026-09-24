import Foundation

struct DisplayRoom: Codable, Hashable {
    let id: String
    let name: String
    var description: String?
    var capacity: Int?
}

struct ScheduleItem: Codable, Hashable {
    enum Kind: String, Codable {
        case booking
        case meeting
    }

    struct Organizer: Codable, Hashable {
        let id: String
        let firstName: String
        let lastName: String
    }

    let kind: Kind
    let id: String
    let title: String
    let start: Date
    let end: Date
    let organizer: Organizer
    let isEvent: Bool

    /// A recurring meeting repeats its `id` across occurrences.
    var occurrenceID: String { "\(kind.rawValue)-\(id)-\(start.timeIntervalSince1970)" }
    var duration: TimeInterval { end.timeIntervalSince(start) }
}

struct ScheduleResponse: Decodable {
    let room: DisplayRoom
    let items: [ScheduleItem]
    let currentEvent: ScheduleItem?
}

struct ActivateResponse: Decodable {
    let token: String
    let label: String
    let room: DisplayRoom
}

struct ScannedMember: Decodable, Hashable {
    let id: String
    let firstName: String
    let lastName: String
    let photoUrl: String?
}

struct BookResponse: Decodable {
    struct Booking: Decodable {
        let id: String
        let start: Date
        let end: Date
    }

    let booking: Booking
    let member: ScannedMember
}

struct ScanResponse: Decodable {
    let member: ScannedMember
}

/// What the room is doing at `now`, derived from the day's schedule.
struct RoomSnapshot {
    static let bookNowOptions = [15, 30, 60, 120]
    /// Shortest walk-up booking the server accepts.
    static let minimumBookingMinutes = 5

    let current: ScheduleItem?
    let next: ScheduleItem?
    let now: Date

    init(items: [ScheduleItem], now: Date) {
        self.now = now
        current = items.first { $0.start <= now && $0.end > now }
        next = items.first { $0.start > now }
    }

    /// Minutes of free time from now until the next booking (nil = rest of day is free).
    var freeMinutes: Int? {
        guard current == nil else { return 0 }
        guard let next else { return nil }
        return Int(next.start.timeIntervalSince(now) / 60)
    }

    /// Walk-up durations that fit before the next booking. When the gap is
    /// shorter than every preset, offer the gap itself.
    var bookableMinutes: [Int] {
        guard current == nil else { return [] }
        guard let free = freeMinutes else { return Self.bookNowOptions }
        let fitting = Self.bookNowOptions.filter { $0 <= free }
        if fitting.isEmpty, free >= Self.minimumBookingMinutes { return [free] }
        return fitting
    }
}

/// What the person at the door asked to book: "now for N minutes" (the Book
/// now buttons) or a slot picked on the timeline.
enum BookingRequest: Identifiable, Hashable {
    case now(minutes: Int)
    case slot(DateInterval)

    var id: Self { self }

    var interval: DateInterval {
        switch self {
        case .now(let minutes): DateInterval(start: .now, duration: TimeInterval(minutes * 60))
        case .slot(let interval): interval
        }
    }
}
