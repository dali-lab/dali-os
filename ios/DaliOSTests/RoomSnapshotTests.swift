import Foundation
import Testing
@testable import DaliOS

struct RoomSnapshotTests {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func item(_ startMin: Double, _ endMin: Double) -> ScheduleItem {
        ScheduleItem(
            kind: .booking, id: "\(startMin)", title: "b",
            start: now.addingTimeInterval(startMin * 60), end: now.addingTimeInterval(endMin * 60),
            organizer: .init(id: "u", firstName: "A", lastName: "B"), isEvent: false
        )
    }

    @Test func busyWhileABookingIsUnderway() {
        let snapshot = RoomSnapshot(items: [item(-10, 20), item(60, 90)], now: now)
        #expect(snapshot.current?.id == "-10.0")
        #expect(snapshot.next?.id == "60.0")
        #expect(snapshot.bookableMinutes.isEmpty)
    }

    @Test func bookNowOnlyOffersDurationsThatFitBeforeTheNextBooking() {
        let snapshot = RoomSnapshot(items: [item(40, 90)], now: now)
        #expect(snapshot.freeMinutes == 40)
        #expect(snapshot.bookableMinutes == [15, 30])
    }

    @Test func aShortGapOffersExactlyTheGap() {
        #expect(RoomSnapshot(items: [item(10, 30)], now: now).bookableMinutes == [10])
        #expect(RoomSnapshot(items: [item(3, 30)], now: now).bookableMinutes.isEmpty)
    }

    @Test func presetsAreFifteenThirtyOneHourTwoHours() {
        #expect(RoomSnapshot.bookNowOptions == [15, 30, 60, 120])
        #expect(RoomSnapshot(items: [item(100, 160)], now: now).bookableMinutes == [15, 30, 60])
    }

    @Test func freeForTheRestOfTheDayOffersEveryPreset() {
        let snapshot = RoomSnapshot(items: [item(-60, -30)], now: now)
        #expect(snapshot.freeMinutes == nil)
        #expect(snapshot.bookableMinutes == RoomSnapshot.bookNowOptions)
    }
}

struct SlotPickerTests {
    // A quarter-hour boundary, so snapping is easy to read.
    private let now = Date(timeIntervalSinceReferenceDate: 800_000_100)
    private var base: Date { Date(timeIntervalSinceReferenceDate: 800_000_100 - 800_000_100.truncatingRemainder(dividingBy: 900)) }

    private func at(_ minutes: Double) -> Date { base.addingTimeInterval(minutes * 60) }

    private func item(_ startMin: Double, _ endMin: Double) -> ScheduleItem {
        ScheduleItem(
            kind: .booking, id: "\(startMin)", title: "b", start: at(startMin), end: at(endMin),
            organizer: .init(id: "u", firstName: "A", lastName: "B"), isEvent: false
        )
    }

    @Test func dragSnapsOutwardToQuarterHours() {
        let slot = SlotPicker(items: [], now: now).drag(from: at(67), to: at(125))
        #expect(slot.interval == DateInterval(start: at(60), end: at(135)))
        #expect(slot.isValid)
    }

    @Test func draggingUpwardWorksToo() {
        let slot = SlotPicker(items: [], now: now).drag(from: at(125), to: at(67))
        #expect(slot.interval == DateInterval(start: at(60), end: at(135)))
    }

    @Test func dragAcrossABookingIsInvalid() {
        let slot = SlotPicker(items: [item(90, 120)], now: now).drag(from: at(60), to: at(150))
        #expect(!slot.isValid)
    }

    @Test func dragStartingInThePastStartsNow() {
        let slot = SlotPicker(items: [], now: at(20)).drag(from: at(0), to: at(60))
        #expect(slot.interval.start == at(20))
        #expect(slot.isValid)
    }

    @Test func tapPicksThirtyMinutesShortenedBeforeTheNextBooking() {
        let picker = SlotPicker(items: [item(75, 120)], now: now)
        #expect(picker.tap(at: at(122))?.interval == DateInterval(start: at(120), end: at(150)))
        #expect(picker.tap(at: at(62))?.interval == DateInterval(start: at(60), end: at(75)))
    }

    @Test func tapOnABookingPicksNothing() {
        #expect(SlotPicker(items: [item(60, 120)], now: now).tap(at: at(80)) == nil)
    }
}
