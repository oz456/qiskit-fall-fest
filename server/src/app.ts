import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import { config, isProd } from "./config.ts";
import type { Db } from "./db.ts";
import { initMail } from "./lib/mail.ts";
import { adminRoutes } from "./routes/admin.ts";
import { checkRoutes } from "./routes/check.ts";
import { attendeeRoutes } from "./routes/attendee.ts";
import { webRoutes } from "./routes/web.ts";

export async function buildApp(db: Db) {
  const app = Fastify({
    logger: config.env === "test" ? false : {
      level: "info", redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
      // never log query strings: the scanner's short-lived photo ticket travels in one
      serializers: { req: (r) => ({ method: r.method, url: String(r.url).split("?")[0], host: r.host, remoteAddress: r.ip }) },
    },
    // Cloud Run appends the REAL client address to X-Forwarded-For; anything to its left is attacker-controlled. Trust exactly one hop
    // (that appended entry). `true` trusted the leftmost value, which let anyone dodge every rate limit by spoofing the header.
    trustProxy: (_addr: string, hop: number) => hop === 0, // exactly one trusted hop
    bodyLimit: 100_000,
  });

  // Android labels a body-less PUT/POST as a web form. An EMPTY body in any other content type is harmless, so accept it (this was the
  // root cause of "couldn't save"); a non-empty unknown type is still refused.
  app.addContentTypeParser("*", { parseAs: "string" }, (_req, body, done) => {
    if (!body) return done(null, {});
    const err: Error & { statusCode?: number } = new Error("Unsupported media type"); err.statusCode = 415; done(err);
  });
  // Selfie upload: raw JPEG bytes (validated in the route).
  app.addContentTypeParser("image/jpeg", { parseAs: "buffer", bodyLimit: 400_000 }, (_req, body, done) => done(null, body));

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"], fontSrc: ["'self'"], mediaSrc: ["'self'", "blob:"], workerSrc: ["'self'"], manifestSrc: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"], baseUri: ["'none'"],
      },
    },
    strictTransportSecurity: { maxAge: 63072000, includeSubDomains: true, preload: false },
    referrerPolicy: { policy: "no-referrer" },
    crossOriginResourcePolicy: { policy: "same-origin" },
  });
  app.addHook("onSend", async (req, reply) => {
    reply.header("Permissions-Policy", "camera=(self), microphone=(), geolocation=(), payment=()");
    if (/^\/(user|admin|check|v1)(\/|$)/.test(req.url)) reply.header("X-Robots-Tag", "noindex, nofollow"); // only the landing page is public
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

  let pingOkUntil = 0; // the uptime probe must not be able to hammer the DB pool: re-check at most every 5 s
  app.get("/ping", { config: { rateLimit: false } }, async () => {
    if (Date.now() > pingOkUntil) { await db.query("SELECT 1"); pingOkUntil = Date.now() + 5000; }
    return { ok: true };
  });

  initMail(db);
  attendeeRoutes(app, db);
  adminRoutes(app, db);
  checkRoutes(app, db);

  await webRoutes(app);
  return app;
}
