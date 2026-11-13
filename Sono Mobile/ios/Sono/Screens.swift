import SwiftUI

// MARK: Musique de fond : une playlist, un album ou un artiste quand la file est vide

struct FallbackSheet: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var kind = "playlist"
    @State private var query = ""
    @State private var results: CatalogResults?
    @State private var mine: [CatalogItem] = []
    @State private var loading = false
    @State private var choosing: String?
    @State private var error: String?

    private var items: [CatalogItem] {
        guard let results else { return kind == "playlist" ? mine : [] }
        switch kind { case "album": return results.albums ?? []; case "artist": return results.artists ?? []; default: return results.playlists ?? [] }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(L("Musique de fond")).font(.system(size: 21, weight: .bold)).foregroundStyle(Color.sonoText).padding(.top, 26)
            Picker("Type", selection: $kind) {
                Text("Playlists").tag("playlist"); Text("Albums").tag("album"); Text(L("Artistes")).tag("artist")
            }
            .pickerStyle(.segmented)
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(Color.sonoMuted)
                TextField("", text: $query, prompt: Text(kind == "artist" ? L("Rechercher un artiste…") : kind == "album" ? L("Rechercher un album…") : L("Rechercher une playlist…")).foregroundColor(Color.sonoMuted.opacity(0.7)))
                    .sonoCaret().font(.system(size: 15)).submitLabel(.search).autocorrectionDisabled().foregroundStyle(Color.sonoText)
                if loading { ProgressView() }
            }
            .padding(.horizontal, 16).padding(.vertical, 13)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.sonoFg.opacity(0.08)))
            if let error { Label(error, systemImage: "exclamationmark.circle").font(.system(size: 13)).foregroundStyle(Color.sonoDanger) }
            if results == nil, kind == "playlist", !mine.isEmpty { Text(L("MES PLAYLISTS")).font(.system(size: 11.5, weight: .bold)).tracking(1.4).foregroundStyle(Color.sonoMuted) }
            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(items) { item in
                        Button { choose(item) } label: {
                            HStack(spacing: 12) {
                                CoverView(address: item.cover, size: 52, radius: item.type == "artist" ? 26 : 9)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(item.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.sonoText).lineLimit(1)
                                    if let subtitle = item.subtitle { Text(subtitle).font(.system(size: 13)).foregroundStyle(Color.sonoMuted).lineLimit(1) }
                                }
                                Spacer()
                                if choosing == item.id { ProgressView() } else { Image(systemName: "chevron.right").foregroundStyle(Color.sonoMuted) }
                            }
                            .padding(.vertical, 6)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(StillButtonStyle())
                        .disabled(choosing != nil)
                    }
                }
                if items.isEmpty && !loading {
                    Text(results != nil ? L("Aucun résultat.") : kind == "playlist" ? L("Recherchez une playlist, ou choisissez-en une de votre compte si elle apparaît ici.") : kind == "artist" ? L("Recherchez un artiste : ses titres les plus écoutés passeront en aléatoire.") : L("Recherchez un album : il sera joué dans l’ordre."))
                        .font(.system(size: 13)).foregroundStyle(Color.sonoMuted).multilineTextAlignment(.center).frame(maxWidth: .infinity).padding(.top, 30)
                }
            }
            .scrollDismissesKeyboard(.immediately)
        }
        .padding(.horizontal, 20)
        .presentationBackground(.regularMaterial)
        .task { mine = await store.myPlaylists() }
        .task(id: query) {
            let term = query.trimmingCharacters(in: .whitespaces)
            guard !term.isEmpty else { results = nil; error = nil; loading = false; return }
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            loading = true
            do { let found = try await store.catalogSearch(term); if !Task.isCancelled { results = found; error = nil } }
            catch { if !Task.isCancelled { self.error = error.localizedDescription } }
            loading = false
        }
    }

    private func choose(_ item: CatalogItem) {
        choosing = item.id
        Task {
            if await store.chooseFallback(item) { dismiss() }
            choosing = nil
        }
    }
}

