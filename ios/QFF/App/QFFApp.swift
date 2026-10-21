import SwiftUI

@main
struct QFFApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @StateObject private var app: AppState

    init() {
        #if QFF_PREVIEW
        if ProcessInfo.processInfo.environment["QFF_PREVIEW"] == "1" {
            let s = AppState.preview(signedIn: ProcessInfo.processInfo.environment["QFF_SCREEN"] != "signin")
            _app = StateObject(wrappedValue: s)
            return
        }
        #endif
        _app = StateObject(wrappedValue: AppState())
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(app)
                .background(P.bg.ignoresSafeArea())
                .preferredColorScheme(.light)
                .onAppear {
                    AppDelegate.state = app
                    if let p = AppDelegate.pendingType { app.pendingOpen = p; AppDelegate.pendingType = nil }
                }
        }
    }
}
