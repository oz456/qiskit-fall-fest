// My Pass: tilt card, "tap to show QR" (hidden until tapped), full-screen rotating QR, saved events.
import { api } from "../api.js";
import { atom } from "../atom.js";
import { drawQR } from "../qr.js";
import { S, loadAll, subscribe } from "../store.js";
import { button, h, icon, posterTitle, sectionLabel, toast } from "../ui.js";
import { eventRow } from "./hub.js";

const STEP = 30, QR_IDLE_MS = 120_000;
let codes = [], skew = 0;
async function fetchCodes() {
  const r = await api.passCodes();
  skew = r.serverTime - Date.now(); codes = r.codes;
}
const currentStep = () => Math.floor((Date.now() + skew) / 1000 / STEP);
const currentPayload = () => codes.find((c) => c.step === currentStep())?.payload || null;
const progress = () => 1 - (((Date.now() + skew) / 1000) % STEP) / STEP;   // fraction of this 30-second window still left

export function passView({ open }) {
  const root = h("div", { class: "screen" });
  const canvas = h("canvas", { "aria-hidden": "true" });
  const card = h("div", { class: "pass" }, canvas);
  const cardBody = h("div", { style: { display: "contents" } }); card.append(cardBody);
  const cap = h("div", { class: "cap" }, "QR appears when you tap. It refreshes every 30 seconds.");
  const listBox = h("div", {});
  root.append(h("div", { class: "passhead" }, h("div", { class: "label" }, "My pass"), posterTitle("One pass.", "Every moment.")), h("div", {}, card), cap, listBox);
  requestAnimationFrame(() => atom(canvas, { color: "#f2e7d7", electron: "#eb732f", period: 12, line: 1.3 }));

  // tilt the card under your finger, spring back on release
  const tilt = (e) => { const t = e.touches[0], r = card.getBoundingClientRect(); const rx = -((t.clientY - r.top) / r.height - 0.5) * 18, ry = ((t.clientX - r.left) / r.width - 0.5) * 18; card.style.transition = "none"; card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`; };
  card.addEventListener("touchmove", tilt, { passive: true });
  card.addEventListener("touchend", () => { card.style.transition = ""; card.style.transform = ""; });

  function update() {
    const p = S.profile || {};
    cardBody.replaceChildren(
      h("div", { class: "secure" }, icon("checkCircle"), "Secure Pass", h("span", { class: "pill cream" }, "ACTIVE")),
      h("div", { class: "att" }, "ATTENDEE"), h("div", { class: "nm" }, p.name || ""), h("div", { class: "id" }, `ID: ${p.passCode || ""}`), p.college ? h("div", { class: "col" }, p.college) : null,
      h("button", { class: "btn", type: "button", onclick: showQR }, icon("qr"), "Tap to show QR"));
    const reg = S.events.filter((e) => e.saved);
    listBox.replaceChildren(...(reg.length ? [sectionLabel("Saved events"), h("div", { class: "list" }, reg.map((e) => eventRow(e, { trailing: true, open })))] : [h("div", { class: "empty", style: { padding: "48px 40px" } }, h("p", { class: "body muted" }, "Events you save appear here. Tap the bookmark on any event to save it."))]));
  }
  const un = subscribe(update); update();
  return { el: root, refresh: loadAll, destroy: un };
}

/** Full-screen QR with a border that counts down the 30-second window. Closed automatically when the page is hidden (app switcher). */
export function showQR() {
  const p = S.profile || {};
  let timer = 0, idle = 0, lastPayload = null, wake = null, closed = false;
  const canvas = h("canvas", { "aria-label": "Your pass QR code" });
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  for (const [k, v] of Object.entries({ x: 1.5, y: 1.5, width: 97, height: 97, rx: 8, fill: "none", "stroke-width": 1.8, "stroke-linecap": "round", pathLength: 100, stroke: "#7e1322" })) rect.setAttribute(k, v);
  const track = rect.cloneNode(); track.setAttribute("stroke", "rgba(126,19,34,.15)");
  const ring = document.createElementNS("http://www.w3.org/2000/svg", "svg"); ring.setAttribute("viewBox", "0 0 100 100"); ring.setAttribute("preserveAspectRatio", "none"); ring.setAttribute("class", "ring"); ring.append(track, rect);
  const box = h("div", { class: "qrbox" }, canvas, ring);
  const status = h("p", { class: "small muted", style: { textAlign: "center" } }, "Live code: it changes every 30 seconds.", h("br"), "Hold steady at the scanner. Tap anywhere to close.");
  const view = h("div", { class: "qrfull", role: "dialog", "aria-modal": "true", onclick: close }, h("div", { class: "nm" }, (p.name || "").toUpperCase()), h("div", { class: "body muted" }, `ID: ${p.passCode || ""}`), box, status);
  document.body.append(view);
  navigator.wakeLock?.request("screen").then((w) => { wake = w; if (closed) w.release(); }).catch(() => {});
  const onHide = () => { if (document.hidden) close(); };
  document.addEventListener("visibilitychange", onHide);

  function showOffline() { canvas.style.display = "none"; if (!box.querySelector(".off")) box.append(h("div", { class: "off" }, icon("cloudOff"), "Can’t load your code. Check your connection.")); }
  async function tick() {
    if (closed) return;
    let payload = currentPayload();
    if (!payload) { try { await fetchCodes(); payload = currentPayload(); } catch (e) { toast(e.message); } }   // new batch every ~5 minutes
    else if (codes.length && currentStep() >= codes.at(-1).step - 1) fetchCodes().catch(() => {});          // top up before the batch runs out
    if (!payload) return showOffline();
    box.querySelector(".off")?.remove(); canvas.style.display = "";
    if (payload !== lastPayload) { lastPayload = payload; drawQR(canvas, payload); }
    rect.setAttribute("stroke-dasharray", `${(progress() * 100).toFixed(1)} 100`);
  }
  function close() { if (closed) return; closed = true; clearInterval(timer); clearTimeout(idle); document.removeEventListener("visibilitychange", onHide); wake?.release?.().catch(() => {}); view.remove(); }
  tick(); timer = setInterval(tick, 250);
  idle = setTimeout(close, QR_IDLE_MS);   // a forgotten QR must not keep the screen awake or the code on show
  return close;
}
