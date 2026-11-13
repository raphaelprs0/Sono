import SwiftUI
import VisionKit
import WebKit

/// Accueil : créer une session (on devient l’hôte). Pour rejoindre celle d’un proche, on scanne son QR code.
struct HomeView: View {
    @EnvironmentObject private var store: Store
    @State private var name = ""
    @State private var host = ""
    @State private var approval = false
    @State private var busy = false
    @State private var scanning = false
    @State private var guest: URL?
    @FocusState private var focus: HomeField?

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                VStack(spacing: 18) {
                    Brand(size: 58)
                    Text(L("Créez une file d’attente commune pour votre soirée, ou rejoignez celle d’un proche."))
                        .font(.system(size: 14.5)).foregroundStyle(Color.sonoMuted).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 44).padding(.bottom, 6)

                VStack(alignment: .leading, spacing: 16) {
                    Text(L("Nouvelle session")).font(.system(size: 18, weight: .semibold)).foregroundStyle(Color.sonoText)
                    HomeInput(title: L("Nom de la session"), text: $name, prompt: L("Ex. Soirée chez Camille"))
                        .focused($focus, equals: .name).id(HomeField.name).submitLabel(.next).onSubmit { focus = .host }
                    HomeInput(title: L("Votre prénom"), text: $host, prompt: L("Affiché aux invités"))
                        .focused($focus, equals: .host).id(HomeField.host).submitLabel(.done).textContentType(.givenName)
                    Toggle(isOn: $approval) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(L("Valider chaque invité")).font(.system(size: 15, weight: .medium)).foregroundStyle(Color.sonoText)
                            Text(L("Chaque personne qui rejoint doit être acceptée par vous.")).font(.system(size: 12)).foregroundStyle(Color.sonoMuted)
                        }
                    }
                    Button {
                        busy = true
                        focus = nil
                        Task { _ = await store.create(name: trimmed(name), host: trimmed(host), requireApproval: approval); busy = false }
                    } label: {
                        HStack { if busy { ProgressView().tint(store.appearance.accentInk) }; Text(L("Créer la session")) }
                    }
                    .buttonStyle(AccentButtonStyle())
                    .disabled(trimmed(name).isEmpty || busy)
                    .opacity(trimmed(name).isEmpty ? 0.5 : 1)
                }
                .padding(18)
                .glassCard()

                // Rejoindre la session d’un proche : uniquement en scannant son QR code.
                Button { focus = nil; scanning = true } label: {
                    Label(L("Rejoindre avec un QR code"), systemImage: "qrcode.viewfinder")
                        .font(.system(size: 13, weight: .medium)).foregroundStyle(Color.sonoMuted)
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .contentShape(Rectangle())
                }
                .buttonStyle(StillButtonStyle())
                .frame(maxWidth: .infinity)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 40)
        }
        .scrollDismissesKeyboard(.interactively)
        .onChange(of: focus) { _, field in
            guard let field else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo(field, anchor: .center) } }
        }
        }
        .fullScreenCover(isPresented: $scanning) {
            QRScannerView { address in
                scanning = false
                // La session s’ouvre dans l’app, une fois la caméra refermée.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { guest = address }
            } cancel: { scanning = false }
        }
        .fullScreenCover(item: $guest) { url in GuestScreen(url: url) { guest = nil } }
        #if DEBUG
        // Simulateur (sans caméra) : « -sonoScan <adresse> » simule un scan.
        .onAppear { if let text = UserDefaults.standard.string(forKey: "sonoScan"), let url = sonoInvite(text) { guest = url } }
        #endif
    }

    private func trimmed(_ text: String) -> String { text.trimmingCharacters(in: .whitespaces) }
}

enum HomeField { case name, host }

extension URL: @retroactive Identifiable { public var id: String { absoluteString } }

/// Champ de saisie de l’accueil (même style que la page web).
private struct HomeInput: View {
    let title: String
    @Binding var text: String
    let prompt: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 12.5, weight: .medium)).foregroundStyle(Color.sonoText.opacity(0.85))
            TextField("", text: $text, prompt: Text(prompt).foregroundColor(Color.sonoMuted.opacity(0.6)))
                .sonoCaret().font(.system(size: 14))
                .padding(.horizontal, 14).frame(height: 46)
                .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.sonoField))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.sonoFg.opacity(0.12)))
                .foregroundStyle(Color.sonoText)
        }
    }
}

// MARK: Appareil photo : lecture du QR code d’invitation

/// Une adresse d’invitation Sono : « …/1234 » ou l’ancien « ?invitation=SONO-1234 », d’où qu’elle vienne
/// (service en ligne, ordinateur de l’hôte sur le Wi-Fi, lien public).
func sonoInvite(_ text: String) -> URL? {
    guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)), ["http", "https"].contains(url.scheme), let host = url.host else { return nil }
    let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let digits = path.range(of: "^\\d{4}$", options: .regularExpression) != nil ? path
        : URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "invitation" }?.value?.uppercased().replacingOccurrences(of: "SONO-", with: "")
    guard let digits, digits.range(of: "^\\d{4}$", options: .regularExpression) != nil else { return nil }
    var parts = URLComponents()
    parts.scheme = url.scheme; parts.host = host; parts.port = url.port; parts.path = "/\(digits)"
    return parts.url
}

