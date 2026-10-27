// "Add QFF 2026 to your home screen". Android Chrome offers a real install dialog (beforeinstallprompt); iPhone has no such button,
// so we show the two steps. Nothing is shown inside the installed app, on a laptop, or in browsers that cannot install.
import { button, h, icon, openSheet } from "./ui.js";

const HIDE_KEY = "qff.installHide", HIDE_MS = 3 * 24 * 3600 * 1000;
const ios = /iPhone|iPad|iPod/.test(navigator.userAgent || "");
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let deferred = null; const listeners = new Set();
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; listeners.forEach((f) => f()); });
window.addEventListener("appinstalled", () => { deferred = null; listeners.forEach((f) => f()); });

export const onInstallChange = (f) => { listeners.add(f); return () => listeners.delete(f); };
export const canInstall = () => !standalone() && window.top === window && (!!deferred || ios);
const hidden = () => { try { return Date.now() - Number(localStorage.getItem(HIDE_KEY) || 0) < HIDE_MS; } catch { return false; } };

export async function install() {
  if (deferred && !ios) {
    const d = deferred; deferred = null;
    try { d.prompt(); await d.userChoice.catch(() => {}); listeners.forEach((f) => f()); return; } catch { /* the browser refused the dialog: show the steps below */ }
  }
  openSheet((close) => [
    h("h2", { class: "h1" }, "Add to Home Screen"),
    h("ol", { class: "steps" },
      h("li", {}, "Tap the ", h("b", {}, "Share"), " button in Safari (the square with an arrow, at the bottom of the screen)."),
      h("li", {}, "Scroll down and tap ", h("b", {}, "Add to Home Screen"), "."),
      h("li", {}, "Tap ", h("b", {}, "Add"), ", then open ", h("b", {}, "QFF 2026"), " from your Home Screen.")),
    h("p", { class: "small muted" }, "On iPhone, notifications only work after the app is added to the Home Screen. You may need to sign in again there."),
    button("Got it", { onclick: close })]);
}

/** The card shown at the top of the Hub, or null when nothing should be shown. */
export function installCard() {
  if (!canInstall() || hidden()) return null;
  const hide = () => { try { localStorage.setItem(HIDE_KEY, String(Date.now())); } catch { /* ignore */ } listeners.forEach((f) => f()); };
  return h("div", { class: "install" }, h("div", { class: "txt" }, h("b", {}, "Add QFF 2026 to your home screen"), h("span", {}, "Open it like any other app, in one tap.")),
    h("button", { class: "go", type: "button", onclick: install }, deferred && !ios ? "Install" : "Show me how"),
    h("button", { class: "x", type: "button", "aria-label": "Not now", onclick: hide }, icon("x")));
}

/** A row for the profile sheet so people can find it again after dismissing the card. */
export function installRow() {
  if (!canInstall()) return null;
  return h("div", { class: "setrow" }, icon("download"), h("div", { class: "grow" }, h("div", { class: "bodyM" }, "Install the app"), h("div", { class: "small muted" }, "Add QFF 2026 to your home screen")),
    h("button", { class: "link pri", type: "button", onclick: install }, "ADD"));
}
