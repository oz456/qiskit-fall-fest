import SwiftUI

private enum HubEntry: Identifiable {
    case header(Date), event(Event)
    var id: String { switch self { case .header(let d): return "h\(d.timeIntervalSince1970)"; case .event(let e): return e.id } }
}


struct HubView: View {
    @EnvironmentObject var app: AppState
    @EnvironmentObject var router: Router
    @State private var picked: Date?

    /// The whole festival window (admin setting) plus every day an event touches, so no day is ever hidden.
    private var days: [Date] {
        var set = Set<Date>()
        func add(_ a: Date, _ b: Date) { var d = a; var n = 0; while d <= b && n < 45 { set.insert(d); d = istCalendar.date(byAdding: .day, value: 1, to: d)!; n += 1 } }
        if let a = parseDay(app.settings["fest_start"]), let b = parseDay(app.settings["fest_end"]), b >= a { add(a, b) }
        for e in app.events { add(e.startDay, e.endDay) }
        return set.sorted()
    }
    private var daysWithEvents: Set<Date> {
        var set = Set<Date>()
        for e in app.events { var d = e.startDay; var n = 0; while d <= e.endDay && n < 45 { set.insert(d); d = istCalendar.date(byAdding: .day, value: 1, to: d)!; n += 1 } }
        return set
    }
    private var day: Date? { picked } // nil = every day
    private var shown: [Event] {
        app.events.filter { e in (day.map(e.covers) ?? true) }.sorted { a, b in
            let ra = (day.map { a.isMultiDay && a.startDay < $0 } ?? false) ? 0 : 1
            let rb = (day.map { b.isMultiDay && b.startDay < $0 } ?? false) ? 0 : 1
            return ra != rb ? ra < rb : a.startsAt < b.startsAt
        }
    }
    /// With "All days" the list is grouped under a small date header.
    private var entries: [HubEntry] {
        guard day == nil else { return shown.map { .event($0) } }
        var out: [HubEntry] = []; var last: Date?
        for e in shown { if e.startDay != last { out.append(.header(e.startDay)); last = e.startDay }; out.append(.event(e)) }
        return out
    }
    private var live: Event? { app.events.filter { app.status(of: $0) == .live }.max { $0.startsAt < $1.startsAt } }
    private var next: Event? { app.events.filter { app.status(of: $0) == .upcoming }.min { $0.startsAt < $1.startsAt } }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                header
                if app.offline { offlineBanner }
                greeting
                if app.events.isEmpty {
                    EmptyHub(title: app.refreshing ? "Loading schedule…" : "Schedule coming soon", sub: "Pull down to refresh.", symbol: "calendar.badge.clock")
                } else {
                    Hero(live: live, next: next).padding(.horizontal, 24).padding(.bottom, 26)
                    if !days.isEmpty { DayStrip(days: days, withEvents: daysWithEvents, selected: day) { picked = $0; Haptics.select() }.padding(.bottom, 14) }
                    if shown.isEmpty {
                        EmptyHub(title: "No events here", sub: "Try a different day.", symbol: "calendar")
                    }
                    ForEach(entries) { entry in
                        switch entry {
                        case .header(let d):
                            Text(Fmt.dayHeader.string(from: d).uppercased()).font(T.label).tracking(1.3).foregroundStyle(P.muted)
                                .padding(.horizontal, 28).padding(.top, 14).padding(.bottom, 2)
                        case .event(let e):
                            EventRow(event: e, day: day).padding(.horizontal, 24).padding(.vertical, 6)
                                .transition(.opacity.combined(with: .scale(scale: 0.98)))
                        }
                    }
                    .animation(.spring(response: 0.4, dampingFraction: 0.85), value: entries.map(\.id))
                    PartnerLine()
                }
            }
            .padding(.bottom, 24)
        }
        .background(Backdrop())
        .refreshable { await app.refresh() }
    }

    private var header: some View {
        HStack {
            Logo()
            Spacer()
            Button { router.sheet = .notifications; app.markAnnouncementsSeen(); Haptics.tap() } label: {
                Image(systemName: "bell").font(.system(size: 20)).foregroundStyle(P.ink).frame(width: 44, height: 44)
                    .overlay(alignment: .topTrailing) {
                        if app.unread { Circle().fill(P.danger).frame(width: 9, height: 9).overlay(Circle().stroke(P.bg, lineWidth: 1.5)).padding(.top, 9).padding(.trailing, 10) }
                    }
            }
            .accessibilityLabel(app.unread ? "Announcements, new" : "Announcements")
            Button { router.sheet = .profile; Haptics.tap() } label: {
                Text(app.profile?.initials ?? "").font(T.bodyM).fontWeight(.bold).foregroundStyle(P.ink)
                    .frame(width: 42, height: 42).background(P.surfaceAlt, in: Circle()).overlay(Circle().stroke(P.line))
            }
            .accessibilityLabel("Profile")
        }
        .buttonStyle(PressStyle())
        .padding(.horizontal, 24).padding(.vertical, 14)
    }

    private var offlineBanner: some View {
        Label("You’re offline. Showing the last saved schedule.", systemImage: "icloud.slash")
            .font(T.small).foregroundStyle(P.muted)
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(P.surfaceAlt, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .padding(.horizontal, 24).padding(.bottom, 10)
    }

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(app.greeting).font(Fonts.display(25, 700, style: .title1)).foregroundStyle(P.ink).fixedSize(horizontal: false, vertical: true)
            Text(Fmt.dateGreeting.string(from: app.now) + (app.settings["venue"].map { " · \($0)" } ?? "")).font(T.body).foregroundStyle(P.muted)
        }
        .padding(.horizontal, 24).padding(.top, 4).padding(.bottom, 18)
    }

}

