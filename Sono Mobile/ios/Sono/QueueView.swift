import SwiftUI

/// Onglet « File » : le lecteur, les titres proposés et la musique de fond.
struct QueueView: View {
    @EnvironmentObject private var store: Store
    @Binding var sheet: Sheet?
    @Binding var confirmation: Confirmation?
    @Binding var tab: Tab

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ScreenHeader(sheet: $sheet).padding(.top, 14)
                if !(store.session.requests ?? []).isEmpty { JoinRequestsBanner() }
                if !store.joinNotices.isEmpty { JoinNoticesBanner(confirmation: $confirmation) }
                if !store.live {
                    HStack(spacing: 6) { Circle().fill(Color.orange).frame(width: 7, height: 7); Text(L("RECONNEXION…")).font(.system(size: 11.5, weight: .bold)).tracking(1.5).foregroundStyle(.orange) }
                }
                if store.connectionsChecked, !store.status.deezerConnected, !store.status.appleConnected { SourceNotice(tab: $tab) }
                NowPlayingCard(open: { sheet = .player })
                queueHeading
                VStack(alignment: .leading, spacing: 8) {
                    if store.queue.isEmpty {
                        emptyQueue
                    } else {
                        if store.session.fallback != nil { groupLabel(L("Proposés par les invités"), count: store.queue.count) }
                        ReorderableRows(items: store.queue, swipe: (L("Retirer"), "trash.fill", Color.sonoDanger, { store.remove($0) }), onMove: { store.move(from: IndexSet(integer: $0), to: $1 > $0 ? $1 + 1 : $1) }) { track, index in
                            TrackRow(track: track, number: index + 1) {
                                Button { confirmation = .removeTrack(track) } label: {
                                    Image(systemName: "trash").font(.system(size: 14, weight: .medium)).foregroundStyle(Color.sonoMuted).frame(width: 36, height: 36).contentShape(Rectangle())
                                }
                                .accessibilityLabel(L("Retirer {0}", track.title))
                            }
                        }
                    }
                    FallbackRow(choose: { sheet = .fallback }).padding(.top, 6)
                    if store.session.fallback != nil, let fallback = store.fallbackQueue, !fallback.tracks.isEmpty {
                        groupLabel(L("Musique de fond"), count: fallback.total)
                        ReorderableRows(items: fallback.tracks, swipe: (L("Ne pas jouer"), "trash.fill", Color.sonoDanger, { store.skipFallback($0) }), onMove: { store.moveFallback(from: IndexSet(integer: $0), to: $1 > $0 ? $1 + 1 : $1) }) { track, index in
                            TrackRow(track: track, number: store.queue.count + index + 1, dim: true) {
                                Button { store.skipFallback(track) } label: {
                                    Image(systemName: "trash").font(.system(size: 14, weight: .medium)).foregroundStyle(Color.sonoMuted).frame(width: 36, height: 36).contentShape(Rectangle())
                                }
                                .accessibilityLabel(L("Ne pas jouer {0}", track.title))
                            }
                        }
                    }
                }
                // Marge sous la liste : retirer un titre en bas ne fait pas remonter la page.
                Color.clear.frame(height: 240)
            }
            .padding(.horizontal, 20)
            .buttonStyle(StillButtonStyle())
        }
        .scrollIndicators(.hidden)
        .refreshable { await store.refresh() }
    }

    private var queueHeading: some View {
        let total = store.queue.count + (store.fallbackQueue?.total ?? 0)
        return HStack(alignment: .center) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(L("Prochains titres")).font(.system(size: 20, weight: .bold)).foregroundStyle(Color.sonoText)
                    Text("\(total)").font(.system(size: 12, weight: .bold)).foregroundStyle(Color.sonoText)
                        .padding(.horizontal, 9).padding(.vertical, 3).background(Capsule().fill(Color.sonoFg.opacity(0.1)))
                        .contentTransition(.numericText()).animation(.snappy, value: total)
                }
                if !store.queue.isEmpty {
                    Text(L("{0} proposés · maintenez un titre pour le déplacer", totalDuration(store.queue))).font(.system(size: 12)).foregroundStyle(Color.sonoMuted)
                }
            }
            Spacer()
            Button { sheet = .search } label: { Label(L("Ajouter"), systemImage: "plus") }
                .buttonStyle(AccentButtonStyle(wide: false))
        }
        .padding(.top, 10)
    }

    private var emptyQueue: some View {
        Button { sheet = .search } label: {
            VStack(spacing: 8) {
                Image(systemName: "music.note.list").font(.system(size: 23)).foregroundStyle(Color.sonoMuted)
                Text(L("La file est vide")).font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.sonoText)
                Text(L("Ajoutez un titre, ou laissez vos invités en proposer.")).font(.system(size: 13)).foregroundStyle(Color.sonoMuted).multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 26)
        }
        .buttonStyle(StillButtonStyle())
        .glassCard(radius: 20)
    }

    private func groupLabel(_ title: String, count: Int) -> some View {
        Text("\(title.uppercased()) · \(count)").font(.system(size: 11.5, weight: .bold)).tracking(1.4).foregroundStyle(Color.sonoMuted).padding(.top, 6)
    }
}

