import Foundation
import Testing
@testable import DaliOS

private let calendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/New_York")!
    return calendar
}()

private func time(_ hour: Int, _ minute: Int = 0, day: Int = 3) -> Date {
    calendar.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute))!
}

private func item(_ start: Date, _ end: Date) -> ScheduleItem {
    ScheduleItem(
        kind: .booking, id: "\(start)", title: "b", start: start, end: end,
        organizer: .init(id: "u", firstName: "A", lastName: "B"), isEvent: false, source: "Display"
    )
}

/// Tuesday, booked 10–12 and 4:30–6. Now is the day before.
private func tuesday(items: [ScheduleItem]? = nil, now: Date = time(9, day: 2)) -> BookingDay {
    BookingDay(
        day: time(0),
        items: items ?? [item(time(10), time(12)), item(time(16, 30), time(18))],
        now: now, calendar: calendar
    )
}

struct BookingDayGapTests {
    @Test func runsFromOpeningToClosing() {
        let day = BookingDay(day: time(0), items: [], now: time(9, day: 2), calendar: calendar)
        #expect(day.gaps == [time(8)...time(22)])
    }

    @Test func splitsAroundBookings() {
        #expect(tuesday().gaps == [time(8)...time(10), time(12)...time(16, 30), time(18)...time(22)])
    }

    @Test func todayStartsAtTheNextFiveMinuteMark() {
        let day = BookingDay(day: time(0), items: [], now: time(14, 2), calendar: calendar)
        #expect(day.gaps == [time(14, 5)...time(22)])
    }

    @Test func nothingLeftAfterClosing() {
        #expect(BookingDay(day: time(0), items: [], now: time(21, 58), calendar: calendar).gaps.isEmpty)
    }

    @Test func oddBookingTimesRoundInward() {
        let day = tuesday(items: [item(time(9, 3), time(9, 12))])
        #expect(day.gaps == [time(8)...time(9), time(9, 15)...time(22)])
    }

    @Test func overlappingBookingsMerge() {
        let day = tuesday(items: [item(time(10), time(12)), item(time(11), time(11, 30)), item(time(12), time(13))])
        #expect(day.gaps == [time(8)...time(10), time(13)...time(22)])
    }

    @Test func gapsTooSmallToBookAreDropped() {
        let day = tuesday(items: [item(time(10), time(10, 1)), item(time(10, 3), time(11))])
        #expect(day.gaps == [time(8)...time(10), time(11)...time(22)])
    }

    @Test func bookingsOutsideTheDayDontCount() {
        #expect(tuesday(items: [item(time(6), time(7)), item(time(22, 30), time(23))]).gaps == [time(8)...time(22)])
    }

    @Test func zeroLengthItemsAreIgnored() {
        #expect(tuesday(items: [item(time(9), time(9))]).gaps == [time(8)...time(22)])
    }
}

struct BookingDayPositionTests {
    @Test func placesTimesAcrossTheDay() {
        let day = tuesday()
        #expect(day.fraction(of: time(8)) == 0)
        #expect(day.fraction(of: time(15)) == 0.5)
        #expect(day.fraction(of: time(22)) == 1)
    }

    @Test func readsTimesBackOffTheSlider() {
        let day = tuesday()
        #expect(day.date(atFraction: 0.5) == time(15))
        #expect(day.date(atFraction: -1) == time(8))
        #expect(day.date(atFraction: 2) == time(22))
    }
}

struct BookingDayDragTests {
    @Test func snapsToFifteenMinutes() {
        let window = tuesday().window(dragFrom: time(14, 3), to: time(15, 11))
        #expect(window == BookingWindow(start: time(14), end: time(15, 15)))
    }

    @Test func dragsBackwardToo() {
        #expect(tuesday().window(dragFrom: time(15), to: time(14)) == BookingWindow(start: time(14), end: time(15)))
    }

    @Test func startsOnFreeTimeOnly() {
        #expect(tuesday().window(dragFrom: time(11), to: time(13)) == nil)
    }

    @Test func stopsAtTheNextBooking() {
        #expect(tuesday().window(dragFrom: time(14), to: time(20))?.end == time(16, 30))
    }

    @Test func stopsAtThePreviousBooking() {
        #expect(tuesday().window(dragFrom: time(14), to: time(9))?.start == time(12))
    }

    @Test func staysUnderTheLimit() {
        let day = tuesday(items: [])
        #expect(day.window(dragFrom: time(9), to: time(20))?.end == time(17))
        #expect(day.window(dragFrom: time(20), to: time(9))?.start == time(12))
    }

    @Test func aDragThatDoesntLeaveItsSlotIsStillAWindow() {
        let window = tuesday().window(dragFrom: time(14), to: time(14, 2))
        #expect(window == BookingWindow(start: time(14), end: time(14, 15)))
    }

    @Test func thatWindowFitsBeforeTheNextBooking() {
        let window = tuesday().window(dragFrom: time(16, 28), to: time(16, 29))
        #expect(window == BookingWindow(start: time(16, 15), end: time(16, 30)))
    }
}

