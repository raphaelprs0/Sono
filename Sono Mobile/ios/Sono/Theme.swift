import AVKit
import CoreImage.CIFilterBuiltins
import ImageIO
import SwiftUI

// MARK: Apparence (gardée sur ce téléphone, envoyée aux invités pour le fond, l’accent et le verre)

struct Appearance: Codable, Equatable {
    var background = "black"
    var accent = "#d7f75b"
    var glass = false
    var tvBackground = "cover"
    var tvShowAddedBy = true
    var tvShowQrText = true

    init() {}
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let base = Appearance()
        background = (try? c.decode(String.self, forKey: .background)) ?? base.background
        accent = (try? c.decode(String.self, forKey: .accent)) ?? base.accent
        glass = (try? c.decode(Bool.self, forKey: .glass)) ?? base.glass
        tvBackground = (try? c.decode(String.self, forKey: .tvBackground)) ?? base.tvBackground
        tvShowAddedBy = (try? c.decode(Bool.self, forKey: .tvShowAddedBy)) ?? base.tvShowAddedBy
        tvShowQrText = (try? c.decode(Bool.self, forKey: .tvShowQrText)) ?? base.tvShowQrText
    }

    static func load() -> Appearance {
        guard let text = UserDefaults.standard.string(forKey: "sono-appearance"), var value = try? JSONDecoder().decode(Appearance.self, from: Data(text.utf8)) else { return Appearance() }
        // Fond ou couleur retirés depuis (ancien choix) : retour aux valeurs par défaut.
        if value.background != "cover", !Backdrop.all.contains(where: { $0.id == value.background }) { value.background = Appearance().background }
        if value.accent == "#151513" { value.accent = "#f5f5f4" }
        if !Accent.all.contains(where: { $0.hex == value.accent }) { value.accent = Appearance().accent }
        return value
    }

    /// Même clé et même forme que la page web : le mode TV affiché sur la TV (page web) garde ces réglages.
    func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        UserDefaults.standard.set(String(decoding: data, as: UTF8.self), forKey: "sono-appearance")
    }

    /// Les couleurs suivent le thème affiché (clair ou sombre), résolu par iOS au moment de dessiner.
    var accentColor: Color { Color(UIColor { UIColor(hex: Accent.resolved(accent, light: $0.userInterfaceStyle == .light).hex) }) }
    /// Texte posé sur l’accent : sombre sur les accents clairs.
    var accentInk: Color { Color(UIColor { UIColor(hex: Accent.resolved(accent, light: $0.userInterfaceStyle == .light).ink) }) }
    /// Accent utilisé comme couleur de texte : foncé sur le thème clair pour rester lisible.
    var accentText: Color {
        Color(UIColor { trait in
            let light = trait.userInterfaceStyle == .light
            let value = Accent.resolved(accent, light: light)
            return UIColor(hex: light ? value.lightText ?? value.hex : value.hex)
        })
    }
}

/// Couleurs d’accent. « Natif » n’a pas de couleur propre : blanc sur un fond sombre, noir sur un fond clair.
struct Accent: Identifiable {
    let hex: String
    let label: String
    let ink: String
    var lightText: String? = nil
    var native = false
    var id: String { hex }
    static let all = [
        Accent(hex: "#d7f75b", label: "Citron", ink: "#171a08", lightText: "#5a7000"),
        Accent(hex: "#c084fc", label: "Lilas", ink: "#1f0b33", lightText: "#7a2ec4"),
        Accent(hex: "#fb7185", label: "Framboise", ink: "#330811", lightText: "#c0243f"),
        Accent(hex: "#fbbf24", label: "Or", ink: "#2b1d02", lightText: "#946000"),
        Accent(hex: "#bdd2e9", label: "Pleins Phares", ink: "#0c1521", lightText: "#3a6491"),
        Accent(hex: "#f5f5f4", label: "Natif", ink: "#151512", native: true),
    ]
    /// Version sombre de « Natif », affichée sur le thème clair.
    static let nativeOnLight = Accent(hex: "#151513", label: "Natif", ink: "#f5f5f4", native: true)
    /// L’accent tel qu’il s’affiche sur ce thème (« Natif » devient noir sur le thème clair).
    static func resolved(_ hex: String, light: Bool) -> Accent {
        let accent = all.first { $0.hex == hex } ?? all[0]
        return accent.native && light ? nativeOnLight : accent
    }
}