extension View {
    /// Ligne de liste sans séparateur ni fond, avec des marges régulières.
    func row(top: CGFloat = 8, bottom: CGFloat = 8) -> some View {
        // Style « plain » : chaque bouton de la ligne réagit seul (sinon un appui sur la ligne déclenche son premier bouton).
        buttonStyle(StillButtonStyle())
            .listRowInsets(EdgeInsets(top: top, leading: 20, bottom: bottom, trailing: 20))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
    }
}

struct TrackRow<Accessory: View>: View {
    let track: Track
    var number: Int
    var dim = false
    @ViewBuilder var accessory: () -> Accessory

    var body: some View {
        HStack(spacing: 13) {
            CoverView(address: track.cover, size: 50, radius: 9)
            VStack(alignment: .leading, spacing: 3) {
                Text(track.title).font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.sonoText).lineLimit(1)
                Text(track.artist).font(.system(size: 13)).foregroundStyle(Color.sonoMuted).lineLimit(1)
                if let by = track.addedBy, !track.isFallback {
                    Text(L("Proposé par {0}", by)).font(.system(size: 11.5)).foregroundStyle(Color.sonoMuted.opacity(0.8)).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            if track.durationMillis > 0 { Text(clock(track.durationMillis)).font(.system(size: 12).monospacedDigit()).foregroundStyle(Color.sonoMuted) }
            accessory()
        }
        .opacity(dim ? 0.85 : 1)
        .contentShape(Rectangle())
    }
}

/// Liste qu’on réordonne comme sur ordinateur : on reste appuyé sur un titre, il se soulève, puis il ne glisse
/// que vers le haut ou le bas ; les autres titres s’écartent pour lui faire place.
struct ReorderableRows<Item: Identifiable & Equatable, Row: View>: View {
    let items: [Item]
    var rowHeight: CGFloat = 70
    /// Glisser un titre vers la gauche : l’action (retirer, ne pas jouer), avec son texte et son icône.
    var swipe: (label: String, symbol: String, color: Color, action: (Item) -> Void)? = nil
    let onMove: (_ from: Int, _ to: Int) -> Void
    @ViewBuilder let row: (Item, Int) -> Row
    @State private var dragging: Item.ID?
    @State private var translation: CGFloat = 0
    @State private var target = 0

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                let lifted = dragging == item.id
                SwipeToAct(swipe: swipe.map { swipe in (swipe.label, swipe.symbol, swipe.color, { swipe.action(item) }) }) { row(item, index) }
                    .frame(height: rowHeight)
                    .background {
                        // Fond et ombre seulement pour le titre soulevé : les autres lignes n’ont rien à dessiner.
                        if lifted {
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .fill(Color(red: 0.13, green: 0.13, blue: 0.12).opacity(0.96))
                                .background(SoftShadow(radius: 14, blur: 16, opacity: 0.45).offset(y: 8))
                                .padding(.horizontal, -10)
                        }
                    }
                    .scaleEffect(lifted ? 1.03 : 1)
                    .offset(y: offset(for: index, item: item))
                    .zIndex(lifted ? 1 : 0)
                    // Ligne retirée : elle a déjà quitté l’écran, pas de fondu qui laisserait une trace.
                    .transition(.identity)
                    .modifier(LiftModifier(
                        began: {
                            guard dragging == nil else { return }
                            withAnimation(.spring(response: 0.25, dampingFraction: 0.8)) { dragging = item.id; target = index }
                            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        },
                        moved: { dy in
                            guard dragging == item.id else { return }
                            translation = dy
                            let next = min(items.count - 1, max(0, index + Int((dy / rowHeight).rounded())))
                            if next != target {
                                withAnimation(.spring(response: 0.28, dampingFraction: 0.85)) { target = next }
                                UISelectionFeedbackGenerator().selectionChanged()
                            }
                        },
                        ended: { finish(from: index) }))
            }
        }
        .animation(.spring(response: 0.3, dampingFraction: 0.85), value: items)
    }

    /// Le titre soulevé suit le doigt (verticalement) ; ceux entre son départ et sa place visée se décalent d’une ligne.
    private func offset(for index: Int, item: Item) -> CGFloat {
        guard let dragging, let from = items.firstIndex(where: { $0.id == dragging }) else { return 0 }
        if item.id == dragging { return translation }
        if from < target, index > from, index <= target { return -rowHeight }
        if from > target, index < from, index >= target { return rowHeight }
        return 0
    }

    private func finish(from index: Int) {
        guard dragging != nil else { return }
        guard items.indices.contains(index) else { dragging = nil; translation = 0; return }
        let to = target
        // La ligne glisse jusqu’à sa place, puis la liste réordonnée prend le relais sans saut.
        withAnimation(.spring(response: 0.22, dampingFraction: 0.9)) { translation = CGFloat(to - index) * rowHeight }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            var transaction = Transaction()
            transaction.disablesAnimations = true
            withTransaction(transaction) {
                if to != index { onMove(index, to) }
                dragging = nil
                translation = 0
            }
        }
    }
}

