import Foundation
import Observation

/// State for a paired door display: its token, its rooms, and their day.
@MainActor
@Observable
final class DisplayStore {
    static let refreshInterval: Duration = .seconds(30)

    /// The display's own room first, then the room beside it.
    private(set) var rooms: [RoomSchedule] = []
    private(set) var attendanceScan: AttendanceScan?
    private(set) var applicationEvent: ApplicationEventBroadcast?
    private(set) var isPaired: Bool
    /// Set when the last refresh failed; the display keeps showing stale data.
    private(set) var isOffline = false
    /// "Exit attendance mode" on this iPad hides that one scan until it ends.
    private(set) var dismissedScanID: String?

    private(set) var isDemo = false
    private let settings: AppSettings
    private var token: String?

    init(settings: AppSettings) {
        self.settings = settings
        let stored = Keychain.read(account: settings.environment.rawValue)
        token = stored
        isPaired = stored != nil
    }

    private var client: APIClient {
        var client = settings.api
        client.authorization = token.map { "RoomDisplay \($0)" }
        return client
    }

    /// The lab-wide scan this iPad is showing, unless someone exited it here.
    var visibleAttendanceScan: AttendanceScan? {
        guard let attendanceScan, attendanceScan.meetingId != dismissedScanID else { return nil }
        return attendanceScan
    }

    func exitAttendanceScan() {
        dismissedScanID = attendanceScan?.meetingId
    }

    func activate(code: String) async throws {
        #if DEBUG
        let normalized = code.uppercased().filter { $0.isLetter || $0.isNumber }
        if let mode = Self.demoCodes[normalized] {
            startDemo(mode)
            return
        }
        #endif
        struct Body: Encodable { let code: String }
        let response: ActivateResponse = try await settings.api.post("api/room-display/activate", body: Body(code: code))
        Keychain.write(response.token, account: settings.environment.rawValue)
        token = response.token
        rooms = [RoomSchedule(room: response.room, items: [], currentEvent: nil)]
        isPaired = true
        await refresh()
    }

    func refresh(now: Date = .now) async {
        guard token != nil, !isDemo else { return }
        let day = Calendar.current.dateInterval(of: .day, for: now)!
        do {
            let response: ScheduleResponse = try await client.get(
                "api/room-display/schedule",
                query: [
                    URLQueryItem(name: "start", value: day.start.formatted(.iso8601)),
                    URLQueryItem(name: "end", value: day.end.formatted(.iso8601)),
                ]
            )
            rooms = response.roomSchedules
            attendanceScan = response.attendanceScan
            if attendanceScan?.meetingId != dismissedScanID { dismissedScanID = nil }
            applicationEvent = response.applicationEvent
            isOffline = false
        } catch let error as APIClient.APIError where error.status == 401 {
            // Revoked from Core ▸ Rooms (or the room was archived).
            unpair()
        } catch {
            isOffline = true
        }
    }

    /// Book `roomID` from now for `minutes`, as whoever's pass was scanned.
    /// The server's clock picks the start, so a skewed iPad can't shift it.
    func book(roomID: String, minutes: Int, memberToken: String) async throws -> BookResponse {
        #if DEBUG
        if isDemo { return try await demoBook(roomID: roomID, minutes: minutes, memberToken: memberToken) }
        #endif
        struct Body: Encodable { let memberToken: String; let roomId: String; let minutes: Int }
        let response: BookResponse = try await client.post(
            "api/room-display/book",
            body: Body(memberToken: memberToken, roomId: roomID, minutes: minutes)
        )
        await refresh()
        return response
    }

    /// End early or extend the booking underway; the pass must be the booker's.
    func change(_ change: BookingChange, booking: ScheduleItem, memberToken: String) async throws -> BookingChangeResponse {
        #if DEBUG
        if isDemo { return try await demoChange(change, booking: booking, memberToken: memberToken) }
        #endif
        struct Body: Encodable { let memberToken: String; let change: BookingChange }
        let response: BookingChangeResponse = try await client.post(
            "api/room-display/bookings/\(booking.id)",
            body: Body(memberToken: memberToken, change: change)
        )
        await refresh()
        return response
    }

