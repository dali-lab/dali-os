import Foundation
import Observation

/// State for a paired door display: its token, room, and today's schedule.
@MainActor
@Observable
final class DisplayStore {
    static let refreshInterval: Duration = .seconds(30)

    private(set) var room: DisplayRoom?
    private(set) var items: [ScheduleItem] = []
    private(set) var currentEvent: ScheduleItem?
    private(set) var isPaired: Bool
    /// Set when the last refresh failed; the display keeps showing stale data.
    private(set) var isOffline = false

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

    func activate(code: String) async throws {
        #if DEBUG
        let normalized = code.uppercased().filter { $0.isLetter || $0.isNumber }
        if let event = Self.demoCodes[normalized] {
            startDemo(event: event)
            return
        }
        #endif
        struct Body: Encodable { let code: String }
        let response: ActivateResponse = try await settings.api.post("api/room-display/activate", body: Body(code: code))
        Keychain.write(response.token, account: settings.environment.rawValue)
        token = response.token
        room = response.room
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
            room = response.room
            items = response.items
            currentEvent = response.currentEvent
            isOffline = false
        } catch let error as APIClient.APIError where error.status == 401 {
            // Revoked from Core ▸ Rooms (or the room was archived).
            unpair()
        } catch {
            isOffline = true
        }
    }

    func book(_ request: BookingRequest, memberToken: String) async throws -> BookResponse {
        #if DEBUG
        if isDemo { return demoBook(request.interval) }
        #endif
        let response: BookResponse
        switch request {
        case .now(let minutes):
            struct Body: Encodable { let memberToken: String; let minutes: Int }
            response = try await client.post("api/room-display/book", body: Body(memberToken: memberToken, minutes: minutes))
        case .slot(let interval):
            struct Body: Encodable { let memberToken: String; let start: Date; let end: Date }
            response = try await client.post(
                "api/room-display/book",
                body: Body(memberToken: memberToken, start: interval.start, end: interval.end)
            )
        }
        await refresh()
        return response
    }

    func checkIn(memberToken: String) async throws -> ScannedMember {
        #if DEBUG
        if isDemo {
            try await Task.sleep(for: .milliseconds(400))
            return Self.demoMember
        }
        #endif
        struct Body: Encodable { let memberToken: String }
        let response: ScanResponse = try await client.post("api/room-display/scan", body: Body(memberToken: memberToken))
        return response.member
    }

    #if DEBUG
    /// Sample room and schedule, no server. Entered with the setup code
    /// DEMO-ROOM (or DEMO-EVENT for event check-in mode), or by launching with
    /// `-demoDisplay [event]`. Unpair (long-press the date) to leave.
    static let demoCodes = ["DEMOROOM": false, "DEMOEVENT": true]

    func startDemo(event: Bool) {
        let now = Date.now
        func at(_ minutes: Double) -> Date { now.addingTimeInterval(minutes * 60) }
        func org(_ first: String, _ last: String) -> ScheduleItem.Organizer {
            ScheduleItem.Organizer(id: first, firstName: first, lastName: last)
        }
        room = DisplayRoom(id: "demo", name: "Sudikoff Studio", description: "DALI Lab, 1st floor", capacity: 12)
        items = [
            ScheduleItem(kind: .meeting, id: "a", title: "Design critique", start: at(-200), end: at(-140),
                         organizer: org("Maya", "Chen"), isEvent: false),
            ScheduleItem(kind: .booking, id: "b", title: "Jordan's booking", start: at(-90), end: at(-30),
                         organizer: org("Jordan", "Lee"), isEvent: false),
            ScheduleItem(kind: .booking, id: "c", title: "Interview prep", start: at(event ? -120 : 150), end: at(event ? -100 : 210),
                         organizer: org("Priya", "Patel"), isEvent: false),
            ScheduleItem(kind: .meeting, id: "d", title: "DALI Lab Night", start: at(event ? -10 : 240), end: at(event ? 110 : 360),
                         organizer: org("Sam", "Rivera"), isEvent: true),
        ]
        currentEvent = event ? items.last : nil
        isDemo = true
        isPaired = true
    }

    private static let demoMember = ScannedMember(id: "demo", firstName: "Alex", lastName: "Kim", photoUrl: nil)

    private func demoBook(_ interval: DateInterval) -> BookResponse {
        items.append(ScheduleItem(
            kind: .booking, id: UUID().uuidString, title: "Alex's booking", start: interval.start, end: interval.end,
            organizer: ScheduleItem.Organizer(id: "demo", firstName: "Alex", lastName: "Kim"), isEvent: false
        ))
        items.sort { $0.start < $1.start }
        return BookResponse(booking: .init(id: "demo", start: interval.start, end: interval.end), member: Self.demoMember)
    }
    #endif

    func unpair() {
        isDemo = false
        Keychain.delete(account: settings.environment.rawValue)
        token = nil
        room = nil
        items = []
        currentEvent = nil
        isPaired = false
    }
}