/// Le lecteur du tableau de bord ; un appui l’ouvre en grand.
struct NowPlayingCard: View {
    @EnvironmentObject private var store: Store
    let open: () -> Void

    var body: some View {
        let current = store.current
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 15) {
                CoverView(address: current?.cover, size: 84, radius: 14)
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 7) {
                        Equalizer(playing: store.playing && current != nil, color: store.appearance.accentColor)
                        Text(current == nil ? L("LECTURE") : store.playing ? L("EN LECTURE") : L("EN PAUSE")).font(.system(size: 11.5, weight: .bold)).tracking(1.6).foregroundStyle(store.appearance.accentText)
                    }
                    Text(current?.title ?? L("Aucun titre en cours")).font(.system(size: 18, weight: .bold)).foregroundStyle(Color.sonoText).lineLimit(2)
                        .id(current?.key).transition(.opacity)
                    Text(current.map { $0.artist } ?? (store.nextUp == nil ? L("Ajoutez un titre pour commencer.") : store.nextUp!.isFallback ? L("Lancez la musique de fond.") : L("Lancez le premier titre de la file.")))
                        .font(.system(size: 14)).foregroundStyle(Color.sonoMuted).lineLimit(1)
                }
                Spacer(minLength: 0)
                AirPlayButton().frame(width: 34, height: 34).background(Circle().fill(Color.sonoFg.opacity(0.08)))
            }
            .animation(.easeInOut(duration: 0.25), value: current?.key)
            Controls(size: .regular)
            if current != nil { ProgressBar(compact: true) }
            if let next = store.nextUp {
                Divider().overlay(Color.sonoFg.opacity(0.08))
                HStack(spacing: 10) {
                    Text(L("ENSUITE")).font(.system(size: 11.5, weight: .bold)).tracking(1.6).foregroundStyle(Color.sonoMuted)
                    Text("\(next.title) · \(next.artist)").font(.system(size: 14)).foregroundStyle(Color.sonoText).lineLimit(1)
                }
            }
        }
        .padding(15)
        .background {
            // La pochette floutée dans la carte, à 40 %, puis un voile plus sombre à gauche (comme avant).
            ZStack {
                if let cover = current?.cover, !cover.isEmpty { BlurredCover(address: cover).opacity(0.4).padding(-60) }
                LinearGradient(colors: [Color(white: 0.04).opacity(0.3), Color(white: 0.04).opacity(0.15)], startPoint: .leading, endPoint: .trailing)
            }
            .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        }
        .glassCard(radius: 28, solid: true)
        // Carte du titre en cours : toujours sombre (comme sur l’ordinateur), même sur le thème clair.
        .environment(\.colorScheme, .dark)
        .contentShape(Rectangle())
        .onTapGesture(perform: open)
    }
}

/// Précédent, lecture/pause, suivant : disques en verre, icônes blanches (comme avant).
struct Controls: View {
    enum Size { case regular, large }
    @EnvironmentObject private var store: Store
    let size: Size

