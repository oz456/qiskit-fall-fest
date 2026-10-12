import SwiftUI

struct SupportView: View {
    @EnvironmentObject var app: AppState
    @EnvironmentObject var router: Router

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 2) {
                    SectionLabel(text: "SUPPORT & GRIEVANCES")
                    Text("We’ve got\nyour back.").font(Fonts.display(32, 700, style: .largeTitle)).foregroundStyle(P.ink)
                }
                .padding(.horizontal, 24).padding(.vertical, 18)

                Button { router.sheet = .form("General"); Haptics.tap() } label: {
                    Card {
                        HStack(spacing: 16) {
                            IconBubble(symbol: "person.wave.2", size: 54, tint: P.mintInk, bg: P.mint)
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Need help?").font(T.title).foregroundStyle(P.ink)
                                Text(app.settings["support_note"] ?? "Reach our support team or raise a grievance.").font(T.small).foregroundStyle(P.muted).multilineTextAlignment(.leading)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(P.muted)
                        }
                        .padding(20)
                    }
                }
                .buttonStyle(PressStyle()).padding(.horizontal, 24)

                VStack(spacing: 0) {
                    option("person.3", "Request mentor help", "Stuck on your quantum circuit? Ping an expert.") { router.sheet = .form("Mentor help") }
                    Divider().overlay(P.line)
                    option("exclamationmark.triangle", "Submit a grievance", "Report an issue, bug, or team dispute.") { router.sheet = .form("Grievance") }
                    Divider().overlay(P.line)
                    option("book", "FAQs & rules", "Hackathon guidelines.") { router.sheet = .faq }
                }
                .padding(.horizontal, 24).padding(.top, 10)

                Button { router.sheet = .form("General"); Haptics.tap() } label: {
                    Label("NEW SUPPORT TICKET", systemImage: "ticket").font(T.button).tracking(1).foregroundStyle(P.mintInk)
                        .frame(maxWidth: .infinity, minHeight: 58).background(P.mint, in: Capsule())
                }
                .buttonStyle(PressStyle()).padding(.horizontal, 24).padding(.top, 20)

                if !app.tickets.isEmpty {
                    SectionLabel(text: "YOUR TICKETS").padding(.horizontal, 24).padding(.top, 30).padding(.bottom, 8)
                    ForEach(app.tickets) { t in
                        let replied = t.messages.last?.fromAdmin == true
                        Button { router.sheet = .thread(t.id); Haptics.tap() } label: {
                            Card(radius: 20) {
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack(spacing: 8) {
                                        Text(t.code).font(T.bodyM).foregroundStyle(P.ink)
                                        if t.status == "resolved" { Pill(text: "RESOLVED", bg: P.mint, fg: P.mintInk) }
                                        else if replied { Pill(text: "NEW REPLY", bg: P.primary, fg: P.onPrimary) }
                                        else { Pill(text: t.status.replacingOccurrences(of: "_", with: " ").uppercased(), bg: P.surfaceAlt, fg: P.muted) }
                                        Spacer()
                                        Text(Fmt.stamp.string(from: t.createdAt)).font(T.small).foregroundStyle(P.muted)
                                    }
                                    Text("\(t.kind) · \(t.topic)").font(Fonts.display(15, 600, style: .subheadline)).foregroundStyle(P.ink)
                                    if let m = t.messages.last { Text((m.fromAdmin ? "Team: " : "You: ") + m.body).font(T.small).foregroundStyle(P.muted).lineLimit(2).multilineTextAlignment(.leading) }
                                }
                                .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        .buttonStyle(PressStyle()).padding(.horizontal, 24).padding(.vertical, 5)
                    }
                }
            }
            .padding(.bottom, 24)
        }
        .background(P.bg.ignoresSafeArea())
        .refreshable { await app.refresh() }
    }

    private func option(_ symbol: String, _ title: String, _ sub: String, _ action: @escaping () -> Void) -> some View {
        Button { Haptics.tap(); action() } label: {
            HStack(spacing: 16) {
                IconBubble(symbol: symbol, size: 50)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(T.title).foregroundStyle(P.ink)
                    Text(sub).font(T.small).foregroundStyle(P.muted).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(P.muted)
            }
            .padding(.vertical, 16).contentShape(Rectangle())
        }
        .buttonStyle(PressStyle())
    }
}

