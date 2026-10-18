// Public API consumed by the mobile apps. All routes are under /v1.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../config.ts";
import type { Db } from "../db.ts";
import { hmac, otpCode, passPayload, randomToken, sha256, signJwt, verifyJwt } from "../lib/crypto.ts";
import { otpMail, sendMail } from "../lib/mail.ts";
import { looksLikeJpeg, savePhoto } from "../lib/photos.ts";
import { Email, TicketCreate, TicketReply } from "../lib/schemas.ts";
import { eventOut, newTicketCode } from "../lib/util.ts";
import { randomBytes } from "node:crypto";

const ACCESS_TTL = 15 * 60;
const REFRESH_TTL_MS = 60 * 24 * 3600 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const CODE_SENT = { ok: true, message: "A 6-digit code is on its way to your email." };

declare module "fastify" { interface FastifyRequest { uid?: string; sid?: string } }

export function appRoutes(app: FastifyInstance, db: Db) {
  const otpHash = (email: string, code: string) => hmac(config.otpPepper, `${email}|${code}`).toString("hex");

  // ---------- auth ----------
  app.post("/v1/auth/request-code", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const { email } = z.object({ email: Email }).parse(req.body);
    const [user] = await db.query("SELECT id, status FROM users WHERE lower(email)=$1", [email]);
    // The attendee list is closed and pre-registered, so say plainly when an email isn't on it (otherwise people just wait for a mail that never comes).
    // The route is rate-limited per IP, which bounds how fast the list could be probed.
    if (!user) return reply.code(404).send({ error: "not_registered", message: "This email isn't on the attendee list. Use the exact email you registered with." });
    if (user.status !== "active") return reply.code(403).send({ error: "account_inactive", message: "This account isn't active. Please contact the organisers." });
    const [{ n }] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM otp_codes WHERE lower(email)=$1 AND created_at > now() - interval '10 minutes'", [email]);
    if (n >= 3) return reply.code(429).send({ error: "too_many_codes", message: "You've requested several codes already. Use the latest one in your inbox (check spam), or try again in 10 minutes." });
    const code = otpCode();
    const [row] = await db.query<{ id: string }>("INSERT INTO otp_codes (email, code_hash, expires_at) VALUES ($1,$2,$3) RETURNING id", [email, otpHash(email, code), new Date(Date.now() + OTP_TTL_MS)]);
    try { await sendMail(otpMail(email, code)); }
    catch (e: any) {
      req.log.error({ err: e.message }, "otp mail failed");
      await db.query("DELETE FROM otp_codes WHERE id=$1", [row.id]).catch(() => {}); // a failed send must not burn one of the 3 attempts
      return reply.code(503).send({ error: "mail_failed", message: "We couldn't send the email right now. Please try again in a minute." });
    }
    // Opportunistic cleanup of stale rows.
    db.query("DELETE FROM otp_codes WHERE expires_at < now() - interval '1 day'").catch(() => {});
    return CODE_SENT;
  });

  app.post("/v1/auth/verify", { config: { rateLimit: { max: 15, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const b = z.object({ email: Email, code: z.string().regex(/^\d{6}$/), deviceId: z.string().min(8).max(100), deviceName: z.string().max(100).optional() }).parse(req.body);
    const bad = () => reply.code(401).send({ error: "invalid_code", message: "That code is incorrect or has expired." });
    const [otp] = await db.query(
      "SELECT * FROM otp_codes WHERE lower(email)=$1 AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1", [b.email]);
    if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) return bad();
    await db.query("UPDATE otp_codes SET attempts = attempts + 1 WHERE id=$1", [otp.id]);
    if (otp.code_hash !== otpHash(b.email, b.code)) return bad();
    const [user] = await db.query("SELECT * FROM users WHERE lower(email)=$1 AND status='active'", [b.email]);
    if (!user) return bad();

    const refresh = randomToken(32);
    const secret = randomBytes(32); // rotating the pass secret invalidates the previous device's QR
    const sid = await db.tx(async (q) => {
      await q.query("UPDATE otp_codes SET consumed_at = now() WHERE id=$1", [otp.id]);
      await q.query("UPDATE sessions SET revoked_at = now() WHERE user_id=$1 AND revoked_at IS NULL", [user.id]); // one device per account
      await q.query("UPDATE users SET pass_secret=$2 WHERE id=$1", [user.id, secret]);
      const [s] = await q.query("INSERT INTO sessions (user_id, refresh_hash, device_id, device_name, expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [user.id, sha256(refresh), b.deviceId, b.deviceName ?? null, new Date(Date.now() + REFRESH_TTL_MS)]);
      return s!.id as string;
    });
    return {
      accessToken: signJwt({ sub: user.id, sid }, config.jwtSecret, ACCESS_TTL), expiresIn: ACCESS_TTL, refreshToken: refresh,
      profile: { name: user.name, email: user.email, college: user.college, passCode: user.pass_code },
      passSecret: secret.toString("base64"),
    };
  });

  app.post("/v1/auth/refresh", { config: { rateLimit: { max: 60, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const { refreshToken } = z.object({ refreshToken: z.string().min(20).max(100) }).parse(req.body);
    const h = sha256(refreshToken);
    const [s] = await db.query("SELECT * FROM sessions WHERE refresh_hash=$1 OR prev_refresh_hash=$1", [h]);
    const deny = () => reply.code(401).send({ error: "invalid_session", message: "Please sign in again." });
    if (!s || s.revoked_at || new Date(s.expires_at) < new Date()) return deny();
    if (s.refresh_hash !== h) { // an already-rotated token was replayed: assume theft, kill the session
      await db.query("UPDATE sessions SET revoked_at = now() WHERE id=$1", [s.id]);
      return deny();
    }
    const [u] = await db.query("SELECT status FROM users WHERE id=$1", [s.user_id]);
    if (!u || u.status !== "active") return deny();
    const next = randomToken(32);
    await db.query("UPDATE sessions SET prev_refresh_hash=refresh_hash, refresh_hash=$2, last_used_at=now() WHERE id=$1", [s.id, sha256(next)]);
    return { accessToken: signJwt({ sub: s.user_id, sid: s.id }, config.jwtSecret, ACCESS_TTL), expiresIn: ACCESS_TTL, refreshToken: next };
  });

  // ---------- authenticated ----------
  app.register(async (api) => {
    api.addHook("preHandler", async (req: FastifyRequest, reply) => {
      const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? "");
      const p = m && verifyJwt<{ sub: string; sid: string }>(m[1]!, config.jwtSecret);
      if (!p) return reply.code(401).send({ error: "unauthorized" });
      const [s] = await db.query("SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status='active'", [p.sid]);
      if (!s) return reply.code(401).send({ error: "unauthorized" });
      req.uid = p.sub; req.sid = p.sid;
      // The selfie is mandatory: until it exists the only things an attendee can do are read their profile, upload the photo, or sign out.
      if (!/^\/v1\/(me|me\/photo|auth\/logout)(\?|$)/.test(req.url)) {
        const [ph] = await db.query("SELECT 1 FROM user_photos WHERE user_id=$1", [req.uid]);
        if (!ph) return reply.code(403).send({ error: "photo_required", message: "Add your selfie to continue." });
      }
    });

    api.post("/v1/auth/logout", async (req) => { await db.query("UPDATE sessions SET revoked_at = now() WHERE id=$1", [req.sid]); return { ok: true }; });

    api.get("/v1/me", async (req) => {
      const [u] = await db.query("SELECT name,email,college,pass_code, EXISTS(SELECT 1 FROM user_photos p WHERE p.user_id=users.id) AS has_photo FROM users WHERE id=$1", [req.uid]);
      const checkins = await db.query("SELECT scope, scanned_at FROM checkins WHERE user_id=$1", [req.uid]);
      return { profile: { name: u!.name, email: u!.email, college: u!.college, passCode: u!.pass_code, hasPhoto: u!.has_photo }, checkins: checkins.map((c) => ({ scope: c.scope, at: new Date(c.scanned_at).toISOString() })) };
    });

    // One selfie per attendee, taken on first sign-in so door staff can match the face to the pass. Only an admin can reset it.
    api.put("/v1/me/photo", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || !looksLikeJpeg(body)) return reply.code(400).send({ error: "bad_image", message: "That photo couldn't be used. Please try again." });
      if (await savePhoto(db, req.uid!, body) === "exists") return reply.code(409).send({ error: "already_set", message: "Your photo is already saved. It can't be changed." });
      return { ok: true };
    });

    api.get("/v1/events", async (req) => {
      const rows = await db.query(`
        SELECT e.*,
          (SELECT count(*)::int FROM user_events r WHERE r.event_id=e.id AND r.kind='registered') AS registered_count,
          EXISTS (SELECT 1 FROM user_events x WHERE x.event_id=e.id AND x.user_id=$1 AND x.kind='saved') AS saved,
          (EXISTS (SELECT 1 FROM user_events x WHERE x.event_id=e.id AND x.user_id=$1 AND x.kind='registered') OR EXISTS (SELECT 1 FROM checkins c WHERE c.user_id=$1 AND c.scope = 'event:' || e.id::text)) AS registered
        FROM events e WHERE e.published ORDER BY e.starts_at, e.title`, [req.uid]);
      const faqs = await db.query("SELECT question, answer FROM faqs ORDER BY position, question");
      const settings = Object.fromEntries((await db.query("SELECT key, value FROM settings")).map((r) => [r.key, r.value]));
      return {
        events: rows.map((r) => eventOut(r, { saved: r.saved, registered: r.registered, spotsLeft: r.capacity == null ? null : Math.max(0, r.capacity - r.registered_count) })),
        faqs: faqs.map((f) => ({ q: f.question, a: f.answer })), settings,
      };
    });

    const EventId = z.object({ id: z.string().uuid() });
    api.put("/v1/events/:id/saved", async (req) => {
      const { id } = EventId.parse(req.params);
      await db.query("INSERT INTO user_events (user_id,event_id,kind) SELECT $1,id,'saved' FROM events WHERE id=$2 AND published ON CONFLICT DO NOTHING", [req.uid, id]);
      return { ok: true };
    });
    api.delete("/v1/events/:id/saved", async (req) => {
      const { id } = EventId.parse(req.params);
      await db.query("DELETE FROM user_events WHERE user_id=$1 AND event_id=$2 AND kind='saved'", [req.uid, id]);
      return { ok: true };
    });
    api.get("/v1/announcements", async () =>
      (await db.query("SELECT id,title,body,created_at FROM announcements ORDER BY created_at DESC LIMIT 50"))
        .map((a) => ({ id: a.id, title: a.title, body: a.body, createdAt: new Date(a.created_at).toISOString() })));

    // Server-rendered current QR payload (also computable offline by the app from passSecret).
    api.get("/v1/pass/current", async (req) => {
      const [u] = await db.query("SELECT pass_code, pass_secret FROM users WHERE id=$1", [req.uid]);
      return { payload: passPayload(Buffer.from(u!.pass_secret), u!.pass_code), serverTime: Date.now() };
    });

    // ---------- support ----------
    api.get("/v1/tickets", async (req) => {
      const t = await db.query("SELECT * FROM tickets WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [req.uid]);
      if (!t.length) return [];
      const msgs = await db.query("SELECT ticket_id, author, body, created_at FROM ticket_messages WHERE ticket_id = ANY($1::uuid[]) ORDER BY created_at", [t.map((x) => x.id)]);
      return t.map((x) => ({
        id: x.id, code: x.code, kind: x.kind, topic: x.topic, status: x.status, createdAt: new Date(x.created_at).toISOString(),
        messages: msgs.filter((m) => m.ticket_id === x.id).map((m) => ({ author: m.author, body: m.body, at: new Date(m.created_at).toISOString() })),
      }));
    });
    api.post("/v1/tickets", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
      const b = TicketCreate.parse(req.body);
      for (let i = 0; i < 5; i++) {
        try {
          const t = await db.tx(async (q) => {
            const [row] = await q.query("INSERT INTO tickets (code,user_id,kind,topic) VALUES ($1,$2,$3,$4) RETURNING id, code, created_at", [newTicketCode(), req.uid, b.kind, b.topic]);
            await q.query("INSERT INTO ticket_messages (ticket_id,author,body) VALUES ($1,'user',$2)", [row!.id, b.message]);
            return row!;
          });
          return reply.code(201).send({ id: t.id, code: t.code });
        } catch (e: any) { if (!String(e.message).includes("tickets_code_key") && e.code !== "23505") throw e; }
      }
      return reply.code(500).send({ error: "try_again" });
    });
    api.post("/v1/tickets/:id/messages", { config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (req, reply) => {
      const { id } = EventId.parse(req.params);
      const { body } = TicketReply.parse(req.body);
      const [t] = await db.query("SELECT id FROM tickets WHERE id=$1 AND user_id=$2", [id, req.uid]);
      if (!t) return reply.code(404).send({ error: "not_found" });
      await db.query("INSERT INTO ticket_messages (ticket_id,author,body) VALUES ($1,'user',$2)", [id, body]);
      await db.query("UPDATE tickets SET updated_at=now(), status = CASE WHEN status='resolved' THEN 'open' ELSE status END WHERE id=$1", [id]);
      return { ok: true };
    });
  });
}
