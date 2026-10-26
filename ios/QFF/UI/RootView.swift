import SwiftUI
import UIKit

struct RootView: View {
    @EnvironmentObject var app: AppState
    @StateObject private var router = Router()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ZStack {
            if app.signedIn {
                if app.needsDetails { DetailsView().transition(.opacity) }
                else if app.needsSelfie { SelfieView().transition(.opacity) }
                else { MainView().environmentObject(router).transition(.opacity.combined(with: .scale(scale: 0.98))) }
            } else {
                SignInView().transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.45), value: app.signedIn)
        .overlay(alignment: .bottom) {
            if let m = app.message {
                Toast(text: m).padding(.bottom, 96).transition(.move(edge: .bottom).combined(with: .opacity))
                    .task(id: m) { try? await Task.sleep(nanoseconds: 3_000_000_000); withAnimation { app.message = nil } }
            }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: app.message)
        .alert("You’re checked in", isPresented: Binding(get: { app.checkinNotice != nil }, set: { if !$0 { app.checkinNotice = nil } }), presenting: app.checkinNotice) { _ in
            Button("OK", role: .cancel) {}
        } message: { n in Text("\(n.title)\n\(n.time)") }
        .tint(P.primary)
        .task { await bootPreviewScreen() }
        .onChange(of: app.signedIn) { signedIn in if !signedIn { router.tab = .hub; router.sheet = nil } }
        .onChange(of: scenePhase) { phase in if phase == .active { Task { await app.refresh() } } } // fresh schedule whenever the app comes back
    }

    /// Debug-only: lets CI open a specific screen for automated screenshots.
    private func bootPreviewScreen() async {
        #if QFF_PREVIEW
        guard app.isPreview, let s = ProcessInfo.processInfo.environment["QFF_SCREEN"] else { return }
        try? await Task.sleep(nanoseconds: 600_000_000)
        let firstTicket = app.tickets.first?.id ?? ""
        let firstEvent = app.events.first(where: { app.status(of: $0) == .live })?.id ?? app.events.first?.id ?? ""
        if s == "selfie" { app.needsSelfie = true; return }
        if s == "notify" { app.previewAskNotif = true; return }
        switch s {
        case "pass", "qr": router.tab = .pass
        case "support", "ticket", "thread", "faq": router.tab = .support
        default: router.tab = .hub
        }
        try? await Task.sleep(nanoseconds: 400_000_000)
        switch s {
        case "event": router.sheet = .event(firstEvent)
        case "notifications": router.sheet = .notifications
        case "profile": router.sheet = .profile
        case "ticket": router.sheet = .form("Mentor help")
        case "thread": router.sheet = .thread(firstTicket)
        case "faq": router.sheet = .faq
        default: break
        }
        #endif
    }
}

struct MainView: View {
    @EnvironmentObject var app: AppState
    @EnvironmentObject var router: Router
    @State private var askNotif = false

    private func openPending() {
        guard let t = app.pendingOpen else { return }
        if t == "ticket" { router.tab = .support } else if t == "announcement" { router.tab = .hub; router.sheet = .notifications; app.markAnnouncementsSeen() }
        app.pendingOpen = nil
        Task { await app.refresh() }
    }

