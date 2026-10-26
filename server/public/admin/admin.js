"use strict";
// Fall Fest admin — dependency-free. All dynamic text is inserted with textContent (no innerHTML) to prevent XSS.
const $app = document.getElementById("app");
let csrf = "", TZ = "Asia/Kolkata";

const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") e.className = v; else if (k === "style") e.style.cssText = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
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
const PAGES = [["events", "Events"], ["people", "Attendees"], ["announce", "Announcements"], ["support", "Support"], ["attendance", "Attendance"], ["content", "Content"]];
function showLogin() {
  clear($app);
  const err = h("div", { class: "err" }); const u = h("input", { autocomplete: "username", required: true }); const p = h("input", { type: "password", autocomplete: "current-password", required: true });
  const form = h("form", { onsubmit: async (e) => {
    e.preventDefault(); err.textContent = "";
    try { const r = await api("POST", "/login", { username: u.value, password: p.value }); csrf = r.csrf; await boot(); } catch (x) { err.textContent = x.message; }
  } }, h("label", {}, "Username"), u, h("label", {}, "Password"), p, err, h("div", { class: "row" }, h("button", { class: "btn grow" }, "Sign in")));
  $app.append(h("div", { class: "login" }, h("div", { class: "brand" }, h("img", { src: "/admin/qiskit.svg", alt: "" }), "Fall Fest Admin"), h("div", { class: "card" }, form)));
}
let main;
function route() {
  const page = (location.hash.slice(1) || "events"); clear(main);
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("on", a.dataset.p === page));
  const fn = { events, people, announce, support, attendance, content, activity }[page] || events;
  guard(fn)(main);
}
async function boot() {
  let me; try { me = await api("GET", "/me"); } catch { return showLogin(); }
  csrf = me.csrf; TZ = me.tz; clear($app);
  main = h("main");
  $app.append(h("div", { class: "shell" },
    h("nav", {}, h("div", { class: "brand" }, h("img", { src: "/admin/qiskit.svg", alt: "" }), h("span", {}, "Fall Fest")),
      PAGES.map(([id, label]) => h("a", { href: "#" + id, "data-p": id }, label)),
      h("div", { class: "grow" }),
      h("a", { href: "#activity", "data-p": "activity" }, "Activity"),
      h("a", { href: "#", onclick: guard(async (e) => { e.preventDefault(); await api("POST", "/logout"); showLogin(); }) }, "Sign out")), main));
  route();
}
window.addEventListener("hashchange", () => main && route());

const head = (title, ...actions) => h("div", { class: "head" }, h("h1", {}, title), h("div", { class: "right row" }, actions));
function modal(title, body) {
  const bg = h("div", { class: "modal-bg", onmousedown: (e) => { if (e.target === bg) bg.remove(); } }, h("div", { class: "modal" }, h("div", { class: "head" }, h("h2", {}, title), h("button", { class: "btn ghost sm right", onclick: () => bg.remove() }, "Close")), body));
  document.body.append(bg); return bg;
}
const field = (label, input) => h("div", { class: "field" }, h("label", {}, label), input);
const confirmDo = (msg, fn) => { if (confirm(msg)) guard(fn)(); };

