import SwiftUI
import UIKit

// Les arrière-plans, rendus exactement comme sur l’ancienne interface web (App.jsx : AppBackdrop, measureImage,
// smoothBitmap, useBackdropEdges ; styles.css : .app-backdrop, .edge-tint).

typealias RGB = (r: Double, g: Double, b: Double)

private func relativeLuminance(_ c: RGB) -> Double {
    func channel(_ v: Double) -> Double { let x = v / 255; return x <= 0.03928 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4) }
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

private func color(_ c: RGB) -> Color { Color(red: c.r / 255, green: c.g / 255, blue: c.b / 255) }
private func rgb(_ hex: String) -> RGB {
    let v = Int(hex.trimmingCharacters(in: CharacterSet(charactersIn: "#")), radix: 16) ?? 0
    return (Double(v >> 16 & 255), Double(v >> 8 & 255), Double(v & 255))
}

/// Ce qu’on retient d’une image de fond : l’assombrissement minimal pour que les textes restent lisibles,
/// la couleur des bords haut et bas, et la version floutée (48 × 48, agrandie telle quelle).
struct BackdropMeasure {
    let shade: Double
    let top: RGB
    let bottom: RGB
    let blur: UIImage?
}

enum BackdropLab {
    private static let cache = NSCache<NSString, Box>()
    final class Box { let value: BackdropMeasure; init(_ value: BackdropMeasure) { self.value = value } }

    static func cached(_ key: String) -> BackdropMeasure? { cache.object(forKey: key as NSString)?.value }

    static func measure(key: String, image: UIImage, blur: Bool) async -> BackdropMeasure? {
        if let found = cached(key) { return found }
        guard let cg = image.cgImage else { return nil }
        let value = await Task.detached(priority: .utility) { compute(cg, blur: blur) }.value
        if let value { cache.setObject(Box(value), forKey: key as NSString) }
        return value
    }

