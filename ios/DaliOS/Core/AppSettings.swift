import Foundation
import Observation

@Observable
final class AppSettings {
    private static let environmentKey = "appEnvironment"

    private let defaults: UserDefaults

    var environment: AppEnvironment {
        didSet { defaults.set(environment.rawValue, forKey: Self.environmentKey) }
    }

    var api: APIClient { APIClient(baseURL: environment.baseURL) }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        #if DEBUG
        let stored = defaults.string(forKey: Self.environmentKey).flatMap(AppEnvironment.init(rawValue:))
        self.environment = stored ?? .default
        #else
        self.environment = .production
        #endif
    }
}