extension UIColor {
    convenience init(hex: String) {
        let value = Int(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
        self.init(red: CGFloat(value >> 16 & 255) / 255, green: CGFloat(value >> 8 & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
    }
}

extension Color {
    init(hex: String) {
        let value = Int(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
        self.init(red: Double(value >> 16 & 255) / 255, green: Double(value >> 8 & 255) / 255, blue: Double(value & 255) / 255)
    }
    /// Couleur qui change avec le thème affiché (sombre ou clair).
    static func themed(dark: UIColor, light: UIColor) -> Color { Color(UIColor { $0.userInterfaceStyle == .light ? light : dark }) }
    static let sonoBackground = themed(dark: UIColor(hex: "#0f0f0d"), light: UIColor(hex: "#f4f4f0"))
    static let sonoText = themed(dark: UIColor(hex: "#f4f3ec"), light: UIColor(hex: "#151513"))
    static let sonoMuted = themed(dark: UIColor(red: 0.62, green: 0.62, blue: 0.58, alpha: 1), light: UIColor(hex: "#66665e"))
    static let sonoDanger = themed(dark: UIColor(red: 1, green: 0.47, blue: 0.42, alpha: 1), light: UIColor(hex: "#cf3a2e"))
    /// Teinte des voiles et traits : blanc sur le thème sombre, presque noir sur le thème clair.
    static let sonoFg = themed(dark: .white, light: UIColor(hex: "#141412"))
    /// Fond des champs de saisie.
    static let sonoField = themed(dark: UIColor.black.withAlphaComponent(0.28), light: UIColor.black.withAlphaComponent(0.05))
    static let sonoSurface = themed(dark: UIColor(hex: "#181815"), light: .white)
    static let sonoSurfaceTop = themed(dark: UIColor(hex: "#23231e"), light: .white)
    static let sonoSurfaceBottom = themed(dark: UIColor(hex: "#191916"), light: UIColor(hex: "#f7f7f3"))
    static let sonoLine = themed(dark: UIColor(hex: "#2a2a25"), light: UIColor(hex: "#e2e2da"))
    static let sonoLineStrong = themed(dark: UIColor(hex: "#3a3a33"), light: UIColor(hex: "#d4d4cb"))
    static let sonoGlass = themed(dark: UIColor(red: 22 / 255, green: 22 / 255, blue: 20 / 255, alpha: 0.62), light: UIColor.white.withAlphaComponent(0.6))
    static let sonoGlassSolid = themed(dark: UIColor(red: 14 / 255, green: 14 / 255, blue: 12 / 255, alpha: 0.68), light: UIColor.white.withAlphaComponent(0.78))
    static let sonoGlassEdge = themed(dark: UIColor.white.withAlphaComponent(0.24), light: UIColor.black.withAlphaComponent(0.08))
    static let sonoGlassHighlight = themed(dark: UIColor.white.withAlphaComponent(0.42), light: UIColor.white.withAlphaComponent(0.95))
}

// MARK: Pochettes : téléchargées une fois, réduites à la taille affichée (peu de mémoire), gardées en cache

final class CoverCache {
    static let shared = CoverCache()
    private let memory = NSCache<NSString, UIImage>()
    private var running: [String: Task<UIImage?, Never>] = [:]
    private let lock = NSLock()

    init() { memory.totalCostLimit = 24 * 1024 * 1024 }

    func cached(_ url: URL, pixels: Int) -> UIImage? { memory.object(forKey: "\(url.absoluteString)@\(pixels)" as NSString) }

    func image(_ url: URL, pixels: Int) async -> UIImage? {
        let key = "\(url.absoluteString)@\(pixels)"
        if let image = memory.object(forKey: key as NSString) { return image }
        let task = lock.withLock {
            if let running = running[key] { return running }
            let task = Task.detached(priority: .userInitiated) { () -> UIImage? in
                var request = URLRequest(url: url, timeoutInterval: 20)
                request.cachePolicy = .returnCacheDataElseLoad
                guard let (data, _) = try? await URLSession.shared.data(for: request) else { return nil }
                return Self.downsample(data, pixels: pixels)
            }
            running[key] = task
            return task
        }
        let image = await task.value
        lock.withLock { running[key] = nil }
        if let image { memory.setObject(image, forKey: key as NSString, cost: Int(image.size.width * image.size.height * image.scale * image.scale * 4)) }
        return image
    }

    private static func downsample(_ data: Data, pixels: Int) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary) else { return nil }
        let options = [kCGImageSourceCreateThumbnailFromImageAlways: true, kCGImageSourceShouldCacheImmediately: true, kCGImageSourceCreateThumbnailWithTransform: true, kCGImageSourceThumbnailMaxPixelSize: pixels] as CFDictionary
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options) else { return nil }
        return UIImage(cgImage: image)
    }
}

/// Pochette d’un titre ; une note de musique tant qu’elle n’est pas là.
struct CoverView: View {
    let address: String?
    var size: CGFloat
    var radius: CGFloat = 8
    @State private var image: UIImage?