    var body: some View {
        TabView(selection: $router.tab) {
            HubView().tabItem { Label("Hub", systemImage: "house") }.tag(AppTab.hub)
            PassView().tabItem { Label("My Pass", systemImage: "ticket") }.tag(AppTab.pass)
            SupportView().tabItem { Label("Support", systemImage: "headphones") }.badge(app.newReplyCount).tag(AppTab.support)
        }
        .onChange(of: router.tab) { _ in Haptics.select() }
        // tapping a notification opens Support or the announcements list
        .onChange(of: app.pendingOpen) { _ in openPending() }
        .onAppear { openPending() }
        // ask for notification permission once, a moment after the attendee first lands here (right after sign-in and selfie)
        .task(id: app.previewAskNotif) {
            await app.refreshNotifStatus()
            if app.shouldAskNotifications { try? await Task.sleep(nanoseconds: 1_500_000_000); if app.shouldAskNotifications { askNotif = true } }
        }
        .sheet(isPresented: $askNotif) { NotificationPrompt().environmentObject(app).presentationDetents([.medium]).presentationDragIndicator(.visible) }
        .sheet(item: $router.sheet) { s in
            Group {
                switch s {
                case .event(let id): EventSheet(id: id)
                case .notifications: NotificationsSheet()
                case .profile: ProfileSheet()
                case .faq: FaqSheet()
                case .form(let k): TicketFormSheet(kind: k)
                case .thread(let id): ThreadSheet(id: id)
                }
            }
            .environmentObject(app).environmentObject(router)
            .presentationDetents([.large]).presentationDragIndicator(.visible)
        }
    }
}

struct NotificationsSheet: View {
    @EnvironmentObject var app: AppState
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("Announcements").font(T.h1).foregroundStyle(P.ink).padding(.bottom, 6)
                if app.announcements.isEmpty { Text("Nothing yet. Organisers’ updates will show up here.").font(T.body).foregroundStyle(P.muted) }
                ForEach(app.announcements) { a in
                    Card(radius: 20) {
                        HStack(alignment: .top, spacing: 14) {
                            IconBubble(symbol: "megaphone", size: 44, tint: P.mintInk, bg: P.mint)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(a.title).font(Fonts.display(16, 600, style: .headline)).foregroundStyle(P.ink)
                                Text(a.body).font(T.small).foregroundStyle(P.muted)
                                Text(Fmt.stamp.string(from: a.createdAt)).font(Fonts.body(12, 400, style: .caption1)).foregroundStyle(P.muted.opacity(0.7))
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(16)
                    }
                }
            }
            .padding(24)
        }
        .background(P.bg.ignoresSafeArea())
    }
}

struct ProfileSheet: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var confirm = false
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 16) {
                Text(app.profile?.initials ?? "").font(T.h2).foregroundStyle(P.onPrimary).frame(width: 64, height: 64).background(P.primary, in: Circle())
                VStack(alignment: .leading, spacing: 2) {
                    Text(app.profile?.name ?? "").font(T.h2).foregroundStyle(P.ink)
                    Text("\(app.profile?.email ?? "") · Attendee").font(T.small).foregroundStyle(P.muted)
                }
            }
            .padding(.top, 8)
            HStack(spacing: 12) {
                Image(systemName: app.notifOn ? "bell.badge" : "bell.slash").font(.system(size: 18)).foregroundStyle(P.muted)
                VStack(alignment: .leading, spacing: 1) {
                    Text("Notifications").font(T.bodyM).foregroundStyle(P.ink)
                    Text(app.notifOn ? "On: announcements and support replies" : "Off").font(T.small).foregroundStyle(P.muted)
                }
                Spacer()
                if !app.notifOn {
                    Button("TURN ON") {
                        if app.notifStatus == .notDetermined { Task { await app.enableNotifications() } }
                        else if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) }
                    }.font(T.label).tracking(1.1).foregroundStyle(P.primary)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 12).background(P.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(P.line))
            Spacer()
            Button(role: .destructive) { confirm = true } label: {
                Label("SIGN OUT", systemImage: "rectangle.portrait.and.arrow.right").font(T.button).tracking(1).foregroundStyle(P.danger)
                    .frame(maxWidth: .infinity, minHeight: 56).overlay(Capsule().stroke(P.line))
            }
            .buttonStyle(PressStyle())
            Text("Version \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0")").font(T.small).foregroundStyle(P.muted).frame(maxWidth: .infinity)
        }
        .padding(24).background(P.bg.ignoresSafeArea())
        .confirmationDialog("Sign out of Fall Fest?", isPresented: $confirm, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { dismiss(); app.signOut() }
            Button("Cancel", role: .cancel) {}
        } message: { Text("You can sign back in with your registered email.") }
    }
}
