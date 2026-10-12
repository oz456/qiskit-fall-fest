"use strict";
// Fall Fest admin — dependency-free. All dynamic text is inserted with textContent (no innerHTML) to prevent XSS.
const $app = document.getElementById("app");
let csrf = "", TZ = "Asia/Kolkata";

const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, ""); else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};
const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };

async function api(method, url, body) {
  const res = await fetch("/admin/api" + url, {
    method, credentials: "same-origin",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(method !== "GET" ? { "x-csrf-token": csrf } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !url.startsWith("/login")) { showLogin(); throw new Error("Signed out"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || "Request failed");
  return data;
}
function toast(msg) { const t = h("div", { class: "toast" }, msg); document.body.append(t); setTimeout(() => t.remove(), 2600); }
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

// ---- time helpers (always in the event timezone, not the admin's laptop zone) ----
const fmt = (iso, opts) => new Intl.DateTimeFormat("en-IN", { timeZone: TZ, ...opts }).format(new Date(iso));
const fmtRange = (a, b) => {
  const sameDay = fmt(a, { dateStyle: "short" }) === fmt(b, { dateStyle: "short" });
  const d = { day: "numeric", month: "short" }, t = { hour: "numeric", minute: "2-digit" };
  return sameDay ? `${fmt(a, d)}, ${fmt(a, t)} – ${fmt(b, t)}` : `${fmt(a, { ...d, ...t })} → ${fmt(b, { ...d, ...t })}`;
};
function tzOffsetMs(tz, utcMs) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - utcMs;
}
const localToIso = (local) => { // "2026-10-16T11:00" in TZ -> ISO instant
  const [d, t] = local.split("T"); const [y, m, da] = d.split("-").map(Number); const [hh, mm] = t.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, da, hh, mm);
  return new Date(guess - tzOffsetMs(TZ, guess - tzOffsetMs(TZ, guess))).toISOString();
};
const isoToLocal = (iso) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };

// ---- shell ----
const PAGES = [["dashboard", "Overview"], ["events", "Events"], ["people", "Attendees"], ["announce", "Announcements"], ["support", "Support"], ["attendance", "Attendance"], ["content", "Content"], ["activity", "Activity"]];
function showLogin() {
  clear($app);
  const err = h("div", { class: "err" }); const u = h("input", { autocomplete: "username", required: true }); const p = h("input", { type: "password", autocomplete: "current-password", required: true });
  const form = h("form", { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = "";
    try { const r = await api("POST", "/login", { username: u.value, password: p.value }); csrf = r.csrf; await boot(); } catch (x) { err.textContent = x.message; }
  } }, h("label", {}, "Username"), u, h("label", {}, "Password"), p, err, h("div", { class: "row" }, h("button", { class: "btn grow" }, "Sign in")));
  $app.append(h("div", { class: "login" }, h("div", { class: "brand" }, h("img", { src: "qiskit.svg", alt: "" }), "Fall Fest Admin"), h("div", { class: "card" }, form)));
}
let main;
function route() {
  const page = (location.hash.slice(1) || "dashboard"); clear(main);
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("on", a.dataset.p === page));
  const fn = { dashboard, events, people, announce, support, attendance, content, activity }[page] || dashboard;
  guard(fn)(main);
}
async function boot() {
  let me; try { me = await api("GET", "/me"); } catch { return showLogin(); }
  csrf = me.csrf; TZ = me.tz; clear($app);
  main = h("main");
  $app.append(h("div", { class: "shell" },
    h("nav", {}, h("div", { class: "brand" }, h("img", { src: "qiskit.svg", alt: "" }), "Fall Fest"),
      PAGES.map(([id, label]) => h("a", { href: "#" + id, "data-p": id }, label)),
      h("a", { href: "#", onclick: guard(async (e) => { e.preventDefault(); await api("POST", "/logout"); showLogin(); }) }, "Sign out")), main));
  route();
}
window.addEventListener("hashchange", () => main && route());

const head = (title, ...actions) => h("div", { class: "head" }, h("h1", {}, title), h("div", { class: "right row" }, actions));
function modal(title, body) {
  const bg = h("div", { class: "modal-bg", onmousedown: (e) => { if (e.target === bg) bg.remove(); } }, h("div", { class: "modal" }, h("div", { class: "head" }, h("h2", {}, title), h("button", { class: "btn ghost sm right", onclick: () => bg.remove() }, "Close")), body));
  document.body.append(bg); return bg;
}
const field = (label, input) => h("div", {}, h("label", {}, label), input);
const confirmDo = (msg, fn) => { if (confirm(msg)) guard(fn)(); };

