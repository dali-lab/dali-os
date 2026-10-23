import SwiftUI

/// The door display's palette: the DALI brand colors (teal, coral, yellow,
/// navy) rather than the dali.os app tokens in `OS`, since the display is a
/// sign on the wall, read from down the hall.
enum Brand {
    // MARK: Brand fills (same in light and dark)
    static let teal = Color(hex: 0x24B1B1)
    static let coral = Color(hex: 0xE45768)
    static let yellow = Color(hex: 0xFFCF88)
    static let navy = Color(hex: 0x0C4876)
    static let darkNavy = Color(hex: 0x083858)
    static let coolBlack = Color(hex: 0x0B1C29)
    static let coolWhite = Color(hex: 0xF5F9FF)
    static let paleBlue = Color(hex: 0xD4EDFF)
    static let mediumGray = Color(hex: 0xA7B5C8)
    static let lightTeal = Color(hex: 0x4CD5C5)
    static let paleTeal = Color(hex: 0x8CE0D6)
    static let lightYellow = Color(hex: 0xFFF3B5)

    // MARK: Surfaces and ink (light / dark)
    static let surface = Color(light: 0xFFFFFF, dark: 0x0E1C29)
    static let surfaceMuted = Color(light: 0xF5F9FF, dark: 0x0A1520)
    static let textStrong = Color(light: 0x0B1C29, dark: 0xE8F1FB)
    static let textHeading = Color(light: 0x0C4876, dark: 0xD4EDFF)
    static let textMuted = Color(light: 0x404040, dark: 0xA7B5C8)
    static let borderSubtle = Color(light: 0xD4EDFF, dark: 0x1F3A52)
    static let shadow = Color.black.opacity(0.07)

    // MARK: Type
    static func heading(_ size: CGFloat) -> Font { OS.font(size, .bold) }
    static func body(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font { OS.font(size, weight) }
    /// Eyebrows and times: mono, like the design's DM Mono.
    static func mono(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .monospaced)
    }

    static let panelRadius: CGFloat = 16
    static let cardRadius: CGFloat = 12
    static let rowRadius: CGFloat = 8
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

extension View {
    /// Small uppercase mono label, tracked out.
    func brandEyebrow(_ color: Color = Brand.textMuted, size: CGFloat = 12, tracking: CGFloat = 2.2) -> some View {
        font(Brand.mono(size)).tracking(tracking).textCase(.uppercase).foregroundStyle(color)
    }
}

/// The design system's button: a pill (or rounded rect) in teal, navy, or
/// coral, filled, tinted, outlined, or bare.
struct BrandButtonStyle: ButtonStyle {
    enum Variant { case primary, secondary, outline, ghost }
    enum Tint { case teal, navy, coral }
    enum Size { case sm, md, lg }

    var variant: Variant = .primary
    var tint: Tint = .teal
    var size: Size = .md
    var rounded = false
    var fullWidth = false

    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Brand.body(fontSize, .semibold))
            .labelStyle(BrandButtonLabelStyle(iconSize: iconSize))
            .lineLimit(1)
            .padding(.horizontal, horizontalPadding)
            .frame(height: height)
            .frame(maxWidth: fullWidth ? .infinity : nil)
            .foregroundStyle(foreground)
            .background(background, in: .rect(cornerRadius: rounded ? Brand.rowRadius : height / 2))
            .overlay {
                if variant == .outline {
                    RoundedRectangle(cornerRadius: rounded ? Brand.rowRadius : height / 2)
                        .strokeBorder(color, lineWidth: 1)
                }
            }
            .shadow(color: variant == .primary && isEnabled ? Brand.shadow : .clear, radius: 2, y: 1)
            .opacity(isEnabled ? 1 : 0.5)
            .brightness(configuration.isPressed && variant == .primary ? -0.08 : 0)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }

    private var color: Color {
        switch tint {
        case .teal: Brand.teal
        case .navy: Brand.textHeading
        case .coral: Brand.coral
        }
    }

    private var foreground: Color {
        switch variant {
        case .primary: .white
        case .secondary: tint == .navy ? Brand.navy : Brand.coolBlack
        case .outline, .ghost: color
        }
    }

    private var background: Color {
        switch variant {
        case .primary: tint == .navy ? Brand.navy : color
        case .secondary:
            switch tint {
            case .teal: Brand.paleTeal
            case .navy: Brand.paleBlue
            case .coral: Color(hex: 0xFFA89C)
            }
        case .outline, .ghost: .clear
        }
    }

    private var height: CGFloat {
        switch size { case .sm: 36; case .md: 44; case .lg: 56 }
    }

    private var fontSize: CGFloat {
        switch size { case .sm: 15; case .md: 16; case .lg: 19 }
    }

    private var iconSize: CGFloat {
        switch size { case .sm: 14; case .md: 16; case .lg: 20 }
    }

    private var horizontalPadding: CGFloat {
        switch size { case .sm: 14; case .md: 20; case .lg: 24 }
    }
}

