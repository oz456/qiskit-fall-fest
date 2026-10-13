import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fstatic from "@fastify/static";
import Fastify from "fastify";
import { ZodError } from "zod";
import { config, isProd } from "./config.ts";
import type { Db } from "./db.ts";
import { initMail } from "./lib/mail.ts";
import { adminRoutes } from "./routes/admin.ts";
import { checkRoutes } from "./routes/check.ts";
import { appRoutes } from "./routes/app.ts";

export async function buildApp(db: Db) {
  const app = Fastify({
    logger: config.env === "test" ? false : { level: "info", redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"] },
    trustProxy: true, // Cloud Run terminates TLS and forwards the client IP
    bodyLimit: 100_000,
  });

  // Selfie upload: raw JPEG bytes (validated in the route).
  app.addContentTypeParser("image/jpeg", { parseAs: "buffer", bodyLimit: 400_000 }, (_req, body, done) => done(null, body));

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"], mediaSrc: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"], baseUri: ["'none'"],
      },
    },
    strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: false },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginResourcePolicy: { policy: "same-origin" },
  });
  app.addHook("onSend", async (req, reply) => {
    reply.header("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=()");
    if (req.url.startsWith("/v1/") || req.url.startsWith("/admin/api/") || req.url.startsWith("/check/api/")) reply.header("Cache-Control", "no-store");
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 240, timeWindow: "1 minute" });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "invalid_request", message: err.issues[0] ? `${err.issues[0].path.join(".") || "request"}: ${err.issues[0].message}` : "Invalid request" });
    }
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code ?? "bad_request", message: err.message });
    req.log.error({ err: err.message, stack: isProd ? undefined : err.stack }, "unhandled");
    return reply.code(500).send({ error: "server_error", message: "Something went wrong." });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "not_found" }));

  app.get("/ping", { config: { rateLimit: false } }, async () => {
    await db.query("SELECT 1");
    return { ok: true };
  });

  initMail(db);
  appRoutes(app, db);
  adminRoutes(app, db);
  checkRoutes(app, db);

  const pub = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
  const staticOpts = (decorateReply: boolean) => ({ index: ["index.html"], maxAge: "5m", decorateReply, setHeaders: (res: any, p: string) => { if (p.endsWith("index.html")) res.header("Cache-Control", "no-cache"); } });
  await app.register(fstatic, { root: join(pub, "admin"), prefix: "/admin/", ...staticOpts(true) });
  await app.register(async (s) => { await s.register(fstatic, { root: join(pub, "check"), prefix: "/check/", ...staticOpts(false) }); });
  await app.register(async (s) => { await s.register(fstatic, { root: join(pub, "download"), prefix: "/download/", ...staticOpts(false) }); });
  app.get("/download", async (_req, reply) => reply.redirect("/download/"));
  app.get("/", async (_req, reply) => reply.redirect("/admin/"));
  app.get("/admin", async (_req, reply) => reply.redirect("/admin/"));
  app.get("/scan", async (_req, reply) => reply.redirect("/check/"));
  app.get("/scan/", async (_req, reply) => reply.redirect("/check/"));
  app.get("/check", async (_req, reply) => reply.redirect("/check/"));
  return app;
}