    private var pixels: Int { Int(size * UIScreen.main.scale) }
    private var url: URL? { coverURL(address, size: pixels > 500 ? 1000 : pixels > 250 ? 500 : 250) }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: radius, style: .continuous).fill(Color.sonoFg.opacity(0.08))
            if let image = image ?? url.flatMap({ CoverCache.shared.cached($0, pixels: pixels) }) {
                Image(uiImage: image).resizable().scaledToFill().transition(.opacity)
            } else {
                Image(systemName: "music.note").font(.system(size: size * 0.32, weight: .medium)).foregroundStyle(Color.sonoMuted)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
        .task(id: url) {
            guard let url else { image = nil; return }
            if let found = await CoverCache.shared.image(url, pixels: pixels) { withAnimation(.easeOut(duration: 0.25)) { image = found } }
        }
    }
}

// MARK: Cartes en verre (même rendu que l’ancienne interface : teinte sombre translucide, reflet en diagonale, liseré clair)

/// Dégradé CSS « 145deg » : de haut-gauche vers bas-droite, à peu près.
private let glassSheen = LinearGradient(stops: [
    .init(color: .white.opacity(0.15), location: 0), .init(color: .white.opacity(0.04), location: 0.48), .init(color: .white.opacity(0.09), location: 1),
], startPoint: UnitPoint(x: 0.21, y: 0), endPoint: UnitPoint(x: 0.79, y: 1))

/// Liseré du verre, plus marqué en haut (reflet de la lumière) ; sombre et discret sur le thème clair.
private let glassEdge = LinearGradient(stops: [
    .init(color: .sonoGlassHighlight, location: 0), .init(color: .sonoGlassEdge, location: 0.12), .init(color: .sonoGlassEdge, location: 0.9), .init(color: .sonoGlassEdge, location: 1),
], startPoint: .top, endPoint: .bottom)

struct GlassCard: ViewModifier {
    @EnvironmentObject private var store: Store
    var radius: CGFloat = 24
    /// Fond plus opaque (lecteur) : « glass-fill-solid ».
    var solid = false
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        if store.appearance.glass {
            content
                .background(shape.fill(solid ? Color.sonoGlassSolid : Color.sonoGlass).overlay(shape.fill(glassSheen)))
                .overlay(shape.strokeBorder(glassEdge, lineWidth: 1))
                // Ombre douce : une image calculée une fois (aucun flou recalculé en défilant ou en glissant).
                .background(SoftShadow(radius: radius, blur: 20, opacity: 0.3).offset(y: 14))
        } else {
            content
                .background(shape.fill(solid ? AnyShapeStyle(LinearGradient(colors: [Color.sonoSurfaceTop, Color.sonoSurfaceBottom], startPoint: .topLeading, endPoint: .bottomTrailing)) : AnyShapeStyle(Color.sonoSurface)))
                .overlay(shape.strokeBorder(solid ? Color.sonoLineStrong : Color.sonoLine, lineWidth: 1))
        }
    }
}

