import XCTest

final class RoomDisplayUITests: XCTestCase {
    @MainActor
    func testBookNowOpensScannerAndBooks() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-demoDisplay"]
        app.launch()

        let button = app.buttons["15 min"]
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        button.tap()

        XCTAssertTrue(app.navigationBars["Book for 15 minutes"].waitForExistence(timeout: 5))
        app.buttons["Simulate a scan"].tap()
        XCTAssertTrue(app.staticTexts["Alex Kim"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testBookNowAfterPairingWithDemoCodeOnLocal() throws {
        let app = XCUIApplication()
        app.launch()

        let local = app.buttons["Local"]
        XCTAssertTrue(local.waitForExistence(timeout: 5))
        local.tap()
        let field = app.textFields.firstMatch
        field.tap()
        field.typeText("DEMO-ROOM")
        app.buttons["Pair display"].tap()

        let button = app.buttons["15 min"]
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        button.tap()
        XCTAssertTrue(app.navigationBars["Book for 15 minutes"].waitForExistence(timeout: 5))
    }
}
