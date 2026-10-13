import Foundation

let IST = TimeZone(identifier: "Asia/Kolkata")!
let istCalendar: Calendar = {
    var c = Calendar(identifier: .gregorian)
    c.timeZone = IST
    c.locale = Locale(identifier: "en_US")
    return c
}()

enum Fmt {
    private static func make(_ f: String) -> DateFormatter {
        let d = DateFormatter(); d.locale = Locale(identifier: "en_US_POSIX"); d.timeZone = IST; d.dateFormat = f; return d
    }
    static let time = make("h:mm a")
    static let dm = make("d MMM")
    static let dmTime = make("d MMM, h:mm a")
    static let dateLong = make("EEEE, d MMMM yyyy")
    static let dateGreeting = make("EEEE, d MMMM")
    static let weekdayTime = make("EEE h:mm a")
    static let weekdayShort = make("EEE")
    static let monthShort = make("MMM")
    static let stamp = make("d MMM, h:mm a")
}

/// ISO-8601 with or without fractional seconds (the API emits milliseconds).
enum ISO {
    private static let frac: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
    private static let plain: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime]; return f }()
    static func parse(_ s: String) -> Date? { frac.date(from: s) ?? plain.date(from: s) }
}

extension JSONDecoder {
    static let api: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { dec in
            let s = try dec.singleValueContainer().decode(String.self)
            guard let date = ISO.parse(s) else { throw DecodingError.dataCorrupted(.init(codingPath: dec.codingPath, debugDescription: "bad date \(s)")) }
            return date
        }
        return d
    }()
}

enum Track: String, Decodable, CaseIterable {
    case Main, Workshop, Talk, Hackathon, Social, Competition
    init(from decoder: Decoder) throws {
        let s = try decoder.singleValueContainer().decode(String.self)
        self = Track(rawValue: s) ?? .Main
    }
    var label: String {
        switch self {
        case .Main: return "Main event"
        case .Workshop: return "Workshop"
        case .Talk: return "Talk"
        case .Hackathon: return "Hackathon"
        case .Social: return "Social"
        case .Competition: return "Competition"
        }
    }
    var symbol: String {
        switch self {
        case .Main: return "sparkles"
        case .Workshop: return "atom"
        case .Talk: return "mic"
        case .Hackathon: return "chevron.left.forwardslash.chevron.right"
        case .Social: return "party.popper"
        case .Competition: return "trophy"
        }
    }
}

enum EventStatus { case live, upcoming, done }

struct Event: Identifiable, Equatable, Decodable {
    let id: String
    let title: String
    let description: String
    let track: Track
    let location: String
    let speaker: String
    let startsAt: Date
    let endsAt: Date
    let capacity: Int?
    let registrationRequired: Bool
    var access: String?
    var spotsLeft: Int?
    var saved: Bool
    var registered: Bool

    var startDay: Date { istCalendar.startOfDay(for: startsAt) }
    var endDay: Date { istCalendar.startOfDay(for: endsAt) }
    var isMultiDay: Bool { endDay > startDay }
    var durationDays: Int { (istCalendar.dateComponents([.day], from: startDay, to: endDay).day ?? 0) + 1 }
    func covers(_ day: Date) -> Bool { let d = istCalendar.startOfDay(for: day); return d >= startDay && d <= endDay }

    /// Short time label as seen from a given day of the schedule.
    func timeLabel(on day: Date) -> String {
        guard isMultiDay else { return Fmt.time.string(from: startsAt) }
        let d = istCalendar.startOfDay(for: day)
        if d == startDay { return "From " + Fmt.time.string(from: startsAt) }
        if d == endDay { return "Until " + Fmt.time.string(from: endsAt) }
        return "All day"
    }
    var rangeLabel: String {
        isMultiDay ? Fmt.dmTime.string(from: startsAt) + " → " + Fmt.dmTime.string(from: endsAt)
                   : Fmt.time.string(from: startsAt) + " – " + Fmt.time.string(from: endsAt)
    }
    var dayLabel: String {
        isMultiDay ? Fmt.dm.string(from: startsAt) + " – " + Fmt.dm.string(from: endsAt) + " · \(durationDays) days" : Fmt.dateLong.string(from: startsAt)
    }
}

struct Announcement: Identifiable, Decodable, Equatable { let id: String; let title: String; let body: String; let createdAt: Date }
struct Faq: Identifiable, Decodable, Equatable { var id: String { q }; let q: String; let a: String }
struct TicketMessage: Decodable, Equatable, Identifiable { var id: String { "\(author)|\(at.timeIntervalSince1970)|\(body.hashValue)" }; let author: String; let body: String; let at: Date; var fromAdmin: Bool { author == "admin" } }
struct Ticket: Identifiable, Decodable, Equatable { let id: String; let code: String; let kind: String; let topic: String; let status: String; let createdAt: Date; let messages: [TicketMessage] }
struct Profile: Codable, Equatable {
    let name: String; let email: String; let college: String?; let passCode: String
    var initials: String {
        let s = name.split(separator: " ").prefix(2).compactMap { $0.first.map { String($0).uppercased() } }.joined()
        return s.isEmpty ? "?" : s
    }
    var firstName: String { name.split(separator: " ").first.map(String.init) ?? name }
}
struct Checkin: Decodable { let scope: String; let at: Date }

// ---- API payloads ----
struct EventsResponse: Decodable { let events: [Event]; let faqs: [Faq]; let settings: [String: String] }
struct MeResponse: Decodable { let profile: Profile; let checkins: [Checkin] }
struct VerifyResponse: Decodable { let accessToken: String; let refreshToken: String; let profile: Profile; let passSecret: String }
struct RefreshResponse: Decodable { let accessToken: String; let refreshToken: String }
struct MessageResponse: Decodable { let message: String? }
struct TicketCreated: Decodable { let id: String; let code: String }

func dayShort(_ d: Date) -> String { Fmt.weekdayShort.string(from: d).uppercased() }
