// Service worker for the QFF 2026 web app: keeps the app shell available offline and shows push notifications.
const CACHE = "qff-user-v1";
const SHELL = ["/user/", "/user/css/user.css", "/user/js/main.js"];

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

// Network first (so a new deploy shows at once), cache as the offline fallback. API calls are never cached.
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || !(u.pathname.startsWith("/user/") || u.pathname.startsWith("/shared/"))) return;
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request.mode === "navigate" ? "/user/" : e.request, copy)); } return r; })
    .catch(() => caches.match(e.request.mode === "navigate" ? "/user/" : e.request).then((m) => m || Response.error())));
});

self.addEventListener("push", (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { /* plain text */ }
  const title = d.title || "QFF 2026";
  e.waitUntil(self.registration.showNotification(title, { body: d.body || "", icon: "/user/icons/icon-192.png", badge: "/user/icons/icon-192.png", tag: d.type === "ticket" ? `ticket-${d.id}` : `ann-${d.id}`, data: { type: d.type, id: d.id } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = e.notification.data?.type === "ticket" ? "/user/support" : "/user/hub#announcements";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.includes("/user/"));
    if (c) { c.postMessage({ open: target }); return c.focus(); }
    return self.clients.openWindow(target);
  }));
});