// MARK: Activité : chiffres, fil d’activité, personnes présentes

struct ActivityScreen: View {
    @EnvironmentObject private var store: Store
    @Binding var sheet: Sheet?
    @Binding var confirmation: Confirmation?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(sheet: $sheet).padding(.top, 14)
                Eyebrow(text: L("Session · Activité"))
                HStack(spacing: 10) {
                    stat("person.2.fill", value: store.session.guests ?? 0, label: (store.session.guests ?? 0) > 1 ? L("invités connectés") : L("invité connecté"), color: store.appearance.accentColor)
                    stat("music.note", value: store.queue.count, label: L("titres à venir"), color: Color(hex: "#ffb38a"))
                    stat("waveform.path.ecg", value: store.activity.count, label: "actions", color: Color(hex: "#b9a3ff"))
                }
                people
                VStack(alignment: .leading, spacing: 14) {
                    Text(L("Fil d’activité")).font(.system(size: 18, weight: .bold)).foregroundStyle(Color.sonoText)
                    if store.activity.isEmpty { Text(L("Aucune activité enregistrée.")).font(.system(size: 14)).foregroundStyle(Color.sonoMuted) }
                    ForEach(Array(store.activity.enumerated()), id: \.offset) { _, item in
                        HStack(alignment: .top, spacing: 12) {
                            Image(systemName: item.icon == "plus" ? "plus" : item.icon == "user" ? "person.fill" : "music.note")
                                .font(.system(size: 12, weight: .bold)).foregroundStyle(store.appearance.accentText)
                                .frame(width: 32, height: 32).background(Circle().fill(store.appearance.accentColor.opacity(0.14)))
                            VStack(alignment: .leading, spacing: 3) {
                                Text(LServer(item.text)).font(.system(size: 14, weight: .medium)).foregroundStyle(Color.sonoText)
                                Text(activityTime(item.at)).font(.system(size: 12)).foregroundStyle(Color.sonoMuted)
                            }
                        }
                    }
                }
                .padding(16).frame(maxWidth: .infinity, alignment: .leading).glassCard()
            }
            .padding(.horizontal, 20).padding(.bottom, 30)
        }
        .refreshable { await store.refresh() }
    }

    private func stat(_ symbol: String, value: Int, label: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: symbol).font(.system(size: 13, weight: .bold)).foregroundStyle(color)
            Text("\(value)").font(.system(size: 23, weight: .bold)).foregroundStyle(Color.sonoText).contentTransition(.numericText())
            Text(label).font(.system(size: 11.5)).foregroundStyle(Color.sonoMuted).lineLimit(2, reservesSpace: true)
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading).glassCard(radius: 20)
    }

    private var people: some View {
        let participants = store.session.participants ?? []
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Text(L("Dans la session")).font(.system(size: 18, weight: .bold)).foregroundStyle(Color.sonoText)
                Text("\(participants.count)").font(.system(size: 12, weight: .bold)).foregroundStyle(Color.sonoText).padding(.horizontal, 9).padding(.vertical, 3).background(Capsule().fill(Color.sonoFg.opacity(0.1)))
            }
            ForEach(participants) { person in
                HStack(spacing: 12) {
                    Avatar(name: person.name)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(person.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.sonoText).lineLimit(1)
                            if person.isHost || person.admin == true {
                                Text(person.isHost ? L("Hôte") : "Admin").font(.system(size: 11, weight: .bold)).foregroundStyle(store.appearance.accentText)
                                    .padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(store.appearance.accentColor.opacity(0.15)))
                            }
                        }
                        Text(person.isHost ? L("Organise la session") : person.online == true ? L("En ligne") : L("Hors ligne")).font(.system(size: 12)).foregroundStyle(person.online == true && !person.isHost ? Color(hex: "#7ee08a") : Color.sonoMuted)
                    }
                    Spacer()
                    if !person.isHost {
                        Menu {
                            Button { person.admin == true ? store.setAdmin(person, false) : (confirmation = .admin(person)) } label: {
                                Label(person.admin == true ? L("Retirer des admins") : L("Nommer admin"), systemImage: "checkmark.shield")
                            }
                            Button(role: .destructive) { confirmation = .kick(person) } label: { Label(L("Retirer de la session"), systemImage: "person.badge.minus") }
                        } label: {
                            Image(systemName: "ellipsis").font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.sonoText).frame(width: 36, height: 36).background(Circle().fill(Color.sonoFg.opacity(0.08)))
                        }
                        .accessibilityLabel(L("Options pour {0}", person.name))
                    }
                }
            }
            if participants.filter({ !$0.isHost }).isEmpty { Text(L("Personne n’a encore rejoint.")).font(.system(size: 14)).foregroundStyle(Color.sonoMuted) }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading).glassCard()
    }
}

