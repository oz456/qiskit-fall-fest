// QFF 2026 web app: boot, device gate, session, router, tab bar. Routes: /attendee (sign in), /attendee/hub, /attendee/pass, /attendee/support.
import { ApiError, api, hooks, restoreSession } from "./api.js";
import * as push from "./push.js";
import { maybeAskInstall } from "./install.js";
import { detectPlatform, showDesktopFrame, showGate } from "./platform.js";
import { S, emit, hooks as storeHooks, loadAll, newReplies, resetState, subscribe } from "./store.js";
import { bubble, button, clear, closeAllSheets, closeTopSheet, h, icon, pullToRefresh, toast } from "./ui.js";
import { hubView } from "./views/hub.js";
import { passView } from "./views/pass.js";
import { detailsView } from "./views/details.js";
import { selfieView } from "./views/selfie.js";
import { openAnnouncements, openEventSheet, openProfile } from "./views/sheets.js";
import { signInView } from "./views/signin.js";
import { supportView } from "./views/support.js";

const root = document.getElementById("app");
const TABS = [["hub", "Hub", "home"], ["pass", "My Pass", "ticket"], ["support", "Support", "headset"]];
let signedIn = false, view = null, viewKey = "", tabbar = null;

const platform = detectPlatform();
// desktop browsers only get this far when the server allows them (WEB_APP_PLATFORMS has "desktop"): they see the app in a phone-sized frame
const desktopOk = document.body.dataset.desktop === "1", androidOk = document.body.dataset.android === "1";
if (platform === "desktop" && desktopOk && window.top === window) showDesktopFrame(h);
else if (platform !== "ios" && !(platform === "desktop" && desktopOk) && !(platform === "android" && androidOk)) { showGate(platform, h, document.getElementById("layer")); }
else boot();

storeHooks.onCheckin = (n) => {
  document.querySelector(".qrfull")?.click();   // close the full-screen QR: the scan is done
  const done = () => scrim.remove();
  const scrim = h("div", { class: "dialogscrim" }, h("div", { class: "dialog center", role: "alertdialog", "aria-modal": "true" },
    bubble("check", 72, true), h("h2", {}, "You’re checked in"), h("div", { class: "title" }, n.title), h("p", { class: "muted" }, n.time),
    h("div", { class: "actions" }, button("OK", { onclick: done }))));
  document.body.append(scrim);
};
hooks.onBlocked = () => showGate("desktop", h, document.getElementById("layer"));
hooks.onPhotoRequired = () => { if (!S.needsSelfie) { S.needsSelfie = true; render(); } };
hooks.onSignedOut = () => { if (!signedIn) return; endSession(); toast("You were signed out. Sign in again to continue."); };

const currentTab = () => (location.pathname.match(/^\/attendee\/(hub|pass|support)\/?$/) || [])[1] || "hub";
function go(path, replace = false) { history[replace ? "replaceState" : "pushState"]({}, "", path); render(); }

function setView(key, make) {
  if (viewKey === key) return view;
  view?.destroy?.(); viewKey = key; view = make(); clear(root); root.append(view.el); window.scrollTo(0, 0); return view;
}
function render() {
  if (!signedIn) {
    tabbar?.remove(); tabbar = null;
    return setView("signin", () => signInView({ onDone: onSignedIn }));
  }
  if (S.needsDetails) { tabbar?.remove(); tabbar = null; return setView("details", () => detailsView({ onDone: onDetailsDone, onSignOut: signOut })); }
  if (S.needsSelfie) { tabbar?.remove(); tabbar = null; return setView("selfie", () => selfieView({ onDone: onSelfieDone, onSignOut: signOut })); }
  if (!/^\/attendee\/(hub|pass|support)\/?$/.test(location.pathname)) history.replaceState({}, "", "/attendee/hub");
  const tab = currentTab();
  setView("tab:" + tab, () => (tab === "pass" ? passView({ open: openEventSheet }) : tab === "support" ? supportView() : hubView({ open: openEventSheet, openAnnouncements, openProfile: () => openProfile({ onSignOut: signOut }) })));
  drawTabs(tab);
  document.title = "QFF 2026";
}

function drawTabs(tab) {
  if (!tabbar) { tabbar = h("nav", { class: "tabbar", "aria-label": "Main" }); document.body.append(tabbar); }
  tabbar.replaceChildren(...TABS.map(([key, label, ic]) => h("button", { class: "tab" + (key === tab ? " on" : ""), type: "button", "aria-label": label, "aria-current": key === tab ? "page" : null, onclick: () => key !== tab && go("/attendee/" + key) },
    icon(ic), h("span", {}, label), key === "support" && newReplies() ? h("i", { class: "dot" }) : null)));
}
subscribe(() => { if (signedIn && !S.needsSelfie && !S.needsDetails && tabbar) drawTabs(currentTab()); });

async function onSignedIn() {
  signedIn = true; viewKey = ""; await afterAuth();
}
async function afterAuth() {
  try { await loadAll(); } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn’t load. Pull down to retry."); }
  render(); openFromHash();
  if (!S.needsSelfie && !S.needsDetails) { push.maybeAsk(); maybeAskInstall(); }
}
async function onDetailsDone() { S.needsDetails = false; viewKey = ""; await afterAuth(); }
async function onSelfieDone() { S.needsSelfie = false; viewKey = ""; await afterAuth(); }

function endSession() { signedIn = false; viewKey = ""; resetState(); closeAllSheets(); history.replaceState({}, "", "/attendee"); render(); }
async function signOut() { await push.forget().catch(() => {}); await api.logout(); endSession(); }

function openFromHash() { if (location.hash === "#announcements") { history.replaceState({}, "", location.pathname); openAnnouncements(); } }

async function boot() {
  window.addEventListener("popstate", () => { if (!closeTopSheet()) render(); });
  navigator.serviceWorker?.register("/attendee/sw.js", { scope: "/attendee/" }).catch(() => {});
  navigator.serviceWorker?.addEventListener("message", (e) => { if (e.data?.open) { const u = new URL(e.data.open, location.origin); closeAllSheets(); history.pushState({}, "", u.pathname); render(); if (u.hash === "#announcements") openAnnouncements(); loadAll().catch(() => {}); } });
  pullToRefresh(async () => { await (view?.refresh?.() ?? loadAll()).catch(() => {}); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && signedIn) loadAll().catch(() => {}); });
  window.addEventListener("online", () => signedIn && loadAll().catch(() => {}));

  root.append(h("div", { class: "screen", style: { display: "grid", placeItems: "center" } }, h("img", { src: "/shared/qiskit.svg", width: 64, height: 64, alt: "" })));
  let ok = false, net = false;
  // no saved profile = this browser has never signed in, so there is no session to restore (and no pointless 401)
  if (S.profile) { try { ok = await restoreSession(); } catch (e) { net = e instanceof ApiError && e.status === 0; } }
  if (ok) { signedIn = true; await afterAuth(); }
  else if (net && S.profile) { signedIn = true; S.offline = true; render(); }     // offline: show the last saved schedule
  else { signedIn = false; render(); }
}