    private static func pixels(_ image: CGImage, size: Int) -> [UInt8]? {
        var data = [UInt8](repeating: 0, count: size * size * 4)
        guard let context = CGContext(data: &data, width: size, height: size, bitsPerComponent: 8, bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: size, height: size))
        return data
    }

    private static func compute(_ image: CGImage, blur: Bool) -> BackdropMeasure? {
        // 12 × 12 : une moyenne par zone, comme le flou de l’arrière-plan.
        guard let data = pixels(image, size: 12) else { return nil }
        var list: [RGB] = []
        for i in stride(from: 0, to: data.count, by: 4) { list.append((Double(data[i]), Double(data[i + 1]), Double(data[i + 2]))) }
        // La première rangée en mémoire est celle du haut de l’image.
        func row(_ y: Int) -> RGB {
            let items = list[(y * 12)..<(y * 12 + 12)]
            return (items.map(\.r).reduce(0, +) / 12, items.map(\.g).reduce(0, +) / 12, items.map(\.b).reduce(0, +) / 12)
        }
        let sorted = list.sorted { relativeLuminance($0) < relativeLuminance($1) }
        let bright = sorted[Int(Double(sorted.count) * 0.9)]
        var keep = 1.0
        while keep > 0.05 && relativeLuminance((bright.r * keep, bright.g * keep, bright.b * keep)) > 0.045 { keep -= 0.01 }
        return BackdropMeasure(shade: 1 - keep, top: row(0), bottom: row(11), blur: blur ? smooth(image) : nil)
    }

    /// Petite image saturée et très adoucie (flou de boîte en trois passes ≈ flou gaussien de 70 px une fois agrandie).
    private static func smooth(_ image: CGImage, size: Int = 48, radius: Int = 3, passes: Int = 3, saturation: Double = 1.5) -> UIImage? {
        guard var px = pixels(image, size: size) else { return nil }
        let count = size * size
        var a = [Double](repeating: 0, count: count * 3)
        var b = a
        for i in 0..<count {
            let gray = 0.299 * Double(px[i * 4]) + 0.587 * Double(px[i * 4 + 1]) + 0.114 * Double(px[i * 4 + 2])
            for c in 0..<3 { a[i * 3 + c] = max(0, min(255, gray + (Double(px[i * 4 + c]) - gray) * saturation)) }
        }
        let width = Double(radius * 2 + 1)
        func blurAxis(_ src: [Double], _ dst: inout [Double], horizontal: Bool) {
            for line in 0..<size {
                for c in 0..<3 {
                    func at(_ k: Int) -> Int { let k = min(size - 1, max(0, k)); return (horizontal ? line * size + k : k * size + line) * 3 + c }
                    var sum = 0.0
                    for k in -radius...radius { sum += src[at(k)] }
                    for k in 0..<size { dst[at(k)] = sum / width; sum += src[at(k + radius + 1)] - src[at(k - radius)] }
                }
            }
        }
        for _ in 0..<passes { blurAxis(a, &b, horizontal: true); blurAxis(b, &a, horizontal: false) }
        for i in 0..<count { for c in 0..<3 { px[i * 4 + c] = UInt8(max(0, min(255, a[i * 3 + c].rounded()))) }; px[i * 4 + 3] = 255 }
        guard let provider = CGDataProvider(data: Data(px) as CFData),
              let cg = CGImage(width: size, height: size, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: size * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue), provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

/// Un calque d’un fond en dégradés : un halo elliptique (radial-gradient « ellipse at x y ») ou un dégradé linéaire.
enum Layer {
    case radial(x: Double, y: Double, color: String, alpha: Double, stop: Double)
    case linear(angle: Double, stops: [(String, Double)])
}

struct Backdrop: Identifiable {
    let id: String
    let label: String
    let edges: [String]
    /// Calques du dessous vers le dessus (l’inverse de l’ordre CSS).
    let layers: [Layer]
    var image: String? = nil
    var minShade: Double = 0

    static let all: [Backdrop] = [
        Backdrop(id: "default", label: "Sombre", edges: ["#0f0f0d", "#0f0f0d"], layers: [.linear(angle: 180, stops: [("#0f0f0d", 0), ("#0f0f0d", 1)])]),
        Backdrop(id: "black", label: "Noir", edges: ["#000000", "#000000"], layers: [.linear(angle: 180, stops: [("#000000", 0), ("#000000", 1)])]),
        Backdrop(id: "night", label: "Nuit", edges: ["#0b0f22", "#06070f"], layers: [
            .linear(angle: 180, stops: [("#0b0f22", 0), ("#06070f", 1)]),
            .radial(x: 0.92, y: 1.05, color: "#622ea0", alpha: 0.5, stop: 0.5),
            .radial(x: 0.18, y: -0.05, color: "#4056be", alpha: 0.55, stop: 0.55),
        ]),
        Backdrop(id: "aurora", label: "Aurore", edges: ["#05080e", "#05080e"], layers: [
            .linear(angle: 180, stops: [("#05080e", 0), ("#05080e", 1)]),
            .radial(x: 0.5, y: 1.15, color: "#1676aa", alpha: 0.4, stop: 0.55),
            .radial(x: 0.88, y: 0.18, color: "#7c48e2", alpha: 0.42, stop: 0.5),
            .radial(x: 0.12, y: 0.08, color: "#1ac496", alpha: 0.42, stop: 0.5),
        ]),
        Backdrop(id: "sunset", label: "Coucher de soleil", edges: ["#170a1d", "#3a1510"], layers: [
            .linear(angle: 180, stops: [("#170a1d", 0), ("#2a0e19", 0.6), ("#3a1510", 1)]),
            .radial(x: 0.08, y: 0.05, color: "#962876", alpha: 0.5, stop: 0.5),
            .radial(x: 0.5, y: 1.25, color: "#ff8a3a", alpha: 0.55, stop: 0.55),
        ]),
        Backdrop(id: "ocean", label: "Océan", edges: ["#062a40", "#03141f"], layers: [
            .linear(angle: 170, stops: [("#062a40", 0), ("#04354a", 0.45), ("#03141f", 1)]),
            .radial(x: 0.05, y: 1, color: "#145a8c", alpha: 0.45, stop: 0.55),
            .radial(x: 0.82, y: -0.05, color: "#3ec4d6", alpha: 0.32, stop: 0.5),
        ]),
        Backdrop(id: "pleins-phares", label: "Pleins Phares", edges: ["#262d33", "#262d33"], layers: [.linear(angle: 180, stops: [("#3f4b55", 0), ("#3f4b55", 1)])], image: "FondPleinsPhares"),
        Backdrop(id: "apocalypse", label: "Apocalypse", edges: ["#2a0b10", "#030208"], layers: [
            .linear(angle: 180, stops: [("#2a0b10", 0), ("#120310", 0.6), ("#030208", 1)]),
            .radial(x: 0.58, y: 0.04, color: "#df7b47", alpha: 0.28, stop: 0.4),
            .radial(x: 0.86, y: 0.72, color: "#a32418", alpha: 0.55, stop: 0.5),
            .radial(x: 0.18, y: 0.28, color: "#f94c0e", alpha: 0.5, stop: 0.45),
        ]),
    ]
}

/// Les calques en dégradés, dessinés comme le navigateur (ellipse « farthest-corner », transparent progressif).
struct GradientLayers: View {
    let layers: [Layer]
    var body: some View {
        Canvas { context, size in
            let rect = CGRect(origin: .zero, size: size)
            for layer in layers {
                switch layer {
                case .linear(let angle, let stops):
                    // Angle CSS : 180° = de haut en bas ; la ligne du dégradé couvre toute la diagonale utile.
                    let radians = angle * .pi / 180
                    let dx = sin(radians), dy = -cos(radians)
                    let half = (abs(size.width * dx) + abs(size.height * dy)) / 2
                    let center = CGPoint(x: size.width / 2, y: size.height / 2)
                    let gradient = Gradient(stops: stops.map { .init(color: color(rgb($0.0)), location: $0.1) })
                    context.fill(Path(rect), with: .linearGradient(gradient, startPoint: CGPoint(x: center.x - dx * half, y: center.y - dy * half), endPoint: CGPoint(x: center.x + dx * half, y: center.y + dy * half)))
                case .radial(let x, let y, let hex, let alpha, let stop):
                    let cx = x * size.width, cy = y * size.height
                    // Ellipse qui passe par le coin le plus éloigné, aux proportions des côtés les plus éloignés.
                    let rx = max(cx, size.width - cx) * 2.squareRoot(), ry = max(cy, size.height - cy) * 2.squareRoot()
                    let base = color(rgb(hex))
                    var layerContext = context
                    layerContext.translateBy(x: cx, y: cy)
                    layerContext.scaleBy(x: rx, y: ry)
                    let gradient = Gradient(stops: [.init(color: base.opacity(alpha), location: 0), .init(color: base.opacity(0), location: stop)])
                    let local = CGRect(x: -cx / rx, y: -cy / ry, width: size.width / rx, height: size.height / ry)
                    layerContext.fill(Path(local), with: .radialGradient(gradient, center: .zero, startRadius: 0, endRadius: 1))
                }
            }
        }
    }
}

// MARK: Arrière-plan de l’app

struct AppBackground: View {
    let appearance: Appearance
    let cover: String?
    /// Bandes unies en haut et en bas (sous l’heure et la barre d’onglets), comme sur la page web.
    var edges = true
    @State private var measure: BackdropMeasure?
    @State private var measuredKey: String?

    private var preset: Backdrop { Backdrop.all.first { $0.id == appearance.background } ?? Backdrop.all[0] }
    private var sourceKey: String? { appearance.background == "cover" ? cover.flatMap { $0.isEmpty ? nil : $0 } : preset.image }

    /// Couleur des bords : la plus sombre des deux, après le même assombrissement que le fond.
    private var edgeColor: Color {
        let scrim: RGB = (8, 8, 7)
        var pair: [RGB] = preset.edges.map(rgb)
        if appearance.background == "cover" { pair = [rgb("#0f0f0d"), rgb("#0f0f0d")] }
        if let measure, measuredKey == sourceKey, sourceKey != nil {
            let shade = appearance.background == "cover" ? max(0.5, measure.shade) : max(measure.shade, preset.minShade)
            pair = [measure.top, measure.bottom].map { ($0.r * (1 - shade) + scrim.r * shade, $0.g * (1 - shade) + scrim.g * shade, $0.b * (1 - shade) + scrim.b * shade) }
        }
        return color(pair.min { relativeLuminance($0) < relativeLuminance($1) } ?? pair[0])
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .top) {
                if appearance.background == "cover" {
                    edgeColor
                    if let measure, let blur = measure.blur {
                        Image(uiImage: blur).resizable().interpolation(.high)
                            .scaledToFill()
                            .frame(width: (geometry.size.width + geometry.safeAreaInsets.leading + geometry.safeAreaInsets.trailing) * 1.16, height: (geometry.size.height + geometry.safeAreaInsets.top + geometry.safeAreaInsets.bottom) * 1.16)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .clipped()
                            .transition(.opacity)
                            .id(measuredKey)
                        Color(red: 8 / 255, green: 8 / 255, blue: 7 / 255).opacity(max(0.5, measure.shade))
                    }
                } else {
                    GradientLayers(layers: preset.layers)
                    if let image = preset.image {
                        Image(image).resizable().interpolation(.high).scaledToFill()
                            .frame(width: geometry.size.width + geometry.safeAreaInsets.leading + geometry.safeAreaInsets.trailing, height: geometry.size.height + geometry.safeAreaInsets.top + geometry.safeAreaInsets.bottom)
                            .clipped()
                        Color(red: 8 / 255, green: 8 / 255, blue: 7 / 255).opacity(max(measuredKey == sourceKey ? measure?.shade ?? 0.65 : 0.65, preset.minShade))
                    }
                }
                if edges {
                    VStack(spacing: 0) {
                        edgeColor.frame(height: geometry.safeAreaInsets.top + 4)
                        LinearGradient(colors: [edgeColor, edgeColor.opacity(0)], startPoint: .top, endPoint: .bottom).frame(height: 64)
                        Spacer(minLength: 0)
                        LinearGradient(colors: [edgeColor.opacity(0), edgeColor], startPoint: .top, endPoint: .bottom).frame(height: 64)
                        edgeColor.frame(height: geometry.safeAreaInsets.bottom + 12)
                    }
                }
            }
            .ignoresSafeArea()
            .animation(.easeInOut(duration: 0.8), value: measuredKey)
        }
        .task(id: sourceKey) { await load() }
    }

    private func load() async {
        guard let key = sourceKey else { return }
        if let found = BackdropLab.cached(key) { measure = found; measuredKey = key; return }
        var image: UIImage?
        if appearance.background == "cover" {
            if let url = coverURL(key, size: 250) { image = await CoverCache.shared.image(url, pixels: 120) }
        } else { image = UIImage(named: key) }
        guard let image, let found = await BackdropLab.measure(key: key, image: image, blur: appearance.background == "cover") else { return }
        guard key == sourceKey else { return }
        measure = found
        measuredKey = key
    }
}

/// Pochette en grand flou, même rendu que le fond de l’app (lecteur en grand).
struct BlurredCover: View {
    let address: String
    @State private var image: UIImage?
    var body: some View {
        GeometryReader { geometry in
            if let image {
                Image(uiImage: image).resizable().interpolation(.high).scaledToFill()
                    .frame(width: geometry.size.width * 1.16, height: geometry.size.height * 1.16)
                    .frame(width: geometry.size.width, height: geometry.size.height)
                    .clipped()
                    .transition(.opacity)
            }
        }
        .task(id: address) {
            if let found = BackdropLab.cached(address)?.blur { image = found; return }
            guard let url = coverURL(address, size: 250), let small = await CoverCache.shared.image(url, pixels: 120),
                  let found = await BackdropLab.measure(key: address, image: small, blur: true)?.blur else { return }
            withAnimation(.easeInOut(duration: 0.6)) { image = found }
        }
    }
}
