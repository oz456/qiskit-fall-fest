// Small UI toolkit: element builder (never innerHTML, so no XSS), icons, sheets, toasts, dialogs.
// The strict CSP forbids inline style attributes, so dynamic styling goes through element.style (CSSOM) only.
const SVG = "http://www.w3.org/2000/svg";

// replaceChildren turns a null/false child into the text "null"/"false"; the screens pass optional pieces as null, so drop them here once for all.
const nativeReplace = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function (...kids) { return nativeReplace.apply(this, kids.flat(Infinity).filter((k) => k != null && k !== false)); };

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  append(el, kids);
  return el;
}
export function append(el, kids) { for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); return el; }
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// Icons: 24px, stroke style. "p:" = path data, "c:x,y,r" = circle.
const ICONS = {
  mail: ["p:M3 6h18v12H3z", "p:M3 7l9 6 9-6"],
  home: ["p:M3 11l9-8 9 8", "p:M5 10v10h5v-6h4v6h5V10"],
  ticket: ["p:M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z", "p:M13 5v2M13 11v2M13 17v2"],
  headset: ["p:M4 14v-2a8 8 0 0 1 16 0v2", "p:M4 14h3v5H5a1 1 0 0 1-1-1z", "p:M20 14h-3v5h2a1 1 0 0 0 1-1z", "p:M20 19a3 3 0 0 1-3 3h-3"],
  bell: ["p:M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9", "p:M10.3 21a1.9 1.9 0 0 0 3.4 0"],
  bellOff: ["p:M6 8a6 6 0 0 1 9.5-4.8M18 8c0 3 .6 5 1.5 6.5M3 17s3-2 3-9", "p:M10.3 21a1.9 1.9 0 0 0 3.4 0", "p:M3 3l18 18"],
  bookmark: ["p:M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"],
  chevR: ["p:M9 6l6 6-6 6"], chevL: ["p:M15 6l-6 6 6 6"],
  arrowR: ["p:M5 12h14M13 6l6 6-6 6"],
  x: ["p:M6 6l12 12M18 6L6 18"],
  download: ["p:M12 4v11M7 11l5 5 5-5", "p:M5 20h14"],
  lock: ["p:M5 11h14v10H5z", "p:M8 11V7a4 4 0 0 1 8 0v4"],
  lockOpen: ["p:M5 11h14v10H5z", "p:M8 11V7a4 4 0 0 1 7.5-2"],
  calendar: ["p:M4 6h16v14H4z", "p:M4 10h16M8 3v4M16 3v4"],
  calendarPlus: ["p:M4 6h16v14H4z", "p:M4 10h16M8 3v4M16 3v4M12 13v4M10 15h4"],
  clock: ["c:12,12,9", "p:M12 7v5l3 2"],
  pin: ["p:M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z", "c:12,10,2.5"],
  user: ["c:12,8,4", "p:M4 21a8 8 0 0 1 16 0"],
  mic: ["p:M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z", "p:M5 11a7 7 0 0 0 14 0M12 18v3"],
  checkCircle: ["c:12,12,9", "p:M8 12l3 3 5-6"],
  qr: ["p:M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z", "p:M14 14h2v2h-2zM18 14h2v6h-4M14 18h2v2"],
  camera: ["p:M4 8h3l2-3h6l2 3h3v12H4z", "c:12,14,3.5"],
  megaphone: ["p:M3 11v3a1 1 0 0 0 1 1h2l8 4V6L6 10H4a1 1 0 0 0-1 1z", "p:M17 9a4 4 0 0 1 0 6"],
  rocket: ["p:M12 3c3 2 5 5 5 9l-2 3H9l-2-3c0-4 2-7 5-9z", "c:12,10,1.6", "p:M9 15l-3 3v3l3-2M15 15l3 3v3l-3-2"],
  flask: ["p:M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3", "p:M8 15h8"],
  code: ["p:M9 8l-5 4 5 4M15 8l5 4-5 4M13.5 6l-3 12"],
  party: ["p:M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z", "p:M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"],
  trophy: ["p:M8 4h8v5a4 4 0 0 1-8 0z", "p:M8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 13v4M8 21h8M10 17h4"],
  help: ["c:12,12,9", "p:M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"],
  book: ["p:M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z", "p:M4 21V5M9 7h6M9 11h6"],
  warn: ["p:M12 3l10 18H2z", "p:M12 10v5M12 18h.01"],
  users: ["c:9,8,3.5", "p:M2 20a7 7 0 0 1 14 0M16 5a3.5 3.5 0 0 1 0 7M18 20a6 6 0 0 0-3-5.2"],
  eyeOff: ["p:M3 3l18 18M10.6 6.2A9.6 9.6 0 0 1 12 6c5 0 8.5 4.5 9.5 6a14 14 0 0 1-2.7 3.2M6.6 7.6A14 14 0 0 0 2.5 12C3.5 13.5 7 18 12 18c1.4 0 2.6-.3 3.7-.8", "p:M9.9 10a3 3 0 0 0 4.1 4.1"],
  cloudOff: ["p:M3 3l18 18M8.5 6.6A6 6 0 0 1 18 11a4 4 0 0 1 3 6.5M17 19H7a4 4 0 0 1-1.2-7.8"],
  send: ["p:M21 3L3 11l7 2 2 7z", "p:M10 13l11-10"],
  share: ["p:M12 3v12M8 7l4-4 4 4", "p:M5 12v8h14v-8"],
  plus: ["p:M12 5v14M5 12h14"],
  check: ["p:M5 12l5 5L20 7"],
  logout: ["p:M10 4H5v16h5", "p:M16 8l4 4-4 4M20 12H9"],
  grid: ["p:M4 5h16v6H4zM4 14h16v6H4z"],
  sparkle: ["p:M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z"],
};
export function icon(name, cls = "") {
  const s = document.createElementNS(SVG, "svg");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "icon " + cls); s.setAttribute("aria-hidden", "true");
  for (const d of ICONS[name] || []) {
    if (d.startsWith("p:")) { const p = document.createElementNS(SVG, "path"); p.setAttribute("d", d.slice(2)); s.append(p); }
    else { const [cx, cy, r] = d.slice(2).split(","); const c = document.createElementNS(SVG, "circle"); c.setAttribute("cx", cx); c.setAttribute("cy", cy); c.setAttribute("r", r); s.append(c); }
  }
  return s;
}
export const TRACK_ICON = { Main: "rocket", Workshop: "flask", Talk: "mic", Hackathon: "code", Social: "party", Competition: "trophy" };
export const TRACK_LABEL = { Main: "Main event", Workshop: "Workshop", Talk: "Talk", Hackathon: "Hackathon", Social: "Social", Competition: "Competition" };

