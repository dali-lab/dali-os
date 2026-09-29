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
