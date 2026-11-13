import SwiftUI
import UIKit

/// Erreur renvoyée par le service, avec son message en français.
struct APIError: LocalizedError {
    let status: Int
    let message: String
    var errorDescription: String? { message }
}

/// Le service en ligne de Sono (cloud/) : mêmes appels que la page web.
struct API {
    let server: URL
    let clientId: String

    func request(_ path: String, method: String = "GET", token: String? = nil, body: [String: Any]? = nil) async throws -> Data {
        guard let url = URL(string: path, relativeTo: server) else { throw APIError(status: 0, message: L("Adresse invalide.")) }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(clientId, forHTTPHeaderField: "x-sono-client")
        if let token { request.setValue(token, forHTTPHeaderField: "x-host-token") }
        if let body { request.httpBody = try? JSONSerialization.data(withJSONObject: body) }
        let data: Data
        let response: URLResponse
        do { (data, response) = try await URLSession.shared.data(for: request) }
        catch { throw APIError(status: 0, message: L("Le serveur Sono est momentanément indisponible.")) }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 500
        guard status < 400 else {
            let message = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["error"] as? String
            throw APIError(status: status, message: message.map(LServer) ?? L("Le serveur Sono est momentanément indisponible."))
        }
        return data
    }

    func payload(_ path: String, method: String = "GET", token: String? = nil, body: [String: Any]? = nil) async throws -> Payload {
        try JSONDecoder().decode(Payload.self, from: try await request(path, method: method, token: token, body: body))
    }
}

/// Message en bas de l’écran (« Titre ajouté »…).
struct Toast: Identifiable, Equatable {
    let id = UUID()
    let message: String
    let isError: Bool
}

/// Position dans le titre en cours, lue sur le moteur du téléphone.
struct Progress: Equatable {
    var positionMs = 0
    var durationMs = 0
    var at = Date()
    var running = false
    /// Position du moment, entre deux relevés.
    func position(at date: Date) -> Int {
        guard running else { return positionMs }
        let moved = positionMs + Int(date.timeIntervalSince(at) * 1000)
        return durationMs > 0 ? min(moved, durationMs) : moved
    }
}

struct JoinNotice: Identifiable, Equatable {
    let id: String
    let name: String
    let at: Date
}

/// Tout l’état de l’app côté hôte, et ses actions. Une seule instance (SonoApp.store).
@MainActor
final class Store: ObservableObject {
    enum Phase { case checking, home, host }

    let driver: Driver
    let server: URL
    let api: API
    private let defaults = UserDefaults.standard

    @Published var phase: Phase = .checking
    @Published var session = SessionInfo(code: "", name: "Session Sono", host: "Hôte")
    @Published var queue: [Track] = []
    @Published var current: Track?
    @Published var playing = false
    @Published var previous: Track?
    @Published var fallbackQueue: FallbackQueue?
    @Published var activity: [ActivityItem] = []
    @Published var live = true
    @Published var toast: Toast?
    @Published var joinNotices: [JoinNotice] = []
    @Published var progress = Progress()
    @Published var appearance: Appearance
    /// Langue de l’interface (fr ou en), reprise par les invités et l’écran TV.
    @Published private(set) var language = Lang.current
    /// Onglet ouvert dans Réglages (gardé quand l’écran se reconstruit, par exemple après un changement de langue).
    @Published var settingsSection = 0
    /// Invitation ouverte depuis la page d’un invité (« Ouvrir dans l’app Sono ») : la session s’affiche dans l’app.
    @Published var pendingInvite: URL?
    @Published var carInvite: Bool
    @Published var status = PlayerStatus()
    /// Les comptes de musique de ce téléphone ont été vérifiés (moteur Deezer relancé, Apple Music lu) :
    /// avant cela, on ne sait pas encore s’ils sont connectés, donc rien ne doit dire le contraire.
    @Published var connectionsChecked = false

