// Draws the pass QR with soft rounded modules (same look as the apps). The text is the rotating, signed pass code from the server.
export function drawQR(canvas, text) {
  const qr = window.qrcode(0, "M"); qr.addData(text); qr.make();
  const n = qr.getModuleCount(), dpr = Math.min(window.devicePixelRatio || 1, 3), css = canvas.getBoundingClientRect().width || 300;
  canvas.width = canvas.height = Math.round(css * dpr);
  const g = canvas.getContext("2d"), cell = canvas.width / n, r = cell * 0.28;
  g.clearRect(0, 0, canvas.width, canvas.height); g.fillStyle = "#161818";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) { g.beginPath(); g.roundRect(x * cell, y * cell, cell + 0.6, cell + 0.6, r); g.fill(); }
}
