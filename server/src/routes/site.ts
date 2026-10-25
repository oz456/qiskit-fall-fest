// Everything the browser loads: the landing page at /, the APK under /downloads, shared fonts/logo, the three sites
// (/admin, /checkin, /attendee) and the redirects for older addresses. Only /attendee is gated by device (iPhone/iPad only).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fstatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { detectPlatform, gatePage, webAppAllowed } from "../lib/platform.ts";

export async function siteRoutes(app: FastifyInstance) {
  const pub = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");
  /** HTML and scripts always revalidate (cheap 304s), so a new deploy reaches phones at once; big static files are cached. */
  const noCache = (res: any) => res.header("Cache-Control", "no-cache");
  const longCache = (res: any) => res.header("Cache-Control", "public, max-age=604800");

  // ---- staff sites: /admin and /checkin (one address each, no trailing slash; assets live below the same prefix) ----
  await app.register(fstatic, { root: join(pub, "admin"), prefix: "/admin/", index: false, decorateReply: true, setHeaders: noCache });
  await app.register(async (s) => { await s.register(fstatic, { root: join(pub, "checkin"), prefix: "/checkin/", index: false, decorateReply: false, setHeaders: noCache }); });
  app.get("/admin", async (_req, reply) => reply.header("Cache-Control", "no-cache").sendFile("index.html", join(pub, "admin")));
  app.get("/checkin", async (_req, reply) => reply.header("Cache-Control", "no-cache").sendFile("index.html", join(pub, "checkin")));
  // duplicate spellings (trailing slash, /index.html) redirect to the one canonical address
  for (const [from, to] of [["/admin/", "/admin"], ["/admin/index.html", "/admin"], ["/checkin/", "/checkin"], ["/checkin/index.html", "/checkin"], ["/index.html", "/"], ["/favicon.ico", "/shared/favicon.ico"]] as const)
    app.get(from, async (_req, reply) => reply.redirect(to, 301));

  // ---- shared assets and downloads ----
  await app.register(async (s) => { await s.register(fstatic, { root: join(pub, "shared"), prefix: "/shared/", decorateReply: false, setHeaders: longCache }); });
  await app.register(async (s) => { await s.register(fstatic, { root: join(pub, "downloads"), prefix: "/downloads/", decorateReply: false, setHeaders: (res: any, path: string) => { noCache(res); if (path.endsWith(".apk")) res.header("Content-Disposition", 'attachment; filename="qff-2026.apk"'); } }); });

  // ---- the attendee web app (/attendee): iPhone/iPad only ----
  const attendeeRoot = join(pub, "attendee");
  await app.register(async (s) => {
    s.addHook("onRequest", async (req, reply) => {
      reply.header("Vary", "User-Agent, Sec-CH-UA-Platform");
      const p = detectPlatform(req.headers["user-agent"], req.headers["sec-ch-ua-platform"] as string | undefined);
      if (webAppAllowed(p)) return;
      // Android / desktop: the page, its scripts, fonts and manifest are ALL refused; they only ever get the popup.
      return reply.code(403).header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(gatePage(p === "ios" ? "desktop" : p));
    });
    await s.register(fstatic, { root: attendeeRoot, prefix: "/", index: false, decorateReply: false, setHeaders: (res: any, path: string) => (/\.(ttf|png|svg)$/.test(path) ? longCache(res) : noCache(res)) });
    const shell = async (_req: any, reply: any) => reply.sendFile("index.html", attendeeRoot);
    s.get("/", shell);
    // the app's own screens all load the same shell; /attendee/hub/ and /attendee/index.html collapse to one address; anything else under /attendee goes to the app's front door
    for (const tab of ["hub", "pass", "support"]) { s.get(`/${tab}`, shell); s.get(`/${tab}/`, async (_req, reply) => reply.redirect(`/attendee/${tab}`, 301)); }
    s.get("/index.html", async (_req, reply) => reply.redirect("/attendee", 301));
    s.setNotFoundHandler((req, reply) => (req.method === "GET" && !/\.[a-z0-9]+$/i.test(req.url.split("?")[0]!) ? reply.redirect("/attendee", 302) : reply.code(404).send({ error: "not_found", message: "Not found." })));
  }, { prefix: "/attendee" });

  // ---- landing page at / (last, so it never shadows the sites above) ----
  await app.register(async (s) => { await s.register(fstatic, { root: join(pub, "landing"), prefix: "/", index: ["index.html"], decorateReply: false, setHeaders: noCache }); });
}
