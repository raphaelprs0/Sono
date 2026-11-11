import Foundation

/// Le moteur Deezer (engine/, en Go) tourne dans l’app et répond sur une adresse locale, comme sur ordinateur.
final class Engine {
    private(set) var port = 0
    private(set) var account: [String: Any] = [:]
    private let token = UUID().uuidString
    var isRunning: Bool { port != 0 }

    func start(arl: String) async throws {
        let token = self.token
        let reply: [String: Any] = await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let raw = arl.withCString { a in token.withCString { t in SonoEngineStart(UnsafeMutablePointer(mutating: a), UnsafeMutablePointer(mutating: t)) } }
                defer { SonoFree(raw) }
                let data = Data(String(cString: raw!).utf8)
                continuation.resume(returning: (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:])
            }
        }
        if let error = reply["error"] as? String { throw SonoError.message(error) }
        guard let port = reply["port"] as? Int else { throw SonoError.message(L("Le moteur Deezer n’a pas démarré.")) }
        self.port = port
        self.account = reply["account"] as? [String: Any] ?? [:]
    }

    func stop() {
        SonoEngineStop()
        port = 0
        account = [:]
    }

    @discardableResult
    func request(_ path: String, method: String = "POST", body: Data? = nil) async throws -> [String: Any] {
        guard isRunning, let url = URL(string: "http://127.0.0.1:\(port)\(path)") else { throw SonoError.message(L("Deezer n’est pas connecté.")) }
        var request = URLRequest(url: url, timeoutInterval: 15)
        request.httpMethod = method
        request.httpBody = body
        request.setValue(token, forHTTPHeaderField: "X-OpenDeezer-Token")
        let (data, response) = try await URLSession.shared.data(for: request)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if (response as? HTTPURLResponse)?.statusCode ?? 500 >= 400 { throw SonoError.message(json["error"] as? String ?? L("Le moteur Deezer a refusé la demande.")) }
        return json
    }
}
