import AVFoundation
import CoreImage
import MediaPlayer
import UIKit

/// Fait jouer au moteur ce que dit la session, y compris écran verrouillé (la page web, elle, y est suspendue) :
/// les commandes de l’hôte, d’un admin ou de l’écran verrouillé passent par le service en ligne, le téléphone suit.
@MainActor
final class Driver {
    private struct Track: Equatable { let id, providerId, title, artist, album, cover, source: String; let durationMs: Int }
    private let server: URL
    private let engine = Engine()
    private let apple = AppleMusicPlayer()
    private var source = "Deezer"
    private var useApple: Bool { source == "Apple Music" }
    private var wantResume = false
    private var resolved: [String: String] = [:]
    private var code: String?
    private var token: String?
    private var socket: URLSessionWebSocketTask?
    private var current: Track?
    private var nextProviderId: String?
    private var playing = false
    private var commandedId: String?
    private var preloadId: String?
    private var seenPlaying = false
    private var lastPlayAt = Date.distantPast
    private var busy = false
    private var lastStatus: [String: Any] = [:]
    private var tick: Timer?
    private var ping: Timer?
    private var lastSavedSlice = -1
    private var lastNowPlayingKey = ""
    private var lastNowPlayingAt = Date.distantPast
    private var artworkKey = ""
    private var rerun = false
    private var holdUntil: Date?
    /// Fondu enchaîné en cours : le titre suivant s’entend déjà, le moteur ne l’a pas encore pris comme titre courant.
    private var crossfadeTo: String?
    private var crossfadeDeadline = Date.distantPast
    private var nearEndId: String?
    var onAdvance: ((Int) -> Void)?
    /// Chaque état de la session reçu (diffusion ou réponse) : l’interface s’en sert aussi, sans ouvrir une deuxième connexion.
    var onPayload: (([String: Any]) -> Void)?
    /// La connexion temps réel est ouverte (sinon l’interface affiche « Reconnexion… »).
    var onLive: ((Bool) -> Void)?
    private var nextRaw: Any?
    private var previousRaw: Any?
    private var lastPlayId: String?
    private var lastPayload: [String: Any]?
    /// Commande donnée sur ce téléphone : la session la confirmera, une diffusion plus ancienne ne doit pas l’annuler.
    private var localUntil: Date?
    private var artworkTries = 0
    private var lastStatusAt = Date.distantPast
    private var artwork: MPMediaItemArtwork?
    /// QR code d’invitation à la place de la pochette : CarPlay et l’écran verrouillé l’affichent en grand.
    private var inviteArtwork: MPMediaItemArtwork?
    private var inviteAddress: String?
    var onCarChange: (() -> Void)?
    var onInviteShown: ((Bool) -> Void)?
    private var lastCarState = ""

    init(server: URL) {
        self.server = server
        setUpRemoteCommands()
        NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { note in
            let ended = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.ended.rawValue
            if ended { try? AVAudioSession.sharedInstance().setActive(true) }
        }
    }

    // MARK: Compte Deezer

    /// Relance le moteur Deezer avec le compte gardé, et attend qu’il ait répondu (connecté ou non).
    func startSavedEngineAndWait() async {
        guard let arl = AccountStore.arl, !engine.isRunning else { return }
        _ = try? await connect(arl: arl)
    }

    func connect(arl: String) async throws -> [String: Any] {
        if !engine.isRunning {
            try await engine.start(arl: arl)
            let audio = AVAudioSession.sharedInstance()
            try? audio.setCategory(.playback)
            try? audio.setActive(true)
        }
        AccountStore.arl = arl
        await applySound()
        startTicking()
        return engine.account
    }

    func disconnect() async {
        AccountStore.arl = nil
        engine.stop()
        commandedId = nil
        preloadId = nil
        lastStatus = [:]
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        artworkKey = ""
        artwork = nil
    }

    func connectApple() async throws {
        try await apple.connect()
        startTicking()
    }

    func disconnectApple() {
        apple.disconnect()
        commandedId = nil
    }

