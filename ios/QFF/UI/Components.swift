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
            .shadow(color: P.ink.opacity(0.05), radius: 14, y: 6)
    }
}

/// Page background: the cool off-white with a faint violet glow at the top, so screens have depth without noise.
struct Backdrop: View {
    var body: some View {
        ZStack(alignment: .top) {
            P.bg
            RadialGradient(colors: [P.sun.opacity(0.14), .clear], center: .center, startRadius: 0, endRadius: 260)
                .frame(width: 520, height: 520).offset(x: 120, y: -190)
        }
        .ignoresSafeArea()
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
            Canvas { gc, size in
                draw(gc, size: size, time: ctx.date.timeIntervalSinceReferenceDate)
            }
        }
        .accessibilityHidden(true)
    }

    private func draw(_ gc: GraphicsContext, size: CGSize, time: Double) {
        let cx: CGFloat = size.width / 2
        let cy: CGFloat = size.height / 2
        let rx: CGFloat = min(size.width, size.height) * 0.46
        let ry: CGFloat = rx * 0.36
        let rotations: [Double] = [0, 60, 120]
        let turn: Double = time / period * 2.0 * Double.pi
        for i in 0..<rotations.count {
            var g = gc
            g.translateBy(x: cx, y: cy)
            g.rotate(by: Angle.degrees(rotations[i]))
            let orbit = Path(ellipseIn: CGRect(x: -rx, y: -ry, width: rx * 2, height: ry * 2))
            g.stroke(orbit, with: GraphicsContext.Shading.color(color.opacity(0.55)), lineWidth: lineWidth)
            let direction: Double = (i == 1) ? -1.0 : 1.0
            let angle: Double = turn * direction + Double(i) * 2.0944
            let ex: CGFloat = rx * CGFloat(cos(angle))
            let ey: CGFloat = ry * CGFloat(sin(angle))
            let halo: CGFloat = lineWidth * 7
            g.fill(Path(ellipseIn: CGRect(x: ex - halo, y: ey - halo, width: halo * 2, height: halo * 2)), with: GraphicsContext.Shading.color(electron.opacity(0.28))) // soft glow so the moving ions read at a glance
            let r: CGFloat = lineWidth * 3.6
            let dot = Path(ellipseIn: CGRect(x: ex - r, y: ey - r, width: r * 2, height: r * 2))
            g.fill(dot, with: GraphicsContext.Shading.color(electron))
        }
        let nr: CGFloat = lineWidth * 4.4
        let nucleus = Path(ellipseIn: CGRect(x: cx - nr, y: cy - nr, width: nr * 2, height: nr * 2))
        gc.fill(nucleus, with: GraphicsContext.Shading.color(color))
    }
}

/// Official Qiskit mark, no tile: the glyph sits directly on the page.
struct QiskitMark: View {
    var size: CGFloat = 38
    var tint: Color = P.ink
    var body: some View {
        Image("QiskitMark").renderingMode(.template).resizable().scaledToFit()
            .foregroundStyle(tint).frame(width: size, height: size)
            .accessibilityLabel("Qiskit")
    }
}

struct PartnerLine: View {
    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                QiskitMark(size: 18)
                Text("In partnership with IBM").font(T.small).foregroundStyle(P.muted)
            }
            Text("SRM UNIVERSITY AP · AMARAVATI").font(Fonts.body(10, 700, style: .caption2)).tracking(1.6).foregroundStyle(P.muted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 28)
    }
}

/// Frosted glass: blurs whatever is behind it, with a bright hairline edge.
extension View {
    func glass(_ shape: some Shape, tint: Color = .white.opacity(0.10)) -> some View {
        self.background(.ultraThinMaterial, in: shape)
            .background(tint, in: shape)
            .overlay(shape.stroke(.white.opacity(0.45), lineWidth: 1))
    }
}

/// Event lockup, as on the poster: logo mark + "IBM Quantum" over "Qiskit Fall Fest 2026".
struct Logo: View {
    var color: Color = P.ink
    var body: some View {
        HStack(spacing: 10) {
            QiskitMark(size: 38, tint: color)
            VStack(alignment: .leading, spacing: 1) {
                (Text("IBM ").font(Fonts.display(17, 500, style: .headline)) + Text("Quantum").font(Fonts.display(17, 800, style: .headline)))
                Text("Qiskit Fall Fest 2026").font(Fonts.display(12, 700, style: .caption1))
            }.foregroundStyle(color)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("IBM Quantum, Qiskit Fall Fest 2026")
    }
}

/// Four-point sparkle, the poster's little accent mark.
struct Sparkle: View {
    var size: CGFloat
    var color: Color = P.primary
    var body: some View {
        Path { p in
            let c = size / 2, k = size * 0.07
            p.move(to: CGPoint(x: c, y: 0))
            p.addQuadCurve(to: CGPoint(x: size, y: c), control: CGPoint(x: c + k, y: c - k))
            p.addQuadCurve(to: CGPoint(x: c, y: size), control: CGPoint(x: c + k, y: c + k))
            p.addQuadCurve(to: CGPoint(x: 0, y: c), control: CGPoint(x: c - k, y: c + k))
            p.addQuadCurve(to: CGPoint(x: c, y: 0), control: CGPoint(x: c - k, y: c - k))
        }
        .fill(color).frame(width: size, height: size).accessibilityHidden(true)
    }
}

/// Page title in poster type: two lines, the second in maroon.
struct PosterTitle: View {
    let first: String
    let second: String
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(first).foregroundStyle(P.ink).frame(height: 46, alignment: .leading)
            Text(second).foregroundStyle(P.primary).frame(height: 46, alignment: .leading)
        }
        .font(T.poster).tracking(0.4)
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
                gc.fill(Path(roundedRect: CGRect(x: CGFloat(x) * cell, y: CGFloat(y) * cell, width: cell + 0.6, height: cell + 0.6), cornerRadius: cell * 0.28), with: .color(P.ink))
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