extension View {
    func glassCard(radius: CGFloat = 24, solid: Bool = false) -> some View { modifier(GlassCard(radius: radius, solid: solid)) }
}

/// Bouton principal, aux couleurs de l’accent (reflet clair en haut, comme avant).
struct AccentButtonStyle: ButtonStyle {
    @EnvironmentObject private var store: Store
    var danger = false
    /// Toute la largeur (formulaires) ou juste la taille du texte (boutons en ligne).
    var wide = true
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(danger ? Color(hex: "#2a0705") : store.appearance.accentInk)
            .lineLimit(1)
            .padding(.horizontal, 16)
            .frame(minHeight: 42)
            .frame(maxWidth: wide ? .infinity : nil)
            .background(Capsule().fill(danger ? Color.sonoDanger : store.appearance.accentColor))
            .overlay(Capsule().strokeBorder(LinearGradient(colors: [.white.opacity(0.5), .clear], startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.25)), lineWidth: 1))
    }
}

/// Bouton sans aucun effet à l’appui (ni assombrissement, ni surbrillance).
struct StillButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View { configuration.label.contentShape(Rectangle()) }
}

/// Bouton secondaire en verre.
struct SecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Color.sonoText)
            .lineLimit(1)
            .padding(.horizontal, 14)
            .frame(minHeight: 36)
            .background(Capsule().fill(Color.sonoGlass).overlay(Capsule().fill(Color.sonoFg.opacity(0.06))))
            .overlay(Capsule().strokeBorder(LinearGradient(colors: [.sonoGlassHighlight, .sonoGlassEdge], startPoint: .top, endPoint: UnitPoint(x: 0.5, y: 0.3)), lineWidth: 1))
    }
}

// MARK: Ombres

/// Ombre portée d’un rectangle arrondi, dessinée une seule fois dans une image (par taille) puis affichée telle quelle :
/// déplacer une carte ou tourner une page ne coûte plus rien, contrairement à une ombre recalculée à chaque image.
struct SoftShadow: View {
    var radius: CGFloat
    var blur: CGFloat
    var opacity: Double
    var body: some View {
        GeometryReader { geometry in
            if let image = SoftShadow.image(size: geometry.size, radius: radius, blur: blur) {
                Image(uiImage: image).resizable()
                    .frame(width: geometry.size.width + blur * 4, height: geometry.size.height + blur * 4)
                    .offset(x: -blur * 2, y: -blur * 2)
                    .opacity(opacity)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private static let cache = NSCache<NSString, UIImage>()

    static func image(size: CGSize, radius: CGFloat, blur: CGFloat) -> UIImage? {
        guard size.width > 1, size.height > 1 else { return nil }
        // Petite échelle : l’ombre est floue, inutile de la calculer en pleine résolution.
        let scale: CGFloat = 0.5
        let key = "\(Int(size.width))x\(Int(size.height))-\(Int(radius))-\(Int(blur))" as NSString
        if let image = cache.object(forKey: key) { return image }
        let canvas = CGSize(width: size.width + blur * 4, height: size.height + blur * 4)
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        let shape = UIGraphicsImageRenderer(size: canvas, format: format).image { _ in
            UIColor.black.setFill()
            UIBezierPath(roundedRect: CGRect(x: blur * 2, y: blur * 2, width: size.width, height: size.height), cornerRadius: radius).fill()
        }
        guard let input = CIImage(image: shape) else { return nil }
        let blurred = input.clampedToExtent().applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: blur * scale]).cropped(to: input.extent)
        guard let cg = CIContext().createCGImage(blurred, from: input.extent) else { return nil }
        let image = UIImage(cgImage: cg, scale: scale, orientation: .up)
        cache.setObject(image, forKey: key)
        return image
    }
}

// MARK: QR code

enum QRCode {
    /// Code net (pixels entiers), noir sur blanc.
    static func image(_ text: String, level: String = "M") -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = level
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 12, y: 12)),
              let image = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: image)
    }
}

