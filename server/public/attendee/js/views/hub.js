// Hub: greeting, hero (live / up next / countdown), day strip, event list.
import { atom } from "../atom.js";
import { S, addDays, istDay, coversDay, dayNum, daysWithEvents, festDays, fmtDayHead, fmtTime, greetDate, greeting, initials, loadAll, markAnnouncementsSeen, monthShort, rangeLabel, statusOf, subscribe, timeLabelOn, toggleSaved, unreadAnnouncements, weekdayShort } from "../store.js";
import { TRACK_ICON, bubble, h, icon, pulse, toast } from "../ui.js";
import { lockup, partnerLine } from "./signin.js";
const KICKOFF_MS = Date.parse("2026-10-26T10:00:00+05:30"); // the countdown reaches zero at the fest opening: 26 Oct 2026, 10:00 AM IST

let picked = null;        // null = every day
let pickedInit = false;   // the first time the schedule is known, open on today's date (if it is a fest day)

export function eventRow(e, { day = null, trailing = true, open }) {
  const st = statusOf(e);
  return h("div", { class: "card press row", role: "button", tabindex: "0", onclick: () => open(e.id), onkeydown: (k) => { if (k.key === "Enter") open(e.id); } },
    bubble(TRACK_ICON[e.track] || "rocket", 50, st === "live"),
    h("div", { class: "meta" },
      h("div", { class: "when" }, day ? timeLabelOn(e, day) : fmtTime(e.startMs),
        st === "live" ? [pulse(), h("span", { class: "live" }, "LIVE")] : st === "done" ? h("span", { class: "ended" }, "ENDED") : null,),
      h("div", { class: "name" }, e.title),
      h("div", { class: "where" }, e.location + (e.multi ? ` · ${e.durationDays} days` : ""))),
    trailing ? h("button", { class: "save" + (e.saved ? " on" : ""), type: "button", "aria-label": e.saved ? "Unsave" : "Save", onclick: (ev) => { ev.stopPropagation(); toggleSaved(e, toast); ev.currentTarget.classList.add("pop"); } }, icon("bookmark")) : null);
}

import { installCard, onInstallChange } from "../install.js";

