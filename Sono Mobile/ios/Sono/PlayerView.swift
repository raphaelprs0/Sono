import SwiftUI

/// Le lecteur en grand (le « mode TV » du téléphone), sur tout l’écran jusqu’en haut. Il monte du bas, suit le doigt
/// quand on le glisse vers le bas, et se referme (ou revient en place) avec un mouvement d’iOS.
struct PlayerView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var page = 0
    @State private var drag: CGFloat = 0
    /// Le geste en cours est-il vertical (fermeture) ? Décidé une fois, au début du geste.
    @State private var vertical: Bool?

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                background
                VStack(spacing: 0) {
                    ZStack {
                        Capsule().fill(Color.white.opacity(0.35)).frame(width: 40, height: 5)
                        HStack {
                            Spacer()
                            AirPlayButton().frame(width: 38, height: 38)
                                .background(Circle().fill(Color.white.opacity(0.12)))
                                .overlay(Circle().strokeBorder(Color.white.opacity(0.2), lineWidth: 1))
                        }
                        .padding(.horizontal, 20)
                    }
                    .frame(height: 44)
                    .padding(.top, 4)
                    TabView(selection: $page) {
                        playing.tag(0)
                        invite.tag(1)
                    }
                    .tabViewStyle(.page(indexDisplayMode: .never))
                    pageSwitch.padding(.bottom, 10)
                }
                // Le contenu reste sous l’heure et au-dessus de la barre du bas ; le fond, lui, va jusqu’aux bords.
                .padding(.top, geometry.safeAreaInsets.top)
                .padding(.bottom, geometry.safeAreaInsets.bottom)
            }
            .frame(width: geometry.size.width + geometry.safeAreaInsets.leading + geometry.safeAreaInsets.trailing, height: geometry.size.height + geometry.safeAreaInsets.top + geometry.safeAreaInsets.bottom)
            .clipShape(RoundedRectangle(cornerRadius: drag > 0 ? 44 : 0, style: .continuous), style: FillStyle())
            .ignoresSafeArea()
            .offset(y: max(0, drag))
            .simultaneousGesture(DragGesture(minimumDistance: 12)
                .onChanged { value in
                    if vertical == nil { vertical = value.translation.height > 0 && abs(value.translation.height) > abs(value.translation.width) * 1.2 }
                    guard vertical == true else { return }
                    drag = max(0, value.translation.height)
                }
                .onEnded { value in
                    defer { vertical = nil }
                    guard vertical == true else { return }
                    let height = geometry.size.height + geometry.safeAreaInsets.top + geometry.safeAreaInsets.bottom
                    if value.translation.height > 140 || value.predictedEndTranslation.height > 420 {
                        withAnimation(.easeOut(duration: 0.26)) { drag = height }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.26) {
                            var transaction = Transaction()
                            transaction.disablesAnimations = true
                            withTransaction(transaction) { dismiss() }
                        }
                    } else {
                        withAnimation(.spring(response: 0.4, dampingFraction: 0.82)) { drag = 0 }
                    }
                })
        }
        .presentationBackground(.clear)
        // Lecteur en grand, posé sur la pochette ou sur du noir : toujours en couleurs sombres.
        .environment(\.colorScheme, .dark)
    }

    @ViewBuilder private var background: some View {
        if store.appearance.tvBackground == "black" {
            Color.black.ignoresSafeArea()
        } else {
            ZStack {
                Color.sonoBackground
                if let cover = store.current?.cover { BlurredCover(address: cover) }
                LinearGradient(colors: [.black.opacity(0.15), .black.opacity(0.55)], startPoint: .top, endPoint: .bottom)
            }
            .ignoresSafeArea()
        }
    }

    private var playing: some View {
        let current = store.current
        return GeometryReader { geometry in
            let side = min(geometry.size.width - 56, geometry.size.height * 0.46)
            VStack(spacing: 0) {
                Spacer(minLength: 12)
                CoverView(address: current?.cover, size: side, radius: 22)
                    .background(SoftShadow(radius: 22, blur: 30, opacity: 0.45).offset(y: 16))
                    .scaleEffect(store.playing || current == nil ? 1 : 0.86)
                    .animation(.spring(response: 0.5, dampingFraction: 0.65), value: store.playing)
                    .id(current?.key)
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
                Spacer(minLength: 18)
                VStack(spacing: 7) {
                    HStack(spacing: 8) {
                        Equalizer(playing: store.playing && current != nil, color: store.appearance.accentColor)
                        Text(current == nil ? L("LECTURE") : store.playing ? L("EN LECTURE") : L("EN PAUSE")).font(.system(size: 12, weight: .bold)).tracking(2.4).foregroundStyle(store.appearance.accentColor)
                    }
                    Text(current?.title ?? L("Aucun titre en cours")).font(.system(size: 25, weight: .bold)).foregroundStyle(.white).multilineTextAlignment(.center).lineLimit(2).minimumScaleFactor(0.7)
                    if let current {
                        Text(current.artist).font(.system(size: 17)).foregroundStyle(.white.opacity(0.75)).lineLimit(1)
                        if store.appearance.tvShowAddedBy, let by = current.addedBy {
                            Text(current.isFallback ? L("Musique de fond · {0}", by) : L("Proposé par {0}", by)).font(.system(size: 14)).foregroundStyle(.white.opacity(0.55)).lineLimit(1)
                        }
                    }
                }
                .padding(.horizontal, 28)
                .animation(.easeInOut(duration: 0.25), value: current?.key)
                Spacer(minLength: 18)
                if current != nil { ProgressBar().padding(.horizontal, 28) }
                Controls(size: .large).padding(.top, 14)
                if let next = store.nextUp {
                    HStack(spacing: 10) {
                        Text(L("ENSUITE")).font(.system(size: 12, weight: .bold)).tracking(2).foregroundStyle(.white.opacity(0.5))
                        Text("\(next.title) · \(next.artist)").font(.system(size: 14)).foregroundStyle(.white.opacity(0.8)).lineLimit(1)
                    }
                    .padding(.horizontal, 28).padding(.top, 14)
                }
                Spacer(minLength: 10)
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var invite: some View {
        VStack(spacing: 22) {
            Spacer()
            QRCodeView(text: store.inviteURL)
                .padding(15)
                .background(RoundedRectangle(cornerRadius: 26, style: .continuous).fill(.white))
                .frame(maxWidth: 300)
            if store.appearance.tvShowQrText {
                VStack(spacing: 8) {
                    Text(L("Ajoutez vos titres")).font(.system(size: 25, weight: .bold)).foregroundStyle(.white)
                    Text(store.inviteURL.replacingOccurrences(of: "https://", with: "")).font(.system(size: 15, weight: .medium)).foregroundStyle(.white.opacity(0.7)).multilineTextAlignment(.center)
                    Text(store.session.code).font(.system(size: 20, weight: .bold)).tracking(4).foregroundStyle(store.appearance.accentColor).padding(.top, 4)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 30)
    }

    private var pageSwitch: some View {
        HStack(spacing: 4) {
            ForEach([(0, "music.note"), (1, "qrcode")], id: \.0) { index, symbol in
                Button { withAnimation(.snappy) { page = index } } label: {
                    Image(systemName: symbol).font(.system(size: 15.5, weight: .semibold)).foregroundStyle(.white)
                        .frame(width: 58, height: 40)
                        .background(Capsule().fill(page == index ? Color.white.opacity(0.18) : .clear))
                }
                .accessibilityLabel(index == 0 ? L("Lecture") : L("Code QR"))
            }
        }
        .padding(4)
        .glassCard(radius: 24)
    }
}

// MARK: Recherche d’un titre

struct SearchSheet: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    let onConnect: () -> Void
    @State private var query = ""
    @State private var results: [Track] = []
    @State private var loading = false
    @State private var error: String?
    @State private var added: Set<String> = []
    @State private var pending: String?
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(L("Ajouter un titre")).font(.system(size: 21, weight: .bold)).foregroundStyle(Color.sonoText).padding(.top, 26)
            if store.session.source == nil {
                VStack(spacing: 12) {
                    Text(L("Aucune app de lecture connectée")).font(.system(size: 15.5, weight: .semibold)).foregroundStyle(Color.sonoText)
                    Text(L("Connectez Apple Music ou Deezer pour chercher et lancer des titres.")).font(.system(size: 13)).foregroundStyle(Color.sonoMuted).multilineTextAlignment(.center)
                    Button(L("Connecter une app"), action: onConnect).buttonStyle(AccentButtonStyle(wide: false))
                }
                .frame(maxWidth: .infinity).padding(.top, 40)
                Spacer()
            } else {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Color.sonoMuted)
                    TextField("", text: $query, prompt: Text(L("Titre, artiste ou album…")).foregroundColor(Color.sonoMuted.opacity(0.7)))
                        .sonoCaret().font(.system(size: 15)).focused($focused).submitLabel(.search).autocorrectionDisabled().foregroundStyle(Color.sonoText)
                    if loading { ProgressView() } else if !query.isEmpty {
                        Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Color.sonoMuted) }.accessibilityLabel(L("Effacer"))
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 13)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white.opacity(0.08)))
                if (store.session.apps ?? []).count > 1 {
                    Text(L("Recherche sur {0}", store.session.source ?? "")).font(.system(size: 12)).foregroundStyle(Color.sonoMuted)
                }
                if let error { Label(error, systemImage: "exclamationmark.circle").font(.system(size: 13)).foregroundStyle(Color.sonoDanger) }
                ScrollView {
                    LazyVStack(spacing: 4) {
                        ForEach(results) { track in result(track) }
                    }
                    if !loading && results.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: query.isEmpty ? "magnifyingglass" : "opticaldisc").font(.system(size: 23)).foregroundStyle(Color.sonoMuted)
                            Text(query.isEmpty ? L("Rechercher un titre") : L("Aucun titre trouvé")).font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.sonoText)
                            Text(query.isEmpty ? L("Tapez le nom d’un titre, d’un artiste ou d’un album.") : L("Essayez une autre orthographe.")).font(.system(size: 13)).foregroundStyle(Color.sonoMuted)
                        }
                        .frame(maxWidth: .infinity).padding(.top, 50)
                    }
                }
                .scrollDismissesKeyboard(.immediately)
            }
        }
        .padding(.horizontal, 20)
        .presentationBackground(.regularMaterial)
        .onAppear { focused = store.session.source != nil }
        .task(id: query) {
            let term = query.trimmingCharacters(in: .whitespaces)
            guard !term.isEmpty else { results = []; error = nil; loading = false; return }
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
            loading = true
            do { let found = try await store.searchTracks(term); if !Task.isCancelled { results = found; error = nil } }
            catch { if !Task.isCancelled { results = []; self.error = error.localizedDescription } }
            loading = false
        }
    }

    private func result(_ track: Track) -> some View {
        let isAdded = added.contains(track.id)
        return HStack(spacing: 12) {
            CoverView(address: track.cover, size: 50, radius: 9)
            VStack(alignment: .leading, spacing: 3) {
                Text(track.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.sonoText).lineLimit(1)
                Text([track.artist, track.album ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")).font(.system(size: 13)).foregroundStyle(Color.sonoMuted).lineLimit(1)
            }
            Spacer(minLength: 6)
            Button {
                pending = track.id
                Task {
                    if await store.add(track) { added.insert(track.id); UIImpactFeedbackGenerator(style: .light).impactOccurred() }
                    pending = nil
                }
            } label: {
                ZStack {
                    if pending == track.id { ProgressView() } else { Image(systemName: isAdded ? "checkmark" : "plus").font(.system(size: 15, weight: .bold)) }
                }
                .foregroundStyle(isAdded ? store.appearance.accentInk : Color.sonoText)
                .frame(width: 40, height: 40)
                .background(Circle().fill(isAdded ? store.appearance.accentColor : Color.white.opacity(0.1)))
            }
            .buttonStyle(PressStyle())
            .disabled(isAdded || pending != nil)
            .accessibilityLabel(L("Ajouter {0}", track.title))
        }
        .padding(.vertical, 6)
    }
}

// MARK: Inviter : QR code, code et lien

struct QRSheet: View {
    @EnvironmentObject private var store: Store
    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                Image(systemName: "qrcode").font(.system(size: 20, weight: .semibold)).foregroundStyle(store.appearance.accentColor)
                    .frame(width: 52, height: 52).background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(store.appearance.accentColor.opacity(0.16)))
                    .padding(.top, 30)
                Text(L("Rejoindre {0}", store.session.name)).font(.system(size: 23, weight: .bold)).foregroundStyle(Color.sonoText).multilineTextAlignment(.center)
                Text(L("Scannez ce code avec l’appareil photo de votre téléphone.")).font(.system(size: 15)).foregroundStyle(Color.sonoMuted).multilineTextAlignment(.center)
                QRCodeView(text: store.inviteURL).padding(16).background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(.white)).frame(maxWidth: 270)
                Text(store.session.code).font(.system(size: 26, weight: .bold)).tracking(5).foregroundStyle(Color.sonoText)
                Button { store.copyInvite() } label: {
                    HStack {
                        Text(store.inviteURL).font(.system(size: 14)).foregroundStyle(Color.sonoText).lineLimit(1).truncationMode(.middle)
                        Spacer()
                        Image(systemName: "doc.on.doc").foregroundStyle(Color.sonoText)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 14)
                    .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.white.opacity(0.08)))
                }
                .accessibilityLabel(L("Copier le lien"))
                Text(LocalizedStringKey(L("Sans appareil photo : ouvrez **{0}** et tapez le code.", store.joinURL.replacingOccurrences(of: "https://", with: "")))).font(.system(size: 13)).foregroundStyle(Color.sonoMuted).multilineTextAlignment(.center)
                Toggle(isOn: Binding(get: { store.carInvite }, set: { store.setCarInvite($0) })) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(L("Afficher sur l’écran de la voiture")).font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.sonoText)
                        Text(store.session.source == "Apple Music" ? L("Disponible avec Deezer : avec Apple Music, c’est iOS qui gère cet écran.") : L("Le QR code remplace la pochette sur CarPlay et sur l’écran verrouillé, pendant la lecture.")).font(.system(size: 12)).foregroundStyle(Color.sonoMuted)
                    }
                }
                .padding(.top, 6)
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 30)
        }
        .presentationBackground(.regularMaterial)
    }
}