// ---- pages ----
async function dashboard(m) {
  const s = await api("GET", "/stats");
  m.append(head("Overview"), h("div", { class: "grid g4" },
    [["Registered attendees", s.users], ["Using the app", s.app_users], ["Checked in today", s.checked_in_today], ["Open tickets", s.open_tickets], ["Events", s.events]]
      .map(([l, v]) => h("div", { class: "card stat" }, h("b", {}, v), h("span", { class: "muted" }, l)))),
    h("div", { class: "card", }, h("h2", {}, "Quick start"), h("p", { class: "muted" }, "Add or import attendees (only registered emails can sign in), create events (multi-day events are supported), post announcements and answer support tickets. Door scanning happens on the separate /check site, and results show up under Attendance.")));
}

async function events(m) {
  const list = await api("GET", "/events");
  m.append(head("Events", h("button", { class: "btn", onclick: () => editEvent() }, "New event")));
  m.append(h("div", { class: "card" }, h("table", {}, h("tr", {}, ["When", "Event", "Track", "Where", "Reg / Saved", ""].map((x) => h("th", {}, x))),
    list.map((e) => h("tr", { class: "click", onclick: () => editEvent(e) },
      h("td", {}, fmtRange(e.startsAt, e.endsAt)), h("td", {}, h("b", {}, e.title), " ", !e.published && h("span", { class: "pill warn" }, "HIDDEN"), " ", fmt(e.startsAt, { dateStyle: "short" }) !== fmt(e.endsAt, { dateStyle: "short" }) && h("span", { class: "pill" }, "MULTI-DAY")),
      h("td", {}, e.track), h("td", {}, e.location), h("td", {}, `${e.registered}${e.capacity ? " / " + e.capacity : ""} · ${e.saved}`), h("td", {}, "›"))))));
  if (!list.length) m.append(h("p", { class: "muted" }, "No events yet."));
}
function editEvent(e) {
  const v = e || { title: "", description: "", track: "Main", location: "", speaker: "", startsAt: null, endsAt: null, capacity: null, registrationRequired: false, published: true };
  const f = {
    title: h("input", { value: v.title, maxlength: 120, required: true }),
    track: h("select", {}, ["Main", "Workshop", "Talk", "Hackathon", "Social", "Competition"].map((t) => h("option", { value: t, selected: t === v.track }, t))),
    start: h("input", { type: "datetime-local", value: v.startsAt ? isoToLocal(v.startsAt) : "", required: true }),
    end: h("input", { type: "datetime-local", value: v.endsAt ? isoToLocal(v.endsAt) : "", required: true }),
    location: h("input", { value: v.location, maxlength: 120 }), speaker: h("input", { value: v.speaker, maxlength: 120 }),
    desc: h("textarea", { maxlength: 2000 }, v.description),
    cap: h("input", { type: "number", min: 1, value: v.capacity ?? "", placeholder: "Unlimited" }),
    reg: h("input", { type: "checkbox", checked: v.registrationRequired }), pub: h("input", { type: "checkbox", checked: v.published }),
  };
  const body = h("form", { onsubmit: guard(async (ev) => {
    ev.preventDefault();
    const payload = { title: f.title.value, track: f.track.value, location: f.location.value, speaker: f.speaker.value, description: f.desc.value,
      startsAt: localToIso(f.start.value), endsAt: localToIso(f.end.value), capacity: f.cap.value ? Number(f.cap.value) : null, registrationRequired: f.reg.checked, published: f.pub.checked };
    if (new Date(payload.endsAt) <= new Date(payload.startsAt)) throw new Error("End must be after start");
    await api(e ? "PUT" : "POST", "/events" + (e ? "/" + e.id : ""), payload);
    bg.remove(); toast("Saved"); route();
  }) },
    field("Title", f.title), h("div", { class: "grid g2" }, field("Track", f.track), field("Location", f.location)),
    h("div", { class: "grid g2" }, field("Starts (" + TZ + ")", f.start), field("Ends (" + TZ + ")", f.end)),
    h("p", { class: "muted small" }, "For a multi-day event (e.g. a hackathon), set the end on a later day. It will appear on every day it spans."),
    field("Speaker / host", f.speaker), field("Description", f.desc),
    h("div", { class: "grid g2" }, field("Capacity", f.cap), h("div", {}, h("label", {}, "Options"), h("label", { class: "check" }, f.reg, "Registration required (seat-limited)"), h("label", { class: "check" }, f.pub, "Visible in the app"))),
    h("div", { class: "row" }, h("button", { class: "btn" }, "Save"), e && h("button", { type: "button", class: "btn danger right", onclick: () => confirmDo("Delete this event? Saved/registered links are removed too.", async () => { await api("DELETE", "/events/" + e.id); bg.remove(); route(); }) }, "Delete")));
  const bg = modal(e ? "Edit event" : "New event", body);
}

