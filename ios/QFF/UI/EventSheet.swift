import SwiftUI

struct EventSheet: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    let id: String
    @State private var ics: URL?

    var body: some View {
        if let e = app.events.first(where: { $0.id == id }) {
            let status = app.status(of: e)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 8) {
                        IconBubble(symbol: e.track.symbol, size: 56, tint: P.mintInk, bg: P.mint)
                        StatusBadge(status: status, checkedIn: app.isCheckedIn(e))
                        Pill(text: e.track.label.uppercased(), bg: P.surfaceAlt, fg: P.muted)
                    }
                    Text(e.title).font(T.h1).foregroundStyle(P.ink)
                    Card {
                        VStack(spacing: 0) {
                            info("calendar", e.dayLabel)
                            Divider().overlay(P.line)
                            info("clock", e.rangeLabel + " IST")
                            if !e.location.isEmpty { Divider().overlay(P.line); info("mappin.and.ellipse", e.location) }
                            if !e.speaker.isEmpty { Divider().overlay(P.line); info("person", e.speaker) }
                        }
                    }
                    if !e.description.isEmpty { Text(e.description).font(T.body).foregroundStyle(P.muted) }
                    if e.registrationRequired || e.capacity != nil {
                        Card(radius: 20) {
                            Label(seatText(e), systemImage: "chair.lounge").font(T.bodyM).foregroundStyle(P.ink).padding(16).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    HStack(spacing: 10) {
                        if e.registrationRequired {
                            PrimaryButton(title: e.registered ? "CANCEL REGISTRATION" : "REGISTER", enabled: e.registered || (e.spotsLeft != 0 && status != .done)) { app.toggleRegistered(e) }
                        } else {
                            PrimaryButton(title: e.saved ? "SAVED TO PASS" : "ADD TO MY PASS", systemImage: e.saved ? "checkmark" : "plus") { app.toggleSaved(e) }
                        }
                        if let ics {
                            ShareLink(item: ics, subject: Text(e.title), message: Text("Add to your calendar")) {
                                Image(systemName: "calendar.badge.plus").font(.system(size: 20)).foregroundStyle(P.ink)
                                    .frame(width: 58, height: 58).background(P.surfaceAlt, in: Circle()).overlay(Circle().stroke(P.line))
                            }
                            .accessibilityLabel("Add to calendar")
                        }
                    }
                }
                .padding(24)
            }
            .background(P.bg.ignoresSafeArea())
            .task(id: e.id) { ics = CalendarFile.write(for: e) }
        } else {
            Color.clear.onAppear { dismiss() }
        }
    }

    private func seatText(_ e: Event) -> String {
        if e.registered { return "You have a seat." }
        if e.spotsLeft == 0 { return "This event is full." }
        if let left = e.spotsLeft { return "\(left) of \(e.capacity ?? 0) seats left" }
        return "Registration required"
    }

    private func info(_ symbol: String, _ text: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: symbol).font(.system(size: 16)).foregroundStyle(P.muted).frame(width: 22)
            Text(text).font(Fonts.body(15, 500, style: .subheadline)).foregroundStyle(P.ink)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18).padding(.vertical, 14)
    }
}

/// Writes a one-event .ics so "Add to calendar" works through the share sheet with no calendar permission.
enum CalendarFile {
    static func write(for e: Event) -> URL? {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "UTC"); f.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
        func esc(_ s: String) -> String { s.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: ";", with: "\\;").replacingOccurrences(of: ",", with: "\\,").replacingOccurrences(of: "\n", with: "\\n") }
        let lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Qiskit Fall Fest//EN", "BEGIN:VEVENT", "UID:\(e.id)@qff",
                     "DTSTAMP:\(f.string(from: Date()))", "DTSTART:\(f.string(from: e.startsAt))", "DTEND:\(f.string(from: e.endsAt))",
                     "SUMMARY:\(esc(e.title + " · Qiskit Fall Fest"))", "LOCATION:\(esc(e.location))", "DESCRIPTION:\(esc(e.description))", "END:VEVENT", "END:VCALENDAR"]
        let name = e.title.lowercased().map { $0.isLetter || $0.isNumber ? String($0) : "-" }.joined().prefix(40)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(name).ics")
        do { try lines.joined(separator: "\r\n").write(to: url, atomically: true, encoding: .utf8); return url } catch { return nil }
    }
}