// MARK: Connexions : Apple Music et Deezer

struct ConnectionsScreen: View {
    @EnvironmentObject private var store: Store
    @Binding var sheet: Sheet?
    @State private var busy: String?
    @State private var errors: [String: String] = [:]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(sheet: $sheet).padding(.top, 14)
                VStack(alignment: .leading, spacing: 8) {
                    Eyebrow(text: L("Sources musicales"))
                    Text(L("La musique est lancée sur l’app choisie ci-dessous et sort de ce téléphone. La recherche de vos invités passe aussi par elle.")).font(.system(size: 14)).foregroundStyle(Color.sonoMuted)
                }
                service("Apple Music", connected: store.status.appleConnected, account: nil, logo: "AppleMusicLogo", description: L("Un abonnement Apple Music actif et l’app Musique connectée sur ce téléphone sont nécessaires."))
                service("Deezer", connected: store.status.deezerConnected, account: store.status.deezerAccount, logo: "DeezerLogo", description: L("Connectez votre compte Deezer pour lancer la lecture depuis Sono."))
            }
            .padding(.horizontal, 20).padding(.bottom, 30)
        }
        .task { await store.syncApps() }
    }

    private func service(_ name: String, connected: Bool, account: String?, logo: String, description: String) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                Image(logo).resizable().scaledToFit().frame(width: 52, height: 52).clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 8) {
                        Text(name).font(.system(size: 17, weight: .bold)).foregroundStyle(Color.sonoText)
                        if connected && store.session.source == name {
                            Text(L("App de lecture")).font(.system(size: 11, weight: .bold)).foregroundStyle(store.appearance.accentText).padding(.horizontal, 7).padding(.vertical, 2).background(Capsule().fill(store.appearance.accentColor.opacity(0.15)))
                        }
                    }
                    HStack(spacing: 6) {
                        Circle().fill(connected ? Color(hex: "#7ee08a") : Color.sonoMuted).frame(width: 7, height: 7)
                        Text(connected ? L("Connecté") : L("Non connecté")).font(.system(size: 13)).foregroundStyle(Color.sonoMuted)
                    }
                }
            }
            Text(description).font(.system(size: 13)).foregroundStyle(Color.sonoMuted)
            if let account { Label(account, systemImage: "checkmark").font(.system(size: 13, weight: .medium)).foregroundStyle(Color.sonoText) }
            if let error = errors[name] { Label(error, systemImage: "exclamationmark.circle").font(.system(size: 13)).foregroundStyle(Color.sonoDanger) }
            if connected {
                if store.session.source != name {
                    Button { Task { await store.setSource(name, message: L("La musique sera lancée sur {0}.", name)) } } label: { Text(L("Utiliser pour la lecture")) }.buttonStyle(SecondaryButtonStyle()).disabled(busy != nil)
                }
                Button {
                    busy = name
                    Task { await store.disconnect(name); busy = nil }
                } label: { Text(L("Déconnecter {0}", name)) }.buttonStyle(SecondaryButtonStyle()).disabled(busy != nil)
            } else {
                Button {
                    busy = name
                    errors[name] = nil
                    Task {
                        do { try await store.connect(name) } catch { errors[name] = error.localizedDescription }
                        busy = nil
                    }
                } label: {
                    HStack { if busy == name { ProgressView().tint(store.appearance.accentInk) }; Text(L("Se connecter avec {0}", name)) }
                }
                .buttonStyle(AccentButtonStyle()).disabled(busy != nil)
            }
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading).glassCard()
    }
}

