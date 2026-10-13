import SwiftUI

private enum HubFilter: String, CaseIterable { case all = "All", ongoing = "Ongoing", upcoming = "Upcoming", saved = "Saved" }

struct HubView: View {
    @EnvironmentObject var app: AppState
    @EnvironmentObject var router: Router
    @State private var picked: Date?
    @State private var filter: HubFilter = .all
    @Namespace private var filterNS

    private var days: [Date] {
        guard let first = app.events.map(\.startDay).min(), let last = app.events.map(\.endDay).max() else { return [] }
        var out: [Date] = []; var d = first
        while d <= last && out.count < 60 { out.append(d); d = istCalendar.date(byAdding: .day, value: 1, to: d)! }
        return out
    }
    private var day: Date? {
        picked ?? days.first(where: { $0 == istCalendar.startOfDay(for: app.now) }) ?? days.first
    }
    private var shown: [Event] {
        app.events.filter { e in
            (day.map(e.covers) ?? true) && { () -> Bool in
                switch filter {
                case .all: return true
                case .ongoing: return app.status(of: e) == .live
                case .upcoming: return app.status(of: e) == .upcoming
                case .saved: return e.saved
                }
            }()
        }.sorted { a, b in
            let ra = (day.map { a.isMultiDay && a.startDay < $0 } ?? false) ? 0 : 1
            let rb = (day.map { b.isMultiDay && b.startDay < $0 } ?? false) ? 0 : 1
            return ra != rb ? ra < rb : a.startsAt < b.startsAt
        }
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
                    if days.count > 1 { DayChips(days: days, selected: day) { picked = $0; Haptics.select() }.padding(.bottom, 14) }
                    filterBar.padding(.horizontal, 24).padding(.bottom, 18)
                    if shown.isEmpty {
                        EmptyHub(title: filter == .saved ? "Nothing saved yet" : "No events here",
                                 sub: filter == .saved ? "Tap the bookmark on any event to add it to your pass." : "Try a different day or filter.",
                                 symbol: filter == .saved ? "bookmark" : "calendar")
                    }
                    ForEach(shown) { e in
                        EventRow(event: e, day: day).padding(.horizontal, 24).padding(.vertical, 6)
                            .transition(.opacity.combined(with: .scale(scale: 0.98)))
                    }
                    .animation(.spring(response: 0.4, dampingFraction: 0.85), value: shown.map(\.id))
                    PartnerLine()
                }
            }
            .padding(.bottom, 24)
        }
        .background(P.bg.ignoresSafeArea())
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
        let h = istCalendar.component(.hour, from: app.now)
        return VStack(alignment: .leading, spacing: 2) {
            Text("\(h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"), \(app.profile?.firstName ?? "")").font(T.h1).foregroundStyle(P.ink)
            Text(Fmt.dateGreeting.string(from: app.now) + (app.settings["venue"].map { " · \($0)" } ?? "")).font(T.body).foregroundStyle(P.muted)
        }
        .padding(.horizontal, 24).padding(.top, 4).padding(.bottom, 18)
    }

    private var filterBar: some View {
        HStack(spacing: 0) {
            ForEach(HubFilter.allCases, id: \.self) { f in
                Button { withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) { filter = f }; Haptics.select() } label: {
                    HStack(spacing: 2) {
                        Text(f.rawValue).font(Fonts.body(13, 500, style: .footnote))
                        if f == .ongoing && live != nil { PulseDot(color: filter == f ? P.accent : Color(hex: 0x22C55E), size: 5) }
                    }
                    .foregroundStyle(filter == f ? P.onPrimary : P.muted)
                    .frame(maxWidth: .infinity, minHeight: 40)
                    .background { if filter == f { Capsule().fill(P.primary).matchedGeometryEffect(id: "pill", in: filterNS) } }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4).background(P.surfaceAlt, in: Capsule())
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
        let firstStart = ([app.events.map(\.startsAt).min(), day(app.settings["fest_start"])].compactMap { $0 }).min() ?? now
        let lastEnd = ([app.events.map(\.endsAt).max(), day(app.settings["fest_end"], endOfDay: true)].compactMap { $0 }).max() ?? now
        let before = now < firstStart, after = now > lastEnd
        let target = live ?? next ?? app.events.first

        Button {
            if let t = target { router.sheet = .event(t.id); Haptics.tap() }
        } label: {
            ZStack(alignment: .leading) {
                LinearGradient(colors: [P.hero1, P.hero2], startPoint: .topLeading, endPoint: .bottomTrailing)
                AtomOrb(color: .white, period: 12).frame(width: 250, height: 250).opacity(0.5).offset(x: 150)
                VStack(alignment: .leading, spacing: 0) {
                    Group {
                        if let l = live { HStack(spacing: 6) { PulseDot(color: P.accent); Text("LIVE NOW · \(l.location.uppercased())").lineLimit(1) } }
                        else if before { Text("FEST STARTS IN") }
                        else if after { Text("THANKS FOR JOINING") }
                        else { Text("UP NEXT · \(next.map { Fmt.weekdayTime.string(from: $0.startsAt).uppercased() } ?? "")") }
                    }
                    .font(T.label).tracking(1.3).foregroundStyle(P.accent)
                    Spacer(minLength: 8)
                    if before {
                        let s = Int(firstStart.timeIntervalSince(now))
                        HStack(spacing: 8) {
                            CountUnit(value: s / 86400, label: "DAYS"); CountUnit(value: (s / 3600) % 24, label: "HRS"); CountUnit(value: (s / 60) % 60, label: "MIN")
                        }
                        Text(app.settings["venue"] ?? "First up · \(target?.title ?? "")").font(T.body).foregroundStyle(.white.opacity(0.7)).lineLimit(1)
                    } else if after {
                        Text("See you at\nFall Fest 2027").font(T.h1).foregroundStyle(.white)
                    } else {
                        Text(target?.title ?? "").font(Fonts.display(28, 700, style: .title1)).foregroundStyle(.white).lineLimit(2).minimumScaleFactor(0.75).multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 8)
                    HStack {
                        Text(before ? (app.settings["fest_name"] ?? "") : (target?.rangeLabel ?? "")).font(T.small).foregroundStyle(.white.opacity(0.75)).lineLimit(1)
                        Spacer()
                        Image(systemName: "arrow.right").font(.system(size: 18, weight: .semibold)).foregroundStyle(P.ink)
                            .frame(width: 46, height: 46).background(.white, in: Circle())
                    }
                }
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            .frame(height: 214)
            .clipShape(RoundedRectangle(cornerRadius: 30, style: .continuous))
        }
        .buttonStyle(PressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(live.map { "Live now: \($0.title)" } ?? (before ? "Festival countdown" : "Up next"))
    }
}

// MARK: Day chips

private struct DayChips: View {
    let days: [Date]; let selected: Date?; let onSelect: (Date) -> Void
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(Array(days.enumerated()), id: \.element) { i, d in
                        let sel = d == selected
                        let monthStart = i == 0 || istCalendar.component(.month, from: days[i - 1]) != istCalendar.component(.month, from: d)
                        Button { onSelect(d) } label: {
                            VStack(spacing: 2) {
                                Text(monthStart ? Fmt.monthShort.string(from: d).uppercased() : dayShort(d)).font(Fonts.body(10, 700, style: .caption2)).tracking(1.3).opacity(0.65)
                                Text("\(istCalendar.component(.day, from: d))").font(Fonts.display(20, 600, style: .title3))
                                Text(monthStart ? dayShort(d) : " ").font(Fonts.body(9, 700, style: .caption2)).tracking(1).opacity(0.55)
                            }
                            .foregroundStyle(sel ? P.bg : P.ink)
                            .frame(width: 66).padding(.vertical, 12)
                            .background(sel ? P.ink : P.surface, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(sel ? .clear : P.line))
                        }
                        .buttonStyle(PressStyle()).id(d)
                        .accessibilityLabel(Fmt.dateLong.string(from: d)).accessibilityAddTraits(sel ? .isSelected : [])
                    }
                }
                .padding(.horizontal, 24)
            }
            .onAppear { if let s = selected { proxy.scrollTo(s, anchor: .center) } }
            .onChange(of: selected) { s in if let s { withAnimation { proxy.scrollTo(s, anchor: .center) } } }
        }
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

    private var locationLabel: some View {
        HStack(spacing: 6) {
            Image(systemName: "mappin.and.ellipse").font(.system(size: 12))
            Text(event.location).lineLimit(1)
        }
    }
    @ViewBuilder private var extraPills: some View {
        if event.isMultiDay { Pill(text: "\(event.durationDays) DAYS", bg: P.surfaceAlt, fg: P.muted) }
        if event.registered { Pill(text: "REGISTERED", bg: P.mint, fg: P.mintInk) }
    }

    var body: some View {
        let status = app.status(of: event)
        Card {
            HStack(spacing: 14) {
                Button { router.sheet = .event(event.id); Haptics.tap() } label: {
                    HStack(spacing: 14) {
                        IconBubble(symbol: event.track.symbol, size: 52, tint: status == .live ? P.mintInk : P.ink, bg: status == .live ? P.mint : P.surfaceAlt)
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 8) {
                                Text(day.map { event.timeLabel(on: $0) } ?? Fmt.dmTime.string(from: event.startsAt)).font(T.small).foregroundStyle(P.muted)
                                StatusBadge(status: status, checkedIn: app.isCheckedIn(event))
                            }
                            Text(event.title).font(T.title).foregroundStyle(P.ink).lineLimit(1)
                            ViewThatFits(in: .horizontal) {
                                HStack(spacing: 6) { locationLabel; extraPills }
                                locationLabel
                            }
                            .font(T.small).foregroundStyle(P.muted)
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
            .padding(16)
        }
    }
}

private struct CountUnit: View {
    let value: Int
    let label: String
    var body: some View {
        VStack(spacing: 0) {
            Text(String(format: "%02d", value)).font(Fonts.display(28, 700, style: .title1)).foregroundStyle(.white)
            Text(label).font(Fonts.body(9, 700, style: .caption2)).tracking(1.1).foregroundStyle(P.accent)
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(.white.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}