// ---- pages ----
async function events(m) {
  const list = await api("GET", "/events");
  m.append(head("Events", h("button", { class: "btn", onclick: () => editEvent() }, "New event")));
  m.append(h("div", { class: "card" }, h("table", {}, h("tr", {}, ["When", "Event", "Track", "Where", "Saved by", ""].map((x) => h("th", {}, x))),
    list.map((e) => h("tr", { class: "click", onclick: () => editEvent(e) },
      h("td", {}, fmtRange(e.startsAt, e.endsAt)), h("td", { class: "lead" }, h("b", {}, e.title), " ", !e.published && h("span", { class: "pill warn" }, "HIDDEN"), " ", fmt(e.startsAt, { dateStyle: "short" }) !== fmt(e.endsAt, { dateStyle: "short" }) && h("span", { class: "pill" }, "MULTI-DAY")),
      h("td", {}, e.track), h("td", {}, e.location), h("td", {}, String(e.saved)), h("td", { class: "chev" }, "›"))))));
  if (!list.length) m.append(h("p", { class: "muted" }, "No events yet."));
}
function editEvent(e) {
  const v = e || { title: "", description: "", track: "Main", location: "", speaker: "", startsAt: null, endsAt: null, published: true };
  const f = {
    title: h("input", { value: v.title, maxlength: 120, required: true }),
    track: h("select", {}, ["Main", "Workshop", "Talk", "Hackathon", "Social", "Competition"].map((t) => h("option", { value: t, selected: t === v.track }, t))),
    start: h("input", { type: "datetime-local", value: v.startsAt ? isoToLocal(v.startsAt) : "", required: true }),
    end: h("input", { type: "datetime-local", value: v.endsAt ? isoToLocal(v.endsAt) : "", required: true }),
    location: h("input", { value: v.location, maxlength: 120 }), speaker: h("input", { value: v.speaker, maxlength: 120 }),
    desc: h("textarea", { maxlength: 2000 }, v.description),
    pub: h("input", { type: "checkbox", checked: v.published }),
  };
  const body = h("form", { onsubmit: guard(async (ev) => {
    ev.preventDefault();
    const payload = { title: f.title.value, track: f.track.value, location: f.location.value, speaker: f.speaker.value, description: f.desc.value,
      startsAt: localToIso(f.start.value), endsAt: localToIso(f.end.value), published: f.pub.checked };
    if (new Date(payload.endsAt) <= new Date(payload.startsAt)) throw new Error("End must be after start");
    await api(e ? "PUT" : "POST", "/events" + (e ? "/" + e.id : ""), payload);
    bg.remove(); toast("Saved"); route();
  }) },
    field("Title", f.title), h("div", { class: "grid g2" }, field("Track", f.track), field("Location", f.location)),
    h("div", { class: "grid g2" }, field("Starts (" + TZ + ")", f.start), field("Ends (" + TZ + ")", f.end)),
    h("p", { class: "muted small" }, "For a multi-day event (e.g. a hackathon), set the end on a later day. It will appear on every day it spans."),
    field("Speaker / host", f.speaker), field("Description", f.desc),
    h("div", {}, h("label", {}, "Options"), h("label", { class: "check" }, f.pub, "Visible in the app")),
    h("div", { class: "row" }, h("button", { class: "btn" }, "Save"), e && h("button", { type: "button", class: "btn danger right", onclick: () => confirmDo("Delete this event? Saved links are removed too.", async () => { await api("DELETE", "/events/" + e.id); bg.remove(); route(); }) }, "Delete")));
  const bg = modal(e ? "Edit event" : "New event", body);
}