export const bubble = (name, size = 50, mint = false) => h("div", { class: "bubble" + (mint ? " mint" : ""), style: { width: size + "px", height: size + "px" } }, icon(name));
export const pill = (text, cls = "") => h("span", { class: "pill " + cls }, text);
export const spinner = () => h("span", { class: "spin" });
export const pulse = () => h("i", { class: "pulse" });
export function button(text, { cls = "", onclick, loading = false, disabled = false, icon: ic } = {}) {
  const b = h("button", { class: "btn " + cls, type: "button", disabled: disabled || loading, onclick }, loading ? spinner() : [text, ic ? icon(ic) : null]);
  return b;
}
export const sectionLabel = (t, cls = "sect") => h("div", { class: "label " + cls }, t);
export const posterTitle = (first, second) => h("h1", { class: "poster" }, first, h("span", { class: "second" }, second));

export function toast(msg, ms = 3200) {
  document.querySelector(".toast")?.remove();
  const t = h("div", { class: "toast", role: "status" }, msg); document.body.append(t); setTimeout(() => t.remove(), ms);
}

// ---- sheets: one removal path (popstate), so the phone's back gesture closes them ----
const stack = [];
export function openSheet(build) {
  const scrim = h("div", { class: "scrim" });
  const grab = h("div", { class: "grab" }, h("i"));
  const inner = h("div", { class: "in" });
  const sheet = h("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, grab, inner);
  const entry = { scrim, sheet, close: () => history.back(), done: [] };
  const close = () => entry.close();
  append(inner, [build(close, entry)]);
  scrim.addEventListener("click", close);
  let y0 = null; // swipe the handle down to dismiss
  grab.addEventListener("touchstart", (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  grab.addEventListener("touchmove", (e) => { if (y0 != null) sheet.style.transform = `translate(-50%, ${Math.max(0, e.touches[0].clientY - y0)}px)`; }, { passive: true });
  grab.addEventListener("touchend", (e) => { if (y0 != null && e.changedTouches[0].clientY - y0 > 90) close(); else sheet.style.transform = ""; y0 = null; });
  document.getElementById("layer").append(scrim, sheet);
  history.pushState({ sheet: true }, "");
  stack.push(entry);
  return entry;
}
export function sheetsOpen() { return stack.length; }
export function closeTopSheet() {
  const e = stack.pop(); if (!e) return false;
  e.scrim.remove(); e.sheet.remove(); e.done.forEach((f) => f()); return true;
}
export function closeAllSheets() { while (closeTopSheet()); }
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && stack.length) stack.at(-1).close(); });

