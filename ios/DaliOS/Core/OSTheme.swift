import CoreText
import SwiftUI

/// The dali.os design system (STYLE_GUIDE.md at the repo root), mirrored from
/// the tokens in dali-api/app/app.css. Tokens only: views never hardcode a hex.
enum OS {
    // MARK: Surfaces (light / dark)
    static let bg = Color(light: 0xE9EEF3, dark: 0x282830)
    static let nav = Color(light: 0xDDE5ED, dark: 0x24242A)
    static let card = Color(light: 0xFFFFFF, dark: 0x2B2B36)
    static let well = Color(light: 0xEAEFF5, dark: 0x26262F)
    static let container = Color(light: 0xCCD7E2, dark: 0x3F3F48)

    // MARK: Ink and accent
    static let fg = Color(light: 0x13293A, dark: 0xFFFFFF)
    static let grey = Color(light: 0x4D5C69, dark: 0xBABABA)
    static let muted = Color(light: 0x78899A, dark: 0x6A6A73)
    static let accent = Color(light: 0x0F6E7D, dark: 0xA8D3DE)
    static let green = Color(light: 0x0F7A4D, dark: 0x9FE0A8)
    static let amber = Color(light: 0x8F5400, dark: 0xF2B84B)
    static let danger = Color(light: 0xC0362F, dark: 0xFF6B6B)
    static let shadow = Color(light: 0x13293A, dark: 0x000000).opacity(0.16)

    // MARK: Category palette (fill / ink), for record types on the timeline
    struct Category {
        let fill: Color
        let ink: Color
    }

    static let slate = Category(fill: Color(light: 0xDDE5EF, dark: 0x2B3340), ink: Color(light: 0x3A4C60, dark: 0xAEC4DE))
    static let blue = Category(fill: Color(light: 0xD6E8FB, dark: 0x1E3348), ink: Color(light: 0x17456E, dark: 0xA2D2FD))
    static let violet = Category(fill: Color(light: 0xE6DDFA, dark: 0x31284A), ink: Color(light: 0x45307D, dark: 0xC3AEF2))

    // MARK: Shape
    static let cardRadius: CGFloat = 24
    static let itemRadius: CGFloat = 12
    static let fieldRadius: CGFloat = 10

    // MARK: Type — Mulish everywhere
    static func font(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        .custom("Mulish", fixedSize: size).weight(weight)
    }

    /// Eyebrow/caption: small, bold, uppercase, tracked, grey.
    static let eyebrow = font(12, .bold)

    /// Registers the bundled Mulish variable font. Call once at launch.
    static func registerFonts() {
        guard let url = Bundle.main.url(forResource: "Mulish-Variable", withExtension: "ttf") else { return }
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    }
}

extension Color {
    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            let hex = traits.userInterfaceStyle == .dark ? dark : light
            return UIColor(
                red: CGFloat((hex >> 16) & 0xFF) / 255,
                green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255,
                alpha: 1
            )
        })
    }
}

extension View {
    /// Section eyebrow per the guide: uppercase, tracked, grey.
    func osEyebrow() -> some View {
        font(OS.eyebrow).tracking(1.2).textCase(.uppercase).foregroundStyle(OS.grey)
    }

    /// A flat card: no border, no shadow. The ground does the work.
    func osCard(padding: CGFloat = 24) -> some View {
        self.padding(padding).background(OS.card, in: .rect(cornerRadius: OS.cardRadius))
    }
}

/// Every button is a pill. Primary = accent fill with page-colored text;
/// ghost = grey text on a quiet fill. Presses scale to 0.97.
struct OSPillButtonStyle: ButtonStyle {
    enum Kind { case primary, ghost }
    var kind: Kind = .primary
    var size: CGFloat = 17

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(OS.font(size, .semibold))
            .padding(.horizontal, 20)
            .frame(minHeight: 48)
            .foregroundStyle(kind == .primary ? OS.bg : OS.grey)
            .background(kind == .primary ? OS.accent : OS.container.opacity(0.6), in: .capsule)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

/// Status: one neutral pill with a colored dot, not a tinted chip.
struct OSStatusPill: View {
    let text: String
    let dot: Color
    var size: CGFloat = 14

    var body: some View {
        HStack(spacing: size * 0.6) {
            Circle().fill(dot).frame(width: size * 0.6, height: size * 0.6)
            Text(text).font(OS.font(size, .semibold)).foregroundStyle(OS.fg)
        }
        .padding(.horizontal, size * 0.85)
        .padding(.vertical, size * 0.45)
        .background(OS.card, in: .capsule)
    }
}