async function people(m) {
  const q = h("input", { placeholder: "Search name, email or pass code…", oninput: debounce(guard(load), 250) });
  const sel = (label, opts) => h("select", { "aria-label": label, onchange: guard(() => load(true)) }, opts.map(([v, t]) => h("option", { value: v }, t)));
  const kind = sel("Who", [["", "Everyone"], ["student", "SRM students (name_surname@)"], ["faculty", "SRM faculty (name.surname@)"], ["unclear", "SRM, unclear"], ["external", "Outside SRM"]]);
  const selfie = sel("Selfie", [["", "Selfie: any"], ["yes", "Selfie taken"], ["no", "No selfie yet"]]);
  const app = sel("App", [["", "App: any"], ["yes", "Signed in to the app"], ["no", "Never signed in"]]);
  const status = sel("Status", [["", "Status: any"], ["active", "Active"], ["blocked", "Blocked"]]);
  const checked = sel("Check-in", [["", "Check-in: any"], ["yes", "Checked in at least once"], ["no", "Never checked in"]]);
  const source = sel("Source", [["", "Source: any"], ["website", "From the website"], ["srm", "SRM sign-in"], ["admin", "Added by admin"], ["import", "CSV import"]]);
  const passSel = sel("Festival pass", [["", "Festival pass: any"], ["general", "₹99 pass holders"], ["flagship", "₹499 pass holders"], ["none", "No ₹99/₹499 pass"]]);
  const sort = sel("Sort", [["newest", "Sort: newest first"], ["name", "Sort: name A–Z"], ["checkins", "Sort: most check-ins"]]);
  const count = h("p", { class: "muted", style: "margin:10px 0 0;font-weight:600" });
  const PAGE = 200; let shown = [];
  const out = h("div", { class: "card" });
  const syncBox = h("div", { class: "card" });
  m.append(head("Attendees", h("button", { class: "btn ghost", onclick: guard(exportStudents) }, "Download student details"), h("button", { class: "btn ghost", onclick: importCsv }, "Import CSV"), h("button", { class: "btn", onclick: addUser }, "Add attendee")), syncBox, h("div", { class: "row", style: "flex-wrap:wrap;gap:10px" }, q, kind, selfie, app, status, checked, source, passSel, sort, h("button", { class: "btn ghost sm", onclick: () => { for (const x of [q, kind, selfie, app, status, checked, source]) x.value = ""; sort.value = "newest"; load(true); } }, "Clear filters")), count, out);
  const KIND = { student: "SRM student", faculty: "SRM faculty", unclear: "SRM", external: "Outside SRM" };
  async function drawSync() {
    const s = await api("GET", "/sync"), access = await api("GET", "/access-summary"); clear(syncBox);
    const last = s.runs.find((r) => r.status !== "running"), when = (iso) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    syncBox.append(h("h3", {}, "Website sync"),
      h("p", { class: "muted small" }, s.configured ? `People who register on ${s.websiteUrl.replace(/^https?:\/\//, "")} appear here automatically (${s.fromWebsite} so far, ${s.total} in total). Checked every 10 minutes and whenever someone registers.` : "Not connected: the sync key is not set on the server."),
      access && h("p", { class: "small" }, `${access.total.toLocaleString()} in the app: ${access.srm.toLocaleString()} with an SRM email · ${access.outsideFlagship.toLocaleString()} outside SRM with the ₹499 pass · ${access.outsideGeneral.toLocaleString()} outside SRM with the ₹99 pass · ${access.signedIn.toLocaleString()} signed in`),
      last && h("p", { class: "small" }, `Last run ${when(last.at)} · ${last.status === "ok" ? `saw ${last.seen}, added ${last.created}, updated ${last.updated}` : "failed: " + (last.error || "")}`),
      h("div", { class: "row" },
        h("button", { class: "btn ghost", disabled: !s.configured, onclick: guard(async () => { const r = await api("POST", "/sync/run"); toast(r.message); await drawSync(); await load(); }) }, "Sync now"),
        h("button", { class: "btn ghost", onclick: guard(async () => {
          const d = await api("POST", "/cleanup-nonpass", { dryRun: true }); if (!d.ok) return toast(d.message);
          if (!d.wouldRemove) return toast("Nobody to remove.");
          confirmDo(`Remove ${d.wouldRemove} outside people who have no ₹99/₹499 pass and never signed in? Anyone who signed in, took a selfie or checked in stays.`, async () => { const r = await api("POST", "/cleanup-nonpass", { dryRun: false }); toast(`Removed ${r.removed}`); await drawSync(); await load(); });
        }) }, "Remove people without a pass")));
  }
  async function load(reset = true) {
    if (reset) shown = [];
    const qs = new URLSearchParams({ q: q.value, sort: sort.value, limit: PAGE, offset: shown.length });
    for (const [k, el] of Object.entries({ kind, selfie, app, status, checkedin: checked, source, pass: passSel })) if (el.value) qs.set(k, el.value);
    const r = await api("GET", "/users?" + qs); shown = shown.concat(r.rows); clear(out);
    const filtered = r.total !== r.all;
    count.textContent = `${r.total.toLocaleString()} ${r.total === 1 ? "attendee" : "attendees"}` + (filtered ? ` match these filters (of ${r.all.toLocaleString()} in total)` : " in total");
    out.append(h("table", {}, h("tr", {}, ["Name", "Email", "Pass", "Status", ""].map((x) => h("th", {}, x))),
      shown.map((u) => h("tr", { class: "click", onclick: guard(() => openUser(u)) }, h("td", {}, h("b", {}, u.name), h("div", { class: "muted small" }, [u.college, KIND[u.kind]].filter(Boolean).join(" · "))), h("td", {}, u.email), h("td", {}, u.passCode, u.passTier ? h("div", { class: "muted small" }, u.passTier === "flagship" ? "₹499 pass" : "₹99 pass") : null),
        h("td", {}, h("span", { class: "pill " + (u.status === "active" ? "ok" : "bad") }, u.status.toUpperCase()), h("div", { class: "muted small", style: "margin-top:4px" }, [u.hasApp ? "Signed in" : "Not signed in", u.hasPhoto ? "Selfie ✓" : "No selfie"].join(" · "))),
        h("td", { class: "chev" }, "›")))));
    if (!shown.length) out.append(h("p", { class: "muted" }, "No attendees found."));
    else if (shown.length < r.total) out.append(h("div", { class: "row", style: "justify-content:center;padding:14px" }, h("button", { class: "btn ghost", onclick: guard(() => load(false)) }, `Show ${Math.min(PAGE, r.total - shown.length)} more (${shown.length} of ${r.total.toLocaleString()} shown)`)));
  }
  await Promise.all([drawSync(), load()]);
  async function openUser(u) {
    const act = (label, cls, fn) => h("button", { class: "btn sm " + cls, onclick: fn }, label);
    const done = (msg) => { bg.remove(); toast(msg); load(); };
    const body = h("div", {},
      h("div", { class: "row", style: "gap:18px;align-items:flex-start;flex-wrap:nowrap" },
        u.hasPhoto ? h("img", { class: "avatar", alt: "", src: `/admin/api/users/${u.id}/photo` }) : h("div", { class: "avatar none" }, u.name.split(/\s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase()),
        h("div", { class: "grow" }, h("h2", { style: "margin:0 0 4px" }, u.name), h("div", { class: "muted" }, u.email), h("div", { class: "muted" }, [u.passCode, u.college].filter(Boolean).join(" · ")),
          h("div", { style: "margin-top:10px" }, h("span", { class: "pill " + (u.status === "active" ? "ok" : "bad") }, u.status.toUpperCase()), " ", h("span", { class: "pill" }, u.hasApp ? "SIGNED IN" : "NOT SIGNED IN"), " ", u.checkins ? h("span", { class: "pill" }, `${u.checkins} CHECK-IN${u.checkins > 1 ? "S" : ""}`) : null))),
      u.details ? h("div", { class: "muted", style: "margin:12px 0" }, [u.details.regNo, u.details.school, "Sem " + u.details.semester, u.details.program + " " + u.details.course, "CGPA " + (u.details.cgpa === null ? "NA" : u.details.cgpa.toFixed(2))].join(" · ")) : null,
      h("div", { class: "row" },
        act(u.status === "active" ? "Block" : "Unblock", "ghost", guard(async () => { await api("PATCH", "/users/" + u.id, { status: u.status === "active" ? "blocked" : "active" }); done("Updated"); })),
        act("Reset device", "ghost", () => confirmDo("Sign " + u.name + " out of their phone so they can log in on a new one?", async () => { await api("POST", `/users/${u.id}/reset-device`); done("Device reset"); })),
        u.details && act("Reset details", "ghost", () => confirmDo("Clear " + u.name + "’s academic details? They will be asked for them again next time they open the app.", async () => { await api("DELETE", `/users/${u.id}/details`); done("Details cleared"); })),
        u.hasPhoto && act("Reset selfie", "ghost", () => confirmDo("Delete " + u.name + "’s selfie? They will be asked for a new one next time they open the app.", async () => { await api("DELETE", `/users/${u.id}/photo`); done("Selfie removed"); })),
        act("Delete", "danger right", () => confirmDo("Delete " + u.name + " and all their data?", async () => { await api("DELETE", "/users/" + u.id); done("Deleted"); }))));
    const bg = modal("Attendee", body);
  }
  async function exportStudents() {
    const r = await api("GET", "/students");
    const safe = (c) => (/^[=+\-@\t\r]/.test(String(c)) ? "'" + c : String(c));
    const lines = ["name,email,registration_no,school,semester,course,program,cgpa", ...r.rows.map((x) => [x.name, x.email, x.regNo, x.school, x.semester, x.course, x.program, x.cgpa === null ? "NA" : x.cgpa.toFixed(2)].map((c) => '"' + safe(c).replace(/"/g, '""') + '"').join(","))];
    h("a", { href: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })), download: "student-details.csv" }).click();
    toast(r.rows.length + " students");
  }
  async function addUser() {
    const n = h("input", { required: true, maxlength: 100 }), e = h("input", { type: "email", required: true }), c = h("input", { maxlength: 150 });
    const bg = modal("Add attendee", h("form", { onsubmit: guard(async (ev) => { ev.preventDefault(); await api("POST", "/users", { email: e.value, name: n.value, college: c.value || null }); bg.remove(); toast("Added"); load(); }) },
      field("Name", n), field("Email", e), field("College / organisation", c), h("div", { class: "row" }, h("button", { class: "btn" }, "Add"))));
  }
  async function importCsv() {
    const ta = h("textarea", { placeholder: "email,name,college\nalex@example.org,Alex Morgan,SRM University AP", rows: 7 });
    const file = h("input", { type: "file", accept: ".csv,text/csv", onchange: async () => { if (file.files[0]) ta.value = await file.files[0].text(); } });
    const template = () => {
      const a = h("a", { href: URL.createObjectURL(new Blob(["email,name,college\njane@example.org,Jane Doe,SRM University AP\n"], { type: "text/csv" })), download: "attendees-template.csv" }); a.click();
    };
    const guide = h("div", { class: "guide" },
      h("b", {}, "How to format the CSV"),
      h("p", {}, "The first row is a header. Columns, in this order: ", h("code", {}, "email"), ", ", h("code", {}, "name"), ", ", h("code", {}, "college"), "."),
      h("p", { class: "muted small" }, "Emails that already exist are skipped, not duplicated. People who register on the website are added automatically; use this only for anyone who isn’t on the website."),
      h("button", { type: "button", class: "btn ghost sm", onclick: template }, "Download template CSV"));
    const bg = modal("Import attendees", h("div", {}, guide, field("CSV file", file), field("…or paste it here", ta),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: guard(async () => {
        const r = await api("POST", "/users/import", { csv: ta.value }); bg.remove();
        toast(`Added ${r.added}, skipped ${r.skipped}` + (r.invalid.length ? `, invalid ${r.invalid.length}` : "")); load();
      }) }, "Import"))));
  }
}