private struct EmptyHub: View {
    let title: String; let sub: String; let symbol: String
    var body: some View {
        VStack(spacing: 12) {
            IconBubble(symbol: symbol, size: 64, tint: P.mintInk, bg: P.mint)
            Text(title).font(T.title).foregroundStyle(P.ink)
            Text(sub).font(T.small).foregroundStyle(P.muted).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(40)
    }
}

// MARK: Hero

private struct Hero: View {
    /// 26 Oct 2026, 10:00 AM IST: the countdown reaches zero here.
    static let kickoff = istCalendar.date(from: DateComponents(timeZone: IST, year: 2026, month: 10, day: 26, hour: 10, minute: 0))!
    @EnvironmentObject var app: AppState
    @EnvironmentObject var router: Router
    let live: Event?
    let next: Event?

    private func day(_ s: String?, endOfDay: Bool = false) -> Date? {
        guard let s, let d = istCalendar.date(from: DateComponents(timeZone: IST, year: Int(s.prefix(4)), month: Int(s.dropFirst(5).prefix(2)), day: Int(s.suffix(2)))) else { return nil }
        return endOfDay ? istCalendar.date(byAdding: .day, value: 1, to: d) : d
    }

    var body: some View {
        let now = app.now
        // The festival window (admin setting) bounds the countdown and the "thanks" state, even before every session is listed.
        let firstStart = Self.kickoff // the countdown reaches zero at the fest opening: 26 Oct 2026, 10:00 AM IST
        let lastEnd = ([app.events.map(\.endsAt).max(), day(app.settings["fest_end"], endOfDay: true)].compactMap { $0 }).max() ?? now
        let before = now < firstStart, after = now > lastEnd
        let target = live ?? next ?? app.events.first

        Button {
            if let t = target { router.sheet = .event(t.id); Haptics.tap() }
        } label: {
            ZStack(alignment: .leading) {
                LinearGradient(colors: [P.hero1, P.hero2], startPoint: .topLeading, endPoint: .bottomTrailing)
                // the atom runs off the card edge: partly visible, ions orbiting
                AtomOrb(color: P.cream, electron: P.accent, period: 9).frame(width: 300, height: 300).opacity(0.75).offset(x: 128).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
                VStack(alignment: .leading, spacing: 0) {
                    Group {
                        if let l = live { HStack(spacing: 6) { PulseDot(color: P.accent); Text("LIVE NOW · \(l.location.uppercased())").lineLimit(1) } }
                        else if before { Text("FEST STARTS IN") }
                        else if after { Text("THANKS FOR JOINING") }
                        else { Text("UP NEXT · \(next.map { Fmt.weekdayTime.string(from: $0.startsAt).uppercased() } ?? "")") }
                    }
                    .font(T.label).tracking(1.3).foregroundStyle(P.accent).padding(.trailing, 56)
                    Spacer(minLength: 14)
                    if before {
                        let s = Int(firstStart.timeIntervalSince(now))
                        HStack(spacing: 8) {
                            CountUnit(value: s / 86400, label: "DAYS"); CountUnit(value: (s / 3600) % 24, label: "HRS"); CountUnit(value: (s / 60) % 60, label: "MIN")
                        }
                    } else if after {
                        Text("SEE YOU AT\nFALL FEST 2027").font(Fonts.poster(32)).foregroundStyle(.white)
                    } else {
                        Text(target?.title ?? "").font(Fonts.poster(30, style: .title1)).foregroundStyle(.white).lineLimit(2).minimumScaleFactor(0.8).multilineTextAlignment(.leading).padding(.trailing, 40)
                    }
                    Spacer(minLength: 18)
                    HStack {
                        Text(before ? (app.settings["fest_name"] ?? "") : (target?.rangeLabel ?? "")).font(T.small).foregroundStyle(.white.opacity(0.75)).lineLimit(1)
                        Spacer()
                        Image(systemName: "arrow.right").font(.system(size: 18, weight: .semibold)).foregroundStyle(P.ink)
                            .frame(width: 46, height: 46).background(.white, in: Circle())
                    }
                }
                .padding(.horizontal, 26).padding(.vertical, 24)
                .frame(maxWidth: .infinity, minHeight: 226, alignment: .topLeading)
            }
            .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
        }
        .buttonStyle(PressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(live.map { "Live now: \($0.title)" } ?? (before ? "Festival countdown" : "Up next"))
    }
}

// MARK: Day strip

/// "All" + each festival day, four visible at a time, glass arrows on both sides to slide through the rest.
private struct DayStrip: View {
    let days: [Date]; let withEvents: Set<Date>; let selected: Date?; let onSelect: (Date?) -> Void
    @State private var anchor = 0
    private var items: [Date?] { [nil] + days.map { Optional($0) } }
    private func key(_ d: Date?) -> Int { d.map { Int($0.timeIntervalSince1970) } ?? -1 }

