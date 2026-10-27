"use strict";
// Fall Fest door check-in. Dependency-free; all dynamic text goes through textContent.
const $app = document.getElementById("app");
let csrf = "", TZ = "Asia/Kolkata";
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (k === "class") e.className = v; else if (k === "style") e.style.cssText = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v === true) e.setAttribute(k, ""); else if (v !== false && v != null) e.setAttribute(k, v); }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};
const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };
async function api(method, url, body) {
  const res = await fetch("/checkin/api" + url, { method, credentials: "same-origin",
    headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(method !== "GET" ? { "x-csrf-token": csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && !url.startsWith("/login")) { stopCam(); showLogin(); throw new Error("Signed out"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || "Request failed");
  return data;
}
const fmtTime = (iso) => new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(new Date(iso));

// feedback: beep + vibrate so volunteers needn't watch the screen
let actx;
function beep(kind) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain(); o.connect(g); g.connect(actx.destination);
    o.frequency.value = kind === "ok" ? 880 : kind === "warn" ? 520 : 200; o.type = kind === "bad" ? "sawtooth" : "sine";
    g.gain.value = 0.15; o.start(); o.stop(actx.currentTime + (kind === "ok" ? 0.12 : 0.35));
  } catch {}
  if (navigator.vibrate) navigator.vibrate(kind === "ok" ? 60 : [90, 60, 90]);
}

function showLogin() {
  clear($app);
  const err = h("div", { class: "err" }); const u = h("input", { autocomplete: "username", autocapitalize: "none", required: true }); const p = h("input", { type: "password", autocomplete: "current-password", required: true });
  $app.append(h("div", { class: "wrap login" }, h("div", { class: "top" }, h("img", { src: "/checkin/qiskit.svg", alt: "" }), h("b", {}, "Fall Fest · Check-in")),
    h("form", { class: "card", onsubmit: async (e) => { e.preventDefault(); err.textContent = ""; try { const r = await api("POST", "/login", { username: u.value, password: p.value }); csrf = r.csrf; await boot(); } catch (x) { err.textContent = x.message; } } },
      h("label", {}, "Scanner username"), u, h("label", {}, "Password"), p, err, h("button", { class: "btn" }, "Sign in"))));
}

let stream = null, timer = null;
function stopCam() { if (timer) clearInterval(timer); timer = null; if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; }

async function boot() {
  let me; try { me = await api("GET", "/me"); } catch { return showLogin(); }
  csrf = me.csrf; TZ = me.tz;
  const sc = await api("GET", "/scopes");
  clear($app);
  const scope = h("select", { onchange: () => { refresh(); } },
    h("optgroup", { label: "Campus entry · once per day" }, sc.days.map((d) => h("option", { value: "day:" + d, selected: "day:" + d === sc.defaultScope }, (d === sc.today ? "Today · " : "") + new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })))),
    h("optgroup", { label: "Event attendance" }, sc.events.map((e) => h("option", { value: "event:" + e.id }, e.title))));
  const count = h("b", {}, "–"), totalEl = h("span", {}, ""), recent = h("div", { class: "recent" }), sheet = h("div", { class: "sheet" }), toastEl = h("div", { class: "toast" });
  const video = h("video", { playsinline: true, muted: true });
  const startBtn = h("button", { class: "btn", onclick: startCam }, "Start camera");
  const startWrap = h("div", { class: "start" }, startBtn);

  async function refresh() {
    try {
      const s = await api("GET", "/stats?scope=" + encodeURIComponent(scope.value));
      count.textContent = s.count; totalEl.textContent = " of " + s.total; clear(recent);
      if (s.recent.length) recent.append(h("h3", {}, "Latest"), ...s.recent.slice(0, 5).map((r) => h("div", { class: "item" }, h("div", { class: "grow" }, h("div", { class: "name" }, r.name), h("div", { class: "muted small" }, [r.passCode, r.college].filter(Boolean).join(" · "))), h("div", { class: "muted small" }, fmtTime(r.at)))));
    } catch {}
  }
  const flash = (text, kind) => { toastEl.textContent = text; toastEl.className = "toast show " + kind; clearTimeout(flash.t); flash.t = setTimeout(() => (toastEl.className = "toast"), 1600); };

  // ---- the verification sheet: face first, then Confirm / Reject ----
  let busy = false, last = "", dismissT;
  const initials = (n) => n.split(/\s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
  function closeSheet() { clearTimeout(dismissT); sheet.className = "sheet"; busy = false; }
  function openSheet(r) {
    clearTimeout(dismissT); clear(sheet);
    const bad = !r.who || ["invalid", "expired", "blocked"].includes(r.result);
    const tone = bad ? "bad" : r.result === "duplicate" ? "warn" : "go";
    const photo = !bad && r.who.hasPhoto
      ? h("img", { class: "photo", alt: "", src: "/checkin/api/photo?ticket=" + encodeURIComponent(r.ticket), onerror: (e) => { e.target.replaceWith(h("div", { class: "photo none bad" }, "PHOTO", h("br"), "UNREADABLE")); flash("Selfie could not be loaded. Check the person’s ID.", "warn"); } })
      : h("div", { class: "photo none" }, bad ? "!" : initials(r.who.name));
    const title = r.result === "verify" ? "" : { duplicate: "Already checked in", expired: "Stale QR", blocked: "Pass blocked", invalid: "Invalid pass" }[r.result] || "Error";
    const body = [photo];
    if (!bad || r.who) body.push(h("div", { class: "name" }, r.who ? r.who.name : ""), h("div", { class: "muted" }, r.who ? [r.who.passCode, r.who.college].filter(Boolean).join(" · ") : ""));
    if (title) body.push(h("div", { class: "state" }, title));
    if (r.result === "duplicate" && r.at) body.push(h("div", { class: "muted small" }, "First scanned at " + fmtTime(r.at)));
    if (bad) body.push(h("div", { class: "muted msg" }, r.message));
    if (r.warning) body.push(h("div", { class: "warnbox" }, r.warning));
    const actions = r.result === "verify"
      ? h("div", { class: "actions" },
          h("button", { class: "btn reject", onclick: () => decide(r, "reject") }, "Reject"),
          h("button", { class: "btn confirm", onclick: () => (r.collectOd ? askOd(r) : decide(r, "confirm")) }, "Confirm entry"))
      : h("div", { class: "actions" }, h("button", { class: "btn dismiss", onclick: closeSheet }, "Done"));
    sheet.append(h("div", { class: "panel " + tone }, h("div", { class: "who" }, body), actions));
    sheet.className = "sheet show";
    beep(r.result === "verify" ? "warn" : bad ? "bad" : "warn");
    if (r.result !== "verify") dismissT = setTimeout(closeSheet, 6000);
  }
  // events that collect OD details: after the face check, the volunteer fills three fields with the student (or skips)
  function askOd(r) {
    clearTimeout(dismissT);
    const from = h("input", { type: "time", required: true, "aria-label": "OD from" }), until = h("input", { type: "time", required: true, "aria-label": "OD until" });
    const hours = h("input", { type: "number", inputmode: "decimal", min: "0.25", max: "24", step: "0.25", placeholder: "e.g. 2", "aria-label": "Number of hours" });
    let hoursEdited = false; hours.oninput = () => { hoursEdited = true; };
    const auto = () => {
      if (hoursEdited || !from.value || !until.value) return;
      const mins = (+until.value.slice(0, 2) * 60 + +until.value.slice(3)) - (+from.value.slice(0, 2) * 60 + +from.value.slice(3));
      if (mins > 0) hours.value = String(Math.round(mins / 15) / 4);
    };
    from.onchange = until.onchange = auto;
    const err = h("div", { class: "warnbox", hidden: true });
    const save = () => {
      const n = Number(hours.value);
      if (!from.value || !until.value) return show("Fill both times.");
      if (until.value <= from.value) return show("OD until time must be after OD from time.");
      if (!(n > 0) || n > 24) return show("Enter the number of hours (more than 0, at most 24).");
      decide(r, "confirm", { from: from.value, until: until.value, hours: n });
    };
    const show = (m) => { err.textContent = m; err.hidden = false; };
    clear(sheet);
    sheet.append(h("div", { class: "panel go" }, h("div", { class: "who" },
      h("div", { class: "name" }, r.who.name), h("div", { class: "muted" }, "OD details for this event"),
      h("label", { class: "odf" }, "OD from time", from), h("label", { class: "odf" }, "OD until time", until), h("label", { class: "odf" }, "Number of hours", hours), err),
      h("div", { class: "actions" }, h("button", { class: "btn reject", onclick: () => decide(r, "confirm") }, "Skip"), h("button", { class: "btn confirm", onclick: save }, "Save and check in"))));
    sheet.className = "sheet show";
  }
  async function decide(r, decision, od) {
    try {
      const d = await api("POST", "/confirm", { ticket: r.ticket, decision, ...(od ? { od } : {}) });
      closeSheet();
      if (d.result === "ok") { flash("✔ " + r.who.name + " checked in", "ok"); beep("ok"); refresh(); }
      else if (d.result === "rejected") flash("Entry rejected", "bad");
      else flash(d.message, "warn");
    } catch (x) { closeSheet(); flash(x.message, "bad"); beep("bad"); }
  }
  async function submit(payload) {
    if (busy || payload === last) return;
    busy = true; last = payload; setTimeout(() => { last = ""; }, 4000);
    try { openSheet(await api("POST", "/scan", { payload, scope: scope.value })); }
    catch (x) { busy = false; flash(x.message, "bad"); beep("bad"); }
  }
  async function startCam() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      video.srcObject = stream; await video.play(); startWrap.remove();
      const cv = document.createElement("canvas"), ctx = cv.getContext("2d", { willReadFrequently: true });
      timer = setInterval(() => {
        if (!video.videoWidth || busy) return;
        const w = 480, hgt = Math.round(480 * video.videoHeight / video.videoWidth); cv.width = w; cv.height = hgt; ctx.drawImage(video, 0, 0, w, hgt);
        const q = window.jsQR(ctx.getImageData(0, 0, w, hgt).data, w, hgt, { inversionAttempts: "dontInvert" });
        if (q && q.data) submit(q.data);
      }, 150);
    } catch (x) { startBtn.textContent = "Camera blocked. Allow it, then tap again"; }
  }

  $app.append(h("div", { class: "wrap" },
    h("div", { class: "top" }, h("img", { src: "/checkin/qiskit.svg", alt: "" }), h("b", {}, "Check-in"), h("button", { class: "link right", onclick: async () => { stopCam(); await api("POST", "/logout"); showLogin(); } }, "Sign out")),
    h("div", { class: "scopebar" }, scope, h("div", { class: "tally" }, count, totalEl)),
    h("div", { class: "cam" }, video, h("div", { class: "corners" }), h("div", { class: "hint" }, "Point at the live pass QR"), startWrap),
    recent, sheet, toastEl));
  refresh(); setInterval(refresh, 20000);
  startCam();
}
boot();