    func statusForPage() async -> [String: Any] {
        var result: [String: Any] = [
            "deezer": ["connected": engine.isRunning, "account": engine.account],
            "apple": ["connected": apple.isConnected],
            "connected": useApple ? apple.isConnected : engine.isRunning,
            "state": "stopped", "positionMs": 0, "durationMs": 0,
        ]
        if useApple {
            let status = apple.status()
            result["state"] = status.state; result["positionMs"] = status.positionMs; result["durationMs"] = status.durationMs; result["trackId"] = status.trackId
        } else if engine.isRunning {
            // Le relevé de la seconde en cours suffit : la page ne refait pas un appel au moteur en plus.
            let status = Date().timeIntervalSince(lastStatusAt) < 0.2 ? lastStatus : (try? await engine.request("/status", method: "GET")) ?? lastStatus
            result["trackId"] = (status["track"] as? [String: Any])?["id"].map { "\($0)" }
            result["state"] = status["state"] ?? "stopped"; result["positionMs"] = status["positionMs"] ?? 0; result["durationMs"] = status["durationMs"] ?? 0
        }
        return result
    }

    // MARK: Session suivie

    func follow(code: String?, token: String?) {
        guard code != self.code || token != self.token else { return }
        self.code = code
        self.token = token
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
        current = nil
        playing = false
        if code != nil { openSocket(); startTicking(); Task { await applySound() } }
        else { Task { await reconcile() } }
    }

    private func openSocket() {
        guard let code, let token, var parts = URLComponents(url: server, resolvingAgainstBaseURL: false) else { return }
        parts.scheme = server.scheme == "https" ? "wss" : "ws"
        parts.path = "/ws"
        parts.queryItems = [URLQueryItem(name: "session", value: code)]
        guard let url = parts.url else { return }
        let task = URLSession.shared.webSocketTask(with: url)
        socket = task
        task.resume()
        let hello = try? JSONSerialization.data(withJSONObject: ["type": "hello", "clientId": "iphone-\(code)", "hostToken": token])
        task.send(.string(String(decoding: hello ?? Data(), as: UTF8.self))) { _ in }
        receive(on: task)
        ping?.invalidate()
        ping = Timer.scheduledTimer(withTimeInterval: 25, repeats: true) { [weak task] _ in task?.sendPing { _ in } }
    }

