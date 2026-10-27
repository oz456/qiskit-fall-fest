// App state (same model as the Android/iPhone apps): schedule, announcements, tickets, saved events and unread markers.
import { ApiError, api } from "./api.js";

export const IST = "Asia/Kolkata";
const GREETINGS = [
  "Howdy, {n}!", "Ah, {n}. Right on time.", "{n}! Superposition suits you.", "Well, well, {n}.", "Look who collapsed into our app, {n}.",
  "Hey {n}, the qubits asked about you.", "Welcome back, {n}. Entangled yet?", "{n}, you made it. Probably.", "Greetings, {n}. Zero, one, or both?",
  "Hello {n}. Observing you now. Sorry.", "Oh good, {n} is here. We can begin.", "{n}! Quantum tunnelling worked.", "Psst, {n}. The schedule's below.",
  "Hi {n}. No cats were harmed, promise.", "Back again, {n}? We're flattered.",
];
const greetingSeed = Math.floor(Math.random() * 10000);

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode / full: the app works without the cache */ } };

export const S = {
  profile: read("qff.profile", null), events: [], faqs: [], settings: {}, announcements: [], tickets: [], checkins: {},
  loading: false, offline: false, odPending: [], needsSelfie: false, loaded: false,
  seenAnn: read("qff.seenAnn", null), seenTickets: read("qff.seenTickets", {}), now: Date.now(),
};
const subs = new Set();
export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const emit = () => subs.forEach((f) => f());
setInterval(() => { S.now = Date.now(); emit(); }, 15000);

// ---- time helpers (always the event timezone, never the phone's) ----
const f = (opts) => new Intl.DateTimeFormat("en-GB", { timeZone: IST, ...opts });
const F = {
  day: new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }),
  time: f({ hour: "numeric", minute: "2-digit", hour12: true }), dm: f({ day: "numeric", month: "short" }),
  dmTime: f({ day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }),
  long: f({ weekday: "long", day: "numeric", month: "long", year: "numeric" }), weekday: f({ weekday: "short" }), month: f({ month: "short" }),
  dayHead: f({ weekday: "short", day: "numeric", month: "short" }), greetDate: f({ weekday: "long", day: "numeric", month: "long" }),
  stamp: f({ day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }),
};
const up = (s) => s.replace(/\b(am|pm)\b/g, (m) => m.toUpperCase());
export const istDay = (ms) => F.day.format(ms);                 // "2026-10-26"
const dayMs = (d) => Date.parse(d + "T00:00:00+05:30");
export const addDays = (d, n) => istDay(dayMs(d) + n * 86400000 + 3600000);
export const fmtTime = (ms) => up(F.time.format(ms));
export const fmtDayHead = (d) => F.dayHead.format(dayMs(d) + 3600000).replace(",", "");
export const fmtStamp = (ms) => up(F.stamp.format(ms)).replace(",", ",");
export const weekdayShort = (d) => F.weekday.format(dayMs(d) + 3600000).toUpperCase();
export const monthShort = (d) => F.month.format(dayMs(d) + 3600000).toUpperCase();
export const dayNum = (d) => Number(d.slice(8));
export const greetDate = () => F.greetDate.format(S.now);

function norm(e) {
  const startMs = Date.parse(e.startsAt), endMs = Date.parse(e.endsAt), startDay = istDay(startMs), endDay = istDay(endMs);
  return { ...e, startMs, endMs, startDay, endDay, multi: endDay > startDay, durationDays: Math.round((dayMs(endDay) - dayMs(startDay)) / 86400000) + 1 };
}
export const statusOf = (e) => (S.now < e.startMs ? "upcoming" : S.now < e.endMs ? "live" : "done");
export const coversDay = (e, d) => d >= e.startDay && d <= e.endDay;
export const timeLabelOn = (e, d) => (!e.multi ? fmtTime(e.startMs) : d === e.startDay ? "From " + fmtTime(e.startMs) : d === e.endDay ? "Until " + fmtTime(e.endMs) : "All day");
export const rangeLabel = (e) => (!e.multi ? `${fmtTime(e.startMs)} – ${fmtTime(e.endMs)}` : `${up(F.dmTime.format(e.startMs))} → ${up(F.dmTime.format(e.endMs))}`.replace(/,/g, ""));
export const dayLabel = (e) => (!e.multi ? F.long.format(e.startMs) : `${F.dm.format(e.startMs)} – ${F.dm.format(e.endMs)} · ${e.durationDays} days`);

export const greeting = () => GREETINGS[greetingSeed % GREETINGS.length].replace("{n}", (S.profile?.name || "").split(" ")[0] || "there");
export const initials = (name = "") => name.split(" ").filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join("") || "?";

