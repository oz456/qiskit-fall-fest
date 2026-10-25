// Web push for the home-screen app. Only two kinds of notification ever arrive: announcements and replies to your support tickets.
// iPhone rule (Apple): web push works only after "Add to Home Screen" and opening the app from its icon (iOS 16.4+).
import { ApiError, api, call } from "./api.js";
import { button, h, icon, openSheet } from "./ui.js";

export const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const urlB64 = (b64) => { const pad = "=".repeat((4 - (b64.length % 4)) % 4), raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
const reg = () => navigator.serviceWorker.getRegistration("/attendee/");   // never wait on .ready: it hangs forever when no worker is registered

/** "install" | "unsupported" | "denied" | "off" | "on" */
export async function status() {
  if (!("serviceWorker" in navigator)) return "unsupported";
  if (!("PushManager" in window) || !("Notification" in window)) return standalone() ? "unsupported" : "install";
  if (Notification.permission === "denied") return "denied";
  try { return (await (await reg()).pushManager.getSubscription()) ? "on" : "off"; } catch { return "off"; }
}
export async function enable() {
  if ((await Notification.requestPermission()) !== "granted") return false;
  const { publicKey } = await call("GET", "/v1/push/vapid");
  const sub = await (await reg()).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(publicKey) });
  const j = sub.toJSON();
  await api.putPush({ platform: "web", token: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
  return true;
}
export async function disable() {
  try { const sub = await (await reg()).pushManager.getSubscription(); if (sub) { const ep = sub.endpoint; await sub.unsubscribe(); await api.delPush(ep).catch(() => {}); } } catch { /* nothing to undo */ }
}
/** Used at sign-out so this browser stops receiving notifications for the account. */
export const forget = disable;

export async function settingsRow(redraw) {
  const s = await status();
  const row = (sub, action) => h("div", { class: "setrow" }, icon(s === "on" ? "bell" : "bellOff", ""), h("div", { class: "grow" }, h("div", { class: "bodyM" }, "Notifications"), h("div", { class: "small muted" }, sub)), action);
  if (s === "on") return row("On: announcements and support replies", h("button", { class: "link pri", type: "button", onclick: async () => { await disable(); redraw(); } }, "TURN OFF"));
  if (s === "off") return row("Off", h("button", { class: "link pri", type: "button", onclick: async () => { try { await enable(); } catch (e) { alert(e instanceof ApiError ? e.message : "Couldn’t turn notifications on."); } redraw(); } }, "TURN ON"));
  if (s === "denied") return row("Blocked. Allow notifications for QFF 2026 in iPhone Settings.", "");
  if (s === "install") return row("To get notifications: tap Share, then “Add to Home Screen”, and open QFF 2026 from your Home Screen.", "");
  return row("Not supported in this browser", "");
}

/** Asked once, a moment after the first time the attendee lands in the app (installed app only; a user gesture is required). */
export async function maybeAsk() {
  if (localStorage.getItem("qff.notifAsked") || !standalone() || (await status()) !== "off") return;
  setTimeout(() => openSheet((close) => {
    const done = () => { try { localStorage.setItem("qff.notifAsked", "1"); } catch { /* ignore */ } close(); };
    return [h("div", { class: "bubble mint", style: { width: "60px", height: "60px" } }, icon("bell")), h("h2", { class: "h1" }, "Never miss an update"),
      h("p", { class: "body muted" }, "We’ll notify you the moment the team posts an announcement or replies to your support ticket. Nothing else, ever."),
      button("Turn on notifications", { onclick: async () => { try { await enable(); } catch { /* the toggle in Profile shows the state */ } done(); } }),
      h("button", { class: "link", type: "button", onclick: done }, "Not now")];
  }), 1500);
}