    private func receive(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, task === self.socket else { return }
                switch result {
                case .success(.string(let text)):
                    self.onLive?(true)
                    if let json = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] { self.apply(json); self.onPayload?(json) }
                    self.receive(on: task)
                case .success: self.receive(on: task)
                case .failure:
                    self.socket = nil
                    self.onLive?(false)
                    try? await Task.sleep(for: .seconds(2.5))
                    if self.code != nil && self.socket == nil { self.openSocket() }
                }
            }
        }
    }

    private func track(from value: Any?) -> Track? {
        guard let item = value as? [String: Any], let providerId = item["providerId"].map({ "\($0)" }), !providerId.isEmpty else { return nil }
        return Track(id: "\(item["id"] ?? providerId)", providerId: providerId, title: item["title"] as? String ?? "", artist: item["artist"] as? String ?? "", album: item["album"] as? String ?? "", cover: item["cover"] as? String ?? "", source: item["source"] as? String ?? "", durationMs: item["durationMs"] as? Int ?? 0)
    }

    private func apply(_ payload: [String: Any]) {
        guard payload["current"] != nil || payload["playing"] != nil else { return }
        lastPayload = payload
        nextRaw = (payload["queue"] as? [Any])?.first ?? ((payload["session"] as? [String: Any])?["fallback"] as? [String: Any])?["next"]
        previousRaw = payload["previous"]
        let incoming = track(from: payload["current"])
        let wanted = payload["playing"] as? Bool ?? false
        // La session a rattrapé la commande locale : plus besoin de la protéger.
        if localUntil != nil, incoming?.providerId == current?.providerId, wanted == playing { localUntil = nil }
        if localUntil == nil {
            current = incoming
            if wanted && !playing { wantResume = true }
            playing = wanted
        }
        let newSource = (payload["session"] as? [String: Any])?["source"] as? String ?? source
        if newSource != source { switchSource(to: newSource) }
        let queue = payload["queue"] as? [Any] ?? []
        let fallback = (payload["session"] as? [String: Any])?["fallback"] as? [String: Any]
        nextProviderId = track(from: queue.first ?? fallback?["next"])?.providerId
        notifyCar()
        Task { await reconcile() }
    }

    // MARK: Le moteur suit la session

    private func startTicking() {
        guard tick == nil else { return }
        // Une marge laissée au système (moins de réveils, moins de batterie) ; en pause ou hors session, un relevé toutes les 3 s suffit :
        // les commandes et les changements de session arrivent, eux, sans attendre ce relevé.
        var count = 0
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
            count += 1
            Task { @MainActor in
                guard let self, self.playing || count % 3 == 0 else { return }
                await self.reconcile()
            }
        }
        timer.tolerance = 0.2
        RunLoop.main.add(timer, forMode: .common)
        tick = timer
    }

    private func switchSource(to newSource: String) {
        if useApple { apple.deactivate() } else if engine.isRunning { Task { [engine] in if ((try? await engine.request("/status", method: "GET"))?["state"] as? String)?.lowercased() == "playing" { try? await engine.request("/playpause") } } }
        source = newSource
        commandedId = nil
        preloadId = nil
        seenPlaying = false
        if useApple && apple.isConnected { apple.activate() }
        if !useApple, engine.isRunning { let audio = AVAudioSession.sharedInstance(); try? audio.setCategory(.playback); try? audio.setActive(true) }
    }

    private func playerStatus() async -> (state: String, trackId: String?, positionMs: Int, durationMs: Int)? {
        if useApple { return apple.isConnected ? apple.status() : nil }
        guard engine.isRunning, let status = try? await engine.request("/status", method: "GET") else { return nil }
        lastStatus = status
        lastStatusAt = Date()
        return ((status["state"] as? String ?? "").lowercased(), (status["track"] as? [String: Any])?["id"].map { "\($0)" }, (status["positionMs"] as? NSNumber)?.intValue ?? 0, (status["durationMs"] as? NSNumber)?.intValue ?? 0)
    }

    private func pausePlayer() async { if useApple { apple.pause() } else { try? await engine.request("/pause") } }
    private func resumePlayer() async { if useApple { apple.resume() } else { try? await engine.request("/resume") } }

    /// Identifiant du titre sur l’app de lecture : un titre proposé depuis l’autre app y est recherché.
    private func playableId(_ track: Track) async -> String? {
        if track.source == source { return track.providerId }
        if let known = resolved[track.id] { return known }
        var parts = URLComponents(string: useApple ? "https://itunes.apple.com/search" : server.appending(path: "api/integrations/opendeezer/search").absoluteString)
        parts?.queryItems = useApple
            ? [URLQueryItem(name: "term", value: "\(track.title) \(track.artist)"), URLQueryItem(name: "entity", value: "song"), URLQueryItem(name: "country", value: "fr"), URLQueryItem(name: "limit", value: "5")]
            : [URLQueryItem(name: "q", value: "\(track.title) \(track.artist)")]
        guard let url = parts?.url, let (data, _) = try? await URLSession.shared.data(from: url),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        let list = (json[useApple ? "results" : "data"] as? [[String: Any]]) ?? []
        let found = (list.first?[useApple ? "trackId" : "id"]).map { "\($0)" }
        if let found { resolved[track.id] = found }
        return found
    }

    private func reconcile() async {
        // Changement de titre en cours de choix : le son est coupé, on attend le titre retenu.
        if let holdUntil, Date() < holdUntil { return }
        // Déjà occupé : on repasse juste après, sans attendre le prochain relevé.
        guard !busy else { rerun = true; return }
        if let until = localUntil, Date() >= until, let lastPayload {
            localUntil = nil
            apply(lastPayload)
        }
        busy = true
        defer {
            busy = false
            if rerun { rerun = false; Task { await reconcile() } }
        }
        guard let status = await playerStatus() else { return }
        let state = status.state
        let engineId = status.trackId
        guard let current else {
            if state == "playing" { await pausePlayer() }
            return
        }
        if let target = crossfadeTo {
            if engineId == target {
                commandedId = target
                preloadId = nil
                crossfadeTo = nil
                seenPlaying = true
                lastNowPlayingKey = ""
            } else if Date() > crossfadeDeadline {
                crossfadeTo = nil
            }
        }
        // Le moteur est passé seul au titre préchargé : la session avance sans relancer la lecture.
        if let engineId, engineId != commandedId, engineId == preloadId {
            commandedId = engineId
            preloadId = nil
            seenPlaying = true
            onAdvance?(0)
            await sendPlayback(nextProviderId == nil ? "ended" : "next", expected: current.id)
            return
        }
        guard playing else {
            if state == "playing" { await pausePlayer() }
            updateNowPlaying(status)
            return
        }
        guard let playId = await playableId(current) else { return }
        if let target = crossfadeTo {
            // Pendant le fondu, le moteur finit l’ancien titre tout seul : surtout ne pas couper en relançant.
            if target == playId { updateNowPlaying(status); return }
            crossfadeTo = nil
        }
        if commandedId != playId || engineId != playId {
            await play(current, id: playId)
            return
        }
        switch state {
        case "playing":
            seenPlaying = true
            wantResume = false
            if status.positionMs / 5000 != lastSavedSlice {
                lastSavedSlice = status.positionMs / 5000
                UserDefaults.standard.set(["id": current.id, "ms": status.positionMs], forKey: "sono-position")
            }
            await preloadNext()
            startCrossfadeIfNear(status, current)
        case "paused":
            if wantResume || !useApple {
                wantResume = false
                await resumePlayer()
            } else {
                // Pause demandée depuis l’écran verrouillé ou le casque : la session suit.
                await sendPlayback("toggle")
            }
        default:
            guard Date().timeIntervalSince(lastPlayAt) > 3 else { break }
            if seenPlaying {
                seenPlaying = false
                await sendPlayback(nextProviderId == nil ? "ended" : "next", expected: current.id)
            } else {
                await play(current, id: playId)
            }
        }
        updateNowPlaying(status)
    }

    private func play(_ track: Track, id: String) async {
        guard id != lastPlayId || Date().timeIntervalSince(lastPlayAt) > 1 else { return }
        lastPlayAt = Date()
        lastPlayId = id
        // Sono relancé en cours de titre : reprise à la dernière position connue.
        let saved = UserDefaults.standard.dictionary(forKey: "sono-position")
        let resumeAt = commandedId == nil && saved?["id"] as? String == track.id ? (saved?["ms"] as? Int ?? 0) : 0
        seenPlaying = false
        wantResume = false
        preloadId = nil
        do {
            if useApple {
                apple.activate()
                try await apple.play(id: id)
            } else {
                try await engine.request("/play/track?id=\(id)")
            }
            commandedId = id
            if resumeAt > 3000 && (track.durationMs == 0 || resumeAt < track.durationMs - 8000) { await seek(ms: resumeAt) }
        } catch {
            // Titre refusé pour ce compte : on passe au suivant.
            let refused = useApple || error.localizedDescription.range(of: "2002|no full-length|sufficient rights|preview only", options: [.regularExpression, .caseInsensitive]) != nil
            if refused { await sendPlayback(nextProviderId == nil ? "ended" : "next", expected: track.id) }
        }
    }

    /// Le fondu dure 3 s. À 2 s de la fin, le nouveau titre domine : l’affichage et l’écran verrouillé changent sans attendre le moteur.
    private func startCrossfadeIfNear(_ status: (state: String, trackId: String?, positionMs: Int, durationMs: Int), _ playingTrack: Track) {
        guard !useApple, status.durationMs > 0, let preloadId, preloadId == nextProviderId,
              "\(lastStatus["preloaded"] ?? "")" == preloadId, let next = track(from: nextRaw), next.providerId == preloadId else { return }
        let remaining = status.durationMs - status.positionMs
        if remaining > 2000 {
            // Le relevé n’arrive qu’une fois par seconde : on se réveille pile au bon moment.
            if remaining < 3200, nearEndId != playingTrack.providerId {
                nearEndId = playingTrack.providerId
                Task { [weak self] in
                    try? await Task.sleep(for: .milliseconds(remaining - 2000))
                    await self?.reconcile()
                }
            }
            return
        }
        crossfadeTo = preloadId
        crossfadeDeadline = Date().addingTimeInterval(6)
        current = next
        localUntil = Date().addingTimeInterval(3)
        onAdvance?(max(0, 3000 - remaining))
        Task { [weak self] in await self?.sendPlayback("next", expected: playingTrack.id) }
    }

    private func preloadNext() async {
        // Apple Music joue un titre à la fois ; seul le moteur Deezer précharge.
        guard !useApple, let nextProviderId, nextProviderId != preloadId else { return }
        preloadId = nextProviderId
        // En arrière-plan : préparer le titre suivant ne doit pas retarder une pause ou un changement.
        Task { [engine] in try? await engine.request("/preload/track?id=\(nextProviderId)") }
    }

    /// Changement de titre décidé sur ce téléphone : le moteur démarre tout de suite, sans attendre l’aller-retour par Internet.
    func holdForSkip() async {
        holdUntil = Date().addingTimeInterval(3)
        await pausePlayer()
    }

    func playNow(_ value: Any?, nextProviderId next: String?) async {
        holdUntil = nil
        guard let track = track(from: value) else {
            // Le serveur a refusé : retour à l’état de la session.
            localUntil = nil
            if let lastPayload { apply(lastPayload) }
            return
        }
        current = track
        nextProviderId = next
        playing = true
        wantResume = true
        localUntil = Date().addingTimeInterval(3)
        // L’écran verrouillé affiche le nouveau titre sans attendre.
        updateNowPlaying((state: "loading", trackId: nil, positionMs: 0, durationMs: track.durationMs))
        await reconcile()
    }

    func setPlaying(_ value: Bool) async {
        if value && !playing { wantResume = true }
        playing = value
        localUntil = Date().addingTimeInterval(2)
        // Directement au moteur, avant tout le reste : le son réagit à l’appui.
        if value { await resumePlayer() } else { await pausePlayer() }
        await reconcile()
    }

    func seek(ms: Int) async {
        if useApple { apple.seek(ms: ms) } else { try? await engine.request("/seek?ms=\(ms)") }
        // L’écran verrouillé suit tout de suite le nouvel endroit.
        if !useApple, var info = MPNowPlayingInfoCenter.default().nowPlayingInfo {
            info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = Double(ms) / 1000
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            lastNowPlayingAt = Date()
        }
    }

    func applySound() async {
        guard engine.isRunning, let code, let token else { return }
        var request = URLRequest(url: server.appending(path: "api/sound").appending(queryItems: [URLQueryItem(name: "code", value: code)]))
        request.setValue(token, forHTTPHeaderField: "x-host-token")
        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let sound = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["sound"] as? [String: Any] else { return }
        let weights: [(String, [Double])] = [
            ("bass", [1, 1, 0.85, 0.5, 0.15, 0, 0, 0, 0, 0]),
            ("mid", [0, 0, 0.1, 0.4, 0.85, 1, 0.85, 0.4, 0.1, 0]),
            ("treble", [0, 0, 0, 0, 0, 0.1, 0.4, 0.8, 1, 1]),
        ]
        let gains = (0..<10).map { band in max(-12, min(12, weights.reduce(0.0) { $0 + ((sound[$1.0] as? NSNumber)?.doubleValue ?? 0) * $1.1[band] })) }
        let body = try? JSONSerialization.data(withJSONObject: ["gains": gains, "preampDb": -max(0, gains.max() ?? 0)])
        try? await engine.request("/eq", body: body)
    }

    // MARK: Service en ligne

    private func sendPlayback(_ action: String, expected: String? = nil) async {
        guard let code, let token else { return }
        var request = URLRequest(url: server.appending(path: "api/sessions/\(code)/playback"), timeoutInterval: 15)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(token, forHTTPHeaderField: "x-host-token")
        var body: [String: Any] = ["action": action]
        if let expected { body["expected"] = expected }
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        guard let (data, _) = try? await URLSession.shared.data(for: request),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        apply(json)
        onPayload?(json)
    }

    // MARK: Écran verrouillé

    private func setUpRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        // Le moteur réagit d’abord, sur place ; la session est prévenue en même temps.
        let send: (String) -> MPRemoteCommandHandlerStatus = { [weak self] action in
            Task { @MainActor in
                guard let self else { return }
                switch action {
                case "toggle": Task { await self.setPlaying(!self.playing) }
                case "next": if self.nextRaw != nil { Task { await self.playNow(self.nextRaw, nextProviderId: nil) } }
                default: if self.previousRaw != nil { Task { await self.playNow(self.previousRaw, nextProviderId: nil) } }
                }
                await self.sendPlayback(action)
            }
            return .success
        }
        center.playCommand.addTarget { [weak self] _ in self?.playing == false ? send("toggle") : .success }
        center.pauseCommand.addTarget { [weak self] _ in self?.playing == true ? send("toggle") : .success }
        center.togglePlayPauseCommand.addTarget { _ in send("toggle") }
        center.nextTrackCommand.addTarget { _ in send("next") }
        center.previousTrackCommand.addTarget { _ in send("previous") }
        // Barre de l’écran verrouillé : on peut la faire glisser pour se déplacer dans le titre.
        center.changePlaybackPositionCommand.isEnabled = true
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            let ms = Int(event.positionTime * 1000)
            Task { @MainActor in await self?.seek(ms: ms) }
            return .success
        }
    }

    private func updateNowPlaying(_ status: (state: String, trackId: String?, positionMs: Int, durationMs: Int)) {
        // Avec Apple Music, le système affiche lui-même le titre sur l’écran verrouillé.
        guard let current, !useApple else { return }
        // Écran verrouillé : mis à jour au changement de titre ou d’état, et toutes les 15 s, pas à chaque seconde.
        // Pendant le fondu, le relevé parle encore de l’ancien titre : le nouveau s’entend depuis 3 s avant sa fin.
        let inCrossfade = crossfadeTo != nil && status.trackId != crossfadeTo
        let positionMs = inCrossfade ? max(0, status.positionMs - (status.durationMs - 3000)) : status.positionMs
        // La durée et le démarrage réel du son changent aussi la barre : on la recale à ce moment-là.
        let running = playing && status.state == "playing"
        let duration = !inCrossfade && status.durationMs > 0 ? status.durationMs : current.durationMs
        let key = "\(current.providerId)-\(running)-\(duration)"
        guard key != lastNowPlayingKey || Date().timeIntervalSince(lastNowPlayingAt) > 15 else { return }
        lastNowPlayingKey = key
        lastNowPlayingAt = Date()
        if artworkKey(for: current) != artworkKey { loadArtwork(for: current) }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: current.title,
            MPMediaItemPropertyArtist: current.artist,
            MPMediaItemPropertyPlaybackDuration: Double(duration) / 1000,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: Double(positionMs) / 1000,
            MPNowPlayingInfoPropertyPlaybackRate: running ? 1.0 : 0.0,
        ]
        if let shown = inviteArtwork ?? artwork { info[MPMediaItemPropertyArtwork] = shown }
        info[MPMediaItemPropertyAlbumTitle] = albumLine
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    var canShowInviteOnCar: Bool { !useApple }

    /// Ligne « album » de l’écran verrouillé, d’AirPlay et de CarPlay ; avec le QR code, on y ajoute l’invitation.
    private var albumLine: String? {
        let album = current?.album ?? ""
        guard inviteArtwork != nil else { return album.isEmpty ? nil : album }
        return album.isEmpty ? L("Scannez pour proposer un titre") : L("{0} · Scannez pour proposer un titre", album)
    }

    /// Ce qu’affiche l’écran de la voiture.
    var carState: (current: (title: String, artist: String, album: String)?, upNext: [(title: String, artist: String)], code: String?, address: String?, inviteShown: Bool) {
        let row = { (value: Any) -> (title: String, artist: String)? in
            guard let item = value as? [String: Any], let title = item["title"] as? String else { return nil }
            return (title, item["artist"] as? String ?? "")
        }
        let waiting = (lastPayload?["queue"] as? [Any] ?? []) + ((lastPayload?["fallbackQueue"] as? [String: Any])?["tracks"] as? [Any] ?? [])
        return (current.map { ($0.title, $0.artist, $0.album) }, waiting.compactMap(row), code, inviteAddress, inviteArtwork != nil)
    }

    private func notifyCar() {
        guard let onCarChange else { return }
        let state = carState
        let summary = "\(state.current?.title ?? "")|\(state.upNext.prefix(12).map(\.title))|\(state.code ?? "")|\(state.address ?? "")|\(state.inviteShown)"
        guard summary != lastCarState else { return }
        lastCarState = summary
        onCarChange()
    }

    /// Bouton de la voiture : pochette ou QR code.
    func toggleInviteOnCar() {
        let shown = inviteArtwork == nil
        showInviteOnCar(shown ? inviteAddress : nil)
        onInviteShown?(shown)
    }

    func setInviteAddress(_ address: String?, shown: Bool) {
        inviteAddress = address
        showInviteOnCar(shown ? address : nil)
    }

    /// Affiche ou retire le QR code d’invitation sur l’écran de la voiture et l’écran verrouillé.
    func showInviteOnCar(_ address: String?) {
        inviteArtwork = address.flatMap(inviteQRCode).map(lockScreenArtwork)
        defer { notifyCar() }
        guard var info = MPNowPlayingInfoCenter.default().nowPlayingInfo else { return }
        info[MPMediaItemPropertyArtwork] = inviteArtwork ?? artwork
        info[MPMediaItemPropertyAlbumTitle] = albumLine
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func artworkKey(for track: Track) -> String { track.cover.isEmpty ? "id-\(track.providerId)" : track.cover }

    /// Pochette de l’écran verrouillé, en 1000 × 1000 : Deezer et Apple Music donnent la taille dans l’adresse.
    /// Sans adresse ou si elle échoue, on demande celle de l’album à Deezer, et on réessaie quelques fois (réseau mobile).
    private func loadArtwork(for track: Track) {
        let key = artworkKey(for: track)
        if key != artworkKey { artworkTries = 0 }
        artworkKey = key
        artwork = nil
        Task {
            guard let image = await Self.fetchArtwork(track), key == artworkKey else {
                guard key == artworkKey, artworkTries < 3 else { return }
                artworkTries += 1
                artworkKey = ""
                lastNowPlayingAt = Date().addingTimeInterval(-10)
                return
            }
            let artwork = lockScreenArtwork(image)
            self.artwork = artwork
            var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
            info[MPMediaItemPropertyArtwork] = inviteArtwork ?? artwork
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        }
    }

    private nonisolated static func fetchArtwork(_ track: Track) async -> UIImage? {
        let cover = track.cover.replacingOccurrences(of: "{w}", with: "1000").replacingOccurrences(of: "{h}", with: "1000")
        let large = cover.replacingOccurrences(of: "/\\d+x\\d+(-000000-\\d+-0-0\\.jpg)$", with: "/1000x1000$1", options: .regularExpression)
            .replacingOccurrences(of: "/\\d+x\\d+bb\\.(jpg|webp|png)$", with: "/1000x1000bb.$1", options: .regularExpression)
        for address in large == cover ? [cover] : [large, cover] {
            if let image = await download(address) { return image }
        }
        guard track.source == "Deezer", let url = URL(string: "https://api.deezer.com/track/\(track.providerId)"),
              let (data, _) = try? await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 15)),
              let album = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["album"] as? [String: Any],
              let address = album["cover_xl"] as? String ?? album["cover_big"] as? String else { return nil }
        return await download(address)
    }

    private nonisolated static func download(_ address: String) async -> UIImage? {
        guard let url = URL(string: address), let (data, _) = try? await URLSession.shared.data(for: URLRequest(url: url, timeoutInterval: 15)) else { return nil }
        return UIImage(data: data)
    }
}