/** The festival window from admin settings plus every day an event touches, so no day is ever hidden. */
export function festDays() {
  const set = new Set(); const add = (a, b) => { for (let d = a, n = 0; d <= b && n < 45; d = addDays(d, 1), n++) set.add(d); };
  const a = S.settings.fest_start, b = S.settings.fest_end;
  if (/^\d{4}-\d{2}-\d{2}$/.test(a || "") && /^\d{4}-\d{2}-\d{2}$/.test(b || "") && b >= a) add(a, b);
  for (const e of S.events) add(e.startDay, e.endDay);
  return [...set].sort();
}
export const daysWithEvents = () => { const s = new Set(); for (const e of S.events) for (let d = e.startDay, n = 0; d <= e.endDay && n < 45; d = addDays(d, 1), n++) s.add(d); return s; };

// ---- unread markers ----
export const unreadAnnouncements = () => !!S.announcements[0] && S.announcements[0].id !== S.seenAnn;
export const markAnnouncementsSeen = () => { S.seenAnn = S.announcements[0]?.id ?? null; write("qff.seenAnn", S.seenAnn); emit(); };
export const hasNewReply = (t) => { const m = t.messages.at(-1); return !!m && m.author === "admin" && Date.parse(m.at) > (S.seenTickets[t.id] || 0); };
export const newReplies = () => S.tickets.some(hasNewReply);
export const markTicketSeen = (id) => { const t = S.tickets.find((x) => x.id === id), m = t?.messages.at(-1); if (!m) return; const v = Date.parse(m.at); if (S.seenTickets[id] === v) return; S.seenTickets[id] = v; write("qff.seenTickets", S.seenTickets); emit(); };

// ---- cache ----
const cached = read("qff.cache", null);
if (cached) { S.events = (cached.events || []).map(norm); S.faqs = cached.faqs || []; S.settings = cached.settings || {}; S.announcements = cached.announcements || []; S.tickets = cached.tickets || []; }

// ---- door check-ins: a new one (under 15 minutes old, not announced before) opens a popup; older ones are marked as seen silently ----
export const checkinLabel = (scope, at) => ({
  title: scope.startsWith("event:") ? S.events.find((e) => e.id === scope.slice(6))?.title || "Event" : "Campus entry",
  time: fmtStamp(Date.parse(at)),
});
export const hooks = { onCheckin(_notice) {} };
function applyCheckins(list) {
  S.checkins = Object.fromEntries(list.map((c) => [c.scope, c.at]));
  S.odPending = list.filter((c) => c.askOd).map((c) => c.scope.slice(6));   // events whose OD details this student still has to give
  const seen = new Set(read("qff.checkSeen", [])), fresh = list.filter((c) => !seen.has(c.scope));
  if (!fresh.length) return;
  fresh.forEach((c) => seen.add(c.scope)); write("qff.checkSeen", [...seen]);
  const newest = fresh.filter((c) => S.now - Date.parse(c.at) < 15 * 60000).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  if (newest) hooks.onCheckin(checkinLabel(newest.scope, newest.at));
}
/** Light check for a new door scan: only /v1/me. Called every few seconds while My Pass is open. */
export async function pollCheckins() {
  try { const me = await api.me(); applyCheckins(me.checkins); emit(); } catch { /* the next tick tries again */ }
}

export async function loadAll() {
  if (S.loading) return; S.loading = true; emit();
  try {
    const me = await api.me();
    S.profile = me.profile; S.needsSelfie = !me.profile.hasPhoto; S.needsDetails = !!me.profile.needsDetails; S.needsExtra = !!me.profile.needsExtra; S.detailsOptions = me.detailsOptions || null; applyCheckins(me.checkins); write("qff.profile", S.profile);
    if (!S.needsSelfie) {
      const [ev, ann, tix] = await Promise.all([api.events(), api.announcements(), api.tickets()]);
      S.events = ev.events.map(norm); S.faqs = ev.faqs; S.settings = ev.settings; S.announcements = ann; S.tickets = tix; S.loaded = true;
      write("qff.cache", { events: ev.events, faqs: ev.faqs, settings: ev.settings, announcements: ann, tickets: tix });
    }
    S.offline = false;
  } catch (e) {
    if (e instanceof ApiError && e.code === "photo_required") S.needsSelfie = true;
    else if (e instanceof ApiError && e.status === 0) S.offline = true;
    else if (!(e instanceof ApiError && e.status === 401)) throw e;
  } finally { S.loading = false; S.now = Date.now(); emit(); }
}

export async function toggleSaved(ev, toast) {
  const on = !ev.saved; ev.saved = on; emit();
  try { await api.setSaved(ev.id, on); }
  catch (e) { ev.saved = !on; emit(); toast(e instanceof ApiError && e.status !== 0 ? e.message : "Couldn’t save. Check your connection."); }
}

export function resetState() {
  Object.assign(S, { profile: null, events: [], faqs: [], settings: {}, announcements: [], tickets: [], checkins: {}, needsSelfie: false, needsDetails: false, needsExtra: false, odPending: [], detailsOptions: null, loaded: false, offline: false, seenAnn: null, seenTickets: {} });
  for (const k of ["qff.profile", "qff.cache", "qff.seenAnn", "qff.seenTickets", "qff.notifAsked", "qff.checkSeen"]) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
  emit();
}
