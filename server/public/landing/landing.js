// Landing page: highlights the card for the visitor's device, shows the Android file's checksum, draws a QR for THIS page's address.
const ua = navigator.userAgent;
const platform = /android/i.test(ua) ? "android" : /iPhone|iPod|iPad/.test(ua) ? "ios" : "desktop";
document.documentElement.dataset.platform = platform;

const from = new URLSearchParams(location.search);
if (from.get("from") === "user") {
  const n = document.getElementById("notice");
  n.hidden = false;
  n.textContent = from.get("platform") === "android"
    ? "The web app isn’t available on Android right now. Install the Android app below instead."
    : "The web app can’t open on this device. On Android, use the buttons below. On iPhone, open this page in Safari.";
}

fetch("/downloads/qff-2026.apk.sha256").then((r) => r.text()).then((t) => { document.getElementById("sha").textContent = t.trim(); })
  .catch(() => { document.getElementById("sha").textContent = "unavailable"; });

try {
  const qr = window.qrcode(0, "M"); qr.addData(location.origin + "/"); qr.make();
  const c = document.getElementById("qrcanvas"), g = c.getContext("2d"), n = qr.getModuleCount(), cell = Math.floor(c.width / n), off = Math.floor((c.width - cell * n) / 2);
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.fillStyle = "#161818";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) g.fillRect(off + x * cell, off + y * cell, cell, cell);
} catch { document.getElementById("qr").hidden = true; }
