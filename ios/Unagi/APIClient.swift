import Foundation

enum NetworkFailure: LocalizedError {
    case response(String)
    case invalidResponse
    var errorDescription: String? {
        switch self {
        case .response(let message): message
        case .invalidResponse: "Не удалось получить ответ сервера"
        }
    }
}

struct APIClient {
    // Public tenant identifier. Secrets and payment credentials are never stored in the app.
    static let baseURL = URL(string: "https://81.200.152.37/api/public/unagi")!
    private let session: URLSession = .shared

    func config() async throws -> PublicConfig { try await send("config") }
    func menu(branch: String) async throws -> MenuResponse {
        try await send("menu/\(branch.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? branch)")
    }
    func quote(_ order: OrderRequest) async throws -> Quote { try await send("quote", body: order) }

    private func send<T: Decodable>(_ path: String, body: OrderRequest? = nil) async throws -> T {
        var request = URLRequest(url: Self.baseURL.appending(path: path))
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw NetworkFailure.invalidResponse }
        guard (200..<300).contains(response.statusCode) else {
            let message = (try? JSONDecoder().decode(APIError.self, from: data).message) ?? "Ошибка сервера: \(response.statusCode)"
            throw NetworkFailure.response(message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
