// Client-side half of the device rule (the server enforces the same rule first). Only iPhone/iPad may use the web app.
// A real iPhone has ALL of: an iPhone/iPad user-agent, navigator.platform of iPhone/iPad, and no Chromium client hint naming another OS.
export function detectPlatform() {
  const ua = navigator.userAgent || "";
  const hint = (navigator.userAgentData && navigator.userAgentData.platform) || "";
  if (/android/i.test(ua) || /android/i.test(hint)) return "android";
  const uaIos = /\b(iPhone|iPod|iPad)\b/.test(ua);
  const platIos = /iPhone|iPad|iPod/.test(navigator.platform || "");
  const ipadDesktopMode = (navigator.platform === "MacIntel" || /Macintosh/.test(ua)) && navigator.maxTouchPoints > 1 && !hint; // iPadOS "Request Desktop Website"
  if ((uaIos && platIos && (!hint || /ios/i.test(hint))) || (ipadDesktopMode && "ontouchend" in document)) return "ios";
  return "desktop";
}

/** Laptop/PC preview: the page shows itself inside a phone-sized frame (an iframe), so the whole app behaves as on a phone. */
export function showDesktopFrame(h) {
  document.body.replaceChildren(h("div", { class: "devpage" },
    h("div", { class: "devphone" }, h("iframe", { src: "/attendee", title: "QFF 2026 app", allow: "camera" })),
    h("div", { class: "note" }, "Preview on a computer. On the day, use your phone.")));
}

const COPY = {
  android: ["The web app isn’t available on Android", "Android has its own QFF 2026 app: install it from our downloads page. It has your pass, the schedule, support and instant notifications.", "Get the Android app"],
  desktop: ["Open this on your iPhone", "The attendee web app is made for iPhone. On Android, install the QFF 2026 app from our downloads page.", "Go to downloads"],
};
/** Same popup the server sends: full screen, no close button, only a way out to the landing page. */
export function showGate(kind, h, mount) {
  const [title, text, cta] = COPY[kind] || COPY.desktop;
  mount.replaceChildren(
    h("div", { class: "dialogscrim" }, h("div", { class: "dialog", role: "alertdialog", "aria-modal": "true" },
      h("img", { src: "/shared/qiskit.svg", alt: "" }), h("h2", {}, title), h("p", { class: "muted" }, text),
      h("div", { class: "actions" }, h("a", { class: "btn", href: `/?from=user&platform=${kind}` }, cta)))));
}
