"use strict";
// Fall Fest door check-in. Dependency-free; all dynamic text goes through textContent.
const $app = document.getElementById("app");
let csrf = "", TZ = "Asia/Kolkata";
const h = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (k === "class") e.className = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else if (v === true) e.setAttribute(k, ""); else if (v !== false && v != null) e.setAttribute(k, v); }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};
const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };
async function api(method, url, body) {
  const res = await fetch("/check/api" + url, { method, credentials: "same-origin",
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
  $app.append(h("div", { class: "wrap login" }, h("div", { class: "top" }, h("img", { src: "qiskit.svg", alt: "" }), h("b", {}, "Fall Fest · Check-in")),
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
    h("optgroup", { label: "Venue entry · once per day" }, sc.days.map((d) => h("option", { value: "day:" + d, selected: "day:" + d === sc.defaultScope }, (d === sc.today ? "Today · " : "") + d))),
    h("optgroup", { label: "Event attendance" }, sc.events.map((e) => h("option", { value: "event:" + e.id }, e.title))));
  const count = h("b", {}, "–"), totalEl = h("b", {}, "–"), recent = h("div"), result = h("div", { class: "result" });
  const manual = h("input", { placeholder: "Hardware scanner / paste code…", autocomplete: "off", autocapitalize: "none", onkeydown: (e) => { if (e.key === "Enter" && manual.value.trim()) { submit(manual.value.trim()); manual.value = ""; } } });
  const video = h("video", { playsinline: true, muted: true });
  const startBtn = h("button", { class: "btn", onclick: startCam }, "Start camera");
  const startWrap = h("div", { class: "start" }, startBtn);

  async function refresh() {
    try {
      const s = await api("GET", "/stats?scope=" + encodeURIComponent(scope.value));
      count.textContent = s.count; totalEl.textContent = s.total; clear(recent);
      recent.append(h("h3", {}, "Latest check-ins"), s.recent.length ? s.recent.map((r) => h("div", { class: "row" }, h("div", { class: "grow" }, h("div", { class: "name" }, r.name), h("div", { class: "muted small" }, [r.passCode, r.college].filter(Boolean).join(" · "))), h("div", { class: "muted small" }, fmtTime(r.at)))) : h("div", { class: "muted small" }, "None yet."));
    } catch {}
  }

  let busy = false, last = "", hideT;
  async function submit(payload) {
    if (busy || payload === last) return;
    busy = true; last = payload; setTimeout(() => { last = ""; }, 4000);
    try {
      const r = await api("POST", "/scan", { payload, scope: scope.value });
      const cls = r.result === "ok" ? (r.warning ? "warn" : "ok") : r.result === "duplicate" ? "warn" : "bad";
      clear(result); result.className = "result show " + cls;
      result.append(h("div", { class: "big" }, { ok: "✔ Checked in", duplicate: "Already checked in", expired: "Stale QR — screenshot?", blocked: "Pass blocked", invalid: "Invalid pass" }[r.result] || "Error"),
        r.who && h("div", { class: "who" }, r.who.name), r.who && h("div", {}, [r.who.passCode, r.who.college].filter(Boolean).join(" · ")),
        h("p", {}, r.warning || r.message), r.at && h("p", { class: "small" }, "First scanned at " + fmtTime(r.at)));
      beep(cls); clearTimeout(hideT); hideT = setTimeout(() => result.classList.remove("show"), cls === "ok" ? 1800 : 4200);
      if (r.result === "ok") refresh();
    } catch (x) { clear(result); result.className = "result show bad"; result.append(h("div", { class: "big" }, "Error"), h("p", {}, x.message)); beep("bad"); hideT = setTimeout(() => result.classList.remove("show"), 3500); }
    finally { busy = false; }
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
    } catch (x) { startBtn.textContent = "Camera blocked — allow it in the browser, then tap again"; }
  }

  $app.append(h("div", { class: "wrap" },
    h("div", { class: "top" }, h("img", { src: "qiskit.svg", alt: "" }), h("b", {}, "Check-in"), h("button", { class: "btn ghost right", onclick: async () => { stopCam(); await api("POST", "/logout"); showLogin(); } }, "Sign out")),
    h("label", {}, "Scanning for"), scope,
    h("div", { class: "counter" }, h("div", { class: "card" }, count, h("span", { class: "muted small" }, "checked in")), h("div", { class: "card" }, totalEl, h("span", { class: "muted small" }, "registered"))),
    h("div", { class: "cam" }, video, h("div", { class: "frame" }), h("div", { class: "hint" }, "Point at the attendee’s live pass QR"), startWrap),
    h("label", {}, "Backup"), manual, h("div", { class: "recent" }, recent), result));
  refresh(); setInterval(refresh, 20000);
  startCam();
}
boot();
