// The animated atom (three tilted orbits, glowing electrons moving along them): same drawing as the Android and iPhone apps.
export function atom(canvas, { color = "#161818", electron = "#eb732f", line = 1.3, period = 9 } = {}) {
  const ctx = canvas.getContext("2d");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let raf = 0, t0 = performance.now(), w = 0, h = 0;
  function fit() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = r.width; h = r.height; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function draw(now) {
    if (!canvas.isConnected) return;
    if (!w) fit();
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2, rx = Math.min(w, h) * 0.46, ry = rx * 0.36, a = still ? 1 : ((now - t0) / 1000 / period) * 2 * Math.PI;
    [0, 60, 120].forEach((deg, i) => {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate((deg * Math.PI) / 180);
      ctx.beginPath(); ctx.ellipse(0, 0, rx, ry, 0, 0, 2 * Math.PI); ctx.strokeStyle = color; ctx.globalAlpha = 0.55; ctx.lineWidth = line; ctx.stroke(); ctx.globalAlpha = 1;
      const ang = a * (i === 1 ? -1 : 1) + (i * 2 * Math.PI) / 3, ex = rx * Math.cos(ang), ey = ry * Math.sin(ang);
      ctx.fillStyle = electron; ctx.globalAlpha = 0.28; ctx.beginPath(); ctx.arc(ex, ey, line * 7, 0, 2 * Math.PI); ctx.fill();
      ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(ex, ey, line * 3.6, 0, 2 * Math.PI); ctx.fill();
      ctx.restore();
    });
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx, cy, line * 4.4, 0, 2 * Math.PI); ctx.fill();
    if (!still) raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  document.addEventListener("visibilitychange", () => { cancelAnimationFrame(raf); if (!document.hidden && !still) raf = requestAnimationFrame(draw); });
  return { stop: () => cancelAnimationFrame(raf) };
}
