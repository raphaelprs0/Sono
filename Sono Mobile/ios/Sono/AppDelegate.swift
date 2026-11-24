import CarPlay
import SwiftUI
import UIKit
import UserNotifications
import WebKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.setNotificationCategories([UNNotificationCategory(identifier: "sono-request", actions: [
            UNNotificationAction(identifier: "accept", title: L("Accepter")),
            UNNotificationAction(identifier: "refuse", title: L("Refuser"), options: .destructive),
        ], intentIdentifiers: [])])
        return true
    }

    /// Accepter ou Refuser depuis la notification d’une demande.
    @MainActor
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        guard ["accept", "refuse"].contains(response.actionIdentifier), let id = info["id"] as? String else { return }
        await SonoApp.store.answer(JoinRequest(id: id, name: info["name"] as? String ?? ""), accept: response.actionIdentifier == "accept")
    }

    /// Sono n’envoie ses notifications qu’en arrière-plan : iOS peut toujours les afficher.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions { [.banner, .list, .sound] }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Sono", sessionRole: connectingSceneSession.role)
        if connectingSceneSession.role == .windowExternalDisplayNonInteractive {
            configuration.delegateClass = ExternalDisplaySceneDelegate.self
        } else if connectingSceneSession.role == .carTemplateApplication {
            configuration.sceneClass = CPTemplateApplicationScene.self
            configuration.delegateClass = CarPlaySceneDelegate.self
        } else {
            configuration.delegateClass = SceneDelegate.self
        }
        return configuration
    }
}

/// Un seul moteur et un seul état, que l’app soit ouverte sur l’iPhone, dans la voiture, ou les deux.
@MainActor
enum SonoApp {
    static let server = URL(string: Bundle.main.object(forInfoDictionaryKey: "SonoServerURL") as? String ?? "")!
    static let driver = Driver(server: server)
    static let store: Store = {
        let store = Store(driver: driver, server: server)
        Task { await store.start() }
        return store
    }()
}

/// iOS 27 exige le cycle de vie par scènes : sans lui, l’app s’arrête dès son ouverture.
final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        let root = UIHostingController(rootView: RootView().environmentObject(SonoApp.store))
        root.view.backgroundColor = UIColor(red: 15 / 255, green: 15 / 255, blue: 13 / 255, alpha: 1)
        window.rootViewController = root
        window.makeKeyAndVisible()
        self.window = window
        openInvite(connectionOptions.urlContexts)
    }

    /// « Ouvrir dans l’app Sono » sur la page d’un invité : sono://open?url=<adresse d’invitation>.
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) { openInvite(URLContexts) }

    private func openInvite(_ contexts: Set<UIOpenURLContext>) {
        guard let link = contexts.first?.url, link.scheme == "sono",
              let address = URLComponents(url: link, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "url" })?.value,
              let invite = sonoInvite(address) else { return }
        SonoApp.store.pendingInvite = invite
    }
}

/// Sono sur l’écran de la voiture. Apple n’autorise aux apps audio que ses propres écrans : pas de glissement possible,
/// la pochette et le QR code s’échangent avec un bouton sur l’écran « À l’écoute ».
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interface: CPInterfaceController?
    private var driver: Driver { SonoApp.driver }
    private let queue = CPListTemplate(title: L("File d’attente"), sections: [])
    private lazy var invite = CPInformationTemplate(title: L("Inviter"), layout: .leading, items: [], actions: [])

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didConnect interfaceController: CPInterfaceController) {
        interface = interfaceController
        // Voiture démarrée sans ouvrir l’iPhone : la session est quand même retrouvée.
        _ = SonoApp.store
        queue.tabTitle = L("File")
        queue.tabImage = UIImage(systemName: "music.note.list")
        invite.tabTitle = L("Inviter")
        invite.tabImage = UIImage(systemName: "qrcode")
        let toggle = CPNowPlayingImageButton(image: UIImage(systemName: "qrcode") ?? UIImage()) { [weak self] _ in self?.toggleInvite() }
        CPNowPlayingTemplate.shared.updateNowPlayingButtons([toggle])
        driver.onCarChange = { [weak self] in self?.refresh() }
        refresh()
        interfaceController.setRootTemplate(CPTabBarTemplate(templates: [queue, invite]), animated: false, completion: nil)
    }

    func templateApplicationScene(_ scene: CPTemplateApplicationScene, didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        interface = nil
        driver.onCarChange = nil
    }

    private func showNowPlaying() {
        guard let interface, interface.topTemplate !== CPNowPlayingTemplate.shared else { return }
        interface.pushTemplate(CPNowPlayingTemplate.shared, animated: true, completion: nil)
    }

    private func toggleInvite() {
        guard driver.canShowInviteOnCar else {
            let alert = CPAlertTemplate(titleVariants: [L("Avec Apple Music, c’est iOS qui gère cet écran. Utilisez le code de l’onglet Inviter.")], actions: [CPAlertAction(title: "OK", style: .cancel) { [weak self] _ in self?.interface?.dismissTemplate(animated: true, completion: nil) }])
            interface?.presentTemplate(alert, animated: true, completion: nil)
            return
        }
        driver.toggleInviteOnCar()
    }

    private func refresh() {
        let state = driver.carState
        var sections: [CPListSection] = []
        if let now = state.current {
            let row = CPListItem(text: now.title, detailText: [now.artist, now.album].filter { !$0.isEmpty }.joined(separator: " · "))
            row.handler = { [weak self] _, done in self?.showNowPlaying(); done() }
            sections.append(CPListSection(items: [row], header: L("En cours"), sectionIndexTitle: nil))
        }
        let next = state.upNext.prefix(12).map { CPListItem(text: $0.title, detailText: $0.artist) }
        if !next.isEmpty { sections.append(CPListSection(items: Array(next), header: L("Ensuite"), sectionIndexTitle: nil)) }
        queue.emptyViewTitleVariants = [L("Aucune session")]
        queue.emptyViewSubtitleVariants = [L("Créez une session dans Sono sur l’iPhone.")]
        queue.updateSections(sections)
        invite.items = [CPInformationItem(title: "Code", detail: state.code ?? L("Aucune session")), CPInformationItem(title: L("Adresse"), detail: state.address?.replacingOccurrences(of: "https://", with: "") ?? "—")]
        invite.actions = state.code == nil ? [] : [CPTextButton(title: state.inviteShown ? L("Revenir à la pochette") : L("Afficher le QR code"), textStyle: .confirm) { [weak self] _ in
            self?.toggleInvite()
            self?.showNowPlaying()
        }]
    }
}

