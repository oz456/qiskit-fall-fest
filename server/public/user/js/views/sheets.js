// Sheets: event details, announcements, profile, FAQs, new ticket, ticket thread.
import { ApiError, api } from "../api.js";
import { S, dayLabel, fmtStamp, loadAll, markAnnouncementsSeen, markTicketSeen, rangeLabel, statusOf, subscribe, toggleSaved } from "../store.js";
import { TRACK_ICON, TRACK_LABEL, bubble, button, confirmDialog, h, icon, openSheet, pill, pulse, toast } from "../ui.js";
import * as push from "../push.js";

// ---- event ----
function accessCard(e) {
  const seats = e.capacity != null ? (e.spotsLeft === 0 ? " · Full" : e.spotsLeft != null ? ` · ${e.spotsLeft} of ${e.capacity} seats left` : "") : "";
  const [ic, title, sub, good] = e.registered ? ["checkCircle", "You’re enrolled", "Your entry is confirmed. Show your pass at the door.", true]
    : e.access === "prereg" ? ["lock", "Pre-registration required", "Only enrolled attendees can enter. If you paid and don’t see “Enrolled”, contact Support.", false]
    : e.access === "onspot" ? ["user", "On-spot registration", "Register at the venue desk when you arrive.", false]
    : ["lockOpen", "Open to everyone", "No registration needed. Just walk in.", false];
  return h("div", { class: "card access" }, bubble(ic, 44, good), h("div", {}, h("div", { class: "title" }, title + seats), h("p", {}, sub)));
}
const icsEscape = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n?|\n/g, "\\n");
const icsTime = (ms) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function downloadIcs(e) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Qiskit Fall Fest//EN", "BEGIN:VEVENT", `UID:${e.id}@qff`, `DTSTAMP:${icsTime(Date.now())}`, `DTSTART:${icsTime(e.startMs)}`, `DTEND:${icsTime(e.endMs)}`,
    `SUMMARY:${icsEscape(e.title + " · Qiskit Fall Fest")}`, `LOCATION:${icsEscape(e.location)}`, `DESCRIPTION:${icsEscape(e.description)}`, "END:VEVENT", "END:VCALENDAR"];
  const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" }));
  const a = h("a", { href: url, download: "qff-event.ics" }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function openEventSheet(id) {
  return openSheet((_close, entry) => {
    const box = h("div", { style: { display: "contents" } });
    const draw = () => {
      const e = S.events.find((x) => x.id === id); if (!e) return;
      const st = statusOf(e);
      box.replaceChildren(
        h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, bubble(TRACK_ICON[e.track] || "rocket", 56, true),
          st === "live" ? pill("Live", "mint") : st === "done" ? pill("Ended") : pill("Upcoming"), pill(TRACK_LABEL[e.track] || e.track)),
        h("h2", { class: "h1" }, e.title),
        h("div", { class: "card infoCard" },
          h("div", { class: "info" }, icon("calendar"), dayLabel(e)), h("div", { class: "info" }, icon("clock"), rangeLabel(e) + " IST"),
          e.location ? h("div", { class: "info" }, icon("pin"), e.location) : null, e.speaker ? h("div", { class: "info" }, icon("user"), e.speaker) : null),
        e.description ? h("p", { class: "body muted", style: { whiteSpace: "pre-wrap" } }, e.description) : null,
        accessCard(e),
        h("div", { class: "twin" }, button(e.saved ? "Saved" : "Save it", { icon: e.saved ? "check" : "plus", onclick: () => toggleSaved(e, toast) }),
          h("button", { class: "round", type: "button", "aria-label": "Add to calendar", onclick: () => downloadIcs(e) }, icon("calendarPlus"))));
    };
    draw(); entry.done.push(subscribe(draw)); return box;
  });
}

// ---- announcements ----
export function openAnnouncements() {
  openSheet(() => {
    markAnnouncementsSeen();
    return [h("h2", { class: "h1" }, "Announcements"),
      !S.announcements.length ? h("p", { class: "body muted" }, "Nothing yet. Organisers’ updates will show up here.")
        : S.announcements.map((a) => h("div", { class: "card ann" }, bubble("megaphone", 44, true), h("div", {}, h("div", { class: "title" }, a.title), h("p", { class: "small muted", style: { whiteSpace: "pre-wrap" } }, a.body), h("p", { class: "small muted", style: { opacity: ".7", marginTop: "4px" } }, fmtStamp(Date.parse(a.createdAt))))))];
  });
}

// ---- profile ----
export function openProfile({ onSignOut }) {
  openSheet((close, sheet) => {
    const pushBox = h("div", {}); const drawPush = async () => pushBox.replaceChildren(await push.settingsRow(drawPush));
    drawPush();
    const p = S.profile || {};
    return [
      h("div", { style: { display: "flex", alignItems: "center", gap: "16px" } }, h("div", { class: "avatar", style: { width: "64px", height: "64px", background: "var(--pri)", color: "var(--onpri)", fontSize: "20px", fontFamily: "var(--display)" } }, (p.name || "?").split(" ").filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join("")),
        h("div", {}, h("div", { class: "h2" }, p.name || ""), h("div", { class: "small muted" }, `${p.email || ""} · Attendee`))),
      pushBox,
      button("Sign out", { cls: "ghost", icon: "logout", onclick: async () => { if (await confirmDialog({ title: "Sign out?", text: "You can sign back in with your registered email.", yes: "Sign out", danger: true })) { close(); setTimeout(onSignOut, 60); } } }),
      h("p", { class: "small muted", style: { textAlign: "center" } }, "QFF 2026 · web app"),
    ];
  });
}

