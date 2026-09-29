import Foundation
import Testing
@testable import DaliOS

struct APIClientTests {
    @Test(arguments: ["/api/notifications", "api/notifications"])
    func buildsURLFromPath(path: String) {
        let client = APIClient(baseURL: AppEnvironment.staging.baseURL)
        #expect(client.url(for: path).absoluteString == "https://os-staging.dali.dartmouth.edu/api/notifications")
    }

    @Test func persistsEnvironmentSelection() {
        let defaults = UserDefaults(suiteName: #function)!
        defaults.removePersistentDomain(forName: #function)

        AppSettings(defaults: defaults).environment = .local
        #expect(AppSettings(defaults: defaults).environment == .local)
    }
}

struct ScheduleResponseTests {
    private func decode(_ json: String) throws -> ScheduleResponse {
        try JSONDecoder.api.decode(ScheduleResponse.self, from: Data(json.utf8))
    }

    @Test func decodesIPadScanSwitchedOnFromAttendance() throws {
        let response = try decode("""
        {"room":{"id":"r1","name":"Lab"},"items":[],"currentEvent":null,
         "attendanceScan":{"meetingId":"m1","title":"Project sync",
           "start":"2026-09-30T22:00:00.000Z","end":"2026-09-30T23:00:00.000Z"}}
        """)
        #expect(response.attendanceScan?.meetingId == "m1")
        #expect(response.attendanceScan?.timeRange != nil)
    }

    @Test func unscheduledScanHasNoTimeRange() throws {
        let response = try decode("""
        {"room":{"id":"r1","name":"Lab"},"items":[],"currentEvent":null,
         "attendanceScan":{"meetingId":"m1","title":"Drop-in","start":null,"end":null}}
        """)
        #expect(response.attendanceScan?.timeRange == nil)
    }

    @Test func scanIsOffWhenAbsent() throws {
        let response = try decode(#"{"room":{"id":"r1","name":"Lab"},"items":[],"currentEvent":null}"#)
        #expect(response.attendanceScan == nil)
    }
}