    /// Check in to the event running in `roomID`, or to the lab-wide scan
    /// when `roomID` is nil (it outranks the rooms' own events on the server).
    func checkIn(roomID: String?, memberToken: String) async throws -> ScanResponse {
        #if DEBUG
        if isDemo { return try await demoCheckIn(roomID: roomID, memberToken: memberToken) }
        #endif
        struct Body: Encodable { let memberToken: String; let roomId: String? }
        let response: ScanResponse = try await client.post(
            "api/room-display/scan",
            body: Body(memberToken: memberToken, roomId: roomID)
        )
        await refresh()
        return response
    }

    func unpair() {
        isDemo = false
        Keychain.delete(account: settings.environment.rawValue)
        token = nil
        rooms = []
        attendanceScan = nil
        applicationEvent = nil
        dismissedScanID = nil
        isPaired = false
    }

    #if DEBUG
    // MARK: Demo

    /// Sample rooms and schedule, no server. Entered with the setup code
    /// DEMO-ROOM (DEMO-EVENT for an event checking in, DEMO-SCAN for lab-wide
    /// attendance, DEMO-APPLICANTS for a hiring broadcast), or by launching
    /// with `-demoDisplay [event|scan|applicants]`. Unpair (long-press the
    /// date) to leave.
    enum DemoMode: String {
        case rooms, event, scan, applicants
    }

    static let demoCodes: [String: DemoMode] = [
        "DEMOROOM": .rooms, "DEMOEVENT": .event, "DEMOSCAN": .scan, "DEMOAPPLICANTS": .applicants,
    ]

    /// The simulator has no camera; the scanner's Simulate buttons send these.
    static let demoInvalidPrefix = "INVALID-"
    private static let demoMembers = [
        ScannedMember(id: "m1", firstName: "Maya", lastName: "Chen", photoUrl: nil),
        ScannedMember(id: "m2", firstName: "Jordan", lastName: "Alvarez", photoUrl: nil),
        ScannedMember(id: "m3", firstName: "Priya", lastName: "Natarajan", photoUrl: nil),
        ScannedMember(id: "m4", firstName: "Alex", lastName: "Kim", photoUrl: nil),
        ScannedMember(id: "m5", firstName: "Rosa", lastName: "Diaz", photoUrl: nil),
        ScannedMember(id: "m6", firstName: "Sam", lastName: "Okafor", photoUrl: nil),
    ]

    func startDemo(_ mode: DemoMode) {
        var anchor = Date.now
        anchor = Calendar.current.date(bySetting: .second, value: 0, of: anchor) ?? anchor
        func item(_ id: String, _ title: String, _ organizer: String, _ offset: Double, _ length: Double,
                  kind: ScheduleItem.Kind = .meeting, isEvent: Bool = false) -> ScheduleItem {
            let names = organizer.split(separator: " ").map(String.init)
            return ScheduleItem(
                kind: kind, id: id, title: title,
                start: anchor.addingTimeInterval(offset * 60), end: anchor.addingTimeInterval((offset + length) * 60),
                organizer: .init(id: organizer, firstName: names.first ?? organizer, lastName: names.dropFirst().joined(separator: " ")),
                isEvent: isEvent, source: kind == .booking ? "Display" : nil
            )
        }
        let showcase = item("ga-4", "Lab Night: Project Showcase", "DALI Lab", mode == .event ? -5 : 60, 60, isEvent: true)
        rooms = [
            RoomSchedule(
                room: DisplayRoom(id: "fishbowl", name: "Fishbowl", description: "Level 1 · DALI Lab", capacity: 8),
                items: [
                    item("fb-1", "Morning standup", "Priya Natarajan", -150, 30),
                    item("fb-2", "Design critique", "Maya Chen", -75, 45),
                    item("fb-3", "1:1 with Jordan and Priya", "Jordan Alvarez", 95, 30, kind: .booking),
                    item("fb-4", "Sprint planning", "Alex Kim", 150, 60),
                ],
                currentEvent: nil
            ),
            RoomSchedule(
                room: DisplayRoom(id: "garage", name: "The Garage", description: "Level 1 · DALI Lab", capacity: 14),
                items: [
                    item("ga-1", "Mentor office hours", "Rosa Diaz", -90, 30),
                    item("ga-2", "Partner call with Hood Museum", "Sam Okafor", mode == .event ? -50 : -15, 45, kind: .booking),
                    showcase,
                    item("ga-3", "Workshop: Figma basics", "Maya Chen", 150, 60, isEvent: true),
                ].sorted { $0.start < $1.start },
                currentEvent: mode == .event
                    ? { var e = showcase; e.checkIns = CheckIns(count: 0, expected: 0, recent: []); return e }()
                    : nil
            ),
        ]
        attendanceScan = mode == .scan
            ? AttendanceScan(
                meetingId: "demo", title: "All-lab meeting",
                start: anchor.addingTimeInterval(-5 * 60), end: anchor.addingTimeInterval(55 * 60),
                checkIns: CheckIns(count: 0, expected: 48, recent: [])
            )
            : nil
        applicationEvent = mode == .applicants
            ? ApplicationEventBroadcast(
                id: "demo", title: "Application help hour", kind: "HelpHour",
                start: anchor.addingTimeInterval(-15 * 60), end: anchor.addingTimeInterval(105 * 60),
                location: "The Garage", checkInUrl: "https://os.dali.dartmouth.edu/hiring/events/check-in/demo"
            )
            : nil
        dismissedScanID = nil
        isDemo = true
        isPaired = true
    }

