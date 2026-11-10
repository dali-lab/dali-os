import XCTest

final class RoomDisplayUITests: XCTestCase {
    @MainActor
    func testBookNowPicksALengthThenBooksAfterAScan() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demoDisplay", "rooms"]
        app.launch()

        let book = app.buttons["Book now"]
        XCTAssertTrue(book.waitForExistence(timeout: 5))
        book.tap()

        XCTAssertTrue(app.staticTexts["Book Fishbowl"].waitForExistence(timeout: 5))
        app.buttons["1 hr"].tap()
        app.buttons["Continue"].tap()
        let simulate = app.buttons["Simulate a scan"]
        XCTAssertTrue(simulate.waitForExistence(timeout: 5))
        simulate.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Booked for'")).firstMatch.waitForExistence(timeout: 5))
    }

    @MainActor
    func testCustomPicksATimeOnTheSliderThenBooksAfterAScan() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demoDisplay", "rooms"]
        app.launch()

        let book = app.buttons["Book now"]
        XCTAssertTrue(book.waitForExistence(timeout: 5))
        book.tap()
        let custom = app.buttons["Custom"]
        XCTAssertTrue(custom.waitForExistence(timeout: 5))
        custom.tap()

        XCTAssertTrue(app.staticTexts["Which day?"].waitForExistence(timeout: 5))
        app.buttons["booking-day-1"].tap()
        let timeline = app.otherElements["day-timeline"]
        XCTAssertTrue(timeline.waitForExistence(timeout: 5))
        timeline.tap()
        let scan = app.buttons["Scan pass to book"]
        XCTAssertTrue(scan.waitForExistence(timeout: 5))
        scan.tap()
        let simulate = app.buttons["Simulate a scan"]
        XCTAssertTrue(simulate.waitForExistence(timeout: 5))
        simulate.tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Booked for'")).firstMatch.waitForExistence(timeout: 5))
    }

    @MainActor
    func testBackFromCustomReturnsToBookNow() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demoDisplay", "rooms"]
        app.launch()

        let book = app.buttons["Book now"]
        XCTAssertTrue(book.waitForExistence(timeout: 5))
        book.tap()
        let custom = app.buttons["Custom"]
        XCTAssertTrue(custom.waitForExistence(timeout: 5))
        custom.tap()
        let back = app.buttons["Back"]
        XCTAssertTrue(back.waitForExistence(timeout: 5))
        back.tap()
        XCTAssertTrue(app.buttons["Continue"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testEndEarlyNeedsAPassScan() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demoDisplay", "rooms"]
        app.launch()

        let end = app.buttons["End early"]
        XCTAssertTrue(end.waitForExistence(timeout: 5))
        end.tap()
        XCTAssertTrue(app.staticTexts["End meeting early?"].waitForExistence(timeout: 5))
        app.buttons["Invalid pass"].tap()
        XCTAssertTrue(app.staticTexts["Couldn't scan that pass"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testEventCheckInListsWhoScanned() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demoDisplay", "event"]
        app.launch()

        let checkIn = app.buttons["Check in with DALI pass"]
        XCTAssertTrue(checkIn.waitForExistence(timeout: 5))
        checkIn.tap()
        app.buttons["Simulate a scan"].tap()
        XCTAssertTrue(app.staticTexts["1 checked in"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testPairingWithADemoCodeOnLocal() throws {
        let app = XCUIApplication()
        app.launch()

        let local = app.buttons["Local"]
        XCTAssertTrue(local.waitForExistence(timeout: 5))
        local.tap()
        let field = app.textFields.firstMatch
        field.tap()
        field.typeText("DEMO-ROOM")
        app.buttons["Pair display"].tap()

        XCTAssertTrue(app.buttons["Book now"].waitForExistence(timeout: 5))
    }
}