    private(set) var token: String?
    private var history: [Track] = []
    private var knownRequests: Set<String>?
    private var knownGuests: (code: String, ids: Set<String>)?
    private var toastTask: Task<Void, Never>?
    private var pollTask: Task<Void, Never>?
    private var syncTask: Task<Void, Never>?
    private var watchUntil = Date.distantPast

    // Affichage d’avance (titre passé, file réordonnée) : une diffusion plus ancienne ne doit pas ramener l’écran en arrière.
    private var pendingChanges = 0
    private var held: Payload?
    private var releaseTask: Task<Void, Never>?
    // Suivant / précédent appuyés plusieurs fois : une seule commande, une fois le choix arrêté.
    private var skipDelta = 0
    private var skipActive = false
    private var skipWasPlaying = false
    private var skipTask: Task<Void, Never>?
    private var skipSending = false
    private var skipThenToggle = false

    init(driver: Driver, server: URL) {
        self.driver = driver
        self.server = server
        var id = UserDefaults.standard.string(forKey: "sono-client-id") ?? ""
        if id.isEmpty { id = UUID().uuidString; UserDefaults.standard.set(id, forKey: "sono-client-id") }
        api = API(server: server, clientId: id)
        appearance = Appearance.load()
        carInvite = UserDefaults.standard.bool(forKey: "sono-car-invite")
        driver.onPayload = { [weak self] json in
            guard let self, let data = try? JSONSerialization.data(withJSONObject: json), let payload = try? JSONDecoder().decode(Payload.self, from: data) else { return }
            self.applyBroadcast(payload)
        }
        driver.onLive = { [weak self] value in if self?.live != value { self?.live = value } }
        driver.onAdvance = { [weak self] ms in self?.advance(ms: ms) }
        driver.onInviteShown = { [weak self] shown in self?.setCarInvite(shown) }
    }

    // MARK: Démarrage

    var savedCode: String? { defaults.string(forKey: "sono-host-code") }
    func savedToken(_ code: String) -> String? { defaults.string(forKey: "sono-host-\(code)") }

    /// Au lancement : reprend la session de cet iPhone.
    func start() async {
        // Le moteur Deezer redémarre pendant que la session se recharge ; ses comptes ne sont annoncés qu’une fois vérifiés.
        Task {
            await driver.startSavedEngineAndWait()
            status = PlayerStatus(await driver.statusForPage())
            connectionsChecked = true
            if phase == .host { await syncApps() }
        }
        guard let code = savedCode, let token = savedToken(code) else { phase = .home; return }
        await resume(code: code, token: token)
    }

    private func resume(code: String, token: String) async {
        do {
            var payload = try await api.payload("/api/host/resume", method: "POST", token: token, body: ["code": code])
            // L’app vient d’être (re)lancée : la musique ne reprend pas toute seule, la session est mise en pause.
            if payload.playing == true, let paused = try? await api.payload("/api/sessions/\(code)/playback", method: "POST", token: token, body: ["action": "ended"]) { payload = paused }
            self.token = token
            apply(payload)
            enterHost()
        } catch let error as APIError where [403, 404].contains(error.status) {
            defaults.removeObject(forKey: "sono-host-code")
            phase = .home
        } catch {
            // Hors connexion : on garde la session, elle se recharge dès que le service répond.
            self.token = token
            session.code = code
            enterHost()
            notify(error.localizedDescription, error: true)
        }
    }

    func create(name: String, host: String, requireApproval: Bool) async -> Bool {
        do {
            let data = try await api.request("/api/sessions", method: "POST", body: ["name": name, "host": host, "requireApproval": requireApproval])
            let payload = try JSONDecoder().decode(Payload.self, from: data)
            guard let token = payload.hostToken, let code = payload.session?.code else { throw APIError(status: 500, message: L("Réponse inattendue du service.")) }
            save(code: code, token: token)
            self.token = token
            reset()
            apply(payload)
            enterHost()
            notify(L("Votre session est prête. Invitez vos proches !"))
            return true
        } catch { notify(error.localizedDescription, error: true); return false }
    }

