import SwiftUI
import UIKit

struct PassView: View {
    @EnvironmentObject var app: AppState
    @EnvironmentObject var router: Router
    @Environment(\.scenePhase) private var scenePhase
    @State private var captured = UIScreen.main.isCaptured
    @State private var fullQR = false

    private var mine: [Event] { app.events.filter { $0.saved || $0.registered } }
    private var hidden: Bool { captured || scenePhase != .active }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 2) {
                    SectionLabel(text: "MY PASS")
                    Text("One pass.\nEvery moment.").font(Fonts.display(32, 700, style: .largeTitle)).foregroundStyle(P.ink)
                }
                .padding(.horizontal, 24).padding(.vertical, 18)

                TimelineView(.periodic(from: .now, by: 0.25)) { _ in
                    TiltPass(payload: app.passPayload(), progress: app.passProgress(), hidden: hidden) { fullQR = true }
                }
                .padding(.horizontal, 24)

                Text(captured ? "The code is hidden while your screen is being recorded or shared."
                              : "Live code · refreshes every 30 seconds. Screenshots won’t scan.")
                    .font(T.small).foregroundStyle(P.muted).multilineTextAlignment(.center).frame(maxWidth: .infinity)
                    .padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 16)

                HStack(spacing: 10) {
                    stat("Saved", app.events.filter(\.saved).count)
                    stat("Registered", app.events.filter(\.registered).count)
                    stat("Check-ins", app.checkins.count)
                }
                .padding(.horizontal, 24)

                SectionLabel(text: "MY ENROLLED EVENTS").padding(.horizontal, 24).padding(.top, 28).padding(.bottom, 8)
                if mine.isEmpty {
                    Button { router.tab = .hub; Haptics.tap() } label: {
                        Card {
                            VStack(spacing: 12) {
                                IconBubble(symbol: "bookmark", size: 56, tint: P.mintInk, bg: P.mint)
                                Text("Your line-up is open").font(T.title).foregroundStyle(P.ink)
                                Text("Save or register for events from the Hub and they’ll show up here.").font(T.small).foregroundStyle(P.muted).multilineTextAlignment(.center)
                            }
                            .padding(24).frame(maxWidth: .infinity)
                        }
                    }
                    .buttonStyle(PressStyle()).padding(.horizontal, 24)
                }
                ForEach(mine) { e in EventRow(event: e, day: nil, trailing: false).padding(.horizontal, 24).padding(.vertical, 6) }
            }
            .padding(.bottom, 24)
        }
        .background(P.bg.ignoresSafeArea())
        .onReceive(NotificationCenter.default.publisher(for: UIScreen.capturedDidChangeNotification)) { _ in captured = UIScreen.main.isCaptured }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.userDidTakeScreenshotNotification)) { _ in app.message = "Screenshots won't scan — the code changes every 30 seconds." }
        .fullScreenCover(isPresented: $fullQR) { FullQR(hidden: hidden) { fullQR = false }.environmentObject(app) }
        .onAppear { if ProcessInfo.processInfo.environment["QFF_SCREEN"] == "qr" { fullQR = true } }
    }

    private func stat(_ label: String, _ value: Int) -> some View {
        Card(radius: 20) {
            VStack(alignment: .leading, spacing: 0) {
                Text("\(value)").font(T.h2).foregroundStyle(P.ink)
                Text(label).font(T.small).foregroundStyle(P.muted)
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Progress border around the QR tile (a circle would cut through the QR's corners).
struct CountdownRing: View {
    let progress: Double
    var corner: CGFloat = 18
    var color: Color = Color(hex: 0x163226)
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: corner, style: .continuous).stroke(color.opacity(0.15), lineWidth: 3)
            RoundedRectangle(cornerRadius: corner, style: .continuous).trim(from: 0, to: progress)
                .stroke(color, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .animation(.linear(duration: 0.25), value: progress)
        }
    }
}

private struct TiltPass: View {
    @EnvironmentObject var app: AppState
    let payload: String?
    let progress: Double
    let hidden: Bool
    let onQR: () -> Void
    @State private var rx: Double = 0
    @State private var ry: Double = 0

    var body: some View {
        let p = app.profile
        ZStack(alignment: .topTrailing) {
            LinearGradient(colors: [P.hero1, P.hero2], startPoint: .topLeading, endPoint: .bottomTrailing)
            AtomOrb(color: .white, period: 16).frame(width: 260, height: 260).opacity(0.3).offset(x: 70, y: -50)
            VStack(alignment: .leading, spacing: 22) {
                HStack {
                    Label("Secure Pass", systemImage: "checkmark.shield").font(T.bodyM).foregroundStyle(.white.opacity(0.8))
                    Spacer()
                    Pill(text: "ACTIVE", bg: Color(hex: 0x7BE0AD), fg: Color(hex: 0x08281A))
                }
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("ATTENDEE").font(T.label).tracking(1.3).foregroundStyle(.white.opacity(0.55))
                        Text((p?.name ?? "").uppercased()).font(Fonts.display(24, 700, style: .title2)).foregroundStyle(.white).lineLimit(2).minimumScaleFactor(0.7)
                        Text("ID: \(p?.passCode ?? "")").font(T.small).foregroundStyle(.white.opacity(0.75)).padding(.top, 2)
                        if let c = p?.college { Text(c).font(T.small).foregroundStyle(.white.opacity(0.55)).lineLimit(1) }
                    }
                    Spacer(minLength: 8)
                    Button(action: onQR) {
                        ZStack {
                            Color.white
                            if let payload, !hidden { QRView(payload: payload).padding(10) }
                            else { Image(systemName: "eye.slash").font(.system(size: 28)).foregroundStyle(Color(hex: 0x163226)) }
                            CountdownRing(progress: progress, corner: 16).padding(1.5)
                        }
                        .frame(width: 112, height: 112).clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }
                    .buttonStyle(PressStyle()).accessibilityLabel("Enlarge pass QR code")
                }
                Button(action: onQR) {
                    Label("TAP TO ENLARGE QR", systemImage: "qrcode").font(T.label).tracking(1.3).foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 44).background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                .buttonStyle(PressStyle())
            }
            .padding(24)
        }
        .clipShape(RoundedRectangle(cornerRadius: 32, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 32, style: .continuous).stroke(.white.opacity(0.12)))
        .rotation3DEffect(.degrees(rx), axis: (x: 1, y: 0, z: 0), perspective: 0.6)
        .rotation3DEffect(.degrees(ry), axis: (x: 0, y: 1, z: 0), perspective: 0.6)
        .gesture(
            DragGesture(minimumDistance: 4)
                .onChanged { v in
                    ry = max(-14, min(14, v.translation.width * 0.08)); rx = max(-14, min(14, -v.translation.height * 0.08))
                }
                .onEnded { _ in withAnimation(.spring(response: 0.5, dampingFraction: 0.45)) { rx = 0; ry = 0 } }
        )
    }
}

