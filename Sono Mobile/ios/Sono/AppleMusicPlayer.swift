// xcode: set sdk=iOS

import AVFoundation
import MediaPlayer
import StoreKit

/// Apple Music sur l’iPhone : la lecture est confiée au système, avec l’abonnement de l’app Musique (aucune clé de développeur).
@MainActor
final class AppleMusicPlayer {
    private let player = MPMusicPlayerController.applicationQueuePlayer
    private let keepAlive = SilentKeepAlive()
    private var requestedId: String?
    private static let linkedKey = "sono-apple-linked"

    var isConnected: Bool {
        MPMediaLibrary.authorizationStatus() == .authorized && UserDefaults.standard.bool(forKey: Self.linkedKey)
    }

    func connect() async throws {
        let authorization = await withCheckedContinuation { continuation in MPMediaLibrary.requestAuthorization { continuation.resume(returning: $0) } }
        guard authorization == .authorized else { throw SonoError.message(L("Autorisez Sono à accéder à Apple Music dans Réglages → Sono.")) }
        let capabilities: SKCloudServiceCapability = try await withCheckedThrowingContinuation { continuation in
            SKCloudServiceController().requestCapabilities { value, error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume(returning: value) }
            }
        }
        guard capabilities.contains(.musicCatalogPlayback) else { throw SonoError.message(L("Il faut un abonnement Apple Music actif, connecté dans l’app Musique de ce téléphone.")) }
        UserDefaults.standard.set(true, forKey: Self.linkedKey)
    }

    func disconnect() {
        UserDefaults.standard.set(false, forKey: Self.linkedKey)
        deactivate()
    }

    func activate() { keepAlive.start() }

    func deactivate() {
        player.stop()
        requestedId = nil
        keepAlive.stop()
    }

    func status() -> (state: String, trackId: String?, positionMs: Int, durationMs: Int) {
        let duration = player.nowPlayingItem?.playbackDuration ?? 0
        let position = player.currentPlaybackTime.isFinite ? player.currentPlaybackTime : 0
        var state: String
        switch player.playbackState {
        case .playing, .seekingForward, .seekingBackward: state = "playing"
        case .paused, .interrupted: state = player.nowPlayingItem == nil ? "stopped" : "paused"
        default: state = "stopped"
        }
        // Fin de titre : selon les versions d’iOS, le lecteur reste en pause tout à la fin plutôt que de s’arrêter.
        if state == "paused" && duration > 0 && position >= duration - 0.5 { state = "stopped" }
        return (state, requestedId, Int(position * 1000), Int(duration * 1000))
    }

    func play(id: String) async throws {
        player.setQueue(with: [id])
        requestedId = id
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            player.prepareToPlay { error in
                if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
        }
        player.play()
    }

    func pause() { player.pause() }
    func resume() { player.play() }
    func seek(ms: Int) { player.currentPlaybackTime = Double(ms) / 1000 }
}

/// Le système joue la musique d’Apple Music à la place de l’app : ce silence garde Sono éveillé écran verrouillé,
/// pour qu’il enchaîne les titres et suive les invités.
final class SilentKeepAlive {
    private let engine = AVAudioEngine()
    private let node = AVAudioPlayerNode()

    func start() {
        guard !engine.isRunning else { return }
        let audio = AVAudioSession.sharedInstance()
        try? audio.setCategory(.playback, options: [.mixWithOthers])
        try? audio.setActive(true)
        let format = AVAudioFormat(standardFormatWithSampleRate: 44100, channels: 2)!
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44100) else { return }
        buffer.frameLength = 44100
        if node.engine == nil { engine.attach(node) }
        engine.connect(node, to: engine.mainMixerNode, format: format)
        engine.mainMixerNode.outputVolume = 0
        try? engine.start()
        node.scheduleBuffer(buffer, at: nil, options: .loops)
        node.play()
    }

    func stop() {
        node.stop()
        engine.stop()
    }
}
