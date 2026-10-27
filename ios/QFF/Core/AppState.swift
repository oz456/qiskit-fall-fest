import Foundation
import SwiftUI
import UserNotifications

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
    @Published var notifStatus: UNAuthorizationStatus = .notDetermined
    /// "ticket" / "announcement" when the user tapped a notification; the UI consumes it and sets it back to nil.
    @Published var pendingOpen: String?
    @Published var previewAskNotif = false   // CI screenshots only
    var defaultsAsked: Bool { defaults.bool(forKey: "notif_asked") }
    func markNotificationsAsked() { defaults.set(true, forKey: "notif_asked") }
    var pushRegistered: String? { defaults.string(forKey: "push_registered") }
    func setPushRegistered(_ t: String) { defaults.set(t, forKey: "push_registered") }
    @Published var message: String?
    /// Set when door staff have just checked this attendee in; the UI shows an alert and clears it.
    @Published var checkinNotice: CheckinNotice?
    /// Events (ids) where the student was checked in and still has to give OD details; "Later" hides the sheet until the app is reopened.
    @Published var odPending: [String] = []
    @Published var odDismissed: Set<String> = []
    private var announcedCheckins: Set<String> = Set(UserDefaults.standard.stringArray(forKey: "seen_checkins") ?? [])
    @Published var now = Date()
    @Published var seenAnnouncement: String?
    /// Support replies: when the attendee last looked at each ticket (timestamp of its last message). Drives the badge on the Support tab.
    @Published var seenTickets: [String: Double] = (UserDefaults.standard.dictionary(forKey: "seen_tickets") as? [String: Double]) ?? [:]
    /// First sign-in: no selfie on file yet. Door staff compare faces, so we ask once.
    @Published var needsSelfie = UserDefaults.standard.bool(forKey: "needs_selfie")
    /// First sign-in of an SRM-AP person: academic details are asked once. Other attendees are never asked.
    @Published var needsDetails = UserDefaults.standard.bool(forKey: "needs_details")
    /// Saved before section and gender existed: only those two are asked.
    @Published var needsExtra = UserDefaults.standard.bool(forKey: "needs_extra")
    @Published var detailsOptions = DetailsOptions(schools: ["SEAS", "ESLA", "PSB", "Other"], programs: ["Other"], genders: ["Male", "Female"])

    let api: API
    let isPreview: Bool
    private let keychain = Keychain.shared
    private let defaults = UserDefaults.standard
    private var accessToken: String?
    var passSecret: Data?
    private var refreshInFlight: Task<String, Error>?
    private var clock: Task<Void, Never>?

    var signedIn: Bool { profile != nil }
    func hasNewReply(_ t: Ticket) -> Bool { t.messages.last.map { $0.fromAdmin && $0.at.timeIntervalSince1970 > (seenTickets[t.id] ?? 0) } ?? false }
    var newReplyCount: Int { tickets.filter(hasNewReply).count }
    func markTicketSeen(_ id: String) {
        guard let last = tickets.first(where: { $0.id == id })?.messages.last?.at.timeIntervalSince1970, seenTickets[id] != last else { return }
        seenTickets[id] = last; defaults.set(seenTickets, forKey: "seen_tickets")
    }
    private let greetingSeed = Int.random(in: 0..<10_000)
    var greeting: String { Greetings[greetingSeed % Greetings.count].replacingOccurrences(of: "{n}", with: profile?.firstName ?? "") }
    var unread: Bool { announcements.first.map { $0.id != seenAnnouncement } ?? false }

    init(preview: Bool = false) {
        isPreview = preview
        let base = (Bundle.main.object(forInfoDictionaryKey: "APIBase") as? String) ?? "https://app.qffsrmap2026.com"
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
        // Learn whether a selfie exists BEFORE showing the app, so first sign-in goes straight to the selfie step.
        let me: MeResponse? = try? await api.call("GET", "/v1/me", token: r.accessToken)
        needsSelfie = me?.profile.hasPhoto == false
        defaults.set(needsSelfie, forKey: "needs_selfie")
        if let me { applyDetailsState(me) }
        defaults.set(try? JSONEncoder().encode(r.profile), forKey: "profile")
        profile = r.profile
        Haptics.success()
        Task { [self] in await refresh() }
    }

    func signOut() {
        let t = accessToken
        let pushToken = pushRegistered
        Task { [self] in
            // stop notifications for this phone before the session ends
            if let pushToken { _ = try? await api.data("DELETE", "/v1/me/push-token?token=\(pushToken)", token: t) }
            _ = try? await api.data("POST", "/v1/auth/logout", token: t)
        }
        wipe()
    }

    private func wipe() {
        accessToken = nil; passSecret = nil
        keychain.wipe()
        for k in ["profile", "cache_events", "cache_ann", "seen_ann", "needs_selfie", "needs_details", "needs_extra", "seen_tickets", "push_registered", "notif_asked", "seen_checkins"] { defaults.removeObject(forKey: k) }
        seenTickets = [:]; announcedCheckins = []; checkinNotice = nil; odPending = []; odDismissed = []
        needsSelfie = false; needsDetails = false; needsExtra = false
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
        let task = Task { [self] () async throws -> String in
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
            applyCheckins(me)
            if me.profile != profile { profile = me.profile; if let d = try? JSONEncoder().encode(me.profile) { defaults.set(d, forKey: "profile") } } // a name fixed by the team shows up without signing in again
            applyDetailsState(me)
            if let has = me.profile.hasPhoto, needsSelfie == has { needsSelfie = !has; defaults.set(needsSelfie, forKey: "needs_selfie") }
            offline = false
            Task { [self] in await refreshNotifStatus() }
            defaults.set(evData, forKey: "cache_events"); defaults.set(annData, forKey: "cache_ann")
        } catch let e as APIError where e.code == "photo_required" { needsSelfie = true; defaults.set(true, forKey: "needs_selfie") } // the server blocks the app until the selfie exists
        catch let e as APIError where e.http == 401 { /* signed out by refreshToken() */ }
        catch { offline = true }
    }

    private func authedData(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> Data {
        let first = try await currentToken()
        do { return try await api.data(method, path, body: body, token: first) }
        catch let e as APIError where e.http == 401 { return try await api.data(method, path, body: body, token: try await refreshToken()) }
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
            catch let x as APIError { patch(e.id) { $0.saved = !on }; message = x.message } // the server answered: say what it said
            catch { patch(e.id) { $0.saved = !on }; message = "Couldn't save. Check your connection." }
        }
    }

    private func applyDetailsState(_ me: MeResponse) {
        let need = me.profile.needsDetails ?? false
        if need != needsDetails { needsDetails = need; defaults.set(need, forKey: "needs_details") }
        let extra = me.profile.needsExtra ?? false
        if extra != needsExtra { needsExtra = extra; defaults.set(extra, forKey: "needs_extra") }
        if let o = me.detailsOptions { detailsOptions = o }
    }

    /// One-time academic details (SRM-AP people). Throws APIError with a readable message.
    func saveDetails(regNo: String, school: String, semester: Int, course: String, program: String, section: String, gender: String, cgpa: Double?) async throws {
        if !isPreview {
            let body: [String: Any] = ["regNo": regNo, "school": school, "semester": semester, "course": course, "program": program, "section": section, "gender": gender, "cgpa": cgpa ?? "NA"]
            do { _ = try await authedData("PUT", "/v1/me/details", body: body) }
            catch let e as APIError where e.http == 409 && e.code == "already_set" { }
        }
        needsDetails = false; needsExtra = false; defaults.set(false, forKey: "needs_details"); defaults.set(false, forKey: "needs_extra")
        if !isPreview { Task { [self] in await refresh() } }
    }

    /// Section and gender for someone who saved their details earlier.
    func saveExtra(section: String, gender: String) async throws {
        if !isPreview {
            do { _ = try await authedData("PUT", "/v1/me/details", body: ["section": section, "gender": gender]) }
            catch let e as APIError where e.http == 409 && e.code == "already_set" { }
        }
        needsExtra = false; defaults.set(false, forKey: "needs_extra")
        if !isPreview { Task { [self] in await refresh() } }
    }

    /// One-time selfie upload (JPEG). A 409 means the server already has one, which is fine.
    func uploadSelfie(_ jpeg: Data) async throws {
        if !isPreview {
            do { _ = try await api.data("PUT", "/v1/me/photo", token: try await currentToken(), jpeg: jpeg) }
            catch let e as APIError where e.http == 401 { _ = try await api.data("PUT", "/v1/me/photo", token: try await refreshToken(), jpeg: jpeg) }
            catch let e as APIError where e.http == 409 { }
        }
        needsSelfie = false; defaults.set(false, forKey: "needs_selfie")
        if !isPreview { Task { [self] in await refresh() } } // the first load was refused until the selfie existed
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

    func authedData2(_ method: String, _ path: String, _ body: [String: Any]) async throws -> Data {
        let first = try await currentToken()
        do { return try await api.data(method, path, body: body, token: first) }
        catch let e as APIError where e.http == 401 { return try await api.data(method, path, body: body, token: try await refreshToken()) }
    }

    // MARK: status

    func status(of e: Event) -> EventStatus { now < e.startsAt ? .upcoming : (now < e.endsAt ? .live : .done) }
    /// Takes the check-ins from /v1/me. One we have not announced yet and that is under 15 minutes old becomes an alert (older ones are marked as seen silently).
    private func applyCheckins(_ me: MeResponse) {
        checkins = Dictionary(me.checkins.map { ($0.scope, $0.at) }, uniquingKeysWith: { a, _ in a })
        odPending = me.checkins.filter { $0.askOd == true }.map { String($0.scope.dropFirst(6)) }
        let fresh = checkins.filter { !announcedCheckins.contains($0.key) }
        guard !fresh.isEmpty else { return }
        announcedCheckins.formUnion(fresh.keys)
        defaults.set(Array(announcedCheckins), forKey: "seen_checkins")
        if let newest = fresh.filter({ Date().timeIntervalSince($0.value) < 15 * 60 }).max(by: { $0.value < $1.value }), !odPending.contains(String(newest.key.dropFirst(6))) { checkinNotice = checkinLabel(newest.key, newest.value) }   // an OD event opens the OD form straight away
    }
    /// OD details (from / until as HH:MM, hours) for an event the student was checked in at. A 409 means they were already saved.
    func saveOd(eventId: String, from: String, until: String, hours: Double) async throws {
        if !isPreview {
            do { _ = try await authedData("PUT", "/v1/me/od", body: ["eventId": eventId, "from": from, "until": until, "hours": hours]) }
            catch let e as APIError where e.http == 409 { }
        }
        odPending.removeAll { $0 == eventId }
        if !isPreview { Task { [self] in await refresh() } }
    }
    func checkinLabel(_ scope: String, _ at: Date) -> CheckinNotice {
        if scope.hasPrefix("event:") { return CheckinNotice(title: events.first { $0.id == String(scope.dropFirst(6)) }?.title ?? "Event", time: Fmt.dmTime.string(from: at)) }
        return CheckinNotice(title: "Campus entry", time: Fmt.dmTime.string(from: at))
    }
    /// Light check for a new door scan: only /v1/me. Called every few seconds while My Pass is on screen.
    func pollCheckins() async {
        guard signedIn, !needsSelfie, !isPreview else { return }
        if let me: MeResponse = try? await authed("GET", "/v1/me") { applyCheckins(me) }
    }
    func isCheckedIn(_ e: Event) -> Bool { checkins["event:\(e.id)"] != nil }

    // MARK: rotating pass QR

    var serverNow: TimeInterval { Date().timeIntervalSince1970 + api.skew }
    func passPayload() -> String? {
        guard let p = profile, let s = passSecret else { return nil }
        return PassCode.payload(passCode: p.passCode, secret: s, serverNow: serverNow)
    }
    func passProgress() -> Double { PassCode.progress(serverNow: serverNow) }
}
