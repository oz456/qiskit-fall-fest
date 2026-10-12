import SwiftUI

// MARK: - Buttons & surfaces

struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .opacity(configuration.isPressed ? 0.92 : 1)
            .animation(.spring(response: 0.28, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

struct PrimaryButton: View {
    let title: String
    var systemImage: String? = nil
    var loading = false
    var enabled = true
    let action: () -> Void
    var body: some View {
        Button {
            guard enabled, !loading else { return }
            Haptics.tap(); action()
        } label: {
            ZStack {
                if loading { ProgressView().tint(P.onPrimary) }
                else {
                    HStack(spacing: 10) {
                        Text(title).font(T.button).tracking(1)
                        if let s = systemImage { Image(systemName: s).font(.system(size: 16, weight: .semibold)) }
                    }
                }
            }
            .foregroundStyle(P.onPrimary)
            .frame(maxWidth: .infinity, minHeight: 58)
            .background(P.primary.opacity(enabled ? 1 : 0.4), in: Capsule())
        }
        .buttonStyle(PressStyle())
        .disabled(!enabled)
        .accessibilityLabel(title.capitalized)
    }
}

struct Card<Content: View>: View {
    var radius: CGFloat = 24
    @ViewBuilder var content: Content
    var body: some View {
        content
            .background(P.surface, in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(P.line, lineWidth: 1))
    }
}

struct Pill: View {
    let text: String
    let bg: Color
    let fg: Color
    var dot = false
    var body: some View {
        HStack(spacing: 6) {
            if dot { PulseDot(color: fg) }
            Text(text).font(Fonts.body(10, 700, style: .caption2)).tracking(0.8).lineLimit(1)
        }
        .foregroundStyle(fg)
        .padding(.horizontal, 10).padding(.vertical, 4)
        .background(bg, in: Capsule())
    }
}

struct PulseDot: View {
    let color: Color
    var size: CGFloat = 6
    @State private var on = false
    var body: some View {
        ZStack {
            Circle().fill(color.opacity(on ? 0 : 0.5)).frame(width: size * (on ? 2.6 : 1), height: size * (on ? 2.6 : 1))
            Circle().fill(color).frame(width: size, height: size)
        }
        .frame(width: size * 2.6, height: size * 2.6)
        .onAppear { withAnimation(.easeOut(duration: 1.3).repeatForever(autoreverses: false)) { on = true } }
        .accessibilityHidden(true)
    }
}

struct IconBubble: View {
    let symbol: String
    var size: CGFloat = 48
    var tint: Color = P.ink
    var bg: Color = P.surfaceAlt
    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.42, weight: .regular))
            .foregroundStyle(tint)
            .frame(width: size, height: size)
            .background(bg, in: RoundedRectangle(cornerRadius: size * 0.32, style: .continuous))
            .accessibilityHidden(true)
    }
}

struct SectionLabel: View {
    let text: String
    var body: some View { Text(text).font(T.label).tracking(1.3).foregroundStyle(P.muted) }
}

// MARK: - Brand

/// Animated quantum atom: three tilted orbits with electrons.
struct AtomOrb: View {
    var color: Color = P.ink
    var electron: Color = P.accent
    var lineWidth: CGFloat = 1.2
    var period: Double = 9
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { ctx in
            let t = ctx.date.timeIntervalSinceReferenceDate
            Canvas { gc, size in
                let c = CGPoint(x: size.width / 2, y: size.height / 2)
                let rx = min(size.width, size.height) * 0.46
                let ry = rx * 0.36
                for (i, rot) in [0.0, 60.0, 120.0].enumerated() {
                    var g = gc
                    g.translateBy(x: c.x, y: c.y)
                    g.rotate(by: .degrees(rot))
                    g.stroke(Path(ellipseIn: CGRect(x: -rx, y: -ry, width: rx * 2, height: ry * 2)), with: .color(color.opacity(0.55)), lineWidth: lineWidth)
                    let ang = (t / period * 2 * .pi) * (i == 1 ? -1 : 1) + Double(i) * 2.0944
                    let p = CGPoint(x: rx * cos(ang), y: ry * sin(ang))
                    let r = lineWidth * 3.2
                    g.fill(Path(ellipseIn: CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)), with: .color(electron))
                }
                let r = lineWidth * 4.4
                gc.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(color))
            }
        }
        .accessibilityHidden(true)
    }
}

/// Official Qiskit mark on a brand tile.
struct QiskitMark: View {
    var size: CGFloat = 38
    var body: some View {
        Image("QiskitMark")
            .renderingMode(.template)
            .resizable().scaledToFit()
            .foregroundStyle(.white)
            .padding(size * 0.19)
            .frame(width: size, height: size)
            .background(LinearGradient(colors: [Color(hex: 0x8A4DE0), Color(hex: 0x4A1C96)], startPoint: .topLeading, endPoint: .bottomTrailing),
                        in: RoundedRectangle(cornerRadius: size * 0.3, style: .continuous))
            .accessibilityLabel("Qiskit")
    }
}

struct Logo: View {
    var color: Color = P.ink
    var body: some View {
        HStack(spacing: 10) {
            QiskitMark()
            VStack(alignment: .leading, spacing: 0) {
                Text("QISKIT").font(T.title).tracking(0.3)
                Text("FALL FEST ’26").font(T.title).tracking(0.3)
            }.foregroundStyle(color)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Qiskit Fall Fest 2026")
    }
}

/// QR drawn with soft rounded modules.
struct QRView: View {
    let payload: String
    var body: some View {
        let m = QRMatrix.make(payload)
        Canvas { gc, size in
            guard let m, let n = m.first?.count, n > 0 else { return }
            let cell = size.width / CGFloat(n)
            for y in 0..<n { for x in 0..<n where m[y][x] {
                gc.fill(Path(roundedRect: CGRect(x: CGFloat(x) * cell, y: CGFloat(y) * cell, width: cell + 0.6, height: cell + 0.6), cornerRadius: cell * 0.28), with: .color(Color(hex: 0x0B1A13)))
            } }
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityLabel("Your pass QR code")
    }
}

struct Toast: View {
    let text: String
    var body: some View {
        Text(text)
            .font(T.bodyM).foregroundStyle(P.bg)
            .padding(.horizontal, 20).padding(.vertical, 12)
            .background(P.ink, in: Capsule())
            .shadow(color: .black.opacity(0.2), radius: 12, y: 4)
            .padding(.horizontal, 24)
    }
}