async function people(m) {
  const q = h("input", { placeholder: "Search name, email or pass code…", oninput: debounce(guard(load), 250) });
  const out = h("div", { class: "card" });
  m.append(head("Attendees", h("button", { class: "btn ghost", onclick: importCsv }, "Import CSV"), h("button", { class: "btn", onclick: addUser }, "Add attendee")), q, h("div", { class: "row" }), out);
  async function load() {
    const list = await api("GET", "/users?q=" + encodeURIComponent(q.value)); clear(out);
    out.append(h("table", {}, h("tr", {}, ["Name", "Email", "Pass", "App", "Check-ins", "Status", ""].map((x) => h("th", {}, x))),
      list.map((u) => h("tr", {}, h("td", {}, h("b", {}, u.name), h("div", { class: "muted small" }, u.college || "")), h("td", {}, u.email), h("td", {}, u.passCode),
        h("td", {}, u.hasApp ? h("span", { class: "pill ok" }, "SIGNED IN") : h("span", { class: "pill" }, "NOT YET")), h("td", {}, u.checkins),
        h("td", {}, h("span", { class: "pill " + (u.status === "active" ? "ok" : "bad") }, u.status.toUpperCase())),
        h("td", {}, h("div", { class: "row" },
          h("button", { class: "btn ghost sm", onclick: guard(async () => { await api("PATCH", "/users/" + u.id, { status: u.status === "active" ? "blocked" : "active" }); load(); }) }, u.status === "active" ? "Block" : "Unblock"),
          h("button", { class: "btn ghost sm", title: "Sign the user out of their phone so they can log in on a new one", onclick: () => confirmDo("Sign " + u.name + " out of their device?", async () => { await api("POST", `/users/${u.id}/reset-device`); toast("Device reset"); load(); }) }, "Reset device"),
          h("button", { class: "btn danger sm", onclick: () => confirmDo("Delete " + u.name + " and all their data?", async () => { await api("DELETE", "/users/" + u.id); load(); }) }, "Delete")))))));
    if (!list.length) out.append(h("p", { class: "muted" }, "No attendees found."));
  }
  await load();
  function addUser() {
    const n = h("input", { required: true, maxlength: 100 }), e = h("input", { type: "email", required: true }), c = h("input", { maxlength: 150 });
    const bg = modal("Add attendee", h("form", { onsubmit: guard(async (ev) => { ev.preventDefault(); await api("POST", "/users", { email: e.value, name: n.value, college: c.value || null }); bg.remove(); toast("Added"); load(); }) },
      field("Name", n), field("Email", e), field("College / organisation", c), h("div", { class: "row" }, h("button", { class: "btn" }, "Add"))));
  }
  function importCsv() {
    const ta = h("textarea", { placeholder: "email,name,college\nalex@example.org,Alex Morgan,SRM AP", rows: 8 });
    const file = h("input", { type: "file", accept: ".csv,text/csv", onchange: async () => { if (file.files[0]) ta.value = await file.files[0].text(); } });
    const bg = modal("Import attendees", h("div", {}, h("p", { class: "muted" }, "CSV with columns email, name, college (header optional). Existing emails are skipped."), file, ta,
      h("div", { class: "row" }, h("button", { class: "btn", onclick: guard(async () => { const r = await api("POST", "/users/import", { csv: ta.value }); bg.remove(); toast(`Added ${r.added}, skipped ${r.skipped}${r.invalid.length ? ", invalid " + r.invalid.length : ""}`); load(); }) }, "Import"))));
  }
}