export function confirmDialog({ title, text, yes = "Yes", no = "Cancel", danger = false }) {
  return new Promise((resolve) => {
    const done = (v) => { scrim.remove(); resolve(v); };
    const scrim = h("div", { class: "dialogscrim" }, h("div", { class: "dialog", role: "alertdialog", "aria-modal": "true" },
      h("h2", {}, title), h("p", { class: "muted" }, text),
      h("div", { class: "actions" }, h("button", { class: "btn" + (danger ? " ghost" : ""), type: "button", onclick: () => done(true) }, yes), h("button", { class: "link", type: "button", onclick: () => done(false) }, no))));
    document.body.append(scrim);
  });
}

export function sparkle(size, color) {
  const s = document.createElementNS(SVG, "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("width", size); s.setAttribute("height", size); s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(SVG, "path"); p.setAttribute("d", "M12 0Q13.4 10.6 24 12Q13.4 13.4 12 24Q10.6 13.4 0 12Q10.6 10.6 12 0z"); p.setAttribute("fill", color); s.append(p); return s;
}

// ---- pull to refresh (iOS Safari has none inside a web app) ----
export function pullToRefresh(onRefresh) {
  const ind = h("div", { class: "ptr" }, spinner()); document.body.append(ind);
  let y0 = null, pulled = 0, busy = false;
  const apply = (v) => { ind.style.opacity = String(Math.min(1, v / 70)); ind.style.transform = `translateY(${Math.min(v, 90) * 0.7}px)`; };
  window.addEventListener("touchstart", (e) => { y0 = window.scrollY <= 0 && !stack.length && !busy ? e.touches[0].clientY : null; pulled = 0; }, { passive: true });
  window.addEventListener("touchmove", (e) => { if (y0 == null) return; pulled = e.touches[0].clientY - y0; if (pulled > 0) apply(pulled); }, { passive: true });
  window.addEventListener("touchend", async () => {
    if (y0 == null) return; const go = pulled > 80; y0 = null;
    if (go) { busy = true; apply(70); try { await onRefresh(); } finally { busy = false; } }
    ind.style.opacity = "0"; ind.style.transform = "";
  });
}

// ---- iPhone keyboard: keep sheets above it, hide the floating bars, bring the field into view ----
if (window.visualViewport) {
  const vv = window.visualViewport, root = document.documentElement;
  const sync = () => { const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop); root.style.setProperty("--kb", kb + "px"); root.style.setProperty("--vvh", vv.height + "px"); };
  vv.addEventListener("resize", sync); vv.addEventListener("scroll", sync); sync();
}
const typing = (el) => el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["button", "checkbox", "radio"].includes(el.type)));
document.addEventListener("focusin", (e) => { if (typing(e.target)) { document.body.classList.add("kb"); setTimeout(() => e.target.scrollIntoView?.({ block: "center", behavior: "smooth" }), 300); } });
document.addEventListener("focusout", () => setTimeout(() => { if (!typing(document.activeElement)) document.body.classList.remove("kb"); }, 50));