async function announce(m) {
  const [list, push] = await Promise.all([api("GET", "/announcements"), api("GET", "/push")]);
  const t = h("input", { maxlength: 120 }), b = h("textarea", { maxlength: 2000 });
  m.append(head("Announcements"), h("div", { class: "card" }, h("h2", {}, "New announcement"), field("Title", t), field("Message", b),
    h("p", { class: "muted small", style: "margin-top:12px" }, `Sent instantly as a notification to every phone that has notifications on (${push.devices} right now), and listed in the app’s bell menu. Not emailed.`),
    h("div", { class: "row" }, h("button", { class: "btn", onclick: guard(async (ev) => {
      const btn = ev.currentTarget; btn.disabled = true;
      try { const r = await api("POST", "/announcements", { title: t.value, body: b.value }); toast(r.notified ? `Published. Notifying ${r.notified} phone${r.notified > 1 ? "s" : ""} now` : "Published"); route(); } finally { btn.disabled = false; }
    }) }, "Publish"))),
    h("div", { class: "card" }, h("h2", {}, "Previous"), list.length ? list.map((a) => h("div", { class: "row item" }, h("div", { class: "grow" }, h("b", {}, a.title), " ", h("span", { class: "muted small" }, fmt(a.createdAt, { dateStyle: "medium", timeStyle: "short" })), h("div", { class: "muted" }, a.body)),
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
    const t = await api("GET", "/tickets/" + id); const reply = h("textarea", { placeholder: "Write a reply (the attendee sees it in the app)…", maxlength: 2000 });
    const bg = modal(`${t.code} · ${t.kind}`, h("div", {}, h("p", { class: "muted" }, `${t.name} · ${t.email} · ${t.passCode} — ${t.topic}`),
      h("div", { class: "thread" }, t.messages.map((x) => h("div", { class: "msg " + x.author }, x.body, h("div", { class: "muted small" }, fmt(x.at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }))))), reply,
      h("div", { class: "row" }, h("button", { class: "btn", onclick: guard(async () => { await api("POST", `/tickets/${id}/reply`, { body: reply.value }); bg.remove(); load(); }) }, "Send reply"),
        ["open", "in_progress", "resolved"].filter((s) => s !== t.status).map((s) => h("button", { class: "btn ghost sm", onclick: guard(async () => { await api("PATCH", "/tickets/" + id, { status: s }); bg.remove(); load(); }) }, "Mark " + s.replace("_", " "))))));
  }
}

async function attendance(m) {
  const sum = await api("GET", "/attendance"); let scope = sum.summary[0]?.scope || "";
  const out = h("div", { class: "card" }), chips = h("div", { class: "chips" });
  const dayLabel = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const label = (x) => x.scope.startsWith("day:") ? ["Campus entry", dayLabel(x.scope.slice(4))] : ["Event", x.title || "Deleted event"];
  m.append(head("Attendance"), h("p", { class: "muted" }, "Who the door scanners checked in, at what time, and which volunteer (by name and ID) scanned them. Campus entry counts people once per day at the gate; an event counts people at that session."), chips, out);
  function drawChips() {
    clear(chips);
    sum.summary.forEach((x) => { const [kind, name] = label(x); chips.append(h("button", { class: "chip" + (x.scope === scope ? " on" : ""), onclick: () => { scope = x.scope; drawChips(); load(); } }, h("small", {}, kind), h("b", {}, name), h("span", {}, x.count + " in"))); });
  }
  async function load() {
    clear(out); if (!scope) return;
    const r = await api("GET", "/attendance?scope=" + encodeURIComponent(scope));
    const safe = (c) => (/^[=+\-@\t\r]/.test(String(c)) ? "'" + c : String(c)); /* a name like =HYPERLINK(...) must not run as a formula in Excel */
    const csv = () => { const lines = ["name,email,college,pass,checked_in_at,scanned_by_name,scanned_by_id", ...r.rows.map((x) => [x.name, x.email, x.college || "", x.passCode, x.at, x.scannedByName || "", x.scannedById || ""].map((c) => '"' + safe(c).replace(/"/g, '""') + '"').join(","))]; const a = h("a", { href: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })), download: "attendance.csv" }); a.click(); };
    const tally = new Map(); for (const x of r.rows) { const k = x.scannedById ? (x.scannedByName || x.scannedById) : "Not recorded (earlier scans)"; tally.set(k, (tally.get(k) || 0) + 1); }
    const by = h("div", { class: "muted", style: "margin-bottom:12px" }, "Scanned by: " + [...tally].sort((a, b) => b[1] - a[1]).map(([k, n]) => k + " " + n).join(" · "));
    out.append(h("div", { class: "row", style: "margin-bottom:12px" }, h("b", {}, r.rows.length + " checked in"), h("button", { class: "btn ghost sm right", onclick: csv }, "Download CSV")),
      by, h("table", {}, h("tr", {}, ["Name", "Email", "Pass", "Time", "Scanned by", "Volunteer ID"].map((x) => h("th", {}, x))), r.rows.map((x) => h("tr", {}, h("td", {}, x.name, h("div", { class: "muted small" }, x.college || "")), h("td", {}, x.email), h("td", {}, x.passCode), h("td", {}, fmt(x.at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", second: "2-digit" })),
        h("td", {}, x.scannedById ? h("b", {}, x.scannedByName || x.scannedById) : h("span", { class: "muted" }, "Not recorded")), h("td", {}, x.scannedById || "—")))));
  }
  if (!sum.summary.length) { out.append(h("p", { class: "muted" }, "No check-ins yet. They appear here as soon as the door scanners record entries.")); return; }
  drawChips(); await load();
}

async function content(m) {
  const [faqs, st] = await Promise.all([api("GET", "/faqs"), api("GET", "/settings")]);
  const f = { fest_name: h("input", { value: st.fest_name || "" }), venue: h("input", { value: st.venue || "" }), support_note: h("input", { value: st.support_note || "" }),
    fest_start: h("input", { type: "date", value: st.fest_start || "" }), fest_end: h("input", { type: "date", value: st.fest_end || "" }) };
  m.append(head("Content"), h("div", { class: "card" }, h("h2", {}, "Festival details"), field("Festival name", f.fest_name), field("Venue", f.venue), h("div", { class: "grid g2" }, field("Festival first day", f.fest_start), field("Festival last day", f.fest_end)),
    h("p", { class: "muted small" }, "These days always appear in the check-in scanner and drive the countdown in the app, even before sessions are added."), field("Support note (shown in the app)", f.support_note),
    h("div", { class: "row" }, h("button", { class: "btn", onclick: guard(async () => { await api("PUT", "/settings", { fest_name: f.fest_name.value, venue: f.venue.value, support_note: f.support_note.value, ...(f.fest_start.value ? { fest_start: f.fest_start.value } : {}), ...(f.fest_end.value ? { fest_end: f.fest_end.value } : {}) }); toast("Saved"); }) }, "Save"))),
    h("div", { class: "head" }, h("h2", {}, "FAQs"), h("button", { class: "btn sm right", onclick: () => editFaq() }, "Add FAQ")),
    h("div", { class: "card" }, faqs.length ? faqs.map((q) => h("div", { class: "row item" }, h("div", { class: "grow" }, h("b", {}, q.question), h("div", { class: "muted" }, q.answer)), h("button", { class: "btn ghost sm", onclick: () => editFaq(q) }, "Edit"))) : h("p", { class: "muted" }, "No FAQs yet.")));
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

// Label every table cell with its column header, so on phones (where rows become cards) each value says what it is.
new MutationObserver((muts) => {
  for (const m of muts) for (const n of m.addedNodes) {
    if (n.nodeType !== 1) continue;
    for (const t of n.matches("table") ? [n] : n.querySelectorAll("table")) {
      const heads = [...(t.querySelector("tr")?.querySelectorAll("th") || [])].map((x) => x.textContent);
      if (!heads.length) continue;
      t.querySelectorAll("tr").forEach((tr) => [...tr.children].forEach((td, i) => { if (td.tagName === "TD" && heads[i] !== undefined) td.dataset.label = heads[i]; }));
    }
  }
}).observe(document.body, { childList: true, subtree: true });