    var body: some View {
        GeometryReader { geo in
            let chipW = (geo.size.width - 48 - 88 - 24) / 4
            ScrollViewReader { proxy in
                HStack(spacing: 0) {
                    arrow(false, enabled: anchor > 0) { move(-3, proxy) }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(Array(items.enumerated()), id: \.offset) { _, d in chip(d, width: chipW).id(key(d)) }
                        }
                        .padding(.horizontal, 4)
                    }
                    arrow(true, enabled: anchor + 4 < items.count) { move(3, proxy) }
                }
                .padding(.horizontal, 24)
            }
        }
        .frame(height: 86)
    }

    private func move(_ delta: Int, _ proxy: ScrollViewProxy) {
        anchor = max(0, min(items.count - 1, anchor + delta)); Haptics.select()
        withAnimation(.easeInOut(duration: 0.3)) { proxy.scrollTo(key(items[anchor]), anchor: .leading) }
    }

    private func chip(_ d: Date?, width: CGFloat) -> some View {
        let sel = d == selected
        return Button { onSelect(d) } label: {
            VStack(spacing: 1) {
                Text(d.map(dayShort) ?? "ALL").font(Fonts.body(9, 700, style: .caption2)).tracking(1.1).opacity(0.6)
                if let d { Text("\(istCalendar.component(.day, from: d))").font(Fonts.poster(26, style: .title2)) }
                else { Image(systemName: "rectangle.grid.1x2").font(.system(size: 18)).padding(.vertical, 5) }
                Text(d.map { Fmt.monthShort.string(from: $0).uppercased() } ?? "DAYS").font(Fonts.body(9, 700, style: .caption2)).tracking(1.1).opacity(0.6)
                Circle().fill(d.map { withEvents.contains($0) } == true ? P.accent : .clear).frame(width: 5, height: 5).padding(.top, 3)
            }
            .foregroundStyle(sel ? P.bg : P.ink)
            .frame(width: width, height: 84)
            .background(sel ? P.ink : P.surface, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(sel ? .clear : P.line))
        }
        .buttonStyle(PressStyle())
        .accessibilityLabel(d.map { Fmt.dateLong.string(from: $0) } ?? "All days").accessibilityAddTraits(sel ? .isSelected : [])
    }