    var body: some View {
        let big = size == .large
        HStack(spacing: big ? 30 : 14) {
            button("backward.end.fill", label: L("Titre précédent"), enabled: store.previous != nil, side: big ? 56 : 44) { store.skip(.previous) }
            Button { store.togglePlayback() } label: {
                Image(systemName: store.playing ? "pause.fill" : "play.fill")
                    .font(.system(size: big ? 27 : 20, weight: .semibold))
                    .foregroundStyle(.white)
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: big ? 70 : 52, height: big ? 70 : 52)
                    .background(Circle().fill(Color.sonoFg.opacity(0.14)))
                    .overlay(Circle().strokeBorder(Color.sonoFg.opacity(0.34), lineWidth: 1))
            }
            .buttonStyle(PressStyle())
            .disabled(store.current == nil && store.nextUp == nil)
            .accessibilityLabel(store.playing ? L("Mettre en pause") : L("Lancer la lecture"))
            button("forward.end.fill", label: L("Titre suivant"), enabled: store.nextUp != nil, side: big ? 56 : 44) { store.skip(.next) }
        }
        .frame(maxWidth: .infinity)
    }

    private func button(_ symbol: String, label: String, enabled: Bool, side: CGFloat, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: side * 0.36, weight: .semibold))
                .foregroundStyle(Color.sonoText.opacity(enabled ? 0.9 : 0.3))
                .frame(width: side, height: side)
                .background(Circle().fill(Color(red: 14 / 255, green: 14 / 255, blue: 12 / 255).opacity(0.3)).overlay(Circle().fill(Color.sonoFg.opacity(0.08))))
                .overlay(Circle().strokeBorder(LinearGradient(colors: [Color.sonoFg.opacity(0.3), Color.sonoFg.opacity(0.15)], startPoint: .top, endPoint: .bottom), lineWidth: 1))
                .opacity(enabled ? 1 : 0.6)
        }
        .buttonStyle(PressStyle())
        .disabled(!enabled)
        .accessibilityLabel(label)
    }
}

struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
    }
}

/// Barre de progression : avance en continu entre deux relevés du moteur, et se fait glisser pour se déplacer.
struct ProgressBar: View {
    @EnvironmentObject private var store: Store
    var compact = false
    @State private var dragging: Double?

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.5)) { context in
            let progress = store.progress
            let duration = max(progress.durationMs, store.current?.durationMillis ?? 0)
            let position = dragging.map { Int($0 * Double(duration)) } ?? progress.position(at: context.date)
            let fraction = duration > 0 ? min(1, Double(position) / Double(duration)) : 0
            VStack(spacing: 6) {
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.sonoFg.opacity(0.14))
                        Capsule().fill(compact ? store.appearance.accentColor : Color.sonoText).frame(width: max(0, geometry.size.width * fraction))
                            .animation(dragging == nil ? .linear(duration: 0.5) : nil, value: fraction)
                    }
                    .frame(height: dragging == nil ? 5 : 9)
                    .frame(maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .gesture(DragGesture(minimumDistance: 0)
                        .onChanged { value in dragging = min(1, max(0, value.location.x / geometry.size.width)) }
                        .onEnded { value in
                            let fraction = min(1, max(0, value.location.x / geometry.size.width))
                            store.seek(to: Int(fraction * Double(duration)))
                            dragging = nil
                        })
                    .animation(.easeOut(duration: 0.15), value: dragging == nil)
                }
                .frame(height: 18)
                HStack {
                    Text(clock(position)); Spacer(); Text(duration > 0 ? clock(duration) : "—:—")
                }
                .font(.system(size: 11.5, weight: .medium).monospacedDigit()).foregroundStyle(Color.sonoMuted)
            }
        }
    }
}

/// Musique de fond : la sélection en cours, ou le bouton pour en choisir une.
struct FallbackRow: View {
    @EnvironmentObject private var store: Store
    let choose: () -> Void
    var body: some View {
        if let fallback = store.session.fallback {
            HStack(spacing: 12) {
                CoverView(address: fallback.cover, size: 44, radius: fallback.type == "artist" ? 22 : 8)
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("Musique de fond")).font(.system(size: 11.5, weight: .bold)).tracking(1).foregroundStyle(Color.sonoMuted)
                    Text(fallback.name ?? "").font(.system(size: 14, weight: .semibold)).foregroundStyle(Color.sonoText).lineLimit(1)
                }
                Spacer()
                Menu {
                    Button { choose() } label: { Label(L("Changer"), systemImage: "arrow.triangle.2.circlepath") }
                    Button(role: .destructive) { store.clearFallback() } label: { Label(L("Désactiver"), systemImage: "xmark") }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.sonoText).frame(width: 36, height: 36).background(Circle().fill(Color.sonoFg.opacity(0.08)))
                }
            }
            .padding(12)
            .glassCard(radius: 18)
        } else {
            Button(action: choose) {
                Label(L("Ajouter une musique de fond"), systemImage: "plus").font(.system(size: 14, weight: .medium)).foregroundStyle(Color.sonoMuted)
            }
            .buttonStyle(StillButtonStyle())
            .disabled(store.session.source == nil)
        }
    }
}