// MARK: Réglages : la session, puis l’apparence de ce téléphone

struct SettingsScreen: View {
    @EnvironmentObject private var store: Store
    @Binding var sheet: Sheet?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScreenHeader(sheet: $sheet).padding(.top, 14)
                VStack(alignment: .leading, spacing: 12) {
                    Eyebrow(text: L("Réglages"))
                    Picker("Section", selection: $store.settingsSection) { Text("Session").tag(0); Text(L("Apparence")).tag(1) }.pickerStyle(.segmented)
                }
                if store.settingsSection == 0 { SessionSettings(sheet: $sheet) } else { AppearanceSettings() }
                // Version de l’app (celle de l’App Store / de l’IPA) et numéro de fabrication.
                Text("Sono \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") (\(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""))")
                    .font(.system(size: 12)).foregroundStyle(Color.sonoMuted)
                    .frame(maxWidth: .infinity).padding(.top, 6)
            }
            .padding(.horizontal, 20).padding(.bottom, 30)
        }
        .scrollDismissesKeyboard(.interactively)
    }
}

struct SettingsCard<Content: View>: View {
    let title: String
    var subtitle: String?
    @ViewBuilder let content: Content
    var body: some View {
        // Réglages : des sections posées sur le fond (sans carte), séparées par un trait fin.
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.system(size: 17, weight: .semibold)).foregroundStyle(Color.sonoText)
                if let subtitle { Text(subtitle).font(.system(size: 13)).foregroundStyle(Color.sonoMuted) }
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 22)
        .overlay(alignment: .top) { Rectangle().fill(Color.sonoFg.opacity(0.1)).frame(height: 0.5) }
    }
}

struct InputField: View {
    let title: String
    @Binding var text: String
    var prompt = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.system(size: 13, weight: .medium)).foregroundStyle(Color.sonoMuted)
            TextField("", text: $text, prompt: Text(prompt).foregroundColor(Color.sonoMuted.opacity(0.6)))
                .sonoCaret().font(.system(size: 15))
                .padding(.horizontal, 14).padding(.vertical, 11)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.sonoField))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Color.sonoFg.opacity(0.1)))
                .foregroundStyle(Color.sonoText)
        }
    }
}

struct SessionSettings: View {
    @EnvironmentObject private var store: Store
    @Binding var sheet: Sheet?
    @State private var hostName = ""
    @State private var sessionName = ""
    @State private var saving: String?
    @State private var sound: Sound?
    @State private var soundTask: Task<Void, Never>?
    @State private var confirmClear = false
    /// Taille de ce que « Vider le cache » efface (dossier Caches et fichiers temporaires), calculée à l’affichage.
    @State private var cacheBytes: Int64?

    private let presets: [(String, Sound)] = [
        (L("Neutre"), .neutral), (L("Moins de basses"), Sound(bass: -6, mid: 0, treble: 1)), (L("Plus de basses"), Sound(bass: 5, mid: 0, treble: 0)),
        (L("Voix claires"), Sound(bass: -2, mid: 3, treble: 1.5)), (L("Aigus brillants"), Sound(bass: 0, mid: -1, treble: 4)),
    ]

