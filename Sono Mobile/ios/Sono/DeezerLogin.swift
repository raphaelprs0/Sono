import UIKit
import WebKit
import Security

enum SonoError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

/// Page officielle de connexion Deezer. Dès que Deezer pose son cookie « arl », la fenêtre se ferme.
final class DeezerLogin: UIViewController {
    private var continuation: CheckedContinuation<String, Error>?
    private var timer: Timer?
    private let webView: WKWebView = {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        return WKWebView(frame: .zero, configuration: configuration)
    }()

    @MainActor static func present(from parent: UIViewController) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            let login = DeezerLogin()
            login.continuation = continuation
            let navigation = UINavigationController(rootViewController: login)
            parent.present(navigation, animated: true)
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = L("Connexion à Deezer")
        navigationItem.leftBarButtonItem = UIBarButtonItem(systemItem: .cancel, primaryAction: UIAction { [weak self] _ in
            self?.finish(.failure(SonoError.message(L("La connexion à Deezer a été annulée."))))
        })
        webView.frame = view.bounds
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(webView)
        webView.load(URLRequest(url: URL(string: "https://www.deezer.com/login")!))
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            self?.webView.configuration.websiteDataStore.httpCookieStore.getAllCookies { cookies in
                if let arl = cookies.first(where: { $0.name == "arl" && $0.domain.hasSuffix("deezer.com") && !$0.value.isEmpty })?.value { self?.finish(.success(arl)) }
            }
        }
    }

    private func finish(_ result: Result<String, Error>) {
        timer?.invalidate()
        guard let continuation else { return }
        self.continuation = nil
        dismiss(animated: true)
        continuation.resume(with: result)
    }
}

/// Le jeton du compte Deezer reste sur le téléphone, dans un fichier de l’app : chiffré par iOS, exclu des sauvegardes,
/// et supprimé avec l’app (contrairement au trousseau, qu’iOS garde après la suppression d’une app).
enum AccountStore {
    private static var file: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appending(path: "deezer-account")
    }

    static var arl: String? {
        get {
            moveOutOfKeychain()
            guard let text = try? String(contentsOf: file, encoding: .utf8), !text.isEmpty else { return nil }
            return text
        }
        set {
            moveOutOfKeychain()
            guard let newValue, !newValue.isEmpty else { try? FileManager.default.removeItem(at: file); return }
            write(newValue)
        }
    }

    private static func write(_ value: String) {
        let fm = FileManager.default
        try? fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        // Lisible après le premier déverrouillage, pour que la musique reprenne écran verrouillé.
        try? Data(value.utf8).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var url = file
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? url.setResourceValues(values)
    }

    /// Les versions précédentes gardaient le jeton dans le trousseau, qui survit à la suppression de l’app :
    /// il est déplacé une fois dans le fichier de l’app, puis effacé du trousseau.
    private static var moved = false
    private static func moveOutOfKeychain() {
        guard !moved else { return }
        moved = true
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "app.sono.mobile", kSecAttrAccount as String: "deezer-arl"]
        var search = query
        search[kSecReturnData as String] = true
        var result: AnyObject?
        if SecItemCopyMatching(search as CFDictionary, &result) == errSecSuccess, let data = result as? Data, let old = String(data: data, encoding: .utf8), !old.isEmpty,
           !FileManager.default.fileExists(atPath: file.path) {
            write(old)
        }
        // Tout ce que l’app a pu laisser dans le trousseau est effacé.
        SecItemDelete([kSecClass as String: kSecClassGenericPassword] as CFDictionary)
    }
}
