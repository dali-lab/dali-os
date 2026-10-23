import Foundation
import Testing
@testable import DaliOS

private let now = Date(timeIntervalSince1970: 1_800_000_000)

private func at(_ minutes: Double) -> Date { now.addingTimeInterval(minutes * 60) }

private func item(
    _ startMin: Double, _ endMin: Double,
    kind: ScheduleItem.Kind = .booking, source: String? = "Display", title: String = "b"
) -> ScheduleItem {
    ScheduleItem(
        kind: kind, id: "\(startMin)", title: title, start: at(startMin), end: at(endMin),
        organizer: .init(id: "u", firstName: "A", lastName: "B"), isEvent: false, source: source
    )
}

struct RoomStateStatusTests {
    @Test func availableWithNothingBooked() {
        let state = RoomState(items: [], now: now)
        #expect(state.status == .available)
        #expect(state.current == nil && state.next == nil)
        #expect(state.minutesUntilChange == 0)
    }

    @Test func busyWhileABookingIsUnderway() {
        let state = RoomState(items: [item(60, 90), item(-10, 20)], now: now)
        #expect(state.status == .busy)
        #expect(state.current?.id == "-10.0")
        #expect(state.next?.id == "60.0")
        #expect(state.minutesUntilChange == 20)
    }

    @Test func soonWithinTenMinutesOfTheNextBooking() {
        #expect(RoomState(items: [item(10, 40)], now: now).status == .soon)
        #expect(RoomState(items: [item(11, 40)], now: now).status == .available)
    }

    @Test func pastBookingsDontCount() {
        let state = RoomState(items: [item(-60, -30), item(40, 90)], now: now)
        #expect(state.current == nil)
        #expect(state.next?.id == "40.0")
        #expect(state.minutesUntilChange == 40)
    }

    @Test func aBookingEndingNowIsOver() {
        #expect(RoomState(items: [item(-30, 0)], now: now).current == nil)
    }

    @Test func zeroLengthItemsAreIgnored() {
        #expect(RoomState(items: [item(-5, -5), item(20, 20)], now: now).next == nil)
    }

    @Test func minutesRoundUp() {
        #expect(RoomState.minutes(from: now, to: now.addingTimeInterval(61)) == 2)
        #expect(RoomState.minutes(from: now, to: now.addingTimeInterval(-60)) == 0)
    }
}

struct RoomStateBookingTests {
    @Test func offersEveryLengthWhenFreeAllDay() {
        #expect(RoomState(items: [], now: now).bookableDurations == [15, 30, 60, 90])
    }

    @Test func offersOnlyLengthsThatEndBeforeTheNextBooking() {
        #expect(RoomState(items: [item(45, 90)], now: now).bookableDurations == [15, 30])
        #expect(RoomState(items: [item(60, 90)], now: now).bookableDurations == [15, 30, 60])
    }

    @Test func offersNothingWhileInUseOrRightBeforeTheNext() {
        #expect(RoomState(items: [item(-10, 20)], now: now).bookableDurations.isEmpty)
        #expect(RoomState(items: [item(10, 20)], now: now).bookableDurations.isEmpty)
    }
}

struct RoomStateChangeTests {
    @Test func aDoorBookingCanBeEndedAndExtended() {
        let state = RoomState(items: [item(-10, 20)], now: now)
        #expect(state.canChange)
        #expect(state.canExtend)
    }

    @Test func extendNeedsFifteenFreeMinutesAfterIt() {
        #expect(RoomState(items: [item(-10, 20), item(35, 60)], now: now).canExtend)
        let blocked = RoomState(items: [item(-10, 20), item(30, 60)], now: now)
        #expect(blocked.canChange)
        #expect(!blocked.canExtend)
    }

    @Test func meetingsAndHiringHoldsArentChangedAtTheDoor() {
        for current in [
            item(-10, 20, kind: .meeting, source: nil),
            item(-10, 20, source: "Interview"),
            item(-10, 20, source: "InterviewHold"),
        ] {
            let state = RoomState(items: [current], now: now)
            #expect(!state.canChange)
            #expect(!state.canExtend)
        }
    }

    @Test func webAndAppBookingsCanBeChanged() {
        #expect(RoomState(items: [item(-10, 20, source: "Web")], now: now).canChange)
        #expect(RoomState(items: [item(-10, 20, source: "App")], now: now).canChange)
    }

    @Test func nothingToChangeWhenFree() {
        let state = RoomState(items: [item(30, 60)], now: now)
        #expect(!state.canChange)
        #expect(!state.canExtend)
    }

    @Test func progressRunsFromStartToEnd() {
        let state = RoomState(items: [item(-15, 45)], now: now)
        #expect(state.progress(now: now) == 0.25)
        #expect(state.progress(now: at(100)) == 1)
        #expect(RoomState(items: [], now: now).progress(now: now) == 0)
    }
}