async function announce(m) {
  const list = await api("GET", "/announcements");
  const t = h("input", { maxlength: 120 }), b = h("textarea", { maxlength: 2000 }), mail = h("input", { type: "checkbox" });
  m.append(head("Announcements"), h("div", { class: "card" }, h("h2", {}, "New announcement"), field("Title", t), field("Message", b),
    h("label", { class: "check" }, mail, "Also email every active attendee"),
    h("div", { class: "row" }, h("button", { class: "btn", onclick: guard(async (ev) => {
      const btn = ev.currentTarget; btn.disabled = true;
      try { const r = await api("POST", "/announcements", { title: t.value, body: b.value, sendEmail: mail.checked }); toast(mail.checked ? `Sent. Emailed ${r.emailed}${r.failed ? ", " + r.failed + " failed" : ""}` : "Posted"); route(); } finally { btn.disabled = false; }
    }) }, "Publish"))),
    h("div", { class: "card" }, h("h2", {}, "Previous"), list.length ? list.map((a) => h("div", { class: "row" }, h("div", { class: "grow" }, h("b", {}, a.title), " ", h("span", { class: "muted small" }, fmt(a.createdAt, { dateStyle: "medium", timeStyle: "short" }) + (a.emailed ? ` · emailed ${a.emailed}` : "")), h("div", { class: "muted" }, a.body)),
      h("button", { class: "btn danger sm", onclick: () => confirmDo("Delete this announcement?", async () => { await api("DELETE", "/announcements/" + a.id); route(); }) }, "Delete"))) : h("p", { class: "muted" }, "Nothing yet.")));
}

async function support(m) {
  let status = "";
  const sel = h("select", { onchange: () => { status = sel.value; load(); } }, [["", "All"], ["open", "Open"], ["in_progress", "In progress"], ["resolved", "Resolved"]].map(([v, l]) => h("option", { value: v }, l)));
  const out = h("div", { class: "card" });
  m.append(head("Support", sel), out);
  async function load() {
    const list = await api("GET", "/tickets" + (status ? "?status=" + status : "")); clear(out);
    out.append(h("table", {}, h("tr", {}, ["Ticket", "From", "Type", "Last message", "Status", "Updated"].map((x) => h("th", {}, x))),
      list.map((t) => h("tr", { class: "click", onclick: () => openTicket(t.id) }, h("td", {}, h("b", {}, t.code)), h("td", {}, t.name, h("div", { class: "muted small" }, t.passCode)),
        h("td", {}, t.kind + " · " + t.topic), h("td", {}, (t.lastAuthor === "admin" ? "You: " : "") + (t.lastBody || "").slice(0, 80)),
        h("td", {}, h("span", { class: "pill " + (t.status === "resolved" ? "ok" : t.status === "open" ? "warn" : "") }, t.status.replace("_", " ").toUpperCase())), h("td", {}, fmt(t.updatedAt, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))))));
    if (!list.length) out.append(h("p", { class: "muted" }, "No tickets."));
  }
  await load();
  async function openTicket(id) {
    const t = await api("GET", "/tickets/" + id); const reply = h("textarea", { placeholder: "Write a reply (the attendee is also emailed)…", maxlength: 2000 });
    const bg = modal(`${t.code} · ${t.kind}`, h("div", {}, h("p", { class: "muted" }, `${t.name} · ${t.email} · ${t.passCode} — ${t.topic}`),
      h("div", { class: "thread" }, t.messages.map((x) => h("div", { class: "msg " + x.author }, x.body, h("div", { class: "muted small" }, fmt(x.at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))))), reply,
      h("div", { class: "row" }, h("button", { class: "btn", onclick: guard(async () => { await api("POST", `/tickets/${id}/reply`, { body: reply.value }); bg.remove(); load(); }) }, "Send reply"),
        ["open", "in_progress", "resolved"].filter((s) => s !== t.status).map((s) => h("button", { class: "btn ghost sm", onclick: guard(async () => { await api("PATCH", "/tickets/" + id, { status: s }); bg.remove(); load(); }) }, "Mark " + s.replace("_", " "))))));
  }
}