    private func save(code: String, token: String) {
        defaults.set(code, forKey: "sono-host-code")
        defaults.set(token, forKey: "sono-host-\(code)")
        defaults.set(code, forKey: "sono-last-host-code")
    }

    private func reset() {
        queue = []; current = nil; previous = nil; history = []; fallbackQueue = nil; activity = []; playing = false
        knownRequests = nil; knownGuests = nil; joinNotices = []; progress = Progress()
    }

    private func enterHost() {
        phase = .host
        driver.follow(code: session.code, token: token)
        updateCarInvite()
        startPolling()
        startSyncingApps()
        pushTheme()
    }

    private func leaveHost() {
        driver.follow(code: nil, token: nil)
        driver.setInviteAddress(nil, shown: false)
        pollTask?.cancel(); syncTask?.cancel()
        token = nil
        reset()
        phase = .home
    }

    // MARK: État reçu

    func apply(_ payload: Payload) {
        if let incoming = payload.session, incoming != session { session = incoming; noticeArrivals() }
        if let incoming = payload.queue, incoming != queue { queue = incoming }
        if payload.hasCurrent, payload.current != current {
            current = payload.current
            if let cover = current?.cover, !cover.isEmpty { defaults.set(cover, forKey: "sono-last-cover") }
        }
        if let value = payload.playing, value != playing { playing = value }
        if let incoming = payload.activity, incoming != activity { activity = incoming }
        if payload.hasFallbackQueue, payload.fallbackQueue != fallbackQueue { fallbackQueue = payload.fallbackQueue }
        if payload.hasPrevious, payload.previous != previous { previous = payload.previous }
        if let incoming = payload.history { history = incoming }
    }

    private func applyBroadcast(_ payload: Payload) {
        guard pendingChanges > 0 || releaseTask != nil else { apply(payload); return }
        // Pendant un changement affiché d’avance : la lecture et la file attendent, le reste suit tout de suite.
        held = payload
        var rest = payload
        rest.queue = nil; rest.hasCurrent = false; rest.hasPrevious = false; rest.history = nil; rest.playing = nil; rest.hasFallbackQueue = false
        if var incoming = rest.session { incoming.fallback?.next = session.fallback?.next; rest.session = incoming }
        apply(rest)
    }

