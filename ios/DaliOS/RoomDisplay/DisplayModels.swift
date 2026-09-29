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
        /// Resolved, short-lived URL; only the door display's schedule sends it.
        var photoUrl: String? = nil
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

/// Scanning switched on from a meeting's page for every door display in the lab,
/// whatever room it's in. Outranks the room's own event.
struct AttendanceScan: Codable, Hashable {
    let meetingId: String
    let title: String
    let start: Date?
    let end: Date?

    var timeRange: String? {
        guard let start, let end else { return nil }
        return "\(start.formatted(date: .omitted, time: .shortened)) – \(end.formatted(date: .omitted, time: .shortened))"
    }
}

struct ScheduleResponse: Decodable {
    let room: DisplayRoom
    let items: [ScheduleItem]
    let currentEvent: ScheduleItem?
    let attendanceScan: AttendanceScan?
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
    let current: ScheduleItem?
    let next: ScheduleItem?
    let now: Date

    init(items: [ScheduleItem], now: Date) {
        self.now = now
        current = items.first { $0.start <= now && $0.end > now }
        next = items.first { $0.start > now }
    }
}

/// A booking being set up in the booking sheet, prefilled from the + button
/// or a tap/drag on the timeline.
struct BookingDraft: Identifiable, Hashable {
    let id = UUID()
    var interval: DateInterval
}

/// What the booking sheet accepts, mirroring the server's own checks so the
/// door can explain a problem before anyone scans a pass.
struct BookingRules {
    /// The server lets a booking start this far in the past, for "starting now".
    static let pastGrace: TimeInterval = 5 * 60
    static let minimumLength: TimeInterval = 5 * 60
    /// The server's cap on "now for N minutes".
    static let maxNowMinutes = 240

    let items: [ScheduleItem]
    let now: Date

    /// Why this range can't be booked, or nil if it can.
    func problem(start: Date, end: Date) -> String? {
        let length = end.timeIntervalSince(start)
        if length <= 0 { return "End time must be after the start time" }
        if end <= now { return "That time has already passed" }
        if start < now.addingTimeInterval(-Self.pastGrace) { return "Start time can't be in the past" }
        if length < Self.minimumLength { return "Bookings need to be at least 5 minutes" }
        if length > SlotPicker.maxLength { return "Bookings can be at most 8 hours" }
        if let clash = items.first(where: { $0.start < end && $0.end > start }) {
            return "Overlaps \(clash.title) (\(clash.timeRange))"
        }
        return nil
    }

    /// Starting now → let the server's clock pick the start, so a skewed iPad
    /// can't shift it. Anything else is an explicit slot.
    func request(start: Date, end: Date) -> BookingRequest {
        let minutes = Int((end.timeIntervalSince(start) / 60).rounded())
        if abs(start.timeIntervalSince(now)) < 60, minutes <= Self.maxNowMinutes {
            return .now(minutes: minutes)
        }
        return .slot(DateInterval(start: start, end: end))
    }
}

/// What the person at the door asked to book: "now for N minutes" (starting
/// now, so the server's clock picks the start) or an explicit slot.
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