    private func demoMember(_ token: String) async throws -> ScannedMember {
        try await Task.sleep(for: .milliseconds(700))
        if token.hasPrefix(Self.demoInvalidPrefix) {
            throw APIClient.APIError.server(status: 400, message: "This pass isn't recognized. Try again or ask a DALI staff member.")
        }
        return Self.demoMembers.randomElement()!
    }

    private func demoBook(roomID: String, minutes: Int, memberToken: String) async throws -> BookResponse {
        let member = try await demoMember(memberToken)
        let start = Date.now, end = start.addingTimeInterval(TimeInterval(minutes * 60))
        let booking = ScheduleItem(
            kind: .booking, id: UUID().uuidString, title: "\(member.firstName)'s booking", start: start, end: end,
            organizer: .init(id: member.id, firstName: member.firstName, lastName: member.lastName),
            isEvent: false, source: "Display"
        )
        updateRoom(roomID) { $0.items = ($0.items + [booking]).sorted { $0.start < $1.start } }
        return BookResponse(booking: .init(id: booking.id, start: start, end: end), member: member)
    }

    private func demoChange(_ change: BookingChange, booking: ScheduleItem, memberToken: String) async throws -> BookingChangeResponse {
        let member = try await demoMember(memberToken)
        let end = change == .end ? Date.now : booking.end.addingTimeInterval(TimeInterval(BookingChange.extendMinutes * 60))
        for room in rooms where room.items.contains(where: { $0.occurrenceID == booking.occurrenceID }) {
            updateRoom(room.id) { schedule in
                schedule.items = schedule.items.map { $0.occurrenceID == booking.occurrenceID ? { var b = $0; b.end = end; return b }($0) : $0 }
            }
        }
        return BookingChangeResponse(member: member, booking: .init(start: booking.start, end: end))
    }

    private func demoCheckIn(roomID: String?, memberToken: String) async throws -> ScanResponse {
        let member = try await demoMember(memberToken)
        func add(_ checkIns: CheckIns?) -> (CheckIns, Bool) {
            let current = checkIns ?? CheckIns(count: 0, expected: 0, recent: [])
            if current.recent.contains(where: { $0.id == member.id }) { return (current, true) }
            let entry = CheckIns.Member(id: member.id, firstName: member.firstName, lastName: member.lastName, photoUrl: nil, at: .now)
            return (CheckIns(count: current.count + 1, expected: current.expected, recent: [entry] + current.recent), false)
        }
        var already = false
        if let roomID {
            updateRoom(roomID) { schedule in
                guard var event = schedule.currentEvent else { return }
                (event.checkIns, already) = add(event.checkIns)
                schedule.currentEvent = event
            }
        } else if var scan = attendanceScan {
            (scan.checkIns, already) = add(scan.checkIns)
            attendanceScan = scan
        }
        return ScanResponse(member: member, alreadyCheckedIn: already)
    }

    private func updateRoom(_ id: String, _ update: (inout RoomSchedule) -> Void) {
        guard let index = rooms.firstIndex(where: { $0.id == id }) else { return }
        update(&rooms[index])
    }
    #endif
}