// MARK: Sheets

struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        layout(in: proposal.width ?? 320, subviews: subviews).size
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let r = layout(in: bounds.width, subviews: subviews)
        for (i, f) in r.frames.enumerated() { subviews[i].place(at: CGPoint(x: bounds.minX + f.minX, y: bounds.minY + f.minY), proposal: .unspecified) }
    }
    private func layout(in width: CGFloat, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0, maxW: CGFloat = 0
        var frames: [CGRect] = []
        for s in subviews {
            let sz = s.sizeThatFits(.unspecified)
            if x + sz.width > width, x > 0 { x = 0; y += rowH + spacing; rowH = 0 }
            frames.append(CGRect(x: x, y: y, width: sz.width, height: sz.height))
            x += sz.width + spacing; rowH = max(rowH, sz.height); maxW = max(maxW, x - spacing)
        }
        return (CGSize(width: maxW, height: y + rowH), frames)
    }
}

struct Chip: View {
    let text: String; let selected: Bool; let action: () -> Void
    var body: some View {
        Button { Haptics.select(); action() } label: {
            Text(text).font(Fonts.body(13, 500, style: .footnote)).foregroundStyle(selected ? P.onPrimary : P.ink)
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(selected ? P.primary : P.surface, in: Capsule())
                .overlay(Capsule().stroke(selected ? .clear : P.line))
        }
        .buttonStyle(PressStyle())
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

struct TicketFormSheet: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State var kind: String
    @State private var topic = ""
    @State private var message = ""
    @State private var doneCode: String?
    @State private var busy = false
    @State private var err: String?
    @FocusState private var typing: Bool

    private var topics: [String] {
        switch kind {
        case "Mentor help": return ["Circuits", "Algorithms", "IBM Quantum / hardware", "Setup & Git"]
        case "Grievance": return ["Facilities", "Team dispute", "Conduct", "Other"]
        default: return ["Pass / check-in", "Schedule", "Wi-Fi & power", "Other"]
        }
    }

    var body: some View {
        ScrollView {
            if let code = doneCode {
                VStack(spacing: 12) {
                    Image(systemName: "checkmark").font(.system(size: 40, weight: .semibold)).foregroundStyle(P.mintInk)
                        .frame(width: 84, height: 84).background(P.mint, in: Circle())
                    Text("Ticket raised").font(T.h1).foregroundStyle(P.ink)
                    Text(code).font(T.title).foregroundStyle(P.mintInk)
                    Text("A volunteer will reply here and by email. Track it under Your tickets.").font(T.body).foregroundStyle(P.muted).multilineTextAlignment(.center)
                    PrimaryButton(title: "DONE") { dismiss() }.padding(.top, 10)
                }
                .padding(24).padding(.top, 20)
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    Text(kind == "Mentor help" ? "Request mentor help" : kind == "Grievance" ? "Submit a grievance" : "New support ticket").font(T.h1).foregroundStyle(P.ink)
                    SectionLabel(text: "TYPE")
                    FlowLayout { ForEach(["General", "Mentor help", "Grievance"], id: \.self) { k in Chip(text: k, selected: kind == k) { kind = k; topic = topics.first ?? "" } } }
                    SectionLabel(text: "TOPIC")
                    FlowLayout { ForEach(topics, id: \.self) { t in Chip(text: t, selected: topic == t) { topic = t } } }
                    SectionLabel(text: "DETAILS")
                    ZStack(alignment: .topLeading) {
                        if message.isEmpty { Text("Describe what’s going on, and where to find you.").font(T.body).foregroundStyle(P.muted.opacity(0.8)).padding(.top, 8).padding(.leading, 5) }
                        TextEditor(text: $message).font(T.body).foregroundStyle(P.ink).scrollContentBackground(.hidden).focused($typing).frame(minHeight: 120)
                            .onChange(of: message) { if $0.count > 2000 { message = String($0.prefix(2000)) } }
                    }
                    .padding(14).background(P.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(P.line))
                    if let err { Text(err).font(T.small).foregroundStyle(P.danger) }
                    PrimaryButton(title: "SUBMIT", loading: busy, enabled: message.trimmingCharacters(in: .whitespacesAndNewlines).count >= 5) { submit() }
                }
                .padding(24)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .background(P.bg.ignoresSafeArea())
        .onAppear { if topic.isEmpty { topic = topics.first ?? "" } }
    }

    private func submit() {
        busy = true; err = nil
        Task {
            do { doneCode = try await app.createTicket(kind: kind, topic: topic, text: message.trimmingCharacters(in: .whitespacesAndNewlines)); Haptics.success() }
            catch let x as APIError { err = x.message }
            catch { err = "Couldn't send. Check your connection and try again." }
            busy = false
        }
    }
}

struct ThreadSheet: View {
    @EnvironmentObject var app: AppState
    let id: String
    @State private var text = ""

    var body: some View {
        if let t = app.tickets.first(where: { $0.id == id }) {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(t.code).font(T.h1).foregroundStyle(P.ink)
                    Text("\(t.kind) · \(t.topic) · \(t.status.replacingOccurrences(of: "_", with: " "))").font(T.small).foregroundStyle(P.muted)
                    VStack(spacing: 8) {
                        ForEach(t.messages) { m in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(m.body).font(T.body).foregroundStyle(m.fromAdmin ? P.mintInk : P.ink)
                                Text((m.fromAdmin ? "Fall Fest team · " : "") + Fmt.stamp.string(from: m.at)).font(Fonts.body(11, 400, style: .caption2)).foregroundStyle(P.muted)
                            }
                            .padding(14)
                            .background(m.fromAdmin ? P.mint : P.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(P.line))
                            .frame(maxWidth: 300, alignment: m.fromAdmin ? .leading : .trailing)
                            .frame(maxWidth: .infinity, alignment: m.fromAdmin ? .leading : .trailing)
                        }
                    }
                    TextEditor(text: $text).font(T.body).foregroundStyle(P.ink).scrollContentBackground(.hidden).frame(minHeight: 90)
                        .padding(12).background(P.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(P.line))
                    PrimaryButton(title: "SEND REPLY", enabled: !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) { app.replyTicket(id, text: text.trimmingCharacters(in: .whitespacesAndNewlines)); text = "" }
                }
                .padding(24)
            }
            .scrollDismissesKeyboard(.interactively).background(P.bg.ignoresSafeArea())
        }
    }
}

struct FaqSheet: View {
    @EnvironmentObject var app: AppState
    @State private var open: String?
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text("FAQs & rules").font(T.h1).foregroundStyle(P.ink).padding(.bottom, 12)
                if app.faqs.isEmpty { Text("No FAQs yet.").font(T.body).foregroundStyle(P.muted) }
                ForEach(app.faqs) { f in
                    VStack(alignment: .leading, spacing: 8) {
                        Button { withAnimation(.easeInOut(duration: 0.25)) { open = open == f.id ? nil : f.id }; Haptics.select() } label: {
                            HStack { Text(f.q).font(T.title).foregroundStyle(P.ink).multilineTextAlignment(.leading); Spacer()
                                Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(P.muted).rotationEffect(.degrees(open == f.id ? 90 : 0)) }
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if open == f.id { Text(f.a).font(T.body).foregroundStyle(P.muted).transition(.opacity) }
                    }
                    .padding(.vertical, 14)
                    Divider().overlay(P.line)
                }
            }
            .padding(24)
        }
        .background(P.bg.ignoresSafeArea())
    }
}
