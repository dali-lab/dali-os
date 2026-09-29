import Foundation

struct APIClient: Sendable {
    let baseURL: URL
    var session: URLSession = .shared
    /// Full `Authorization` header value, e.g. `RoomDisplay <token>`.
    var authorization: String?

    enum APIError: LocalizedError {
        case server(status: Int, message: String?)

        var errorDescription: String? {
            switch self {
            case .server(_, let message?): message
            case .server(let status, nil): "Request failed (\(status))"
            }
        }

        var status: Int {
            switch self { case .server(let status, _): status }
        }
    }

    func url(for path: String, query: [URLQueryItem] = []) -> URL {
        let url = baseURL.appending(path: path.hasPrefix("/") ? String(path.dropFirst()) : path)
        return query.isEmpty ? url : url.appending(queryItems: query)
    }

    func get<Response: Decodable>(
        _ path: String,
        query: [URLQueryItem] = [],
        as type: Response.Type = Response.self
    ) async throws -> Response {
        try await send(URLRequest(url: url(for: path, query: query)))
    }

    func post<Response: Decodable>(
        _ path: String,
        body: some Encodable,
        as type: Response.Type = Response.self
    ) async throws -> Response {
        var request = URLRequest(url: url(for: path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder.api.encode(body)
        return try await send(request)
    }

    private func send<Response: Decodable>(_ request: URLRequest) async throws -> Response {
        var request = request
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let authorization {
            request.setValue(authorization, forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error
            throw APIError.server(status: http.statusCode, message: message)
        }
        return try JSONDecoder.api.decode(Response.self, from: data)
    }

    private struct ErrorBody: Decodable {
        let error: String
    }
}

extension JSONDecoder {
    /// The API sends JS `toISOString()` instants, which carry milliseconds.
    static var api: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let string = try decoder.singleValueContainer().decode(String.self)
            if let date = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(string) {
                return date
            }
            return try Date.ISO8601FormatStyle().parse(string)
        }
        return decoder
    }
}

extension JSONEncoder {
    static var api: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
