import SwiftUI
import UIKit
import UserNotifications

/// Notifications. Exactly two kinds exist, both from the organisers: a new announcement and a reply to the attendee's support ticket.
/// Delivery is Apple's push service (APNs). It needs an Apple Developer account and a push key on the server; until then the app asks for
/// permission and registers as normal, but nothing arrives.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    @MainActor static weak var state: AppState?
    /// A tap that arrived before the UI existed (the app was launched by tapping a notification).
    @MainActor static var pendingType: String?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in await AppDelegate.state?.registerPushToken(hex) }
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) { /* no entitlement / no network: try again next launch */ }

    /// Shown as a banner even while the app is open, and the data refreshes at once.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        Task { @MainActor in await AppDelegate.state?.refresh() }
        completionHandler([.banner, .sound, .list])
    }

    /// Tapping a notification opens Support (ticket reply) or the announcements list.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let type = response.notification.request.content.userInfo["type"] as? String
        Task { @MainActor in
            if let s = AppDelegate.state { s.pendingOpen = type } else { AppDelegate.pendingType = type }
        }
        completionHandler()
    }
}

extension AppState {
    /// Ask once, right after sign-in + selfie.
    var shouldAskNotifications: Bool { previewAskNotif || (!isPreview && signedIn && !needsSelfie && notifStatus == .notDetermined && !defaultsAsked) }
    var notifOn: Bool { notifStatus == .authorized || notifStatus == .provisional }

    func refreshNotifStatus() async {
        guard !isPreview else { return }
        notifStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        if notifOn { UIApplication.shared.registerForRemoteNotifications() } // returns the token via the delegate; cheap to repeat each launch
    }

    func enableNotifications() async {
        markNotificationsAsked()
        guard !isPreview else { return }
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        await refreshNotifStatus()
    }

    @MainActor func registerPushToken(_ hex: String) async {
        guard signedIn, !needsSelfie, hex != pushRegistered else { return }
        #if DEBUG
        let env = "sandbox"
        #else
        let env = "production"
        #endif
        if (try? await authedData2("PUT", "/v1/me/push-token", ["token": hex, "platform": "ios", "apnsEnv": env])) != nil { setPushRegistered(hex) }
    }
}

/// Why we want notifications, in two lines, before the system dialog appears. Asked once.
struct NotificationPrompt: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            IconBubble(symbol: "bell.badge", size: 60, tint: P.mintInk, bg: P.mint)
            Text("Never miss an update").font(Fonts.display(26, 700, style: .title1)).foregroundStyle(P.ink)
            Text("We’ll notify you the moment the team posts an announcement or replies to your support ticket. Nothing else, ever.").font(T.body).foregroundStyle(P.muted)
            Spacer(minLength: 8)
            PrimaryButton(title: "TURN ON NOTIFICATIONS") { Task { await app.enableNotifications(); dismiss() } }
            Button("Not now") { app.markNotificationsAsked(); dismiss() }
                .font(T.bodyM).foregroundStyle(P.muted).frame(maxWidth: .infinity, minHeight: 44)
        }
        .padding(28).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).background(P.bg.ignoresSafeArea())
    }
}
