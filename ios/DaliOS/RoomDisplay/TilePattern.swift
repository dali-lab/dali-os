import SwiftUI

/// The DALI brand tile pattern: a grid of square tiles, each a background
/// fill and a shape (dot, ring, flower, asterisk, quarter round), clustered
/// so it thins out toward the edges, with a few loose dots around it. A port of the design system's
/// TilePattern; the same seed gives the same tiles.
struct TilePattern: View {
    struct Pair: Hashable {
        let background: Color
        let foreground: Color
    }

    let rows: Int
    let columns: Int
    var tileSize: CGFloat = 40
    var seed: Int32 = 7
    var density = 0.65
    let pairs: [Pair]

    var body: some View {
        let tiles = TileLayout.tiles(rows: rows, columns: columns, seed: seed, density: density, pairCount: pairs.count)
        Canvas { context, _ in
            for (index, tile) in tiles.enumerated() {
                guard let tile else { continue }
                let origin = CGPoint(x: CGFloat(index % columns) * tileSize, y: CGFloat(index / columns) * tileSize)
                draw(tile, at: origin, in: &context)
            }
        }
        .frame(width: CGFloat(columns) * tileSize, height: CGFloat(rows) * tileSize)
        .accessibilityHidden(true)
    }

    private func draw(_ tile: TileLayout.Tile, at origin: CGPoint, in context: inout GraphicsContext) {
        let s = tileSize / 100
        let rect = CGRect(origin: origin, size: CGSize(width: tileSize, height: tileSize))
        if tile.shape == .loose {
            let r = 20 * s
            let dot = CGRect(x: rect.midX - r, y: rect.midY - r, width: 2 * r, height: 2 * r)
            context.fill(Path(ellipseIn: dot), with: .color(TileLayout.looseColors[tile.pair % TileLayout.looseColors.count]))
            return
        }
        let pair = pairs[tile.pair]
        if tile.shape != .quarter {
            context.fill(Path(rect), with: .color(pair.background))
        }
        var tileContext = context
        tileContext.translateBy(x: rect.midX, y: rect.midY)
        tileContext.rotate(by: .degrees(Double(tile.rotation)))
        tileContext.translateBy(x: -tileSize / 2, y: -tileSize / 2)

        func circle(_ cx: CGFloat, _ cy: CGFloat, _ r: CGFloat) -> Path {
            Path(ellipseIn: CGRect(x: (cx - r) * s, y: (cy - r) * s, width: 2 * r * s, height: 2 * r * s))
        }
        func ellipse(_ cx: CGFloat, _ cy: CGFloat, _ rx: CGFloat, _ ry: CGFloat) -> Path {
            Path(ellipseIn: CGRect(x: (cx - rx) * s, y: (cy - ry) * s, width: 2 * rx * s, height: 2 * ry * s))
        }

        switch tile.shape {
        case .dot:
            tileContext.fill(circle(50, 50, 25), with: .color(pair.foreground))
        case .ring:
            tileContext.fill(circle(50, 50, 27), with: .color(pair.foreground))
            tileContext.fill(circle(50, 50, 12), with: .color(pair.background))
        case .flower:
            for petal in [ellipse(50, 30, 11, 18), ellipse(50, 70, 11, 18), ellipse(30, 50, 18, 11), ellipse(70, 50, 18, 11)] {
                tileContext.fill(petal, with: .color(pair.foreground))
            }
        case .asterisk:
            var lines = Path()
            for (a, b) in [((50, 24), (50, 76)), ((24, 50), (76, 50)), ((32, 32), (68, 68)), ((68, 32), (32, 68))] {
                lines.move(to: CGPoint(x: CGFloat(a.0) * s, y: CGFloat(a.1) * s))
                lines.addLine(to: CGPoint(x: CGFloat(b.0) * s, y: CGFloat(b.1) * s))
            }
            tileContext.stroke(lines, with: .color(pair.foreground), style: StrokeStyle(lineWidth: 6 * s, lineCap: .round))
        case .quarter:
            var quarter = Path()
            quarter.move(to: CGPoint(x: 0, y: 100 * s))
            quarter.addLine(to: .zero)
            quarter.addArc(center: CGPoint(x: 0, y: 100 * s), radius: 100 * s, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
            quarter.closeSubpath()
            tileContext.fill(quarter, with: .color(pair.background))
        case .solid, .loose:
            break
        }
    }
}

/// Which tile goes where. Pure, so the same seed lays out the same tiles.
enum TileLayout {
    enum Shape: CaseIterable {
        case dot, ring, flower, asterisk, quarter, solid, loose

        var weight: Double {
            switch self {
            case .dot: 46
            case .ring: 14
            case .flower: 7
            case .asterisk: 5
            case .quarter: 9
            case .solid: 6
            case .loose: 8
            }
        }
    }

    struct Tile: Hashable {
        let shape: Shape
        /// Index into the pairs, or into `looseColors` for a loose dot.
        let pair: Int
        let rotation: Int
    }

    static let looseColors = [Brand.coral, Color(hex: 0x64B598), Color(hex: 0xE68FBE), Brand.teal, Brand.yellow, Brand.navy]

    static func tiles(rows: Int, columns: Int, seed: Int32, density: Double, pairCount: Int) -> [Tile?] {
        guard pairCount > 0 else { return Array(repeating: nil, count: rows * columns) }
        var random = Mulberry(seed: seed)
        let shapes = Shape.allCases
        let total = shapes.reduce(0) { $0 + $1.weight }
        let centers = (0..<3).map { _ in
            (
                x: Double(columns) * (0.2 + random.next() * 0.6),
                y: Double(rows) * (0.2 + random.next() * 0.6),
                r: Double(max(rows, columns)) * (0.35 + random.next() * 0.25)
            )
        }
        var tiles: [Tile?] = []
        var lastPair = -1
        for row in 0..<rows {
            for column in 0..<columns {
                let closeness = centers.map { 1 - hypot(Double(column) + 0.5 - $0.x, Double(row) + 0.5 - $0.y) / $0.r }.max()!
                let keep = min(1, max(0, closeness) * 1.4) * density + 0.06
                if random.next() > keep {
                    tiles.append(random.next() < 0.07 ? loose(&random) : nil)
                    continue
                }
                var pick = random.next() * total
                var shape = shapes[0]
                for candidate in shapes {
                    pick -= candidate.weight
                    if pick <= 0 {
                        shape = candidate
                        break
                    }
                }
                if shape == .loose {
                    tiles.append(loose(&random))
                    continue
                }
                var pair = Int(random.next() * Double(pairCount))
                if pair == lastPair { pair = (pair + 1) % pairCount }
                lastPair = pair
                tiles.append(Tile(shape: shape, pair: pair, rotation: Int(random.next() * 4) * 90))
            }
        }
        return tiles
    }

    private static func loose(_ random: inout Mulberry) -> Tile {
        Tile(shape: .loose, pair: Int(random.next() * Double(looseColors.count)), rotation: 0)
    }

    /// The design system's seeded PRNG (a mulberry32 variant), bit for bit.
    struct Mulberry {
        var state: Int32

        init(seed: Int32) { state = seed }

        mutating func next() -> Double {
            state = state &+ 1_831_565_813
            var t = UInt32(bitPattern: state)
            t = (t ^ (t >> 15)) &* (1 | UInt32(bitPattern: state))
            t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t
            return Double(t ^ (t >> 14)) / 4_294_967_296
        }
    }
}
