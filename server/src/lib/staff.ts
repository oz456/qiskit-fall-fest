// Shared login/session/CSRF machinery for the two staff-facing sites: /admin (full control) and /check (door scanning).
// Each site has its OWN credentials (env), cookie, cookie path, CSRF token and JWT audience, so a scanner login can never reach admin data.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config, isProd } from "../config.ts";
import type { Db } from "../db.ts";
import { randomToken, safeEqual, signJwt, verifyJwt, verifyPasswordHash } from "./crypto.ts";
import { audit } from "./util.ts";

export interface StaffCfg {
  name: "admin" | "check";
  user: string;
  password?: string;
  hash?: string;
  ttlSec: number;
}

export function staffAuth(app: FastifyInstance, db: Db, cfg: StaffCfg) {
  const cookie = `qff_${cfg.name}`;
  const base = `/${cfg.name}`;
  const claims = (req: FastifyRequest) => {
    const t = req.cookies[cookie];
    const c = t ? verifyJwt<{ aud: string; csrf: string }>(t, config.sessionSecret) : null;
    return c && c.aud === cfg.name ? c : null;
  };
  const credsOk = (user: string, pass: string) => {
    const userOk = safeEqual(user, cfg.user);
    const passOk = cfg.hash ? verifyPasswordHash(pass, cfg.hash) : safeEqual(pass, cfg.password ?? "\u0000none");
    return userOk && passOk; // evaluate both so timing doesn't reveal which was wrong
  };

  app.post(`${base}/api/login`, { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const b = z.object({ username: z.string().max(200), password: z.string().max(500) }).parse(req.body);
    if (!credsOk(b.username, b.password)) {
      await db.query("INSERT INTO audit_log (action, ip) VALUES ($1, $2)", [`${cfg.name}.login_failed`, req.ip]);
      await new Promise((r) => setTimeout(r, 400));
      return reply.code(401).send({ error: "invalid_credentials", message: "Incorrect username or password." });
    }
    const csrf = randomToken(24);
    reply.setCookie(cookie, signJwt({ aud: cfg.name, csrf }, config.sessionSecret, cfg.ttlSec), {
      httpOnly: true, secure: isProd, sameSite: "strict", path: base, maxAge: cfg.ttlSec,
    });
    await audit(db, req, `${cfg.name}.login`);
    return { ok: true, csrf };
  });

  /** preHandler for every authenticated route of this site. */
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.url.startsWith(`${base}/api/login`)) return;
    const c = claims(req);
    if (!c) return reply.code(401).send({ error: "unauthorized" });
    if (req.method !== "GET" && req.method !== "HEAD") {
      const h = req.headers["x-csrf-token"];
      if (typeof h !== "string" || !safeEqual(h, c.csrf)) return reply.code(403).send({ error: "csrf" });
      const origin = req.headers.origin;
      if (isProd && origin && config.publicUrl && origin !== new URL(config.publicUrl).origin) return reply.code(403).send({ error: "origin" });
    }
    (req as any).csrf = c.csrf;
  };

  const common = (api: FastifyInstance) => {
    api.get(`${base}/api/me`, async (req) => ({ user: cfg.user, csrf: (req as any).csrf, tz: config.tz }));
    api.post(`${base}/api/logout`, async (req, reply) => { reply.clearCookie(cookie, { path: base }); await audit(db, req, `${cfg.name}.logout`); return { ok: true }; });
  };
  return { guard, common };
}