    var body: some View {
        let hostValue = store.session.host == "Hôte" ? "" : store.session.host
        VStack(spacing: 26) {
            SettingsCard(title: L("Mon profil"), subtitle: L("Ce nom apparaît aux invités et à côté des titres que vous ajoutez.")) {
                InputField(title: L("Votre nom"), text: $hostName, prompt: L("Ex. Camille"))
                saveButton(L("Enregistrer le profil"), field: "host", disabled: hostName.trimmingCharacters(in: .whitespaces).isEmpty || hostName.trimmingCharacters(in: .whitespaces) == store.session.host) {
                    await store.saveSettings(["host": hostName.trimmingCharacters(in: .whitespaces)], message: L("Profil enregistré."))
                }
            }
            SettingsCard(title: "Session") {
                InputField(title: L("Nom de la session"), text: $sessionName)
                saveButton(L("Enregistrer"), field: "name", disabled: sessionName.trimmingCharacters(in: .whitespaces).isEmpty || sessionName.trimmingCharacters(in: .whitespaces) == store.session.name) {
                    await store.saveSettings(["name": sessionName.trimmingCharacters(in: .whitespaces)], message: L("Nom de la session enregistré."))
                }
            }
            SettingsCard(title: L("Accès à la session")) {
                Toggle(isOn: Binding(get: { store.session.requireApproval == true }, set: { value in
                    Task { await store.saveSettings(["requireApproval": value], message: value ? L("Vous validerez désormais chaque nouvel invité.") : L("Tout le monde peut rejoindre avec le code.")) }
                })) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(L("Valider chaque invité")).font(.system(size: 15, weight: .medium)).foregroundStyle(Color.sonoText)
                        Text(L("Chaque personne qui rejoint doit être acceptée par vous. Les invités déjà présents restent dans la session.")).font(.system(size: 12)).foregroundStyle(Color.sonoMuted)
                    }
                }
            }
            if let sound { soundCard(sound) }
            SettingsCard(title: L("Lien d’invitation"), subtitle: L("Partagez ce lien avec les invités qui ne peuvent pas scanner le code QR.")) {
                HStack {
                    Text(store.inviteURL).font(.system(size: 14)).foregroundStyle(Color.sonoText).lineLimit(1).truncationMode(.middle)
                    Spacer()
                    ShareLink(item: URL(string: store.inviteURL)!) { Image(systemName: "square.and.arrow.up") }.buttonStyle(SecondaryButtonStyle())
                }
            }
            SettingsCard(title: L("Stockage"), subtitle: L("Efface tout ce que l’app garde en cache. La session en cours est fermée et Sono se ferme ; vos comptes connectés sont conservés.")) {
                Text(cacheBytes.map { L("Taille du cache : {0}", Self.formatBytes($0)) } ?? L("Calcul de la taille…"))
                    .font(.system(size: 13, weight: .semibold)).foregroundStyle(Color.sonoText)
                Button { Task { await measureCache() }; confirmClear = true } label: { Label(L("Vider le cache"), systemImage: "trash") }.buttonStyle(SecondaryButtonStyle())
            }
            .task { await measureCache() }
            .alert(L("Vider le cache ?"), isPresented: $confirmClear) {
                Button(L("Vider et fermer Sono"), role: .destructive) { clearAndQuit() }
                Button(L("Annuler"), role: .cancel) {}
            } message: {
                Text((cacheBytes.map { L("{0} seront libérés.", Self.formatBytes($0)) + "\n\n" } ?? "") + L("La session en cours va être fermée : la musique s’arrête et les invités ne pourront plus y accéder. Sono va ensuite se fermer pour que le cache soit entièrement vidé. Rouvrez l’app pour créer une nouvelle session."))
            }
            SettingsCard(title: L("Supprimer la session"), subtitle: L("La file d’attente, l’historique et la liste des invités sont effacés définitivement. Les invités connectés sont déconnectés et le code {0} ne fonctionnera plus.", store.session.code)) {
                Button { sheet = .delete } label: { Label(L("Supprimer la session"), systemImage: "trash") }.buttonStyle(AccentButtonStyle(danger: true))
            }
        }
        .onAppear { hostName = hostValue; sessionName = store.session.name }
        .onChange(of: store.session.host) { _, value in hostName = value == "Hôte" ? "" : value }
        .onChange(of: store.session.name) { _, value in sessionName = value }
        .task { sound = await store.loadSound() }
    }

    private func saveButton(_ title: String, field: String, disabled: Bool, action: @escaping () async -> Bool) -> some View {
        Button {
            saving = field
            Task { _ = await action(); saving = nil }
        } label: { HStack { if saving == field { ProgressView().tint(store.appearance.accentInk) }; Text(title) } }
        .buttonStyle(AccentButtonStyle())
        .disabled(disabled || saving != nil)
        .opacity(disabled ? 0.5 : 1)
    }

    private func soundCard(_ value: Sound) -> some View {
        SettingsCard(title: L("Son"), subtitle: store.session.source != "Deezer" ? L("Ajustez le rendu de la musique en direct (lecture Deezer uniquement).") : L("Ajustez le rendu de la musique en direct.")) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(presets, id: \.0) { label, preset in
                        Button { update(preset) } label: {
                            Text(label).font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(value == preset ? store.appearance.accentInk : Color.sonoText)
                                .padding(.horizontal, 14).padding(.vertical, 9)
                                .background(Capsule().fill(value == preset ? store.appearance.accentColor : Color.sonoFg.opacity(0.08)))
                        }
                    }
                }
            }
            slider(L("Basses"), \.bass, value)
            slider(L("Médiums"), \.mid, value)
            slider(L("Aigus"), \.treble, value)
        }
    }

    private func slider(_ label: String, _ key: WritableKeyPath<Sound, Double>, _ value: Sound) -> some View {
        HStack(spacing: 12) {
            Text(label).font(.system(size: 14)).foregroundStyle(Color.sonoText).frame(width: 78, alignment: .leading)
            Slider(value: Binding(get: { value[keyPath: key] }, set: { var next = value; next[keyPath: key] = ($0 * 2).rounded() / 2; update(next) }), in: -12...12)
            Text("\(value[keyPath: key] > 0 ? "+" : "")\(String(format: "%g", value[keyPath: key]).replacingOccurrences(of: ".", with: Lang.current == "en" ? "." : ",")) dB")
                .font(.system(size: 12).monospacedDigit()).foregroundStyle(Color.sonoMuted).frame(width: 62, alignment: .trailing)
        }
    }

    private func update(_ next: Sound) {
        sound = next
        soundTask?.cancel()
        soundTask = Task {
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            await store.saveSound(next)
        }
    }

    /// Les dossiers que « Vider le cache » efface : Caches (réponses réseau, pochettes) et temporaire.
    nonisolated private static var cacheFolders: [URL] { [FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0], FileManager.default.temporaryDirectory] }

    /// Taille totale de ces dossiers, en octets (calcul hors de l’interface).
    nonisolated private static func cacheSize() -> Int64 {
        var total: Int64 = 0
        for folder in cacheFolders {
            guard let items = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: [.totalFileAllocatedSizeKey, .isRegularFileKey]) else { continue }
            while let url = items.nextObject() as? URL {
                let values = try? url.resourceValues(forKeys: [.totalFileAllocatedSizeKey, .isRegularFileKey])
                if values?.isRegularFile == true { total += Int64(values?.totalFileAllocatedSize ?? 0) }
            }
        }
        return total
    }

    private func measureCache() async {
        cacheBytes = await Task.detached(priority: .utility) { Self.cacheSize() }.value
    }

    /// Taille lisible (Ko, Mo, Go) dans la langue de l’app.
    static func formatBytes(_ bytes: Int64) -> String {
        let value = Double(bytes)
        let measurement: Measurement<UnitInformationStorage> = value >= 1e9 ? .init(value: value / 1e9, unit: .gigabytes) : value >= 1e6 ? .init(value: value / 1e6, unit: .megabytes) : .init(value: max(value, 0) / 1e3, unit: .kilobytes)
        return measurement.formatted(.measurement(width: .abbreviated, usage: .asProvided, numberFormatStyle: .number.precision(.fractionLength(0...(measurement.value < 10 ? 1 : 0)))).locale(Lang.locale))
    }

    /// Ferme la session en cours, efface tout le cache (réponses réseau, dossiers Caches et temporaire), puis ferme Sono :
    /// au prochain lancement, rien ne reste en mémoire ni sur le disque.
    private func clearAndQuit() {
        Task {
            await store.deleteSession()
            let fm = FileManager.default
            URLCache.shared.removeAllCachedResponses()
            for folder in Self.cacheFolders {
                for item in (try? fm.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [] { try? fm.removeItem(at: item) }
            }
            store.notify(L("Cache vidé : Sono se ferme."))
            try? await Task.sleep(for: .milliseconds(1500))
            exit(0)
        }
    }
}

