#if QFF_PREVIEW
import Foundation

// Debug-only sample data so CI can render every screen in the simulator without a network or a login.
extension AppState {
    static func preview(signedIn: Bool) -> AppState {
        let s = AppState(preview: true)
        s.startClock()
        let now = Date()
        func iso(_ d: Date) -> String { ISO8601DateFormatter().string(from: d) }
        func ev(_ id: String, _ title: String, _ track: String, _ loc: String, _ start: TimeInterval, _ end: TimeInterval, desc: String, saved: Bool = false, reg: Bool = false, regReq: Bool = false, onspot: Bool = false, cap: Int? = nil, left: Int? = nil) -> [String: Any] {
            var d: [String: Any] = ["id": id, "title": title, "description": desc, "track": track, "location": loc, "speaker": "SRM University AP",
                    "startsAt": iso(now.addingTimeInterval(start)), "endsAt": iso(now.addingTimeInterval(end)), "registrationRequired": regReq, "access": regReq ? "prereg" : (onspot ? "onspot" : "open"), "saved": saved, "registered": reg]
            d["capacity"] = cap.map { $0 as Any } ?? NSNull()
            d["spotsLeft"] = left.map { $0 as Any } ?? NSNull()
            return d
        }
        let h: TimeInterval = 3600, day: TimeInterval = 86400
        let events: [[String: Any]] = [
            ev("e1", "Project Q – Grand Finale (24-hour Hackathon)", "Hackathon", "SRM University AP, Amaravati", -20 * h, 28 * h, desc: "24 hours of continuous, on-campus building for the confirmed teams. Teams build, refine and present live to the judging panel.", saved: true, reg: true, regReq: true),
            ev("e2", "Quantum Algorithms Workshop", "Workshop", "Workshop Room C", -0.5 * h, 1.5 * h, desc: "VQE and QAOA with Qiskit primitives.", saved: true, regReq: true, cap: 60, left: 12),
            ev("e3", "Hardware Quantum Tech Expo", "Talk", "Future Stage", 3 * h, 4 * h, desc: "Hands-on with real quantum hardware demos."),
            ev("e4", "Quantum Quiz & Social", "Social", "Sky Garden", 5 * h, 6 * h, desc: "Team quiz, snacks and a relaxed evening.", onspot: true),
            ev("e5", "Winner Announcement", "Main", "Main Stage", 2 * day + 2 * h, 2 * day + 3 * h, desc: "Final results, cash prizes and certificates."),
        ]
        let faqs: [[String: String]] = [
            ["q": "What are the festival phases?", "a": "Online phase: 8–10 October 2026. Offline phase: 26–30 October 2026 at SRM University AP, Amaravati."],
            ["q": "Where is the venue?", "a": "SRM University AP, Amaravati, Andhra Pradesh."],
            ["q": "What should I bring?", "a": "A laptop, charger, your college ID and this app."],
        ]
        let settings: [String: String] = [
            "venue": "SRM University AP, Amaravati", "fest_name": "Qiskit Fall Fest 2026",
            "fest_start": Fmt.dateISO(now.addingTimeInterval(-day)), "fest_end": Fmt.dateISO(now.addingTimeInterval(3 * day)),
            "support_note": "Volunteers reply within minutes during the event.",
        ]
        let json: [String: Any] = ["events": events, "faqs": faqs, "settings": settings]
        if let d = try? JSONSerialization.data(withJSONObject: json), let r = try? JSONDecoder.api.decode(EventsResponse.self, from: d) {
            s.events = r.events; s.faqs = r.faqs; s.settings = r.settings
        }
        let a1: [String: String] = ["id": "a1", "title": "Doors open at 9:00 AM", "body": "Pick up your badge at the Main Lobby. Keep your pass QR ready.", "createdAt": iso(now.addingTimeInterval(-2 * h))]
        let a2: [String: String] = ["id": "a2", "title": "Bring a laptop and charger", "body": "Power strips are available on the Hack Floor.", "createdAt": iso(now.addingTimeInterval(-26 * h))]
        let ann: [[String: String]] = [a1, a2]
        if let d = try? JSONSerialization.data(withJSONObject: ann) { s.announcements = (try? JSONDecoder.api.decode([Announcement].self, from: d)) ?? [] }
        let m1: [String: String] = ["author": "user", "body": "My VQE circuit won't converge on the simulator.", "at": iso(now.addingTimeInterval(-h))]
        let m2: [String: String] = ["author": "admin", "body": "A mentor will stop by your table in 10 minutes. Which row are you in?", "at": iso(now.addingTimeInterval(-0.5 * h))]
        let t1: [String: Any] = ["id": "t1", "code": "QFF-4821", "kind": "Mentor help", "topic": "Circuits", "status": "in_progress", "createdAt": iso(now.addingTimeInterval(-h)), "messages": [m1, m2]]
        let tk: [[String: Any]] = [t1]
        if let d = try? JSONSerialization.data(withJSONObject: tk) { s.tickets = (try? JSONDecoder.api.decode([Ticket].self, from: d)) ?? [] }
        if signedIn {
            s.profile = Profile(name: "Alex Morgan", email: "alex.morgan@srmap.edu.in", college: "SRM University AP", passCode: "QFF-4092")
            s.passSecret = Data((0..<32).map { UInt8($0 &* 7 &+ 3) })
            s.checkins = ["day:2026-10-26": now]
        }
        return s
    }
}

extension Fmt {
    static func dateISO(_ d: Date) -> String { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = IST; f.dateFormat = "yyyy-MM-dd"; return f.string(from: d) }
}
#endif