/// Aucune app de lecture connectée.
struct SourceNotice: View {
    @Binding var tab: Tab
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(L("Choisissez l’app qui jouera la musique")).font(.system(size: 15.5, weight: .semibold)).foregroundStyle(Color.sonoText)
            Text(L("Connectez Apple Music ou Deezer : la lecture et la recherche passeront par cette app.")).font(.system(size: 13)).foregroundStyle(Color.sonoMuted)
            Button { tab = .connections } label: { Label(L("Connecter"), systemImage: "link") }.buttonStyle(AccentButtonStyle(wide: false))
        }
        .padding(15)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassCard()
    }
}

/// Personnes qui attendent l’accord de l’hôte.
struct JoinRequestsBanner: View {
    @EnvironmentObject private var store: Store
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(L("Demandes pour rejoindre"), systemImage: "person.badge.plus").font(.system(size: 14, weight: .semibold)).foregroundStyle(Color.sonoText)
            ForEach(store.session.requests ?? []) { request in
                HStack(spacing: 10) {
                    Avatar(name: request.name, size: 32)
                    Text(request.name).font(.system(size: 14, weight: .medium)).foregroundStyle(Color.sonoText).lineLimit(1)
                    Spacer()
                    Button { store.decide(request, accept: false) } label: { Image(systemName: "xmark").font(.system(size: 13, weight: .bold)).frame(width: 36, height: 36).background(Circle().fill(Color.sonoFg.opacity(0.1))).foregroundStyle(Color.sonoText) }
                        .accessibilityLabel(L("Refuser {0}", request.name))
                    Button { store.decide(request, accept: true) } label: { Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).frame(width: 36, height: 36).background(Circle().fill(store.appearance.accentColor)).foregroundStyle(store.appearance.accentInk) }
                        .accessibilityLabel(L("Accepter {0}", request.name))
                }
            }
        }
        .padding(16)
        .glassCard(radius: 20)
        .transition(.move(edge: .top).combined(with: .opacity))
    }
}

/// Invités arrivés à l’instant (sans validation).
struct JoinNoticesBanner: View {
    @EnvironmentObject private var store: Store
    @Binding var confirmation: Confirmation?
    var body: some View {
        VStack(spacing: 8) {
            ForEach(store.joinNotices) { notice in
                HStack(spacing: 10) {
                    Avatar(name: notice.name, size: 30)
                    Text(L("{0} a rejoint la session", notice.name)).font(.system(size: 14)).foregroundStyle(Color.sonoText).lineLimit(1)
                    Spacer()
                    Menu {
                        Button(role: .destructive) {
                            if let person = store.session.participants?.first(where: { $0.id == notice.id }) { confirmation = .kick(person) }
                        } label: { Label(L("Retirer de la session"), systemImage: "person.badge.minus") }
                    } label: { Image(systemName: "ellipsis").foregroundStyle(Color.sonoMuted).frame(width: 30, height: 30) }
                    Button { store.joinNotices.removeAll { $0.id == notice.id } } label: { Image(systemName: "xmark").font(.system(size: 11.5, weight: .bold)).foregroundStyle(Color.sonoMuted).frame(width: 30, height: 30) }
                }
            }
        }
        .padding(14)
        .glassCard(radius: 18)
    }
}

/// Rester appuyé puis glisser : le geste d’iOS (il laisse défiler la page tant que le doigt n’est pas resté posé).
struct LiftModifier: ViewModifier {
    let began: () -> Void
    let moved: (CGFloat) -> Void
    let ended: () -> Void
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.gesture(LiftGesture(began: began, moved: moved, ended: ended))
        } else {
            content.gesture(LongPressGesture(minimumDuration: 0.35).sequenced(before: DragGesture(minimumDistance: 0))
                .onChanged { value in
                    switch value {
                    case .first(true): began()
                    case .second(true, let drag?): moved(drag.translation.height)
                    default: break
                    }
                }
                .onEnded { _ in ended() })
        }
    }
}

@available(iOS 18.0, *)
struct LiftGesture: UIGestureRecognizerRepresentable {
    let began: () -> Void
    let moved: (CGFloat) -> Void
    let ended: () -> Void