/// Écran de la TV en recopie (AirPlay ou câble) : le mode TV en grand, pendant que l’iPhone reste utilisable.
final class ExternalDisplaySceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = TVDisplayViewController()
        window.isHidden = false
        self.window = window
    }

    // TV débranchée : la page et ses relevés s’arrêtent, la fenêtre est libérée.
    func sceneDidDisconnect(_ scene: UIScene) {
        (window?.rootViewController as? TVDisplayViewController)?.tearDown()
        window?.isHidden = true
        window = nil
    }
}

/// La page du mode TV, en lecture seule : elle ne peut que lire la position de lecture, rien commander.
final class TVDisplayViewController: UIViewController, WKScriptMessageHandlerWithReply, WKNavigationDelegate {
    private var webView: WKWebView!
    private let serverURL = SonoApp.server
    private var page: URL { URL(string: "/?tv=1", relativeTo: serverURL)!.absoluteURL }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 15 / 255, green: 15 / 255, blue: 13 / 255, alpha: 1)
        let configuration = WKWebViewConfiguration()
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let origin = URL(string: "/", relativeTo: serverURL)?.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
        // La page du mode TV retrouve la session et l’apparence de l’iPhone (gardées par l’app, plus par une page web).
        let defaults = UserDefaults.standard
        var saved: [String: String] = [:]
        if let code = defaults.string(forKey: "sono-host-code"), let token = defaults.string(forKey: "sono-host-\(code)") { saved["sono-host-code"] = code; saved["sono-host-\(code)"] = token }
        if let appearance = defaults.string(forKey: "sono-appearance") { saved["sono-appearance"] = appearance }
        saved["sono-lang"] = Lang.current
        let values = String(decoding: (try? JSONSerialization.data(withJSONObject: saved)) ?? Data("{}".utf8), as: UTF8.self)
        configuration.userContentController.addUserScript(WKUserScript(source: """
        if (location.origin === '\(origin)') {
          window.sonoNative = { call: (name, args) => name === 'status' ? window.webkit.messageHandlers.sonoTV.postMessage({ name }) : Promise.resolve({}) };
          try { const v = \(values); localStorage.removeItem('sono-host-code'); for (const k in v) localStorage.setItem(k, v[k]); } catch {}
        }
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "sonoTV")
        webView = WKWebView(frame: view.bounds, configuration: configuration)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        webView.scrollView.isScrollEnabled = false
        webView.navigationDelegate = self
        view.addSubview(webView)
        webView.load(URLRequest(url: page, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
        guard message.frameInfo.securityOrigin.host == serverURL.host, (message.body as? [String: Any])?["name"] as? String == "status" else { return ([:] as [String: Any], nil) }
        return (await SonoApp.driver.statusForPage(), nil)
    }

    /// Le gestionnaire de messages retient ce contrôleur : on le retire, sinon la page reste en mémoire.
    func tearDown() {
        guard let webView else { return }
        webView.configuration.userContentController.removeAllScriptMessageHandlers()
        webView.stopLoading()
        webView.navigationDelegate = nil
        webView.removeFromSuperview()
    }

    // Réseau coupé ou page fermée par le système : on recharge tout seul (tant que l’écran est branché).
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            guard let self, self.view.window != nil else { return }
            self.webView.load(URLRequest(url: self.page, cachePolicy: .reloadIgnoringLocalCacheData))
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        guard view.window != nil else { return }
        webView.load(URLRequest(url: page, cachePolicy: .reloadIgnoringLocalCacheData))
    }
}
