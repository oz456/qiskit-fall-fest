import SwiftUI

enum AppTab: Hashable { case hub, pass, support }

enum ActiveSheet: Identifiable, Hashable {
    case event(String)
    case notifications
    case profile
    case faq
    case form(String)
    case thread(String)
    var id: String {
        switch self {
        case .event(let i): return "event-\(i)"
        case .notifications: return "notifications"
        case .profile: return "profile"
        case .faq: return "faq"
        case .form(let k): return "form-\(k)"
        case .thread(let i): return "thread-\(i)"
        }
    }
}

@MainActor
final class Router: ObservableObject {
    @Published var tab: AppTab = .hub
    @Published var sheet: ActiveSheet?
    @Published var showFullQR = false
}