/// QR code noir sur blanc, avec une marge blanche pour qu’un téléphone le lise bien sur un écran de voiture.
func inviteQRCode(_ address: String) -> UIImage? {
    guard let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
    filter.setValue(Data(address.utf8), forKey: "inputMessage")
    filter.setValue("M", forKey: "inputCorrectionLevel")
    guard let code = filter.outputImage else { return nil }
    let side: CGFloat = 1000
    let scale = floor(side * 0.86 / code.extent.width)
    let inset = (side - code.extent.width * scale) / 2
    guard let bitmap = CIContext().createCGImage(code.transformed(by: CGAffineTransform(scaleX: scale, y: scale)), from: code.extent.applying(CGAffineTransform(scaleX: scale, y: scale))) else { return nil }
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    return UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { context in
        UIColor.white.setFill()
        context.fill(CGRect(x: 0, y: 0, width: side, height: side))
        context.cgContext.interpolationQuality = .none
        UIImage(cgImage: bitmap).draw(in: CGRect(x: inset, y: inset, width: side - inset * 2, height: side - inset * 2))
    }
}

// Hors de la classe : le système demande l’image depuis un autre fil que le fil principal.
private func lockScreenArtwork(_ image: UIImage) -> MPMediaItemArtwork {
    MPMediaItemArtwork(boundsSize: image.size) { _ in image }
}
