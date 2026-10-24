// Everything the browser loads: the landing page at /, the APK under /downloads, shared fonts/logo, the three sites
// (/admin, /check, /user) and the redirects for older addresses. Only /user is gated by device (iPhone/iPad only).
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fstatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { detectPlatform, gatePage, webAppAllowed } from "../lib/platform.ts";

export async function webRoutes(app: FastifyInstance) {
  const pub = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public");
  /** HTML and scripts always revalidate (cheap 304s), so a new deploy reaches phones at once; big static files are cached. */
  const noCache = (res: any) => res.header("Cache-Control", "no-cache");
  const longCache = (res: any) => res.header("Cache-Control", "public, max-age=86400");

  // ---- staff sites ----
  await app.register(fstatic, { root: join(pub, "admin"), prefix: "/admin/", index: ["index.html"], decorateReply: true, setHeaders: noCache });
  await app.register(async (s) => { await s.register(fstatic, { root: join(pub, "check"), prefix: "/check/", index: ["index.html"], decorateReply: false, setHeaders: noCache }); });
  app.get("/admin", async (_req, reply) => reply.redirect("/admin/"));
  app.get("/check", async (_req, reply) => reply.redirect("/check/"));
  app.get("/scan", async (_req, reply) => reply.redirect("/check/"));
  app.get("/scan/", async (_req, reply) => reply.redirect("/check/"));

  // ---- shared assets and downloads ----
  await app.register(async (s) => { await s.register(fstatic, { root: join(pub, "shared"), prefix: "/shared/", decorateReply: false, setHeaders: longCache }); });
  await app.register(async (s) => { await s.register(fstatic, { root: join(pub, "downloads"), prefix: "/downloads/", decorateReply: false, setHeaders: noCache }); });
  // addresses printed on earlier posters/QR codes keep working
  app.get("/download", async (_req, reply) => reply.redirect("/", 301));
  app.get("/download/", async (_req, reply) => reply.redirect("/", 301));
  app.get("/download/qiskit-fallfest-2026.apk", async (_req, reply) => reply.redirect("/downloads/qff-2026.apk", 301));
  app.get("/download/qiskit-fallfest-2026.apk.sha256", async (_req, reply) => reply.redirect("/downloads/qff-2026.apk.sha256", 301));

  // ---- the attendee web app: iPhone/iPad only ----
  const userRoot = join(pub, "user");
  await app.register(async (s) => {
    s.addHook("onRequest", async (req, reply) => {
      reply.header("Vary", "User-Agent, Sec-CH-UA-Platform");
      const p = detectPlatform(req.headers["user-agent"], req.headers["sec-ch-ua-platform"] as string | undefined);
      if (webAppAllowed(p)) return;
      // Android / desktop: the page, its scripts, fonts and manifest are ALL refused; they only ever get the popup.
      return reply.code(403).header("Cache-Control", "no-store").type("text/html; charset=utf-8").send(gatePage(p === "ios" ? "desktop" : p));
    });
    await s.register(fstatic, { root: userRoot, prefix: "/", index: false, decorateReply: false, setHeaders: (res: any, path: string) => (/\.(ttf|png|svg)$/.test(path) ? longCache(res) : noCache(res)) });
    const shell = async (_req: any, reply: any) => reply.sendFile("index.html", userRoot);
    s.get("/", shell);
    // client-side routes (/user/hub, /user/pass, /user/support, ...) all load the same shell; unknown files are real 404s
    s.setNotFoundHandler((req, reply) => (req.method === "GET" && !/\.[a-z0-9]+$/i.test(req.url.split("?")[0]!) ? shell(req, reply) : reply.code(404).send({ error: "not_found" })));
  }, { prefix: "/user" });

  // ---- landing page at / (last, so it never shadows the sites above) ----
  await app.register(async (s) => { await s.register(fstatic, { root: join(pub, "landing"), prefix: "/", index: ["index.html"], decorateReply: false, setHeaders: noCache }); });
}
