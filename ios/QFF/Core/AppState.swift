import Foundation
import SwiftUI

/// Single source of truth for the UI. Network-first, with an on-device cache so the schedule still opens offline.
@MainActor
final class AppState: ObservableObject {
    @Published var profile: Profile?
    @Published var events: [Event] = []
    @Published var faqs: [Faq] = []
    @Published var settings: [String: String] = [:]
    @Published var announcements: [Announcement] = []
    @Published var tickets: [Ticket] = []
    @Published var checkins: [String: Date] = [:]
    @Published var refreshing = false
    @Published var offline = false
    @Published var message: String?
    @Published var now = Date()
    @Published var seenAnnouncement: String?

    let api: API
    let isPreview: Bool
    private let keychain = Keychain.shared
    private let defaults = UserDefaults.standard
    private var accessToken: String?
    var passSecret: Data?
    private var refreshInFlight: Task<String, Error>?
    private var clock: Task<Void, Never>?

    var signedIn: Bool { profile != nil }
    var unread: Bool { announcements.first.map { $0.id != seenAnnouncement } ?? false }

    init(preview: Bool = false) {
        isPreview = preview
        let base = (Bundle.main.object(forInfoDictionaryKey: "APIBase") as? String) ?? "https://qff-api-666549809539.us-east5.run.app"
        api = API(base: base)
        api.skew = defaults.double(forKey: "skew")
        api.onSkew = { [defaults] s in defaults.set(s, forKey: "skew") }
        seenAnnouncement = defaults.string(forKey: "seen_ann")
        if preview { return }
        if let d = defaults.data(forKey: "profile"), let p = try? JSONDecoder().decode(Profile.self, from: d) { profile = p }
        if let s = keychain.get("pass_secret") { passSecret = Data(base64Encoded: s) }
        if signedIn { loadCache(); Task { [self] in await refresh() } }
        startClock()
    }

    deinit { clock?.cancel() }

