import CoreText
import SwiftUI
import UIKit

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}
extension Color {
    init(hex: UInt32) { self.init(UIColor(hex: hex)) }
}

/// Brand palette (same tokens as the Android app and the admin sites), taken from the fest poster: cream paper, deep maroon,
/// warm black ink and the orange sun. Light only: the app never switches to dark mode.
enum P {
    static let bg = Color(hex: 0xF2E7D7)
    static let surface = Color(hex: 0xFBF6EC)
    static let surfaceAlt = Color(hex: 0xE9DCC6)
    static let ink = Color(hex: 0x161818)
    static let muted = Color(hex: 0x6F5E54)
    static let line = Color(hex: 0xE0D1BB)
    static let primary = Color(hex: 0x7E1322)
    static let onPrimary = Color(hex: 0xFBF3E6)
    static let mint = Color(hex: 0xEBD4CA)
    static let mintInk = Color(hex: 0x7E1322)
    static let accent = Color(hex: 0xEB732F)
    static let hero1 = Color(hex: 0x911729)
    static let hero2 = Color(hex: 0x4B181F)
    static let danger = Color(hex: 0xB3261E)
    static let sun = Color(hex: 0xEB732F)
    static let cream = Color(hex: 0xF2E7D7)
}

/// Manrope (display) and DM Sans (body) are bundled variable fonts; weights are set through the `wght` axis and
/// every style scales with Dynamic Type. Falls back to the system font if a family is unavailable.
enum Fonts {
    private static let families = Set(UIFont.familyNames)
    private static let wght = NSNumber(value: 0x77676874) // 'wght'

    static func custom(_ family: String, _ size: CGFloat, weight: CGFloat, style: UIFont.TextStyle, fallback: Font.Weight) -> Font {
        guard families.contains(family) else { return .system(size: size, weight: fallback) }
        let variation = UIFontDescriptor.AttributeName(rawValue: kCTFontVariationAttribute as String)
        let desc = UIFontDescriptor(fontAttributes: [.family: family, variation: [wght: NSNumber(value: Double(weight))]])
        let base = UIFont(descriptor: desc, size: size)
        return Font(UIFontMetrics(forTextStyle: style).scaledFont(for: base) as CTFont)
    }
    static func display(_ size: CGFloat, _ weight: CGFloat = 700, style: UIFont.TextStyle = .title1) -> Font {
        custom("Manrope", size, weight: weight, style: style, fallback: weight >= 700 ? .bold : (weight >= 600 ? .semibold : .medium))
    }
    /// Anton (poster display type): page titles, big numerals. Falls back to a heavy system face.
    static func poster(_ size: CGFloat, style: UIFont.TextStyle = .largeTitle) -> Font {
        guard let base = UIFont(name: "Anton-Regular", size: size) else { return .system(size: size, weight: .heavy) }
        return Font(UIFontMetrics(forTextStyle: style).scaledFont(for: base) as CTFont)
    }
    static func body(_ size: CGFloat, _ weight: CGFloat = 400, style: UIFont.TextStyle = .body) -> Font {
        custom("DM Sans", size, weight: weight, style: style, fallback: weight >= 700 ? .bold : (weight >= 500 ? .medium : .regular))
    }
}

enum T {
    static let hero = Fonts.poster(60)
    static let poster = Fonts.poster(40)
    static let h1 = Fonts.display(28, 700, style: .title1)
    static let h2 = Fonts.display(22, 700, style: .title2)
    static let title = Fonts.display(17, 600, style: .headline)
    static let body = Fonts.body(15, 400, style: .body)
    static let bodyM = Fonts.body(14, 500, style: .subheadline)
    static let small = Fonts.body(13, 400, style: .footnote)
    static let label = Fonts.body(11, 700, style: .caption1)
    static let button = Fonts.display(15, 700, style: .headline)
}