struct QRScannerView: View {
    let found: (URL) -> Void
    let cancel: () -> Void
    @State private var message: String?

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                Scanner(found: found, unknown: { message = L("Ce code QR n’est pas une invitation Sono.") }).ignoresSafeArea()
                RoundedRectangle(cornerRadius: 28, style: .continuous).strokeBorder(.white.opacity(0.9), lineWidth: 3)
                    .frame(width: 250, height: 250).frame(maxWidth: .infinity, maxHeight: .infinity).allowsHitTesting(false)
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "camera.fill").font(.system(size: 30)).foregroundStyle(Color.sonoMuted)
                    Text(L("Appareil photo indisponible")).font(.system(size: 16.5, weight: .semibold)).foregroundStyle(.white)
                    Text(L("Autorisez l’appareil photo pour Sono dans Réglages, puis scannez à nouveau le code QR.")).font(.system(size: 14)).foregroundStyle(Color.sonoMuted).multilineTextAlignment(.center)
                    Button(L("Ouvrir Réglages")) { if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) } }
                        .buttonStyle(SecondaryButtonStyle()).padding(.top, 6)
                }
                .padding(32).frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            VStack(spacing: 10) {
                HStack {
                    Text(L("Scanner le code QR")).font(.system(size: 15.5, weight: .semibold)).foregroundStyle(.white)
                    Spacer()
                    Button(action: cancel) {
                        Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                            .frame(width: 38, height: 38).background(Circle().fill(.black.opacity(0.5)))
                    }
                    .buttonStyle(StillButtonStyle())
                    .accessibilityLabel(L("Fermer"))
                }
                Text(message ?? L("Visez le code QR affiché par l’hôte de la session.")).font(.system(size: 13)).foregroundStyle(.white.opacity(0.85))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 20).padding(.vertical, 14)
            .background(LinearGradient(colors: [.black.opacity(0.7), .clear], startPoint: .top, endPoint: .bottom).ignoresSafeArea())
        }
    }

    private struct Scanner: UIViewControllerRepresentable {
        let found: (URL) -> Void
        let unknown: () -> Void

        func makeUIViewController(context: Context) -> DataScannerViewController {
            let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced, isHighlightingEnabled: true)
            scanner.delegate = context.coordinator
            try? scanner.startScanning()
            return scanner
        }
        func updateUIViewController(_ controller: DataScannerViewController, context: Context) {}
        func makeCoordinator() -> Coordinator { Coordinator(found: found, unknown: unknown) }

        final class Coordinator: NSObject, DataScannerViewControllerDelegate {
            let found: (URL) -> Void
            let unknown: () -> Void
            private var done = false
            init(found: @escaping (URL) -> Void, unknown: @escaping () -> Void) { self.found = found; self.unknown = unknown }

            func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
                guard !done else { return }
                for item in items {
                    guard case .barcode(let code) = item, let text = code.payloadStringValue else { continue }
                    if let url = sonoInvite(text) {
                        done = true
                        scanner.stopScanning()
                        UINotificationFeedbackGenerator().notificationOccurred(.success)
                        found(url)
                        return
                    }
                    unknown()
                }
            }
        }
    }
}

/// La session d’un proche, ouverte dans l’app en plein écran (la page de l’invité, sans barre de navigateur).
/// « Quitter la session » sur la page referme l’écran et revient à l’accueil.
struct GuestScreen: View {
    let url: URL
    let close: () -> Void
    @State private var loading = true

    var body: some View {
        ZStack {
            Color(red: 15 / 255, green: 15 / 255, blue: 13 / 255).ignoresSafeArea()
            GuestWebView(url: url, loading: $loading, close: close).ignoresSafeArea()
            if loading { ProgressView().tint(.white) }
        }
        .preferredColorScheme(.dark)
    }
}

private struct GuestWebView: UIViewRepresentable {
    let url: URL
    @Binding var loading: Bool
    let close: () -> Void

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.allowsBackForwardNavigationGestures = false
        view.load(URLRequest(url: url))
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, WKNavigationDelegate {
        let parent: GuestWebView
        init(_ parent: GuestWebView) { self.parent = parent }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = action.request.url, action.targetFrame?.isMainFrame != false else { return decisionHandler(.allow) }
            // La page quitte la session (vers l’accueil web) : on revient à l’accueil de l’app.
            if target.host == parent.url.host, target.path != parent.url.path {
                decisionHandler(.cancel)
                parent.close()
                return
            }
            // Liens externes (Deezer, Apple Music…) : dans leur app ou Safari.
            if target.host != parent.url.host, ["http", "https"].contains(target.scheme) {
                decisionHandler(.cancel)
                UIApplication.shared.open(target)
                return
            }
            decisionHandler(.allow)
        }
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { parent.loading = false }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { parent.loading = false }
    }
}
