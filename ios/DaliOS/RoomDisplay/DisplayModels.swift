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
    var end: Date
    let organizer: Organizer
    let isEvent: Bool
    /// "Display", "Web", "Interview", …; nil for a meeting.
    var source: String? = nil
    /// Only on a room's `currentEvent`: who has scanned in so far.
    var checkIns: CheckIns? = nil

    /// A recurring meeting repeats its `id` across occurrences.
    var occurrenceID: String { "\(kind.rawValue)-\(id)-\(start.timeIntervalSince1970)" }
    var duration: TimeInterval { end.timeIntervalSince(start) }

    /// A room booking the booker can end early or extend from the door.
    /// Meetings and hiring holds are changed elsewhere.
    var isChangeableAtDoor: Bool {
        kind == .booking && source != "Interview" && source != "InterviewHold"
    }

    var timeRange: String { DisplayFormat.range(start, end) }
    var organizerName: String { "\(organizer.firstName) \(organizer.lastName)" }
}

struct CheckIns: Codable, Hashable {
    struct Member: Codable, Hashable {
        let id: String
        let firstName: String
        let lastName: String
        var photoUrl: String?
        let at: Date
    }

    let count: Int
    /// Invited people plus walk-ins; 0 when the event has no roster.
    let expected: Int
    /// Latest first.
    let recent: [Member]
}

/// One of the display's rooms and its day.
struct RoomSchedule: Codable, Hashable, Identifiable {
    var room: DisplayRoom
    var items: [ScheduleItem]
    /// The DALI event in its check-in window here, if any. The panel turns
    /// into a pass scanner for it.
    var currentEvent: ScheduleItem?

    var id: String { room.id }
}

/// Scanning switched on from a meeting's page for every door display in the lab,
/// whatever room it's in. Outranks the rooms' own events.
struct AttendanceScan: Codable, Hashable {
    let meetingId: String
    let title: String
    let start: Date?
    let end: Date?
    var checkIns: CheckIns? = nil

    var timeRange: String? {
        guard let start, let end else { return nil }
        return DisplayFormat.range(start, end)
    }
}

/// A hiring event (help hour, social, info session) whose check-in QR Core has
/// put on every door display. Applicants scan it with their own phone, so the
/// iPad shows a code rather than reading passes. Outranks the rooms, but not a
/// lab-wide attendance scan.
struct ApplicationEventBroadcast: Codable, Hashable {
    let id: String
    let title: String
    let kind: String
    let start: Date
    let end: Date
    let location: String?
    let checkInUrl: String

    var kindLabel: String {
        switch kind {
        case "HelpHour": "Application help hour"
        case "Social": "Applicant social"
        case "InfoSession": "Info session"
        default: "Application event"
        }
    }

    var timeRange: String { DisplayFormat.range(start, end) }
}

struct ScheduleResponse: Decodable {
    let room: DisplayRoom
    let items: [ScheduleItem]
    let currentEvent: ScheduleItem?
    /// Both rooms, own room first. Servers from before two-room displays
    /// leave it out.
    var rooms: [RoomSchedule]? = nil
    let attendanceScan: AttendanceScan?
    var applicationEvent: ApplicationEventBroadcast? = nil

    var roomSchedules: [RoomSchedule] {
        rooms ?? [RoomSchedule(room: room, items: items, currentEvent: currentEvent)]
    }
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
    var alreadyCheckedIn: Bool? = nil
}

/// End early / Extend at the door.
enum BookingChange: String, Encodable, Identifiable {
    case end
    case extend

    /// What Extend adds; the server's own constant.
    static let extendMinutes = 15

    var id: Self { self }
}

struct BookingChangeResponse: Decodable {
    struct Booking: Decodable {
        let start: Date
        let end: Date
    }

    let member: ScannedMember
    let booking: Booking
}

enum DisplayFormat {
    static func time(_ date: Date) -> String { date.formatted(date: .omitted, time: .shortened) }

    static func range(_ start: Date, _ end: Date) -> String { "\(time(start)) – \(time(end))" }

    /// "15 min", "1 hr", "1 hr 30 min".
    static func duration(minutes: Int) -> String {
        if minutes < 60 { return "\(minutes) min" }
        let hours = minutes / 60, rest = minutes % 60
        return rest == 0 ? "\(hours) hr" : "\(hours) hr \(rest) min"
    }
}
