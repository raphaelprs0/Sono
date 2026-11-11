import Foundation

// Ce que renvoie le service en ligne (cloud/src/worker.js). Tout est facultatif : une donnée absente ne casse rien.

/// Valeur JSON lue comme texte, qu’elle arrive en texte ou en nombre (identifiants Deezer).
struct LooseString: Codable, Hashable {
    let value: String
    init(_ value: String) { self.value = value }
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let text = try? container.decode(String.self) { value = text }
        else if let number = try? container.decode(Int64.self) { value = String(number) }
        else if let number = try? container.decode(Double.self) { value = String(Int64(number)) }
        else { value = "" }
    }
    func encode(to encoder: Encoder) throws { var container = encoder.singleValueContainer(); try container.encode(value) }
}

struct Track: Codable, Identifiable, Hashable {
    var id: String
    var providerId: LooseString?
    var title: String
    var artist: String
    var album: String?
    var durationMs: Double?
    var cover: String?
    var addedBy: String?
    var source: String?
    var fromFallback: Bool?
    var fallbackIndex: Int?

    var provider: String { providerId?.value ?? id }
    var durationMillis: Int { Int(durationMs ?? 0) }
    var isFallback: Bool { fromFallback == true }
    /// Même titre, même s’il a changé d’identifiant en passant de la musique de fond à la lecture.
    var key: String { "\(source ?? "")-\(provider)-\(title)" }

    /// Forme envoyée au service (ajout d’un titre) et au moteur du téléphone (Driver).
    var dictionary: [String: Any] {
        var item: [String: Any] = ["id": id, "providerId": provider, "title": title, "artist": artist, "album": album ?? "", "cover": cover ?? "", "source": source ?? "", "durationMs": durationMillis]
        if let addedBy { item["addedBy"] = addedBy }
        if let fromFallback { item["fromFallback"] = fromFallback }
        if let fallbackIndex { item["fallbackIndex"] = fallbackIndex }
        return item
    }
}

struct Participant: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var role: String?
    var admin: Bool?
    var online: Bool?
    var isHost: Bool { role == "host" }
}

struct JoinRequest: Codable, Identifiable, Hashable {
    var id: String
    var name: String
}

struct ActivityItem: Codable, Hashable {
    var icon: String?
    var text: String
    var at: String?
}

struct FallbackSummary: Codable, Hashable {
    var type: String?
    var name: String?
    var subtitle: String?
    var cover: String?
    var source: String?
    var count: Int?
    var next: Track?
}

struct FallbackQueue: Codable, Hashable {
    var tracks: [Track]
    var total: Int
}

struct SessionTheme: Codable, Hashable {
    var background: String?
    var accent: String?
    var glass: Bool?
    var lang: String?
}

struct SessionInfo: Codable, Hashable {
    var code: String
    var name: String
    var host: String
    var requireApproval: Bool?
    var source: String?
    var apps: [String]?
    var theme: SessionTheme?
    var fallback: FallbackSummary?
    var guests: Int?
    var participants: [Participant]?
    var requests: [JoinRequest]?
}

struct Payload: Decodable {
    var session: SessionInfo?
    var queue: [Track]?
    var fallbackQueue: FallbackQueue?
    var hasFallbackQueue = false
    var current: Track?
    var hasCurrent = false
    var previous: Track?
    var hasPrevious = false
    var history: [Track]?
    var playing: Bool?
    var activity: [ActivityItem]?
    var hostToken: String?

    enum CodingKeys: String, CodingKey { case session, queue, fallbackQueue, current, previous, history, playing, activity, hostToken }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        session = try? c.decodeIfPresent(SessionInfo.self, forKey: .session)
        queue = try? c.decodeIfPresent([Track].self, forKey: .queue)
        hasFallbackQueue = c.contains(.fallbackQueue)
        fallbackQueue = try? c.decodeIfPresent(FallbackQueue.self, forKey: .fallbackQueue)
        hasCurrent = c.contains(.current)
        current = try? c.decodeIfPresent(Track.self, forKey: .current)
        hasPrevious = c.contains(.previous)
        previous = try? c.decodeIfPresent(Track.self, forKey: .previous)
        history = try? c.decodeIfPresent([Track].self, forKey: .history)
        playing = try? c.decodeIfPresent(Bool.self, forKey: .playing)
        activity = try? c.decodeIfPresent([ActivityItem].self, forKey: .activity)
        hostToken = try? c.decodeIfPresent(String.self, forKey: .hostToken)
    }
}

/// Une playlist, un album ou un artiste proposé comme musique de fond.
struct CatalogItem: Codable, Identifiable, Hashable {
    var type: String
    var rawId: LooseString
    var name: String
    var subtitle: String?
    var cover: String?
    var id: String { "\(type)-\(rawId.value)" }
    enum CodingKeys: String, CodingKey { case type, rawId = "id", name, subtitle, cover }
}

struct CatalogResults: Codable {
    var playlists: [CatalogItem]?
    var albums: [CatalogItem]?
    var artists: [CatalogItem]?
}

struct Sound: Codable, Equatable {
    var bass: Double
    var mid: Double
    var treble: Double
    static let neutral = Sound(bass: 0, mid: 0, treble: 0)
}

/// Durée affichée « 3:20 ».
func clock(_ ms: Int) -> String {
    let total = max(0, ms / 1000)
    return "\(total / 60):" + String(format: "%02d", total % 60)
}

/// Durée totale d’une liste : « 12 min », « 1 h 05 ».
func totalDuration(_ tracks: [Track]) -> String {
    let minutes = tracks.reduce(0) { $0 + $1.durationMillis } / 60000
    return minutes >= 60 ? "\(minutes / 60) h " + String(format: "%02d", minutes % 60) : "\(minutes) min"
}

/// Pochette à la taille voulue : Deezer et Apple Music donnent la taille dans l’adresse.
func coverURL(_ address: String?, size: Int) -> URL? {
    guard var cover = address, !cover.isEmpty else { return nil }
    cover = cover.replacingOccurrences(of: "{w}", with: "\(size)").replacingOccurrences(of: "{h}", with: "\(size)")
    cover = cover.replacingOccurrences(of: "/\\d+x\\d+(-000000-\\d+-0-0\\.jpg)$", with: "/\(size)x\(size)$1", options: .regularExpression)
    cover = cover.replacingOccurrences(of: "/\\d+x\\d+bb\\.(jpg|webp|png)$", with: "/\(size)x\(size)bb.$1", options: .regularExpression)
    return URL(string: cover)
}

/// « il y a 5 min », comme sur la page web.
func activityTime(_ value: String?) -> String {
    guard let value else { return "" }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value) else { return "" }
    let seconds = Int(Date().timeIntervalSince(date))
    if seconds < 60 { return L("À l’instant") }
    if seconds < 3600 { return L("Il y a {0} min", seconds / 60) }
    if seconds < 86400 { return L("Il y a {0} h", seconds / 3600) }
    let day = DateFormatter()
    day.locale = Lang.locale
    day.dateFormat = "d MMM, HH:mm"
    return day.string(from: date)
}
