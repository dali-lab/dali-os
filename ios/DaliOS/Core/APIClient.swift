import Foundation

struct APIClient: Sendable {
    let baseURL: URL
    var session: URLSession = .shared

    enum APIError: Error {
        case httpStatus(Int)
    }

    func url(for path: String) -> URL {
        baseURL.appending(path: path.hasPrefix("/") ? String(path.dropFirst()) : path)
    }

    func get<Response: Decodable>(_ path: String, as type: Response.Type = Response.self) async throws -> Response {
        var request = URLRequest(url: url(for: path))
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw APIError.httpStatus(http.statusCode)
        }
        return try JSONDecoder().decode(Response.self, from: data)
    }
}