// ---- FAQs ----
export function openFaq() {
  openSheet(() => {
    let open = null; const box = h("div", {});
    const draw = () => box.replaceChildren(...(S.faqs.length ? S.faqs.flatMap((f, i) => [
      h("button", { class: "faq" + (open === i ? " open" : ""), type: "button", "aria-expanded": String(open === i), onclick: () => { open = open === i ? null : i; draw(); } }, h("span", { class: "title q" }, f.q), icon("chevR")),
      open === i ? h("p", { class: "faqa" }, f.a) : null]) : [h("p", { class: "body muted" }, "No FAQs yet.")]));
    draw(); return [h("h2", { class: "h1" }, "FAQs & rules"), box];
  });
}

// ---- new ticket ----
const TOPICS = { "Mentor help": ["Circuits", "Algorithms", "IBM Quantum / hardware", "Setup & Git"], Grievance: ["Facilities", "Team dispute", "Conduct", "Other"], General: ["Pass / check-in", "Schedule", "Wi-Fi & power", "Other"] };
export function openTicketForm(initial = "General") {
  openSheet((close) => {
    let kind = initial, topic = TOPICS[kind][0], msg = "", sending = false, done = null;
    const box = h("div", { style: { display: "contents" } });
    const chips = (list, cur, set) => h("div", { class: "chips" }, list.map((x) => h("button", { class: "opt" + (cur === x ? " on" : ""), type: "button", onclick: () => { set(x); draw(); } }, x)));
    async function submit() {
      sending = true; draw();
      try { const r = await api.createTicket(kind, topic, msg.trim()); done = r.code; await loadAll(); }
      catch (e) { toast(e instanceof ApiError ? e.message : "Couldn’t send. Check your connection."); }
      sending = false; draw();
    }
    function draw() {
      box.replaceChildren();
      if (done) return box.append(h("div", { class: "empty" }, bubble("check", 72, true), h("h2", { class: "h1" }, "Ticket raised"), h("div", { class: "title", style: { color: "var(--pri)" } }, done),
        h("p", { class: "body muted" }, "A volunteer will reply here in the app. Pull down on Support to check for replies."), button("Done", { onclick: close })));
      const ta = h("textarea", { class: "area", placeholder: "Describe what’s going on, and where to find you.", maxlength: "2000", "aria-label": "Details", oninput: (e) => { msg = e.target.value; sendBtn.disabled = msg.trim().length < 5 || sending; } }, msg);
      const sendBtn = button("Submit", { onclick: submit, loading: sending, disabled: msg.trim().length < 5 });
      box.append(h("h2", { class: "h1" }, kind === "Mentor help" ? "Request mentor help" : kind === "Grievance" ? "Submit a grievance" : "New support ticket"),
        h("div", { class: "label" }, "Type"), chips(Object.keys(TOPICS), kind, (x) => { kind = x; topic = TOPICS[x][0]; }),
        h("div", { class: "label" }, "Topic"), chips(TOPICS[kind], topic, (x) => { topic = x; }),
        h("div", { class: "label" }, "Details"), ta, sendBtn);
    }
    draw(); return box;
  });
}

// ---- ticket thread (chat bubbles: you on the right, the team on the left) ----
export function openThread(id) {
  openSheet((close, sheet) => {
    markTicketSeen(id);
    const box = h("div", { style: { display: "contents" } });
    let text = "", sending = false;
    async function send() {
      const body = text.trim(); if (!body || sending) return; sending = true; draw();
      try { await api.replyTicket(id, body); text = ""; await loadAll(); }
      catch (e) { toast(e instanceof ApiError ? e.message : "Couldn’t send. Check your connection."); }
      sending = false; draw();
    }
    function draw() {
      const t = S.tickets.find((x) => x.id === id); if (!t) return; markTicketSeen(id);
      const ta = h("textarea", { class: "area", style: { minHeight: "80px" }, placeholder: "Write a reply…", maxlength: "2000", "aria-label": "Reply", oninput: (e) => { text = e.target.value; send$.disabled = !text.trim() || sending; } }, text);
      const send$ = button("Send reply", { onclick: send, loading: sending, disabled: !text.trim() });
      box.replaceChildren(h("h2", { class: "h1" }, t.code), h("div", { class: "small muted" }, `${t.kind} · ${t.topic} · ${t.status.replace("_", " ")}`),
        h("div", { class: "thread" }, t.messages.map((m) => h("div", { class: "msg " + (m.author === "admin" ? "team" : "me") }, h("div", { class: "b" }, m.author === "admin" ? h("span", { class: "who" }, "Fall Fest team") : null, m.body, h("span", { class: "ts" }, fmtStamp(Date.parse(m.at))))))),
        ta, send$);
    }
    draw(); const un = subscribe(() => { if (!document.activeElement || document.activeElement.tagName !== "TEXTAREA") draw(); }); sheet.done.push(un); return box;
  });
}