struct QRCodeView: View {
    let text: String
    var level = "H"
    var body: some View {
        if let image = QRCode.image(text, level: level) {
            Image(uiImage: image).interpolation(.none).resizable().scaledToFit()
        }
    }
}

// MARK: AirPlay

/// Le vrai bouton AirPlay d’iOS : il ouvre la liste des TV et enceintes.
/// Bouton AirPlay : une icône fixe (blanche, ou à la couleur d’accent quand la musique part sur une TV ou une enceinte),
/// et par-dessus le vrai bouton d’iOS, invisible, qui ouvre la liste des appareils. L’icône animée d’iOS n’est pas affichée.
struct AirPlayButton: View {
    @EnvironmentObject private var store: Store
    @State private var active = AirPlayRoute.isActive

    var body: some View {
        ZStack {
            Image(systemName: "airplay.audio")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(active ? store.appearance.accentText : Color.sonoText)
            RoutePicker().opacity(0.02)
        }
        .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.routeChangeNotification).receive(on: RunLoop.main)) { _ in active = AirPlayRoute.isActive }
        .accessibilityLabel("AirPlay")
    }
}

enum AirPlayRoute {
    /// La musique sort-elle sur un appareil AirPlay ?
    static var isActive: Bool { AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .airPlay } }
}

private struct RoutePicker: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.prioritizesVideoDevices = false
        return view
    }
    func updateUIView(_ view: AVRoutePickerView, context: Context) {}
}

/// Petites barres animées « en lecture ».
struct Equalizer: View {
    let playing: Bool
    let color: Color
    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: !playing)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(0..<3) { index in
                    let phase = sin(t * (5 + Double(index) * 1.7) + Double(index))
                    RoundedRectangle(cornerRadius: 1).fill(color)
                        .frame(width: 3, height: playing ? 5 + 7 * (phase + 1) / 2 : 4)
                }
            }
            .frame(height: 13, alignment: .bottom)
        }
    }
}

/// Initiale dans un rond coloré.
struct Avatar: View {
    let name: String
    var size: CGFloat = 34
    private var color: Color {
        let palette = ["#5a3a2a", "#2a4a5a", "#4a2a5a", "#2a5a3a", "#5a4a2a", "#5a2a3a"]
        return Color(hex: palette[abs(name.unicodeScalars.reduce(0) { $0 &+ Int($1.value) }) % palette.count])
    }
    var body: some View {
        Text(String(name.first ?? "?").uppercased())
            .font(.system(size: size * 0.42, weight: .semibold))
            .foregroundStyle(Color(hex: "#ffd9c7"))
            .frame(width: size, height: size)
            .background(Circle().fill(color))
    }
}

/// Logo « sono. » de l’en-tête.
struct Brand: View {
    @EnvironmentObject private var store: Store
    /// Taille du texte ; les barres en découlent (mêmes proportions que le logo d’origine).
    var size: CGFloat = 27

    var body: some View {
        HStack(spacing: size * 0.37) {
            // Quatre barres inclinées de 8°, de hauteurs 0,44 / 0,96 / 0,70 / 0,33 de la taille du texte.
            HStack(alignment: .center, spacing: size * 0.11) {
                ForEach(Array([0.44, 0.96, 0.70, 0.33].enumerated()), id: \.offset) { _, height in
                    Capsule().fill(store.appearance.accentColor)
                        .frame(width: size * 0.15, height: size * height)
                        .rotationEffect(.degrees(-8))
                }
            }
            .frame(height: size * 1.04)
            (Text("sono").foregroundColor(Color.sonoText) + Text(".").foregroundColor(store.appearance.accentText))
                .font(.system(size: size, weight: .heavy))
                .tracking(-1.2)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Sono")
    }
}

/// Titre de section en petites capitales espacées.
struct Eyebrow: View {
    let text: String
    @EnvironmentObject private var store: Store
    var body: some View {
        Text(text.uppercased()).font(.system(size: 13, weight: .bold)).tracking(2.2).foregroundStyle(store.appearance.accentText)
    }
}