struct AppearanceSettings: View {
    @EnvironmentObject private var store: Store
    @State private var confirmReset = false
    var body: some View {
        VStack(spacing: 26) {
            Text(L("Ces réglages s’appliquent à ce téléphone. Les invités voient votre fond et votre couleur d’accent.")).font(.system(size: 13)).foregroundStyle(Color.sonoMuted).frame(maxWidth: .infinity, alignment: .leading)
            SettingsCard(title: L("Langue"), subtitle: L("Langue de Sono sur ce téléphone. Vos invités voient la même langue.")) {
                Picker(L("Langue"), selection: Binding(get: { store.language }, set: { store.setLanguage($0) })) {
                    Text("Français").tag("fr"); Text("English").tag("en")
                }
                .pickerStyle(.segmented)
            }
            SettingsCard(title: "Style") {
                toggle("Liquid Glass", L("Panneaux translucides façon verre, qui laissent voir l’arrière-plan."), \.glass)
            }
            SettingsCard(title: L("Arrière-plan")) {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 10)], spacing: 12) {
                    ForEach(Backdrop.all) { backdrop in
                        swatch(id: backdrop.id, label: L(backdrop.label)) { GradientLayers(layers: backdrop.layers) }
                    }
                    swatch(id: "cover", label: L("Pochette en cours")) {
                        LinearGradient(colors: [Color(hex: "#3a2a5c"), Color(hex: "#1f4a5c")], startPoint: .topLeading, endPoint: .bottomTrailing).overlay(Image(systemName: "opticaldisc").foregroundStyle(.white))
                    }
                }
            }
            SettingsCard(title: L("Couleur d’accent"), subtitle: L("Boutons, titre en cours, éléments actifs.")) {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 40), spacing: 12)], spacing: 12) {
                    ForEach(Accent.all) { accent in
                        Button { store.updateAppearance { $0.accent = accent.hex } } label: {
                            Circle().fill(accent.native ? AnyShapeStyle(LinearGradient(stops: [.init(color: Color(hex: "#f5f5f4"), location: 0.5), .init(color: Color(hex: "#151513"), location: 0.5)], startPoint: .topLeading, endPoint: .bottomTrailing)) : AnyShapeStyle(Color(hex: accent.hex))).frame(width: 38, height: 38)
                                .overlay(Circle().strokeBorder(Color.sonoFg.opacity(0.22), lineWidth: 1))
                                .overlay(Circle().strokeBorder(Color.sonoText, lineWidth: store.appearance.accent == accent.hex ? 3 : 0).padding(-4))
                        }
                        .accessibilityLabel("Accent \(L(accent.label))")
                    }
                }
                .padding(.vertical, 4)
            }
            SettingsCard(title: L("Lecteur en grand")) {
                Picker(L("Fond"), selection: Binding(get: { store.appearance.tvBackground }, set: { value in store.updateAppearance { $0.tvBackground = value } })) {
                    Text(L("Pochette en cours")).tag("cover"); Text(L("Noir uni")).tag("black")
                }
                .pickerStyle(.segmented)
                toggle(L("« Proposé par »"), L("Le prénom de la personne qui a ajouté le titre, sous l’artiste."), \.tvShowAddedBy)
                toggle(L("Texte à côté du QR code"), L("« Ajoutez vos titres » et le lien court."), \.tvShowQrText)
            }
            // Comme sur l’app ordinateur : tout revient aux réglages d’origine (fond, couleur, verre, lecteur en grand).
            Button { confirmReset = true } label: { Label(L("Réinitialiser l’apparence"), systemImage: "arrow.counterclockwise") }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(store.appearance == Appearance())
                .opacity(store.appearance == Appearance() ? 0.5 : 1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .confirmationDialog(L("Réinitialiser l’apparence ?"), isPresented: $confirmReset, titleVisibility: .visible) {
                    Button(L("Réinitialiser"), role: .destructive) {
                        store.updateAppearance { $0 = Appearance() }
                        store.notify(L("Apparence réinitialisée."))
                    }
                    Button(L("Annuler"), role: .cancel) {}
                } message: {
                    Text(L("Le fond, la couleur d’accent, le style verre et les réglages du lecteur en grand reviennent à ceux d’origine."))
                }
        }
    }

    private func toggle(_ title: String, _ description: String, _ key: WritableKeyPath<Appearance, Bool>) -> some View {
        Toggle(isOn: Binding(get: { store.appearance[keyPath: key] }, set: { value in store.updateAppearance { $0[keyPath: key] = value } })) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 15, weight: .medium)).foregroundStyle(Color.sonoText)
                Text(description).font(.system(size: 12)).foregroundStyle(Color.sonoMuted)
            }
        }
    }

    private func swatch<Preview: View>(id: String, label: String, @ViewBuilder preview: () -> Preview) -> some View {
        Button { store.updateAppearance { $0.background = id } } label: {
            VStack(spacing: 6) {
                preview().frame(height: 58).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(store.appearance.background == id ? store.appearance.accentColor : Color.sonoFg.opacity(0.12), lineWidth: store.appearance.background == id ? 2.5 : 1))
                Text(label).font(.system(size: 11.5, weight: .medium)).foregroundStyle(Color.sonoText).lineLimit(1).minimumScaleFactor(0.8)
            }
        }
        .buttonStyle(StillButtonStyle())
    }
}