struct BookingDayTapTests {
    @Test func booksAnHour() {
        #expect(tuesday().window(tappedAt: time(14, 2)) == BookingWindow(start: time(14), end: time(15)))
    }

    @Test func slidesBackToFitBeforeTheNextBooking() {
        #expect(tuesday().window(tappedAt: time(16)) == BookingWindow(start: time(15, 30), end: time(16, 30)))
    }

    @Test func shortensWhenTheGapIsShort() {
        let day = tuesday(items: [item(time(10), time(12)), item(time(12, 30), time(18))])
        #expect(day.window(tappedAt: time(12, 15)) == BookingWindow(start: time(12), end: time(12, 30)))
    }

    @Test func doesNothingOnABooking() {
        #expect(tuesday().window(tappedAt: time(11)) == nil)
    }
}

struct BookingDayHandleTests {
    private let window = BookingWindow(start: time(14), end: time(15))

    @Test func startHandleSnapsAndKeepsTheEnd() {
        #expect(tuesday().movingStart(of: window, to: time(13, 22)) == BookingWindow(start: time(13, 15), end: time(15)))
    }

    @Test func endHandleSnapsAndKeepsTheStart() {
        #expect(tuesday().movingEnd(of: window, to: time(15, 40)) == BookingWindow(start: time(14), end: time(15, 45)))
    }

    @Test func handlesStopAtBookings() {
        #expect(tuesday().movingStart(of: window, to: time(9)).start == time(12))
        #expect(tuesday().movingEnd(of: window, to: time(20)).end == time(16, 30))
    }

    @Test func handlesCantCross() {
        #expect(tuesday().movingStart(of: window, to: time(16)).start == time(14, 55))
        #expect(tuesday().movingEnd(of: window, to: time(13)).end == time(14, 5))
    }

    @Test func handlesStayUnderTheLimit() {
        let day = tuesday(items: [])
        #expect(day.movingEnd(of: window, to: time(22)).end == time(22))
        let long = BookingWindow(start: time(10), end: time(11))
        #expect(day.movingEnd(of: long, to: time(21)).end == time(18))
        let late = BookingWindow(start: time(20), end: time(21))
        #expect(day.movingStart(of: late, to: time(9)).start == time(13))
    }
}

struct BookingDayWheelTests {
    private let window = BookingWindow(start: time(14), end: time(15))

    @Test func movingStartKeepsTheLength() {
        #expect(tuesday().settingStart(of: window, to: time(14, 35)) == BookingWindow(start: time(14, 35), end: time(15, 35)))
    }

    @Test func startStopsWhereTheEndWouldHitTheNextBooking() {
        #expect(tuesday().startRange(for: window) == time(12)...time(15, 30))
        #expect(tuesday().settingStart(of: window, to: time(16)) == BookingWindow(start: time(15, 30), end: time(16, 30)))
    }

    @Test func startCantGoBackThroughABooking() {
        #expect(tuesday().settingStart(of: window, to: time(9)).start == time(12))
    }

    @Test func endCantPassTheStart() {
        #expect(tuesday().endRange(for: window) == time(14, 5)...time(16, 30))
        #expect(tuesday().settingEnd(of: window, to: time(13)) == BookingWindow(start: time(14), end: time(14, 5)))
    }

    @Test func endCantPassTheNextBooking() {
        #expect(tuesday().settingEnd(of: window, to: time(20)).end == time(16, 30))
    }

    @Test func endCantPassClosing() {
        #expect(tuesday(items: []).settingEnd(of: BookingWindow(start: time(20), end: time(21)), to: time(23)).end == time(22))
    }

    @Test func endStaysUnderTheLimit() {
        #expect(tuesday(items: []).endRange(for: BookingWindow(start: time(9), end: time(10))).upperBound == time(17))
    }

    @Test func todayCantStartInThePast() {
        let day = BookingDay(day: time(0), items: [], now: time(14, 2), calendar: calendar)
        let window = BookingWindow(start: time(15), end: time(16))
        #expect(day.settingStart(of: window, to: time(9)).start == time(14, 5))
    }

    @Test func aWindowOverrunByTheClockStaysPut() {
        let day = BookingDay(day: time(0), items: [], now: time(14, 30), calendar: calendar)
        #expect(day.settingEnd(of: window, to: time(20)).end == time(15))
        #expect(day.settingStart(of: window, to: time(9)) == window)
    }
}

struct BookingDayClockChangeTests {
    @Test func placesTimesOnTheDayTheClocksChange() {
        // Nov 1 2026, the morning the clocks went back: the day still runs 8 to 10.
        let day = BookingDay(day: time(0, day: 1), items: [], now: time(9, day: 1), calendar: calendar)
        #expect(day.closes.timeIntervalSince(day.opens) == 14 * 3600)
        #expect(day.gaps == [time(9, day: 1)...time(22, day: 1)])
    }
}