    private func arrow(_ right: Bool, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: right ? "chevron.right" : "chevron.left").font(.system(size: 14, weight: .bold)).foregroundStyle(P.ink)
                .frame(width: 36, height: 36).glass(Circle(), tint: .white.opacity(0.35))
        }
        .buttonStyle(PressStyle()).opacity(enabled ? 1 : 0.35).disabled(!enabled)
        .accessibilityLabel(right ? "Later days" : "Earlier days")
    }
}

// MARK: Event row

struct StatusBadge: View {
    let status: EventStatus; let checkedIn: Bool
    var body: some View {
        switch (status, checkedIn) {
        case (.live, _): Pill(text: checkedIn ? "LIVE · CHECKED IN" : "LIVE", bg: P.mint, fg: P.mintInk, dot: true)
        case (_, true): Pill(text: "CHECKED IN", bg: P.mint, fg: P.mintInk)
        case (.done, _): Pill(text: "ENDED", bg: P.surfaceAlt, fg: P.muted)
        default: Pill(text: "UPCOMING", bg: P.surfaceAlt, fg: P.muted)
        }
    }
}

struct EventRow: View {
    @EnvironmentObject var app: AppState
    @EnvironmentObject var router: Router
    let event: Event
    var day: Date?
    var trailing = true

    var body: some View {
        let status = app.status(of: event)
        Card {
            HStack(spacing: 14) {
                Button { router.sheet = .event(event.id); Haptics.tap() } label: {
                    HStack(spacing: 14) {
                        IconBubble(symbol: event.track.symbol, size: 50, tint: status == .live ? P.mintInk : P.ink, bg: status == .live ? P.mint : P.surfaceAlt)
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 6) {
                                Text(day.map { event.timeLabel(on: $0) } ?? Fmt.time.string(from: event.startsAt)).font(T.small).foregroundStyle(P.muted)
                                if status == .live { PulseDot(color: P.accent, size: 5); Text("LIVE").font(Fonts.body(10, 700, style: .caption2)).tracking(0.8).foregroundStyle(P.accent) }
                                else if status == .done { Text("ENDED").font(Fonts.body(10, 700, style: .caption2)).tracking(0.8).foregroundStyle(P.muted) }
                            }
                            Text(event.title).font(T.title).foregroundStyle(P.ink).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                            Text(event.location + (event.isMultiDay ? " · \(event.durationDays) days" : "")).font(T.small).foregroundStyle(P.muted).lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(PressStyle())
                if trailing {
                    Button { app.toggleSaved(event) } label: {
                        Image(systemName: event.saved ? "bookmark.fill" : "bookmark")
                            .font(.system(size: 21)).foregroundStyle(event.saved ? P.mintInk : P.muted)
                            .frame(width: 44, height: 44).contentShape(Rectangle())
                            .scaleEffect(event.saved ? 1 : 0.92).animation(.spring(response: 0.3, dampingFraction: 0.5), value: event.saved)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(event.saved ? "Remove \(event.title) from pass" : "Save \(event.title) to pass")
                }
            }
            .padding(.horizontal, 18).padding(.vertical, 18)
        }
    }
}

private struct CountUnit: View {
    let value: Int
    let label: String
    var body: some View {
        VStack(spacing: 0) {
            Text(String(format: "%02d", value)).font(Fonts.poster(34, style: .title1)).foregroundStyle(.white)
            Text(label).font(Fonts.body(9, 700, style: .caption2)).tracking(1.1).foregroundStyle(P.cream)
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .glass(RoundedRectangle(cornerRadius: 16, style: .continuous), tint: .white.opacity(0.10))
    }
}