/// Confirmation de suppression de la session.
struct DeleteSheet: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Image(systemName: "trash").font(.system(size: 18, weight: .semibold)).foregroundStyle(Color.sonoDanger)
                .frame(width: 50, height: 50).background(RoundedRectangle(cornerRadius: 15, style: .continuous).fill(Color.sonoDanger.opacity(0.15)))
            Text(L("Supprimer « {0} » ?", store.session.name)).font(.system(size: 21, weight: .bold)).foregroundStyle(Color.sonoText)
            Text(L("La file, l’historique et les invités seront effacés. Tout le monde sera déconnecté. Cette action est irréversible.")).font(.system(size: 14)).foregroundStyle(Color.sonoMuted)
            VStack(spacing: 10) {
                Button {
                    busy = true
                    Task { await store.deleteSession(); busy = false }
                } label: { HStack { if busy { ProgressView() }; Text(L("Supprimer définitivement")) } }
                .buttonStyle(AccentButtonStyle(danger: true)).disabled(busy)
                Button { dismiss() } label: { Text(L("Annuler")).frame(maxWidth: .infinity) }.buttonStyle(SecondaryButtonStyle())
            }
        }
        .padding(.horizontal, 22).padding(.top, 26)
        .presentationBackground(.regularMaterial)
    }
}