    func startClock() {
        clock?.cancel()
        clock = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                self?.now = Date()
            }
        }
    }

    private var deviceId: String {
        if let d = defaults.string(forKey: "device") { return d }
        let d = UUID().uuidString; defaults.set(d, forKey: "device"); return d
    }

    // MARK: session

    func requestCode(email: String) async throws -> String {
        let r: MessageResponse = try await api.call("POST", "/v1/auth/request-code", body: ["email": email.trimmingCharacters(in: .whitespaces).lowercased()])
        return r.message ?? "Check your inbox for a 6-digit code."
    }

    func verify(email: String, code: String) async throws {
        let r: VerifyResponse = try await api.call("POST", "/v1/auth/verify", body: [
            "email": email.trimmingCharacters(in: .whitespaces).lowercased(), "code": code, "deviceId": deviceId, "deviceName": UIDevice.current.name == "iPhone" ? "iPhone" : "iPhone (\(UIDevice.current.model))",
        ])
        accessToken = r.accessToken
        keychain.set(r.refreshToken, for: "refresh")
        keychain.set(r.passSecret, for: "pass_secret")
        passSecret = Data(base64Encoded: r.passSecret)
        defaults.set(try? JSONEncoder().encode(r.profile), forKey: "profile")
        profile = r.profile
        Haptics.success()
        Task { [self] in await refresh() }
    }

    func signOut() {
        let t = accessToken
        Task { [self] in _ = try? await api.data("POST", "/v1/auth/logout", token: t) }
        wipe()
    }

    private func wipe() {
        accessToken = nil; passSecret = nil
        keychain.wipe()
        for k in ["profile", "cache_events", "cache_ann", "seen_ann"] { defaults.removeObject(forKey: k) }
        profile = nil; events = []; announcements = []; tickets = []; checkins = [:]; faqs = []; settings = [:]
    }

    /// Authenticated call with one transparent refresh-and-retry on 401.
    private func authed<T: Decodable>(_ method: String, _ path: String, body: [String: Any]? = nil, as type: T.Type = T.self) async throws -> T {
        let first = try await currentToken()
        do { return try await api.call(method, path, body: body, token: first) }
        catch let e as APIError where e.http == 401 {
            let t = try await refreshToken()
            return try await api.call(method, path, body: body, token: t)
        }
    }

    private func currentToken() async throws -> String {
        if let t = accessToken { return t }
        return try await refreshToken()
    }

    private func refreshToken() async throws -> String {
        if let t = refreshInFlight { return try await t.value }
        let task = Task { [self] () -> String in
            guard let rt = keychain.get("refresh") else { wipe(); throw APIError(http: 401, code: "unauthorized", message: "Please sign in again.") }
            do {
                let r: RefreshResponse = try await api.call("POST", "/v1/auth/refresh", body: ["refreshToken": rt])
                keychain.set(r.refreshToken, for: "refresh"); accessToken = r.accessToken
                return r.accessToken
            } catch let e as APIError {
                if e.http == 401 { wipe(); message = "You were signed out. Sign in again to continue." }
                throw e
            }
        }
        refreshInFlight = task
        defer { refreshInFlight = nil }
        return try await task.value
    }

    // MARK: data

    func refresh() async {
        guard signedIn, !refreshing, !isPreview else { return }
        refreshing = true
        defer { refreshing = false }
        do {
            let evData = try await authedData("GET", "/v1/events")
            let ev = try JSONDecoder.api.decode(EventsResponse.self, from: evData)
            events = ev.events; faqs = ev.faqs; settings = ev.settings
            let annData = try await authedData("GET", "/v1/announcements")
            announcements = try JSONDecoder.api.decode([Announcement].self, from: annData)
            try await loadTickets()
            let me: MeResponse = try await authed("GET", "/v1/me")
            checkins = Dictionary(me.checkins.map { ($0.scope, $0.at) }, uniquingKeysWith: { a, _ in a })
            offline = false
            defaults.set(evData, forKey: "cache_events"); defaults.set(annData, forKey: "cache_ann")
        } catch let e as APIError where e.http == 401 { /* signed out by refreshToken() */ }
        catch { offline = true }
    }

    private func authedData(_ method: String, _ path: String) async throws -> Data {
        let first = try await currentToken()
        do { return try await api.data(method, path, token: first) }
        catch let e as APIError where e.http == 401 { return try await api.data(method, path, token: try await refreshToken()) }
    }

    private func loadCache() {
        if let d = defaults.data(forKey: "cache_events"), let ev = try? JSONDecoder.api.decode(EventsResponse.self, from: d) { events = ev.events; faqs = ev.faqs; settings = ev.settings }
        if let d = defaults.data(forKey: "cache_ann"), let a = try? JSONDecoder.api.decode([Announcement].self, from: d) { announcements = a }
    }

    private func loadTickets() async throws { tickets = try await authed("GET", "/v1/tickets") }

    func markAnnouncementsSeen() { seenAnnouncement = announcements.first?.id; defaults.set(seenAnnouncement, forKey: "seen_ann") }

    private func patch(_ id: String, _ f: (inout Event) -> Void) { if let i = events.firstIndex(where: { $0.id == id }) { f(&events[i]) } }

    func toggleSaved(_ e: Event) {
        let on = !e.saved
        patch(e.id) { $0.saved = on }
        Haptics.tap()
        guard !isPreview else { return }
        Task { [self] in
            do { _ = try await authedData(on ? "PUT" : "DELETE", "/v1/events/\(e.id)/saved") }
            catch { patch(e.id) { $0.saved = !on }; message = "Couldn't update. Check your connection." }
        }
    }

    func toggleRegistered(_ e: Event) {
        let on = !e.registered
        guard !isPreview else { patch(e.id) { $0.registered = on; $0.saved = $0.saved || on }; return }
        Task { [self] in
            do {
                _ = try await authedData(on ? "PUT" : "DELETE", "/v1/events/\(e.id)/registration")
                patch(e.id) { ev in ev.registered = on; ev.saved = ev.saved || on; ev.spotsLeft = ev.spotsLeft.map { on ? max(0, $0 - 1) : $0 + 1 } }
                message = on ? "You're registered for \(e.title)" : "Registration cancelled"
                Haptics.success()
            } catch let x as APIError { message = x.message; Haptics.error() }
            catch { message = "Couldn't update. Check your connection." }
        }
    }

    func createTicket(kind: String, topic: String, text: String) async throws -> String {
        if isPreview { return "QFF-1234" }
        let r: TicketCreated = try await authed("POST", "/v1/tickets", body: ["kind": kind, "topic": topic, "message": text])
        try await loadTickets()
        return r.code
    }

    func replyTicket(_ id: String, text: String) {
        guard !isPreview else { return }
        Task { [self] in
            do { _ = try await authedData2("POST", "/v1/tickets/\(id)/messages", ["body": text]); try await loadTickets() }
            catch let x as APIError { message = x.message }
            catch { message = "Couldn't send. Check your connection." }
        }
    }

    private func authedData2(_ method: String, _ path: String, _ body: [String: Any]) async throws -> Data {
        let first = try await currentToken()
        do { return try await api.data(method, path, body: body, token: first) }
        catch let e as APIError where e.http == 401 { return try await api.data(method, path, body: body, token: try await refreshToken()) }
    }

    // MARK: status

    func status(of e: Event) -> EventStatus { now < e.startsAt ? .upcoming : (now < e.endsAt ? .live : .done) }
    func isCheckedIn(_ e: Event) -> Bool { checkins["event:\(e.id)"] != nil }

    // MARK: rotating pass QR

    var serverNow: TimeInterval { Date().timeIntervalSince1970 + api.skew }
    func passPayload() -> String? {
        guard let p = profile, let s = passSecret else { return nil }
        return PassCode.payload(passCode: p.passCode, secret: s, serverNow: serverNow)
    }
    func passProgress() -> Double { PassCode.progress(serverNow: serverNow) }
}
