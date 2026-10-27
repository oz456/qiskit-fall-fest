import SwiftUI

/// After a door check-in at an event that collects OD details, the student gives OD from time, OD until time and the number of hours.
struct OdView: View {
    let eventId: String
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var from = Calendar.current.date(bySettingHour: 10, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var until = Calendar.current.date(bySettingHour: 12, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var fromSet = false
    @State private var untilSet = false
    @State private var hours = ""
    @State private var hoursEdited = false
    @State private var error: String?
    @State private var saving = false

    private func hhmm(_ d: Date) -> String { let c = Calendar.current.dateComponents([.hour, .minute], from: d); return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0) }
    private func mins(_ d: Date) -> Int { let c = Calendar.current.dateComponents([.hour, .minute], from: d); return (c.hour ?? 0) * 60 + (c.minute ?? 0) }
    private func auto() { guard !hoursEdited, fromSet, untilSet else { return }; let m = mins(until) - mins(from); if m > 0 { let h = (Double(m) / 15).rounded() / 4; hours = h.truncatingRemainder(dividingBy: 1) == 0 ? String(Int(h)) : String(h) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("OD details").font(Fonts.display(28, 700, style: .title1)).foregroundStyle(P.ink)
            Text(app.events.first { $0.id == eventId }.map { "You were checked in at \($0.title). Tell us your OD times." } ?? "You were checked in. Tell us your OD times.").font(T.body).foregroundStyle(P.muted)
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 6) { Text("OD from time").font(T.small).foregroundStyle(P.muted)
                    DatePicker("", selection: $from, displayedComponents: .hourAndMinute).labelsHidden().onChange(of: from) { _ in fromSet = true; error = nil; auto() } }
                VStack(alignment: .leading, spacing: 6) { Text("OD until time").font(T.small).foregroundStyle(P.muted)
                    DatePicker("", selection: $until, displayedComponents: .hourAndMinute).labelsHidden().onChange(of: until) { _ in untilSet = true; error = nil; auto() } }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Number of hours").font(T.small).foregroundStyle(P.muted)
                TextField("e.g. 2", text: $hours).keyboardType(.decimalPad).font(T.body).foregroundStyle(P.ink).padding(.horizontal, 16).frame(height: 52)
                    .background(P.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(P.line, lineWidth: 1))
                    .onChange(of: hours) { _ in hoursEdited = true; error = nil }
            }
            if let error { Text(error).font(T.small).foregroundStyle(P.danger) }
            HStack(spacing: 12) {
                Button("Later") { app.odDismissed.insert(eventId); dismiss() }.font(T.small).foregroundStyle(P.muted).frame(maxWidth: .infinity)
                PrimaryButton(title: "SAVE", loading: saving) { save() }.frame(maxWidth: .infinity)
            }
            Spacer(minLength: 0)
        }
        .padding(24).background(Backdrop())
        .presentationDetents([.medium, .large])
    }

    private func save() {
        let n = Double(hours.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: "."))
        if !fromSet || !untilSet { error = "Fill in both times."; return }
        if mins(until) <= mins(from) { error = "OD until time must be after OD from time."; return }
        guard let n, n > 0, n <= 24 else { error = "Enter the number of hours (more than 0, at most 24)."; return }
        saving = true; error = nil
        Task {
            do { try await app.saveOd(eventId: eventId, from: hhmm(from), until: hhmm(until), hours: n); dismiss() }
            catch { self.error = error.localizedDescription }
            saving = false
        }
    }
}