    final class Start { var y: CGFloat = 0 }
    func makeCoordinator(converter: CoordinateSpaceConverter) -> Start { Start() }

    func makeUIGestureRecognizer(context: Context) -> UILongPressGestureRecognizer {
        let recognizer = UILongPressGestureRecognizer()
        recognizer.minimumPressDuration = 0.35
        recognizer.allowableMovement = 10
        return recognizer
    }

    func handleUIGestureRecognizerAction(_ recognizer: UILongPressGestureRecognizer, context: Context) {
        let y = context.converter.localLocation.y
        switch recognizer.state {
        case .began: context.coordinator.y = y; began()
        case .changed: moved(y - context.coordinator.y)
        case .ended, .cancelled, .failed: ended()
        default: break
        }
    }
}

/// Une ligne qu’on fait glisser vers la gauche : un fond coloré apparaît avec l’action ; assez loin (ou d’un coup
/// de doigt rapide), la ligne part et l’action s’applique ; sinon elle revient en place.
struct SwipeToAct<Content: View>: View {
    let swipe: (label: String, symbol: String, color: Color, action: () -> Void)?
    @ViewBuilder let content: Content
    @State private var dx: CGFloat = 0
    @State private var armed = false

    var body: some View {
        let revealed = max(0, -dx)
        // Le fond coloré est dessiné derrière la ligne sans compter dans la mise en page : seule la ligne bouge.
        content
            .offset(x: dx)
            .frame(maxWidth: .infinity)
            .background(alignment: .trailing) {
                if let swipe, revealed > 0 {
                    RoundedRectangle(cornerRadius: 14, style: .continuous).fill(swipe.color)
                        .frame(width: revealed + 14)
                        .overlay(alignment: .trailing) {
                            Image(systemName: swipe.symbol)
                                .font(.system(size: 15.5, weight: .semibold)).foregroundStyle(.white)
                                .scaleEffect(armed ? 1.15 : 1)
                                .padding(.trailing, 22)
                                .opacity(revealed > 44 ? 1 : 0)
                        }
                        .padding(.trailing, -10)
                        .accessibilityLabel(swipe.label)
                }
            }
        .modifier(SwipeModifier(enabled: swipe != nil,
            changed: { x in
                dx = min(0, x)
                let now = dx < -120
                if now != armed { armed = now; UIImpactFeedbackGenerator(style: .light).impactOccurred() }
            },
            ended: { x, velocity in
                if x < -120 || velocity < -900 {
                    withAnimation(.easeOut(duration: 0.22)) { dx = -UIScreen.main.bounds.width - 40 }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { swipe?.action() }
                } else {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { dx = 0 }
                }
                armed = false
            }))
    }
}

struct SwipeModifier: ViewModifier {
    let enabled: Bool
    let changed: (CGFloat) -> Void
    let ended: (CGFloat, CGFloat) -> Void
    func body(content: Content) -> some View {
        if enabled, #available(iOS 18.0, *) {
            content.gesture(SwipeGesture(changed: changed, ended: ended))
        } else {
            content
        }
    }
}

/// Le glissement horizontal d’iOS, qui ne démarre que si le doigt part vers la gauche plus que vers le haut ou le bas :
/// la page continue de défiler normalement.
@available(iOS 18.0, *)
struct SwipeGesture: UIGestureRecognizerRepresentable {
    let changed: (CGFloat) -> Void
    let ended: (CGFloat, CGFloat) -> Void

    final class Pan: UIPanGestureRecognizer, UIGestureRecognizerDelegate {
        override init(target: Any?, action: Selector?) { super.init(target: target, action: action); delegate = self }
        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            let velocity = velocity(in: view)
            return velocity.x < 0 && abs(velocity.x) > abs(velocity.y) * 1.4
        }
        /// Pendant le glissement d’une ligne, la page ne défile pas (seule la ligne bouge).
        func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
            other.view is UIScrollView
        }
        func gestureRecognizer(_ recognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { false }
    }

    func makeUIGestureRecognizer(context: Context) -> Pan { Pan(target: nil, action: nil) }

    func handleUIGestureRecognizerAction(_ recognizer: Pan, context: Context) {
        let x = recognizer.translation(in: recognizer.view).x
        switch recognizer.state {
        case .began, .changed: changed(x)
        case .ended: ended(x, recognizer.velocity(in: recognizer.view).x)
        case .cancelled, .failed: ended(0, 0)
        default: break
        }
    }
}