    private func beginChange() { pendingChanges += 1; releaseTask?.cancel(); releaseTask = nil }
    private func endChange() {
        pendingChanges = max(0, pendingChanges - 1)
        guard pendingChanges == 0 else { return }
        releaseTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(500))
            guard let self, !Task.isCancelled else { return }
            self.releaseTask = nil
            if let held = self.held { self.held = nil; self.apply(held) }
        }
    }

    /// Nouveaux arrivants : demandes à valider (message) et invités entrés librement (bandeau).
    private func noticeArrivals() {
        let requests = session.requests ?? []
        let ids = Set(requests.map(\.id))
        if let known = knownRequests {
            let fresh = requests.filter { !known.contains($0.id) }
            if fresh.count == 1 { notify(L("{0} demande à rejoindre la session.", fresh[0].name)) }
            else if fresh.count > 1 { notify(L("{0} personnes demandent à rejoindre la session.", fresh.count)) }
            if !fresh.isEmpty { UINotificationFeedbackGenerator().notificationOccurred(.success) }
        }
        knownRequests = ids
        let guests = (session.participants ?? []).filter { !$0.isHost }
        if let known = knownGuests, known.code == session.code, session.requireApproval != true {
            let fresh = guests.filter { !known.ids.contains($0.id) }
            if !fresh.isEmpty {
                joinNotices = joinNotices.filter { notice in !fresh.contains { $0.id == notice.id } } + fresh.map { JoinNotice(id: $0.id, name: $0.name, at: Date()) }
                let ids = fresh.map(\.id)
                Task { [weak self] in
                    try? await Task.sleep(for: .seconds(15))
                    self?.joinNotices.removeAll { ids.contains($0.id) }
                }
            }
        }
        knownGuests = (session.code, Set(guests.map(\.id)))
    }

    // MARK: Messages

    func notify(_ message: String, error: Bool = false) {
        toast = Toast(message: message, isError: error)
        toastTask?.cancel()
        toastTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(error ? 5.5 : 3.5))
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.25)) { self?.toast = nil }
        }
    }

    // MARK: Lecture

    var nextUp: Track? { queue.first ?? session.fallback?.next }
    var inviteURL: String { server.appending(path: session.code.replacingOccurrences(of: "SONO-", with: "")).absoluteString }
    var joinURL: String { server.appending(path: "rejoindre").absoluteString }

    private func perform(_ path: String, method: String = "POST", body: [String: Any]? = nil) async throws {
        apply(try await api.payload(path, method: method, token: token, body: body))
    }

    func togglePlayback() {
        guard current != nil else { skip(.next); return }
        // Pause pendant un enchaînement de titres : le titre choisi part d’abord, puis la pause.
        if skipActive { skipThenToggle = true; skipTask?.cancel(); Task { await flushSkips() }; return }
        let wanted = !playing
        playing = wanted
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        beginChange()
        Task {
            await driver.setPlaying(wanted)
            do { try await perform("/api/sessions/\(session.code)/playback", body: ["action": "toggle"]) }
            catch { notify(error.localizedDescription, error: true); await refresh() }
            endChange()
        }
    }

    enum Direction { case next, previous }

    /// L’écran avance à chaque appui ; le moteur et le service ne reçoivent qu’une commande, une fois le choix arrêté.
    func skip(_ direction: Direction) {
        guard let track = direction == .next ? nextUp : previous else { return }
        showSkip(direction, track)
        skipDelta += direction == .next ? 1 : -1
        if !skipActive {
            skipActive = true
            skipWasPlaying = playing
            beginChange()
            if current != nil { Task { await driver.holdForSkip() } }
        }
        skipTask?.cancel()
        let delay = current == nil ? 0 : 250
        skipTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(delay))
            guard !Task.isCancelled else { return }
            await self?.flushSkips()
        }
    }

    private func showSkip(_ direction: Direction, _ track: Track) {
        if direction == .next {
            queue.removeAll { $0.id == track.id }
            if track.isFallback, var fallback = fallbackQueue {
                fallback.tracks.removeAll { $0.id == track.id }
                fallback.total = max(0, fallback.total - 1)
                fallbackQueue = fallback
                session.fallback?.next = fallback.tracks.first
            }
            if let current { history.insert(current, at: 0); previous = current }
        } else {
            if let current, current.isFallback, var fallback = fallbackQueue, let index = current.fallbackIndex {
                var back = current
                back.id = "fond-\(index)"
                fallback.tracks.insert(back, at: 0)
                fallback.total += 1
                fallbackQueue = fallback
                session.fallback?.next = back
            } else if let current { queue.insert(current, at: 0) }
            if !history.isEmpty { history.removeFirst() }
            previous = history.first
        }
        current = track
        playing = true
        progress = Progress(positionMs: 0, durationMs: track.durationMillis, at: Date(), running: false)
        watchUntil = Date().addingTimeInterval(5)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }

    private func flushSkips() async {
        guard !skipSending else { return }
        let delta = skipDelta
        skipDelta = 0
        skipSending = true
        do {
            if delta != 0 {
                if let current { Task { await driver.playNow(current.dictionary, nextProviderId: nextUp?.provider) } }
                let payload = try await api.payload("/api/sessions/\(session.code)/playback", method: "POST", token: token, body: ["action": delta > 0 ? "next" : "previous", "count": abs(delta)])
                if skipDelta == 0 { apply(payload) }
            } else {
                // Retour au titre de départ : il repart où il en était (ou reste en pause).
                await driver.playNow(skipWasPlaying ? current?.dictionary : nil, nextProviderId: nextUp?.provider)
                let payload = try await api.payload("/api/sessions/\(session.code)", token: token)
                if skipDelta == 0 { apply(payload) }
            }
        } catch {
            skipDelta = 0
            skipThenToggle = false
            await driver.playNow(nil, nextProviderId: nil)
            notify(error.localizedDescription, error: true)
            await refresh()
        }
        skipSending = false
        if skipDelta != 0 { await flushSkips(); return }
        skipActive = false
        endChange()
        if skipThenToggle { skipThenToggle = false; togglePlayback() }
    }

    /// Fondu enchaîné : le téléphone prévient dès que le titre suivant domine.
    private func advance(ms: Int) {
        guard let next = nextUp else { return }
        beginChange()
        showSkip(.next, next)
        progress = Progress(positionMs: ms, durationMs: next.durationMillis, at: Date(), running: true)
        Task { try? await Task.sleep(for: .milliseconds(1500)); endChange() }
    }

    func seek(to ms: Int) {
        progress = Progress(positionMs: ms, durationMs: progress.durationMs, at: Date(), running: progress.running)
        Task {
            // Titre terminé : un appui sur la barre le relance, puis va à l’endroit choisi.
            if !playing, current != nil, status.state == "stopped" { togglePlayback() }
            await driver.seek(ms: ms)
        }
    }

    func refresh() async {
        guard let payload = try? await api.payload("/api/sessions/\(session.code)", token: token) else { return }
        apply(payload)
    }

    /// Relevé du moteur : chaque seconde, et plus souvent juste après un changement de titre.
    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                let raw = await self.driver.statusForPage()
                let status = PlayerStatus(raw)
                if status != self.status { self.status = status }
                if let current = self.current, !self.skipActive {
                    let stale = status.trackId != nil && current.source == self.session.source && status.trackId != current.provider
                    if !stale, status.durationMs > 0 || status.positionMs > 0 {
                        let next = Progress(positionMs: status.positionMs, durationMs: status.durationMs, at: Date(), running: !["loading", "stopped"].contains(status.state.lowercased()) && self.playing)
                        if abs(next.position(at: Date()) - self.progress.position(at: Date())) > 400 || next.running != self.progress.running || next.durationMs != self.progress.durationMs { self.progress = next }
                    }
                }
                try? await Task.sleep(for: .milliseconds(Date() < self.watchUntil ? 200 : 1000))
            }
        }
    }

    /// Les apps connectées sur ce téléphone : une seule devient l’app de lecture.
    private func startSyncingApps() {
        syncTask?.cancel()
        syncTask = Task { [weak self] in
            while !Task.isCancelled {
                // Tant que les comptes ne sont pas vérifiés, on n’annonce pas à la session qu’aucune app n’est connectée.
                if self?.connectionsChecked == true { await self?.syncApps() }
                try? await Task.sleep(for: .seconds(10))
            }
        }
    }

    func syncApps() async {
        let status = PlayerStatus(await driver.statusForPage())
        self.status = status
        let apps = [status.appleConnected ? "Apple Music" : nil, status.deezerConnected ? "Deezer" : nil].compactMap { $0 }
        var update: [String: Any] = [:]
        if apps != (session.apps ?? []) { update["apps"] = apps }
        if apps.count == 1, apps[0] != session.source { update["playbackSource"] = apps[0] }
        guard !update.isEmpty else { return }
        try? await perform("/api/sessions/\(session.code)", method: "PATCH", body: update)
    }

    // MARK: File d’attente

    func add(_ track: Track) async -> Bool {
        do {
            try await perform("/api/sessions/\(session.code)/tracks", body: ["track": track.dictionary, "addedBy": session.host])
            notify(L("« {0} » a rejoint la file.", track.title))
            return true
        } catch { notify(error.localizedDescription, error: true); return false }
    }

    func remove(_ track: Track) {
        queue.removeAll { $0.id == track.id }
        Task {
            do {
                try await perform("/api/sessions/\(session.code)/tracks/\(track.id)", method: "DELETE")
                notify(L("« {0} » a été retiré de la file.", track.title))
            } catch { notify(error.localizedDescription, error: true); await refresh() }
        }
    }

    func move(from source: IndexSet, to destination: Int) {
        var items = queue
        items.move(fromOffsets: source, toOffset: destination)
        guard items != queue else { return }
        queue = items
        beginChange()
        Task {
            do { try await perform("/api/sessions/\(session.code)/queue", method: "PATCH", body: ["ids": items.map(\.id)]) }
            catch { notify(error.localizedDescription, error: true); await refresh() }
            endChange()
        }
    }

    // MARK: Musique de fond

    func chooseFallback(_ item: CatalogItem) async -> Bool {
        do {
            var body: [String: Any] = ["type": item.type, "id": item.rawId.value, "name": item.name, "subtitle": item.subtitle ?? "", "cover": item.cover ?? "", "source": session.source ?? "Deezer"]
            if item.type == "library" { body["type"] = "playlist" }
            try await perform("/api/sessions/\(session.code)/fallback", method: "PUT", body: body)
            notify(L("« {0} » prendra le relais quand la file sera vide.", item.name))
            return true
        } catch { notify(error.localizedDescription, error: true); return false }
    }

    func clearFallback() {
        Task {
            do { try await perform("/api/sessions/\(session.code)/fallback", method: "DELETE"); notify(L("La musique de fond est désactivée.")) }
            catch { notify(error.localizedDescription, error: true) }
        }
    }

    func skipFallback(_ track: Track) {
        guard let index = track.fallbackIndex else { return }
        if var fallback = fallbackQueue {
            fallback.tracks.removeAll { $0.id == track.id }
            fallback.total = max(0, fallback.total - 1)
            fallbackQueue = fallback
            session.fallback?.next = fallback.tracks.first
        }
        Task {
            do { try await perform("/api/sessions/\(session.code)/fallback/tracks/\(index)", method: "DELETE"); notify(L("« {0} » ne passera pas.", track.title)) }
            catch { notify(error.localizedDescription, error: true) }
        }
    }

    func moveFallback(from source: IndexSet, to destination: Int) {
        guard var fallback = fallbackQueue, let from = source.first else { return }
        let track = fallback.tracks[from]
        fallback.tracks.move(fromOffsets: source, toOffset: destination)
        guard let to = fallback.tracks.firstIndex(of: track), let index = track.fallbackIndex, to != from else { return }
        fallbackQueue = fallback
        session.fallback?.next = fallback.tracks.first
        beginChange()
        Task {
            do { try await perform("/api/sessions/\(session.code)/fallback/order", method: "PATCH", body: ["index": index, "to": to]) }
            catch { notify(error.localizedDescription, error: true); await refresh() }
            endChange()
        }
    }

    func catalogSearch(_ query: String) async throws -> CatalogResults {
        let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        let source = (session.source ?? "Deezer").addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        return try JSONDecoder().decode(CatalogResults.self, from: try await api.request("/api/sessions/\(session.code)/catalog/search?q=\(q)&source=\(source)", token: token))
    }

    func myPlaylists() async -> [CatalogItem] {
        guard session.source != "Apple Music", let user = status.deezerUserId else { return [] }
        guard let data = try? await api.request("/api/sessions/\(session.code)/catalog/mine?user=\(user)", token: token) else { return [] }
        return (try? JSONDecoder().decode(CatalogResults.self, from: data))?.playlists ?? []
    }

    // MARK: Recherche de titres

    func searchTracks(_ query: String) async throws -> [Track] {
        let q = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        if session.source == "Apple Music" {
            // L’API publique d’iTunes, directement depuis le téléphone (Apple limite les demandes venant des serveurs).
            if let url = URL(string: "https://itunes.apple.com/search?term=\(q)&entity=song&country=fr&limit=25"),
               let (data, _) = try? await URLSession.shared.data(from: url),
               let results = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["results"] as? [[String: Any]] {
                return results.compactMap { item in
                    guard let id = item["trackId"] else { return nil }
                    let ms = (item["trackTimeMillis"] as? NSNumber)?.doubleValue ?? 0
                    return Track(id: "\(id)", providerId: LooseString("\(id)"), title: item["trackName"] as? String ?? "", artist: item["artistName"] as? String ?? L("Artiste inconnu"), album: item["collectionName"] as? String, durationMs: ms, cover: (item["artworkUrl100"] as? String)?.replacingOccurrences(of: "100x100bb", with: "400x400bb"), source: "Apple Music")
                }
            }
        }
        let data = try await api.request("/api/integrations/opendeezer/search?q=\(q)")
        let items = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["data"] as? [[String: Any]] ?? []
        return items.compactMap { item in
            guard let id = item["id"] else { return nil }
            let album = item["album"] as? [String: Any]
            let artist = (item["artist"] as? [String: Any])?["name"] as? String ?? L("Artiste inconnu")
            let seconds = (item["duration"] as? NSNumber)?.doubleValue ?? 0
            return Track(id: "\(id)", providerId: LooseString("\(id)"), title: item["title"] as? String ?? "", artist: artist, album: album?["title"] as? String, durationMs: seconds * 1000, cover: album?["cover_xl"] as? String ?? album?["cover"] as? String, source: "Deezer")
        }
    }

    // MARK: Invités

    func decide(_ request: JoinRequest, accept: Bool) {
        Task {
            do {
                try await perform("/api/sessions/\(session.code)/admissions", body: ["id": request.id, "decision": accept ? "accept" : "refuse"])
                notify(accept ? L("{0} a rejoint la session.", request.name) : L("La demande de {0} a été refusée.", request.name))
            } catch { notify(error.localizedDescription, error: true) }
        }
    }

    func removeMember(_ person: Participant) {
        joinNotices.removeAll { $0.id == person.id }
        Task {
            do { try await perform("/api/sessions/\(session.code)/members/\(person.id)", method: "DELETE"); notify(L("{0} a été retiré de la session.", person.name)) }
            catch { notify(error.localizedDescription, error: true) }
        }
    }

    func setAdmin(_ person: Participant, _ admin: Bool) {
        Task {
            do {
                try await perform("/api/sessions/\(session.code)/admins", method: "PATCH", body: ["id": person.id, "admin": admin])
                notify(admin ? L("{0} est maintenant admin.", person.name) : L("{0} n’est plus admin.", person.name))
            } catch { notify(error.localizedDescription, error: true) }
        }
    }

    // MARK: Réglages

    @discardableResult
    func saveSettings(_ changes: [String: Any], message: String) async -> Bool {
        do { try await perform("/api/sessions/\(session.code)", method: "PATCH", body: changes); notify(message); return true }
        catch { notify(error.localizedDescription, error: true); return false }
    }

    func setSource(_ source: String, message: String? = nil) async {
        do {
            try await perform("/api/sessions/\(session.code)", method: "PATCH", body: ["playbackSource": source])
            if let message { notify(message) }
        } catch { notify(error.localizedDescription, error: true) }
    }

    func loadSound() async -> Sound? {
        guard let data = try? await api.request("/api/sound?code=\(session.code)", token: token) else { return nil }
        struct Reply: Decodable { let sound: Sound }
        return (try? JSONDecoder().decode(Reply.self, from: data))?.sound
    }

    func saveSound(_ sound: Sound) async {
        do {
            _ = try await api.request("/api/sound", method: "PUT", token: token, body: ["code": session.code, "sound": ["bass": sound.bass, "mid": sound.mid, "treble": sound.treble]])
            await driver.applySound()
        } catch { notify(error.localizedDescription, error: true) }
    }

    func deleteSession() async {
        let code = session.code
        do {
            _ = try await api.request("/api/sessions/\(code)", method: "DELETE", token: token)
            defaults.removeObject(forKey: "sono-host-\(code)")
            defaults.removeObject(forKey: "sono-host-code")
            if defaults.string(forKey: "sono-last-host-code") == code { defaults.removeObject(forKey: "sono-last-host-code") }
            let name = session.name
            leaveHost()
            notify(L("La session « {0} » a été supprimée.", name))
        } catch { notify(error.localizedDescription, error: true) }
    }

    func copyInvite() {
        UIPasteboard.general.string = inviteURL
        notify(L("Lien d’invitation copié."))
    }

    // MARK: Apparence

    func setLanguage(_ value: String) {
        guard value == "fr" || value == "en", value != language else { return }
        Lang.current = value
        UserDefaults.standard.set(value, forKey: Lang.key)
        language = value
        pushTheme()
    }

    func updateAppearance(_ change: (inout Appearance) -> Void) {
        var next = appearance
        change(&next)
        guard next != appearance else { return }
        appearance = next
        next.save()
        pushTheme()
    }

    /// Les invités voient les couleurs choisies par l’hôte.
    private func pushTheme() {
        guard phase == .host, token != nil else { return }
        let theme = SessionTheme(background: appearance.background, accent: appearance.accent, glass: appearance.glass, lang: language)
        guard theme != session.theme else { return }
        Task { try? await perform("/api/sessions/\(session.code)", method: "PATCH", body: ["theme": ["background": appearance.background, "accent": appearance.accent, "glass": appearance.glass, "lang": language]]) }
    }

    // MARK: Écran de la voiture

    func setCarInvite(_ on: Bool) {
        carInvite = on
        defaults.set(on, forKey: "sono-car-invite")
        updateCarInvite()
    }

    private func updateCarInvite() {
        guard phase == .host else { return }
        driver.setInviteAddress(inviteURL, shown: carInvite)
    }

    // MARK: Connexions

    func connect(_ service: String) async throws {
        if service == "Apple Music" {
            try await driver.connectApple()
        } else {
            guard let presenter = UIApplication.shared.topViewController else { return }
            let arl = try await DeezerLogin.present(from: presenter)
            _ = try await driver.connect(arl: arl)
        }
        await setSource(service, message: L("{0} est connecté : la musique sort de ce téléphone.", service))
        await syncApps()
    }

    func disconnect(_ service: String) async {
        if service == "Apple Music" { driver.disconnectApple() } else { await driver.disconnect() }
        // L’app de musique est déconnectée : la session repart de zéro (lecture, file, historique, musique de fond).
        try? await perform("/api/sessions/\(session.code)/reset")
        progress = Progress()
        if session.source == service { await setSource(service == "Deezer" ? "Apple Music" : "Deezer") }
        await syncApps()
        notify(L("{0} a été déconnecté.", service))
    }
}