struct DisplayFormatTests {
    @Test func durations() {
        #expect(DisplayFormat.duration(minutes: 15) == "15 min")
        #expect(DisplayFormat.duration(minutes: 60) == "1 hr")
        #expect(DisplayFormat.duration(minutes: 90) == "1 hr 30 min")
        #expect(DisplayFormat.duration(minutes: 0) == "0 min")
    }
}

struct TwoRoomScheduleResponseTests {
    private func decode(_ json: String) throws -> ScheduleResponse {
        try JSONDecoder.api.decode(ScheduleResponse.self, from: Data(json.utf8))
    }

    private let lab = #"{"id":"r1","name":"Lab","description":null,"capacity":8}"#
    private let booking = #"""
    {"kind":"booking","id":"b1","title":"Standup","start":"2026-10-23T14:00:00.000Z","end":"2026-10-23T15:00:00.000Z",
     "occurrenceStart":"2026-10-23T14:00:00.000Z","recurring":false,
     "organizer":{"id":"u1","firstName":"Ada","lastName":"Lovelace","photoUrl":null},"isEvent":false,"source":"Display"}
    """#

    @Test func readsBothRoomsAndEventCheckIns() throws {
        let response = try decode(#"""
        {"room":\#(lab),"items":[],"currentEvent":null,"attendanceScan":null,"applicationEvent":null,
         "rooms":[
           {"room":\#(lab),"items":[\#(booking)],"currentEvent":null},
           {"room":{"id":"r2","name":"Garage","description":"Level 1","capacity":14},"items":[],
            "currentEvent":{"kind":"meeting","id":"m1","title":"Lab night","start":"2026-10-23T22:00:00.000Z",
              "end":"2026-10-23T23:00:00.000Z","organizer":{"id":"u1","firstName":"Ada","lastName":"Lovelace"},
              "isEvent":true,"source":null,
              "checkIns":{"count":1,"expected":12,"recent":[
                {"id":"u2","firstName":"Grace","lastName":"Hopper","photoUrl":null,"at":"2026-10-23T22:01:00.000Z"}]}}}
         ]}
        """#)
        let rooms = response.roomSchedules
        #expect(rooms.map(\.room.id) == ["r1", "r2"])
        #expect(rooms[0].items.first?.source == "Display")
        #expect(rooms[0].items.first?.isChangeableAtDoor == true)
        #expect(rooms[1].currentEvent?.checkIns?.count == 1)
        #expect(rooms[1].currentEvent?.checkIns?.recent.first?.firstName == "Grace")
    }

    @Test func fallsBackToTheOneRoomFromAnOlderServer() throws {
        let response = try decode(#"""
        {"room":\#(lab),"items":[\#(booking)],"currentEvent":null,"attendanceScan":null}
        """#)
        #expect(response.roomSchedules.count == 1)
        #expect(response.roomSchedules[0].room.name == "Lab")
        #expect(response.roomSchedules[0].items.count == 1)
    }

    @Test func readsTheLabScanCount() throws {
        let response = try decode(#"""
        {"room":\#(lab),"items":[],"currentEvent":null,"rooms":[],
         "attendanceScan":{"meetingId":"m9","title":"All-lab meeting","start":null,"end":null,
           "checkIns":{"count":12,"expected":48,"recent":[]}}}
        """#)
        #expect(response.attendanceScan?.checkIns?.count == 12)
        #expect(response.attendanceScan?.checkIns?.expected == 48)
        #expect(response.attendanceScan?.timeRange == nil)
    }
}

struct TileLayoutTests {
    // Reference values from the design system's own JS (Td / kd) for the same seeds.
    @Test func prngMatchesTheDesignSystem() {
        var random = TileLayout.Mulberry(seed: 24)
        let values = [random.next(), random.next(), random.next()]
        #expect(values == [0.33202015655115247, 0.9638483456801623, 0.29391058976761997])
    }

    @Test func layoutMatchesTheDesignSystem() {
        let tiles = TileLayout.tiles(rows: 2, columns: 4, seed: 30, density: 0.7, pairCount: 3)
        let expected: [TileLayout.Tile?] = [
            .init(shape: .quarter, pair: 1, rotation: 270),
            .init(shape: .quarter, pair: 2, rotation: 180),
            .init(shape: .ring, pair: 0, rotation: 90),
            .init(shape: .loose, pair: 5, rotation: 0),
            .init(shape: .dot, pair: 1, rotation: 270),
            .init(shape: .dot, pair: 2, rotation: 180),
            nil,
            .init(shape: .dot, pair: 1, rotation: 270),
        ]
        #expect(tiles == expected)
    }

    @Test func sparseSeedLeavesGaps() {
        let tiles = TileLayout.tiles(rows: 2, columns: 4, seed: 24, density: 0.7, pairCount: 3)
        #expect(tiles.count == 8)
        #expect(tiles.compactMap { $0 }.count == 2)
    }
}
