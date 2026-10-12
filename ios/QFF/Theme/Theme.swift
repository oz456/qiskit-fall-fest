import CoreText
import SwiftUI
import UIKit

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}
extension Color {
    /// Adaptive colour: follows the system light/dark appearance automatically.
    init(light: UInt32, dark: UInt32) {
        self.init(UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: dark) : UIColor(hex: light) })
    }
    init(hex: UInt32) { self.init(UIColor(hex: hex)) }
}

/// Brand palette (same tokens as the Android app and the admin sites).
enum P {
    static let bg = Color(light: 0xF6F5F0, dark: 0x0C1511)
    static let surface = Color(light: 0xFFFFFF, dark: 0x142019)
    static let surfaceAlt = Color(light: 0xEFEEE8, dark: 0x1B2A22)
    static let ink = Color(light: 0x111A16, dark: 0xF0F5F2)
    static let muted = Color(light: 0x6B7470, dark: 0x93A29A)
    static let line = Color(light: 0xE6E4DB, dark: 0x243529)
    static let primary = Color(light: 0x163226, dark: 0x7BE0AD)
    static let onPrimary = Color(light: 0xFFFFFF, dark: 0x0A1A12)
    static let mint = Color(light: 0xDDF3E6, dark: 0x1B3A2C)
    static let mintInk = Color(light: 0x17583C, dark: 0x8FE8BA)
    static let accent = Color(hex: 0x7BE0AD)
    static let hero1 = Color(hex: 0x1F4A39)
    static let hero2 = Color(light: 0x0B1A13, dark: 0x08110D)
    static let danger = Color(light: 0xC0392B, dark: 0xFF8A7A)
    static let qiskitPurple = Color(hex: 0x6929C4)
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
    static func body(_ size: CGFloat, _ weight: CGFloat = 400, style: UIFont.TextStyle = .body) -> Font {
        custom("DM Sans", size, weight: weight, style: style, fallback: weight >= 700 ? .bold : (weight >= 500 ? .medium : .regular))
    }
}

enum T {
    static let hero = Fonts.display(44, 500, style: .largeTitle)
    static let h1 = Fonts.display(28, 700, style: .title1)
    static let h2 = Fonts.display(22, 700, style: .title2)
    static let title = Fonts.display(17, 600, style: .headline)
    static let body = Fonts.body(15, 400, style: .body)
    static let bodyM = Fonts.body(14, 500, style: .subheadline)
    static let small = Fonts.body(13, 400, style: .footnote)
    static let label = Fonts.body(11, 700, style: .caption1)
    static let button = Fonts.display(15, 700, style: .headline)
}