async function attendance(m) {
  const sum = await api("GET", "/attendance"); let scope = "";
  const out = h("div", { class: "card" });
  const label = (s) => s.startsWith("day:") ? "Entry · " + s.slice(4) : "Event · " + s.slice(6, 14);
  const pick = h("select", { onchange: () => { scope = pick.value; load(); } }, h("option", { value: "" }, "Select a scan group…"), sum.summary.map((x) => h("option", { value: x.scope }, `${label(x.scope)} — ${x.count}`)));
  m.append(head("Attendance"), h("p", { class: "muted" }, "Recorded by the door scanners at /check. Pick a group to see who was checked in."), pick, h("div", { class: "row" }), out);
  async function load() {
    clear(out); if (!scope) return;
    const r = await api("GET", "/attendance?scope=" + encodeURIComponent(scope));
    const csv = () => { const lines = ["name,email,college,pass,checked_in_at", ...r.rows.map((x) => [x.name, x.email, x.college || "", x.passCode, x.at].map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(","))]; const a = h("a", { href: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })), download: "attendance.csv" }); a.click(); };
    out.append(h("div", { class: "row" }, h("b", {}, r.rows.length + " checked in"), h("button", { class: "btn ghost sm right", onclick: csv }, "Download CSV")),
      h("table", {}, h("tr", {}, ["Name", "Email", "Pass", "Time"].map((x) => h("th", {}, x))), r.rows.map((x) => h("tr", {}, h("td", {}, x.name, h("div", { class: "muted small" }, x.college || "")), h("td", {}, x.email), h("td", {}, x.passCode), h("td", {}, fmt(x.at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))))));
  }
}

async function content(m) {
  const [faqs, st] = await Promise.all([api("GET", "/faqs"), api("GET", "/settings")]);
  const f = { fest_name: h("input", { value: st.fest_name || "" }), venue: h("input", { value: st.venue || "" }), support_note: h("input", { value: st.support_note || "" }) };
  m.append(head("Content"), h("div", { class: "card" }, h("h2", {}, "Festival details"), field("Festival name", f.fest_name), field("Venue", f.venue), field("Support note (shown in the app)", f.support_note),
    h("div", { class: "row" }, h("button", { class: "btn", onclick: guard(async () => { await api("PUT", "/settings", { fest_name: f.fest_name.value, venue: f.venue.value, support_note: f.support_note.value }); toast("Saved"); }) }, "Save"))),
    h("div", { class: "head" }, h("h2", {}, "FAQs"), h("button", { class: "btn sm right", onclick: () => editFaq() }, "Add FAQ")),
    h("div", { class: "card" }, faqs.length ? faqs.map((q) => h("div", { class: "row" }, h("div", { class: "grow" }, h("b", {}, q.question), h("div", { class: "muted" }, q.answer)), h("button", { class: "btn ghost sm", onclick: () => editFaq(q) }, "Edit"))) : h("p", { class: "muted" }, "No FAQs yet.")));
  function editFaq(q) {
    const qq = h("input", { value: q?.question || "", maxlength: 200 }), aa = h("textarea", { maxlength: 2000 }, q?.answer || ""), pos = h("input", { type: "number", min: 0, value: q?.position ?? faqs.length });
    const bg = modal(q ? "Edit FAQ" : "New FAQ", h("div", {}, field("Question", qq), field("Answer", aa), field("Order", pos), h("div", { class: "row" },
      h("button", { class: "btn", onclick: guard(async () => { await api(q ? "PUT" : "POST", "/faqs" + (q ? "/" + q.id : ""), { question: qq.value, answer: aa.value, position: Number(pos.value) }); bg.remove(); route(); }) }, "Save"),
      q && h("button", { class: "btn danger right", onclick: () => confirmDo("Delete this FAQ?", async () => { await api("DELETE", "/faqs/" + q.id); bg.remove(); route(); }) }, "Delete"))));
  }
}

async function activity(m) {
  const list = await api("GET", "/audit");
  m.append(head("Activity"), h("div", { class: "card" }, h("p", { class: "muted small" }, "Every admin change and failed login, newest first."), h("table", {}, h("tr", {}, ["When", "Action", "Target", "IP"].map((x) => h("th", {}, x))),
    list.map((a) => h("tr", {}, h("td", {}, fmt(a.at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", second: "2-digit" })), h("td", {}, a.action), h("td", {}, [a.entity, a.detail && JSON.stringify(a.detail)].filter(Boolean).join(" ")), h("td", {}, a.ip || ""))))));
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
boot();