/// État du moteur de lecture et des comptes connectés.
struct PlayerStatus: Equatable {
    var state = "stopped"
    var trackId: String?
    var positionMs = 0
    var durationMs = 0
    var deezerConnected = false
    var appleConnected = false
    var deezerAccount: String?
    var deezerUserId: String?

    init() {}
    init(_ raw: [String: Any]) {
        state = (raw["state"] as? String ?? "stopped").lowercased()
        trackId = raw["trackId"] as? String
        positionMs = (raw["positionMs"] as? NSNumber)?.intValue ?? 0
        durationMs = (raw["durationMs"] as? NSNumber)?.intValue ?? 0
        let deezer = raw["deezer"] as? [String: Any]
        deezerConnected = deezer?["connected"] as? Bool ?? false
        let account = deezer?["account"] as? [String: Any]
        deezerAccount = account?["name"] as? String
        deezerUserId = (account?["userId"]).map { "\($0)" }
        appleConnected = (raw["apple"] as? [String: Any])?["connected"] as? Bool ?? false
    }
}

extension UIApplication {
    /// Écran affiché au premier plan (pour y présenter la connexion Deezer).
    var topViewController: UIViewController? {
        let scene = connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive } ?? connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var top = scene?.windows.first { $0.isKeyWindow }?.rootViewController ?? scene?.windows.first?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}
