import SwiftUI

/// Fenêtres ouvertes par-dessus le tableau de bord.
enum Sheet: Identifiable {
    case qr, search, fallback, player, delete
    var id: Int { hashValue }
}

/// Demande de confirmation (retirer un titre, un invité, nommer un admin).
enum Confirmation: Identifiable {
    case removeTrack(Track), kick(Participant), admin(Participant)
    var id: String {
        switch self {
        case .removeTrack(let track): return "t-\(track.id)"
        case .kick(let person): return "k-\(person.id)"
        case .admin(let person): return "a-\(person.id)"
        }
    }
}

enum Tab: Hashable { case queue, activity, connections, settings }

struct RootView: View {
    @EnvironmentObject private var store: Store
    @State private var tab: Tab = .queue
    @State private var sheet: Sheet?
    @State private var confirmation: Confirmation?
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            AppBackground(appearance: store.appearance, cover: store.current?.cover ?? UserDefaults.standard.string(forKey: "sono-last-cover"))
            switch store.phase {
            case .checking: Image("LaunchLogo").transition(.opacity)
            case .home: HomeView().transition(.opacity)
            case .host: tabs.transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.35), value: store.phase)
        .id(store.language)
        .overlay(alignment: .bottom) { ToastView().padding(.bottom, store.phase == .host ? 96 : 30) }
        .tint(store.appearance.accentColor)
        .hoverEffectDisabled()
        .preferredColorScheme(store.appearance.background == "white" ? .light : store.appearance.background == "auto" ? nil : .dark)
        // Le lecteur en grand prend tout l’écran ; les autres fenêtres sont des fenêtres d’iOS.
        .fullScreenCover(isPresented: Binding(get: { sheet == .player }, set: { if !$0 { sheet = nil } })) { PlayerView() }
        .sheet(item: Binding(get: { sheet == .player ? nil : sheet }, set: { sheet = $0 })) { sheet in
            switch sheet {
            case .qr: QRSheet().presentationDetents([.large]).presentationDragIndicator(.visible)
            case .search: SearchSheet(onConnect: { self.sheet = nil; tab = .connections }).presentationDetents([.large]).presentationDragIndicator(.visible)
            case .fallback: FallbackSheet().presentationDetents([.large]).presentationDragIndicator(.visible)
            case .player: EmptyView()
            case .delete: DeleteSheet().presentationDetents([.height(380)]).presentationDragIndicator(.visible)
            }
        }
        .confirmationDialog(confirmationTitle, isPresented: Binding(get: { confirmation != nil }, set: { if !$0 { confirmation = nil } }), titleVisibility: .visible, presenting: confirmation) { item in
            switch item {
            case .removeTrack(let track): Button(L("Retirer le titre"), role: .destructive) { store.remove(track) }
            case .kick(let person): Button(L("Retirer de la session"), role: .destructive) { store.removeMember(person) }
            case .admin(let person): Button(L("Nommer admin")) { store.setAdmin(person, true) }
            }
            Button(L("Annuler"), role: .cancel) {}
        } message: { item in
            switch item {
            case .removeTrack(let track): Text(L("« {0} » de {1}", track.title, track.artist))
            case .kick(let person): Text(L("{0} ne verra plus la file et ne pourra plus ajouter de titres. Cette personne pourra vous demander à revenir.", person.name))
            case .admin(let person): Text(L("{0} pourra lancer et passer les titres, gérer la file et accepter les invités, sans modifier les réglages ni les connexions.", person.name))
            }
        }
        .onChange(of: store.phase) { phase in if phase != .host { sheet = nil; tab = .queue } }
        // Retour dans l’app : l’état de la session est relu (la connexion a pu être coupée en arrière-plan).
        .onChange(of: scenePhase) { phase in if phase == .active, store.phase == .host { Task { await store.refresh() } } }
    }

    private var confirmationTitle: String {
        switch confirmation {
        case .removeTrack: return L("Retirer ce titre ?")
        case .kick(let person): return L("Retirer {0} ?", person.name)
        case .admin(let person): return L("Nommer {0} admin ?", person.name)
        case nil: return ""
        }
    }

    private var tabs: some View {
        TabView(selection: $tab) {
            QueueView(sheet: $sheet, confirmation: $confirmation, tab: $tab).appBackground()
                .tabItem { Label(L("File"), systemImage: "music.note.list") }.tag(Tab.queue)
            ActivityScreen(sheet: $sheet, confirmation: $confirmation).appBackground()
                .tabItem { Label(L("Activité"), systemImage: "waveform.path.ecg") }.tag(Tab.activity)
            ConnectionsScreen(sheet: $sheet).appBackground()
                .tabItem { Label(L("Connexions"), systemImage: "link") }.tag(Tab.connections)
            SettingsScreen(sheet: $sheet).appBackground()
                .tabItem { Label(L("Réglages"), systemImage: "gearshape") }.tag(Tab.settings)
        }
    }
}

/// En-tête des onglets : le logo et le bouton QR code.
struct ScreenHeader: View {
    @Binding var sheet: Sheet?
    var body: some View {
        HStack {
            Brand()
            Spacer()
            Button { sheet = .qr } label: {
                Image(systemName: "qrcode").font(.system(size: 15.5, weight: .medium)).foregroundStyle(Color.sonoText).frame(width: 42, height: 42)
            }
            .glassCard(radius: 21)
            .accessibilityLabel(L("Afficher le code QR"))
        }
    }
}

/// L’arrière-plan de l’app derrière un onglet (chaque onglet a sinon un fond noir opaque).
struct AppBackgroundModifier: ViewModifier {
    @EnvironmentObject private var store: Store
    func body(content: Content) -> some View {
        content.background(AppBackground(appearance: store.appearance, cover: store.current?.cover ?? UserDefaults.standard.string(forKey: "sono-last-cover")))
    }
}

extension View {
    func appBackground() -> some View { modifier(AppBackgroundModifier()) }
}

struct ToastView: View {
    @EnvironmentObject private var store: Store
    var body: some View {
        if let toast = store.toast {
            HStack(spacing: 10) {
                Image(systemName: toast.isError ? "exclamationmark.circle.fill" : "checkmark.circle.fill").foregroundStyle(toast.isError ? Color.sonoDanger : store.appearance.accentColor)
                Text(toast.message).font(.system(size: 14, weight: .medium)).foregroundStyle(Color.sonoText).multilineTextAlignment(.leading)
            }
            .padding(.horizontal, 18).padding(.vertical, 13)
            .glassCard(radius: 22)
            .padding(.horizontal, 20)
            .onTapGesture { withAnimation { store.toast = nil } }
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .id(toast.id)
        }
    }
}
