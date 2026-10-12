import Foundation

struct APIError: LocalizedError {
    let http: Int
    let code: String
    let message: String
    var errorDescription: String? { message }
}

/// Thin JSON-over-HTTPS client. Auth / refresh policy lives in AppState.
final class API {
    private let base: URL
    /// serverTime − localTime in seconds, from response `Date` headers; keeps the rotating QR valid on a skewed phone clock.
    var skew: TimeInterval = 0
    var onSkew: ((TimeInterval) -> Void)?
    private let session: URLSession

    private static let httpDate: DateFormatter = {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "GMT")
        f.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"; return f
    }()

    init(base: String) {
        self.base = URL(string: base)!
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 15
        cfg.waitsForConnectivity = false
        cfg.httpAdditionalHeaders = ["Accept": "application/json"]
        self.session = URLSession(configuration: cfg)
    }

    @discardableResult
    func data(_ method: String, _ path: String, body: [String: Any]? = nil, token: String? = nil) async throws -> Data {
        var req = URLRequest(url: URL(string: path, relativeTo: base)!.absoluteURL)
        req.httpMethod = method
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, resp) = try await session.data(for: req)
        guard let http = resp as? HTTPURLResponse else { throw APIError(http: 0, code: "network", message: "No response from the server.") }
        if let d = http.value(forHTTPHeaderField: "Date"), let date = Self.httpDate.date(from: d) {
            skew = date.timeIntervalSinceNow
            onSkew?(skew)
        }
        guard (200..<300).contains(http.statusCode) else {
            let j = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let msg = (j?["message"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Request failed (\(http.statusCode))"
            throw APIError(http: http.statusCode, code: (j?["error"] as? String) ?? "error", message: msg)
        }
        return data
    }

    func call<T: Decodable>(_ method: String, _ path: String, body: [String: Any]? = nil, token: String? = nil, as type: T.Type = T.self) async throws -> T {
        let d = try await data(method, path, body: body, token: token)
        do { return try JSONDecoder.api.decode(T.self, from: d) }
        catch { throw APIError(http: 0, code: "decode", message: "Unexpected response from the server.") }
    }
}
