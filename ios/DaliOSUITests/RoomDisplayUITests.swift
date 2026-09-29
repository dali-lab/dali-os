import XCTest

final class RoomDisplayUITests: XCTestCase {
    @MainActor
    func testPlusButtonBooksAPresetAfterAScan() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demoDisplay"]
        app.launch()

        let plus = app.buttons["New booking"]
        XCTAssertTrue(plus.waitForExistence(timeout: 5))
        plus.tap()

        XCTAssertTrue(app.navigationBars["New booking"].waitForExistence(timeout: 5))
        app.buttons["1 hr"].tap()
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.buttons["Simulate a scan"].waitForExistence(timeout: 5))
        app.buttons["Simulate a scan"].tap()
        XCTAssertTrue(app.staticTexts["Alex Kim"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testPlusButtonAfterPairingWithDemoCodeOnLocal() throws {
        let app = XCUIApplication()
        app.launch()

        let local = app.buttons["Local"]
        XCTAssertTrue(local.waitForExistence(timeout: 5))
        local.tap()
        let field = app.textFields.firstMatch
        field.tap()
        field.typeText("DEMO-ROOM")
        app.buttons["Pair display"].tap()

        let plus = app.buttons["New booking"]
        XCTAssertTrue(plus.waitForExistence(timeout: 5))
        plus.tap()
        XCTAssertTrue(app.navigationBars["New booking"].waitForExistence(timeout: 5))
    }
}
