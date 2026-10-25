import SwiftUI
import UIKit

struct PassView: View {
    @EnvironmentObject var app: AppState
    @EnvironmentObject var router: Router
    @Environment(\.scenePhase) private var scenePhase
    @State private var captured = UIScreen.main.isCaptured
    @State private var fullQR = false

    private var saved: [Event] { app.events.filter(\.saved) }
    private var attended: [(scope: String, at: Date)] { app.checkins.map { (scope: $0.key, at: $0.value) }.sorted { $0.at > $1.at } }
    private var hidden: Bool { captured || scenePhase != .active }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 2) {
                    SectionLabel(text: "MY PASS")
                    PosterTitle(first: "ONE PASS.", second: "EVERY MOMENT.")
                }
                .padding(.horizontal, 24).padding(.vertical, 18)

                TiltPass { fullQR = true }
                    .padding(.horizontal, 24)

                Text(captured ? "The code is hidden while your screen is being recorded or shared."
                              : "QR appears when you tap. It refreshes every 30 seconds.")
                    .font(T.small).foregroundStyle(P.muted).multilineTextAlignment(.center).frame(maxWidth: .infinity)
                    .padding(.horizontal, 24).padding(.top, 14)

                if !saved.isEmpty {
                    SectionLabel(text: "SAVED EVENTS").padding(.horizontal, 24).padding(.top, 32).padding(.bottom, 8)
                    ForEach(saved) { e in EventRow(event: e, day: nil, trailing: true).padding(.horizontal, 24).padding(.vertical, 6) }
                } else {
                    Text("Events you save appear here. Tap the bookmark on any event to save it.").font(T.body).foregroundStyle(P.muted).multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity).padding(.horizontal, 40).padding(.vertical, 36)
                }

                SectionLabel(text: "ATTENDED EVENTS").padding(.horizontal, 24).padding(.top, 24).padding(.bottom, 8)
                if attended.isEmpty {
                    Text("Events you attend appear here after the team scans your pass at the door.").font(T.body).foregroundStyle(P.muted).multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity).padding(.horizontal, 40).padding(.vertical, 24)
                } else {
                    ForEach(attended, id: \.scope) { a in
                        let n = app.checkinLabel(a.scope, a.at)
                        Card {
                            HStack(spacing: 14) {
                                IconBubble(symbol: "checkmark.circle", size: 50, tint: P.mintInk, bg: P.mint)
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(n.title).font(T.title).foregroundStyle(P.ink).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                                    Text("Checked in · \(n.time)").font(T.small).foregroundStyle(P.muted).lineLimit(1)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(18)
                        }
                        .padding(.horizontal, 24).padding(.vertical, 6)
                    }
                }
            }
            .padding(.bottom, 24)
        }
        .background(Backdrop())
        .task { while !Task.isCancelled { try? await Task.sleep(nanoseconds: 4_000_000_000); await app.pollCheckins() } } // a door scan shows up within seconds
        .onReceive(NotificationCenter.default.publisher(for: UIScreen.capturedDidChangeNotification)) { _ in captured = UIScreen.main.isCaptured }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.userDidTakeScreenshotNotification)) { _ in app.message = "Screenshots won't scan — the code changes every 30 seconds." }
        .fullScreenCover(isPresented: $fullQR) { FullQR(hidden: hidden) { fullQR = false }.environmentObject(app) }
        .onAppear { if ProcessInfo.processInfo.environment["QFF_SCREEN"] == "qr" { fullQR = true } }
    }
}

/// Progress border around the QR tile (a circle would cut through the QR's corners).
struct CountdownRing: View {
    let progress: Double
    var corner: CGFloat = 18
    var color: Color = P.primary
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
    let onQR: () -> Void
    @State private var rx: Double = 0
    @State private var ry: Double = 0

    var body: some View {
        let p = app.profile
        ZStack(alignment: .topTrailing) {
            LinearGradient(colors: [P.hero1, P.hero2], startPoint: .topLeading, endPoint: .bottomTrailing)
            AtomOrb(color: P.cream, electron: P.accent, period: 12).frame(width: 300, height: 300).opacity(0.75).offset(x: 128).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
            VStack(alignment: .leading, spacing: 22) {
                HStack {
                    Label("Secure Pass", systemImage: "checkmark.shield").font(T.bodyM).foregroundStyle(.white.opacity(0.8))
                    Spacer()
                    Pill(text: "ACTIVE", bg: P.cream, fg: P.primary)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("ATTENDEE").font(T.label).tracking(1.3).foregroundStyle(.white.opacity(0.55))
                    Text((p?.name ?? "").uppercased()).font(Fonts.poster(34, style: .title1)).foregroundStyle(.white).lineLimit(2).minimumScaleFactor(0.7)
                    Text("ID: \(p?.passCode ?? "")").font(T.body).foregroundStyle(.white.opacity(0.8)).padding(.top, 2)
                    if let c = p?.college { Text(c).font(T.small).foregroundStyle(.white.opacity(0.55)).lineLimit(1) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Button(action: onQR) {
                    Label("TAP TO SHOW QR", systemImage: "qrcode").font(T.button).tracking(1).foregroundStyle(P.hero2)
                        .frame(maxWidth: .infinity, minHeight: 52).background(.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .buttonStyle(PressStyle())
            }
            .padding(26)
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
                        else { Image(systemName: "eye.slash").font(.system(size: 48)).foregroundStyle(P.primary) }
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
