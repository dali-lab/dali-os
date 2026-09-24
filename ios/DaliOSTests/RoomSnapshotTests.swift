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

    @Test func freeForTheRestOfTheDayOffersEveryPreset() {
        let snapshot = RoomSnapshot(items: [item(-60, -30)], now: now)
        #expect(snapshot.freeMinutes == nil)
        #expect(snapshot.bookableMinutes == RoomSnapshot.bookNowOptions)
    }

    @Test func bookedFractionMergesOverlapsAndClipsToTheDay() {
        let dayStart = now
        let dayEnd = now.addingTimeInterval(100 * 60)
        let items = [item(-10, 20), item(10, 30), item(90, 120)]
        // Covered: 0–30 (merged, clipped at start) + 90–100 (clipped at end) = 40 of 100.
        #expect(abs(RoomSnapshot.bookedFraction(items, dayStart: dayStart, dayEnd: dayEnd) - 0.4) < 0.0001)
    }
}
