import Foundation

enum AppEnvironment: String, CaseIterable, Identifiable {
    case production
    case staging
    case local

    var id: Self { self }

    var displayName: String {
        switch self {
        case .production: "Production"
        case .staging: "Staging"
        case .local: "Local"
        }
    }

    var baseURL: URL {
        switch self {
        case .production: URL(string: "https://os.dali.dartmouth.edu")!
        case .staging: URL(string: "https://os-staging.dali.dartmouth.edu")!
        // The simulator shares the Mac's loopback, so this reaches `npm run dev` directly.
        case .local: URL(string: "http://localhost:3001")!
        }
    }

    static var `default`: AppEnvironment {
        #if DEBUG
        .staging
        #else
        .production
        #endif
    }
}