export function hubView({ open, openAnnouncements, openProfile }) {
  const root = h("div", { class: "screen" });
  const bell = h("button", { class: "iconbtn", type: "button", "aria-label": "Announcements", onclick: () => { markAnnouncementsSeen(); openAnnouncements(); } }, icon("bell"));
  const avatar = h("button", { class: "avatar", type: "button", "aria-label": "Profile", onclick: openProfile });
  const offline = h("div", {});
  const installBox = h("div", {});
  const greet = h("div", { class: "greet" });
  const canvas = h("canvas", { "aria-hidden": "true" });
  const heroBox = h("div", { class: "hero", role: "button", tabindex: "0" }, canvas);
  const heroBody = h("div", { style: { display: "contents" } });
  heroBox.append(heroBody);
  const stripBox = h("div", {});
  const listBox = h("div", { class: "list" });
  const foot = partnerLine();
  root.append(h("div", { class: "top" }, lockup(), bell, avatar), offline, installBox, greet, heroBox, stripBox, listBox, foot);
  requestAnimationFrame(() => atom(canvas, { color: "#f2e7d7", electron: "#eb732f", period: 9, line: 1.3 }));
  let railScroll = 0;

  function hero() {
    heroBody.replaceChildren();
    if (!S.events.length) { heroBox.classList.add("hidden"); return; } heroBox.classList.remove("hidden");
    const evs = S.events, now = S.now;
    const live = evs.filter((e) => statusOf(e) === "live").sort((a, b) => b.startMs - a.startMs)[0];
    const upcoming = evs.filter((e) => statusOf(e) === "upcoming").sort((a, b) => a.startMs - b.startMs);
    // people registered for the Hackathon (₹499 pass) see it here instead of the next session, until it starts
    const mineHack = S.profile?.flagship ? upcoming.find((e) => e.track === "Hackathon") : null;
    const next = mineHack || upcoming[0];
    const fe = S.settings.fest_end;
    const festEnd = /^\d{4}-\d{2}-\d{2}$/.test(fe || "") ? Date.parse(addDays(fe, 1) + "T00:00:00+05:30") : -Infinity;
    const firstStart = KICKOFF_MS, lastEnd = Math.max(...evs.map((e) => e.endMs), festEnd);
    const before = now < firstStart, after = now > lastEnd, target = live || next || evs[0];
    heroBox.onclick = () => open(target.id); heroBox.onkeydown = (k) => { if (k.key === "Enter") open(target.id); };
    if (live) heroBody.append(h("div", { class: "kicker" }, pulse(), `LIVE NOW · ${live.location.toUpperCase()}`));
    else if (before) heroBody.append(h("div", { class: "kicker" }, "FEST STARTS IN"));
    else if (after) heroBody.append(h("div", { class: "kicker" }, "THANKS FOR JOINING"));
    else heroBody.append(h("div", { class: "kicker" }, `${mineHack ? "YOUR HACKATHON" : "UP NEXT"} · ${next ? weekdayShort(next.startDay) + " " + fmtTime(next.startMs) : ""}`.toUpperCase()));
    if (before && !live) {
      const s = Math.max(0, Math.floor((firstStart - now) / 1000)), u = (n, l) => h("div", { class: "u glass" }, h("span", { class: "n" }, String(n).padStart(2, "0")), h("span", { class: "l" }, l));
      heroBody.append(h("div", { class: "count" }, u(Math.floor(s / 86400), "DAYS"), u(Math.floor(s / 3600) % 24, "HRS"), u(Math.floor(s / 60) % 60, "MIN")));
    } else if (after) heroBody.append(h("div", { class: "big" }, "See you at", h("br"), "Fall Fest 2027"));
    else heroBody.append(h("div", { class: "big" }, target.title));
    heroBody.append(h("div", { class: "foot" }, h("span", {}, before && !live ? S.settings.fest_name || "" : rangeLabel(target)), h("div", { class: "go" }, icon("arrowR"))));
  }

  function strip() {
    const days = festDays(); stripBox.replaceChildren();
    if (!days.length) return;
    if (!pickedInit) { pickedInit = true; const today = istDay(S.now); if (days.includes(today)) picked = today; }
    const has = daysWithEvents();
    const rail = h("div", { class: "rail" });
    const mk = (d, label1, mid, label2, on) => h("button", { class: "chip" + (on ? " on" : ""), type: "button", "aria-pressed": String(on), onclick: () => { picked = d; update(); } },
      h("span", { class: "t" }, label1), mid, h("span", { class: "t" }, label2), h("span", { class: "dot" + (d && has.has(d) ? " has" : "") }));
    rail.append(mk(null, "ALL", icon("grid"), "DAYS", picked == null));
    for (const d of days) rail.append(mk(d, weekdayShort(d), h("span", { class: "d" }, String(dayNum(d))), monthShort(d), picked === d));
    const step = () => (rail.children[1] ? rail.children[1].getBoundingClientRect().width + 8 : 80) * 3;
    const L = h("button", { class: "arrow", type: "button", "aria-label": "Earlier days", onclick: () => rail.scrollBy({ left: -step() }) }, icon("chevL"));
    const R = h("button", { class: "arrow", type: "button", "aria-label": "Later days", onclick: () => rail.scrollBy({ left: step() }) }, icon("chevR"));
    const sync = () => { railScroll = rail.scrollLeft; L.disabled = rail.scrollLeft < 4; R.disabled = rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4; };
    rail.addEventListener("scroll", sync, { passive: true });
    stripBox.append(h("div", { class: "days" }, L, rail, R));
    const restore = () => { rail.style.scrollBehavior = "auto"; rail.scrollLeft = railScroll; rail.style.scrollBehavior = ""; sync(); };
    restore(); requestAnimationFrame(restore);
  }

  function list() {
    listBox.replaceChildren();
    const shown = S.events.filter((e) => (picked == null || coversDay(e, picked)))
      .sort((a, b) => ((picked && a.multi && a.startDay < picked) ? 0 : 1) - ((picked && b.multi && b.startDay < picked) ? 0 : 1) || a.startMs - b.startMs);
    if (!S.events.length) { listBox.append(h("div", { class: "empty" }, bubble("calendar", 64, true), h("div", { class: "title" }, S.loading ? "Loading schedule…" : "Schedule coming soon"), h("div", { class: "small muted" }, "Pull down to refresh."))); return; }
    if (!shown.length) { listBox.append(h("div", { class: "empty" }, bubble("calendar", 64, true), h("div", { class: "title" }, "No events here"), h("div", { class: "small muted" }, "Try a different day."))); return; }
    let last = null;
    for (const e of shown) {
      if (picked == null && e.startDay !== last) { listBox.append(h("div", { class: "label dayhead" }, fmtDayHead(e.startDay).toUpperCase())); last = e.startDay; }
      listBox.append(eventRow(e, { day: picked, open }));
    }
  }

  function update() {
    bell.querySelector(".dot")?.remove(); if (unreadAnnouncements()) bell.append(h("i", { class: "dot" }));
    avatar.textContent = initials(S.profile?.name);
    offline.replaceChildren(S.offline ? h("div", { class: "offline" }, icon("cloudOff"), "You’re offline. Showing the last saved schedule.") : "");
    greet.replaceChildren(h("div", { class: "h1" }, greeting()), h("div", { class: "body muted" }, greetDate() + (S.settings.venue ? ` · ${S.settings.venue}` : "")));
    installBox.replaceChildren(installCard() || "");
    hero(); strip(); list();
  }
  const un = subscribe(update), unInstall = onInstallChange(update); update();
  return { el: root, refresh: loadAll, destroy() { un(); unInstall(); } };
}