private struct FullQR: View {
    @EnvironmentObject var app: AppState
    let hidden: Bool
    let dismiss: () -> Void
    @State private var previousBrightness: CGFloat = UIScreen.main.brightness

    var body: some View {
        TimelineView(.periodic(from: .now, by: 0.25)) { _ in
            let payload = app.passPayload()
            ZStack {
                P.bg.ignoresSafeArea()
                VStack(spacing: 20) {
                    Text((app.profile?.name ?? "").uppercased()).font(T.h1).foregroundStyle(P.ink).multilineTextAlignment(.center)
                    Text("ID: \(app.profile?.passCode ?? "")").font(T.body).foregroundStyle(P.muted)
                    ZStack {
                        Color.white
                        if let payload, !hidden { QRView(payload: payload).padding(28) }
                        else { Image(systemName: "eye.slash").font(.system(size: 48)).foregroundStyle(Color(hex: 0x163226)) }
                        CountdownRing(progress: app.passProgress(), corner: 24).padding(4)
                    }
                    .aspectRatio(1, contentMode: .fit).clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).stroke(P.line))
                    Text("Live code — it changes every 30 seconds.\nHold steady at the scanner. Tap anywhere to close.").font(T.small).foregroundStyle(P.muted).multilineTextAlignment(.center)
                }
                .padding(32)
            }
        }
        .contentShape(Rectangle()).onTapGesture(perform: dismiss)
        .onAppear { previousBrightness = UIScreen.main.brightness; UIScreen.main.brightness = 1 } // max brightness so scanners read it fast
        .onDisappear { UIScreen.main.brightness = previousBrightness }
        .accessibilityAddTraits(.isModal)
    }
}