private struct BrandButtonLabelStyle: LabelStyle {
    let iconSize: CGFloat

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 8) {
            configuration.icon.font(.system(size: iconSize, weight: .semibold))
            configuration.title
        }
    }
}

/// A small pill: "DALI event check-in", "Now", "Event".
struct BrandBadge: View {
    enum Tone { case info, danger }

    let text: String
    var tone: Tone = .info
    var dot = true
    var pulse = false

    var body: some View {
        HStack(spacing: 6) {
            if dot {
                if pulse { PulsingDot(color: ink) } else { Circle().fill(ink).frame(width: 7, height: 7) }
            }
            Text(text)
                .font(Brand.body(13, .semibold))
                .foregroundStyle(ink)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(fill, in: .capsule)
    }

    private var ink: Color { tone == .info ? Brand.textHeading : Color(hex: 0xCF4253) }
    private var fill: Color {
        tone == .info ? Color(light: 0xD4EDFF, dark: 0x1F3A52) : Color(light: 0xFFE4E1, dark: 0x3A1E24)
    }
}

/// A live indicator: a solid dot with a soft ring breathing out from it.
struct PulsingDot: View {
    let color: Color
    var size: CGFloat = 7
    @State private var pulsing = false

    var body: some View {
        ZStack {
            Circle()
                .fill(color.opacity(0.4))
                .scaleEffect(pulsing ? 2.4 : 1)
                .opacity(pulsing ? 0 : 1)
            Circle().fill(color)
        }
        .frame(width: size, height: size)
        .onAppear {
            withAnimation(.easeOut(duration: 1.6).repeatForever(autoreverses: false)) { pulsing = true }
        }
    }
}

/// The DALI Lab wordmark, tinted.
struct DaliLogo: View {
    var color: Color = Brand.textHeading
    var width: CGFloat = 96

    var body: some View {
        Image("DaliLogo")
            .renderingMode(.template)
            .resizable()
            .scaledToFit()
            .frame(width: width)
            .foregroundStyle(color)
            .accessibilityLabel("DALI Lab")
    }
}

/// A member's photo, or their initials when there isn't one (or it fails to load).
struct MemberAvatar: View {
    let firstName: String
    let lastName: String
    let photoUrl: String?
    var size: CGFloat = 36
    var ring = false

    var body: some View {
        AsyncImage(url: photoUrl.flatMap(URL.init(string:))) { phase in
            if let image = phase.image {
                image.resizable().scaledToFill()
            } else {
                Text(initials)
                    .font(Brand.body(size * 0.38, .bold))
                    .foregroundStyle(Brand.navy)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Brand.paleBlue)
            }
        }
        .frame(width: size, height: size)
        .clipShape(.circle)
        .overlay {
            if ring { Circle().strokeBorder(.white, lineWidth: max(2, size * 0.04)) }
        }
        .accessibilityHidden(true)
    }

    private var initials: String {
        "\(firstName.prefix(1))\(lastName.prefix(1))".uppercased()
    }
}

extension ScannedMember {
    var fullName: String { "\(firstName) \(lastName)" }
}
