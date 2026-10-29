// Attendee API (/v1), used by the Android app, the iPhone app and the /user web app.
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { config, isProd } from "../config.ts";
import type { Db } from "../db.ts";
import { hmac, otpCode, passPayload, PASS_STEP_SEC, randomToken, sha256, signJwt, verifyJwt } from "../lib/crypto.ts";
import { detectPlatform, webAppAllowed } from "../lib/platform.ts";
import { otpMail, sendMail } from "../lib/mail.ts";
import { sanitizeJpeg, savePhoto } from "../lib/photos.ts";
import { Email, TicketCreate, TicketReply } from "../lib/schemas.ts";
import { eventOut, newTicketCode } from "../lib/util.ts";
import { cgpaMissing, Details, OdInput, detailsOut, Extra, GENDERS, needsExtra, PROGRAMS, SCHOOLS } from "../lib/details.ts";
import { allocate, classifyEmail, isSrmEmail, nameFromEmail } from "../lib/website-sync.ts";
import { appTeamOf, inAppTeam, teamOf, type Team } from "../lib/team.ts";
import { claimName, claimOf, maybeSweep, naming, pushClaim, scopeOf, type Claim, type Naming } from "../lib/team-names.ts";
import { randomBytes } from "node:crypto";

const ACCESS_TTL = 15 * 60;
const REFRESH_TTL_MS = 60 * 24 * 3600 * 1000;
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const CODE_SENT = { ok: true, message: "A 6-digit code is on its way to your email." };

declare module "fastify" { interface FastifyRequest { uid?: string; sid?: string } }

/** The browser app sends this header on every call. Native apps don't, and keep using body tokens exactly as before. */
const isWeb = (req: FastifyRequest) => req.headers["x-qff-client"] === "web";
/** Browsers only ever hand out endpoints on their vendor's push service; anything else would make the server call an arbitrary host. */
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
export function isPushServiceUrl(t: string) { try { const u = new URL(t); return u.protocol === "https:" && (u.port === "" || u.port === "443") && !u.username && PUSH_HOSTS.some((r) => r.test(u.hostname)); } catch { return false; } }
const RT_COOKIE = "qff_rt";
/** The web refresh token lives ONLY in this cookie: HttpOnly (scripts can't read it), SameSite=Strict, and scoped to the auth endpoints. */
const rtCookie = (maxAgeMs: number) => ({ httpOnly: true, secure: isProd, sameSite: "strict" as const, path: "/v1/auth", maxAge: Math.floor(maxAgeMs / 1000) });

export function attendeeRoutes(app: FastifyInstance, db: Db) {
  // Browser calls to the API: only from allowed devices (iPhone/iPad), and never cross-site.
  app.addHook("onRequest", async (req, reply) => {
    if (!isWeb(req) || !req.url.startsWith("/v1/")) return;
    if (!webAppAllowed(detectPlatform(req.headers["user-agent"], req.headers["sec-ch-ua-platform"] as string | undefined))) {
      return reply.code(403).send({ error: "platform_not_supported", message: "The web app isn't available on this device. Android also has its own app: see the downloads page." });
    }
    const origin = req.headers.origin;
    if (origin && req.method !== "GET" && req.method !== "HEAD") { let oh = ""; try { oh = new URL(origin).host; } catch {} if (oh !== req.headers.host) return reply.code(403).send({ error: "origin", message: "Cross-site request refused." }); }
  });

  const otpHash = (email: string, code: string) => hmac(config.otpPepper, `${email}|${code}`).toString("hex");

  // What an outside email is told when it may not sign in: waiting for payment review, payment rejected, or never paid.
  const noAccessReply = async (reply: any, email: string) => {
    const [claim] = await db.query("SELECT status FROM pass_claim_status WHERE email=$1", [email]);
    if (claim?.status === "pending") return reply.code(403).send({ error: "payment_pending", message: "Your pass payment is still under verification. You can sign in as soon as the organisers approve it (usually within a few minutes of approval). If it takes long, contact the organisers with the email you paid with." });
    if (claim?.status === "rejected") return reply.code(403).send({ error: "payment_rejected", message: "Your payment verification failed. Please contact the organisers with the correct email you paid with." });
    return reply.code(404).send({ error: "not_registered", message: "This email can't use the app yet. The app is for SRM University-AP emails (@srmap.edu.in) and for people with a verified ₹99 or ₹499 festival pass. Register on the Fall Fest website (www.qffsrmap2026.com/learning), get your pass, then sign in here with the same email. It works within a few minutes of your pass being verified." });
  };
  // An outside person who came from the website needs a verified pass NOW (a pass that was un-verified later closes the door again; verifying it opens it at the next sync).
  const lacksPass = (u: { source?: string; pass_tier?: string | null } | undefined, email: string) => !!u && !isSrmEmail(email) && u.source === "website" && !u.pass_tier;

  // ---------- auth ----------
  app.post("/v1/auth/request-code", { config: { rateLimit: { max: 400, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const { email } = z.object({ email: Email }).parse(req.body);
    const [user] = await db.query("SELECT id, status, source, pass_tier FROM users WHERE lower(email)=$1", [email]);
    // The attendee list is closed (people register on the website and are synced in), so say plainly when an email isn't on it (otherwise people just wait for a mail that never comes).
    // The route is rate-limited per IP, which bounds how fast the list could be probed.
    // every @srmap.edu.in address may sign in (the account is made when the code is verified, so typing random addresses leaves nothing behind)
    if ((!user && !isSrmEmail(email)) || lacksPass(user, email)) return noAccessReply(reply, email);
    if (user && user.status !== "active") return reply.code(403).send({ error: "account_inactive", message: "This account isn't active. Please contact the organisers." });
    const [{ n }] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM otp_codes WHERE lower(email)=$1 AND created_at > now() - interval '10 minutes'", [email]);
    if (n >= 5) return reply.code(429).send({ error: "too_many_codes", message: "You've requested several codes already. Use the latest one in your inbox (check spam), or try again in 10 minutes." });
    // Budgets that don't depend on the caller's IP: per attendee per day, and for the whole system per hour (keeps the mail quota for real use).
    const [{ d }] = await db.query<{ d: number }>("SELECT count(*)::int AS d FROM otp_codes WHERE lower(email)=$1 AND created_at > now() - interval '24 hours'", [email]);
    const [{ h }] = await db.query<{ h: number }>("SELECT count(*)::int AS h FROM otp_codes WHERE created_at > now() - interval '1 hour'");
    if (d >= 30 || h >= 900) return reply.code(429).send({ error: "too_many_codes", message: "Too many sign-in requests right now. Please try again in a little while." });
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

  app.post("/v1/auth/verify", { config: { rateLimit: { max: 800, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const b = z.object({ email: Email, code: z.string().regex(/^\d{6}$/), deviceId: z.string().min(8).max(100), deviceName: z.string().max(100).optional() }).parse(req.body);
    const bad = () => reply.code(401).send({ error: "invalid_code", message: "That code is incorrect or has expired." });
    // Per-attendee failure budget, independent of the caller's IP: after 10 wrong tries in 10 minutes nothing is accepted until it cools off.
    const [{ fails }] = await db.query<{ fails: number }>("SELECT coalesce(sum(attempts),0)::int AS fails FROM otp_codes WHERE lower(email)=$1 AND created_at > now() - interval '10 minutes'", [b.email]);
    if (fails >= 10) return reply.code(429).send({ error: "too_many_attempts", message: "Too many wrong codes. Wait about 10 minutes, then request a new code." });
    // ONE atomic statement spends an attempt on every live code and returns them: parallel guesses cannot overshoot the per-code limit
    // (the old read-check-then-increment let a burst of requests all pass the check). Any live code of this attendee may match, not just the newest.
    const live = await db.query("UPDATE otp_codes SET attempts = attempts + 1 WHERE lower(email)=$1 AND consumed_at IS NULL AND expires_at > now() AND attempts < $2 RETURNING id, code_hash", [b.email, OTP_MAX_ATTEMPTS]);
    const guess = otpHash(b.email, b.code);
    const otp = live.find((r) => r.code_hash === guess);
    if (!otp) return bad();
    let [user] = await db.query("SELECT * FROM users WHERE lower(email)=$1 AND status='active'", [b.email]);
    if (!user && isSrmEmail(b.email) && !(await db.query("SELECT 1 FROM users WHERE lower(email)=$1", [b.email]))[0]) {
      // first sign-in of an SRM address: the code proved they own the mailbox, so make the account (real name arrives with the next website sync)
      await allocate(db, b.email, nameFromEmail(b.email), "SRM University-AP", classifyEmail(b.email), "srm", true);
      [user] = await db.query("SELECT * FROM users WHERE lower(email)=$1 AND status='active'", [b.email]);
    }
    if (!user || lacksPass(user, b.email)) return bad();

    const refresh = randomToken(32);
    const secret = randomBytes(32); // rotating the pass secret invalidates the previous device's QR
    const sid = await db.tx(async (q) => {
      const used = await q.query("UPDATE otp_codes SET consumed_at = now() WHERE id=$1 AND consumed_at IS NULL RETURNING id", [otp.id]);
      if (!used[0]) return null; // lost a race with another request using the same code
      const ended = await q.query("UPDATE sessions SET revoked_at = now() WHERE user_id=$1 AND revoked_at IS NULL RETURNING id", [user.id]); // one device per account
      if (ended.length) req.log.info({ uid: user.id, ended: ended.length, why: "signed_in_elsewhere" }, "older sessions ended by a new sign-in");
      await q.query("UPDATE users SET pass_secret=$2 WHERE id=$1", [user.id, secret]);
      const [s] = await q.query("INSERT INTO sessions (user_id, refresh_hash, device_id, device_name, expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [user.id, sha256(refresh), b.deviceId, b.deviceName ?? null, new Date(Date.now() + REFRESH_TTL_MS)]);
      return s!.id as string;
    });
    if (!sid) return bad();
    const profile = { name: user.name, email: user.email, college: user.college, passCode: user.pass_code };
    const accessToken = signJwt({ sub: user.id, sid }, config.jwtSecret, ACCESS_TTL);
    if (isWeb(req)) { // browser: refresh token goes into the HttpOnly cookie; the pass secret never leaves the server (see /v1/pass/codes)
      reply.setCookie(RT_COOKIE, refresh, rtCookie(REFRESH_TTL_MS));
      return { accessToken, expiresIn: ACCESS_TTL, profile };
    }
    return { accessToken, expiresIn: ACCESS_TTL, refreshToken: refresh, profile, passSecret: secret.toString("base64") };
  });

  app.post("/v1/auth/refresh", { config: { rateLimit: { max: 1500, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const web = isWeb(req);
    const given = z.object({ refreshToken: z.string().min(20).max(100).optional() }).parse(req.body ?? {}).refreshToken;
    const refreshToken = web ? req.cookies[RT_COOKIE] : given; // browsers: cookie only. Native: body only.
    if (!refreshToken || refreshToken.length < 20 || refreshToken.length > 100) return reply.code(401).send({ error: "invalid_session", message: "Please sign in again." });
    const h = sha256(refreshToken);
    const [s] = await db.query("SELECT * FROM sessions WHERE refresh_hash=$1 OR prev_refresh_hash=$1", [h]);
    const deny = () => { if (web) reply.clearCookie(RT_COOKIE, { path: "/v1/auth" }); return reply.code(401).send({ error: "invalid_session", message: "Please sign in again." }); };
    if (!s || s.revoked_at || new Date(s.expires_at) < new Date()) return deny();
    const replayed = s.refresh_hash !== h;
    if (replayed && Date.now() - new Date(s.last_used_at).getTime() < 20_000) {
      // a retry of a renewal whose answer never arrived (shaky mobile data), or two tabs sharing one cookie: not theft.
      if (web) return { accessToken: signJwt({ sub: s.user_id, sid: s.id }, config.jwtSecret, ACCESS_TTL), expiresIn: ACCESS_TTL };  // the other tab already rotated the cookie
      const [live] = await db.query("SELECT status FROM users WHERE id=$1", [s.user_id]);
      if (!live || live.status !== "active") return deny();
      const again = randomToken(32);   // the app never saw the last new token: hand out a fresh one and keep the old one valid for the next retry
      await db.query("UPDATE sessions SET refresh_hash=$2, prev_refresh_hash=$3, last_used_at=now() WHERE id=$1", [s.id, sha256(again), h]);
      return { accessToken: signJwt({ sub: s.user_id, sid: s.id }, config.jwtSecret, ACCESS_TTL), expiresIn: ACCESS_TTL, refreshToken: again };
    }
    if (replayed) { // an already-rotated token was replayed long after: assume theft, kill the session
      req.log.warn({ uid: s.user_id, sid: s.id, why: "refresh_replay" }, "session ended");
      await db.query("UPDATE sessions SET revoked_at = now() WHERE id=$1", [s.id]);
      return deny();
    }
    const [u] = await db.query("SELECT status FROM users WHERE id=$1", [s.user_id]);
    if (!u || u.status !== "active") return deny();
    const next = randomToken(32);
    await db.query("UPDATE sessions SET prev_refresh_hash=refresh_hash, refresh_hash=$2, last_used_at=now() WHERE id=$1", [s.id, sha256(next)]);
    const accessToken = signJwt({ sub: s.user_id, sid: s.id }, config.jwtSecret, ACCESS_TTL);
    if (web) { reply.setCookie(RT_COOKIE, next, rtCookie(REFRESH_TTL_MS)); return { accessToken, expiresIn: ACCESS_TTL }; }
    return { accessToken, expiresIn: ACCESS_TTL, refreshToken: next };
  });

  // Browser sign-out works even when the 15-minute access token has expired: the refresh cookie alone identifies the session.
  app.post("/v1/auth/web-logout", async (req, reply) => {
    const rt = isWeb(req) ? req.cookies[RT_COOKIE] : undefined;
    if (rt && rt.length >= 20 && rt.length <= 100) await db.query("UPDATE sessions SET revoked_at = now() WHERE (refresh_hash=$1 OR prev_refresh_hash=$1) AND revoked_at IS NULL", [sha256(rt)]);
    reply.clearCookie(RT_COOKIE, { path: "/v1/auth" });
    return { ok: true };
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
      // The selfie is mandatory: until it exists the only things an attendee can do are read their profile, save their details, upload the photo, or sign out.
      if (!/^\/v1\/(me|me\/photo|me\/details|auth\/logout)(\?|$)/.test(req.url)) {
        const [ph] = await db.query("SELECT 1 FROM user_photos WHERE user_id=$1", [req.uid]);
        if (!ph) return reply.code(403).send({ error: "photo_required", message: "Add your selfie to continue." });
      }
    });

    api.post("/v1/auth/logout", async (req, reply) => { await db.query("UPDATE sessions SET revoked_at = now() WHERE id=$1", [req.sid]); reply.clearCookie(RT_COOKIE, { path: "/v1/auth" }); return { ok: true }; });

    // Notifications: the app registers its device token after the attendee opts in. A token belongs to one person at a time.
    api.put("/v1/me/push-token", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
      const b = z.object({ token: z.string().min(20).max(4096), platform: z.enum(["android", "ios", "web"]), apnsEnv: z.enum(["production", "sandbox"]).optional(), p256dh: z.string().max(200).optional(), auth: z.string().max(100).optional() }).parse(req.body);
      if (b.platform === "web" && (!b.p256dh || !b.auth || !isPushServiceUrl(b.token))) return reply.code(400).send({ error: "invalid_request", message: "A web subscription needs an https endpoint and its keys." });
      if (b.platform === "web") await db.query("DELETE FROM push_tokens WHERE user_id=$1 AND platform='web' AND token<>$2 AND token NOT IN (SELECT token FROM push_tokens WHERE user_id=$1 AND platform='web' AND token<>$2 ORDER BY updated_at DESC LIMIT 4)", [req.uid, b.token]);
      await db.query("INSERT INTO push_tokens (token,user_id,platform,apns_env,p256dh,auth) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (token) DO UPDATE SET user_id=$2, platform=$3, apns_env=$4, p256dh=$5, auth=$6, updated_at=now()", [b.token, req.uid, b.platform, b.apnsEnv ?? null, b.p256dh ?? null, b.auth ?? null]);
      return { ok: true };
    });
    // The browser needs the server's public VAPID key to subscribe; 404 = web push not configured (the app then hides the switch).
    api.get("/v1/push/vapid", async (_req, reply) => (config.vapid ? { publicKey: config.vapid.publicKey } : reply.code(404).send({ error: "not_configured", message: "Web notifications aren't set up yet." })));
    api.delete("/v1/me/push-token", async (req) => {
      const { token } = z.object({ token: z.string().min(20).max(4096) }).parse(req.query);
      await db.query("DELETE FROM push_tokens WHERE token=$1 AND user_id=$2", [token, req.uid]);
      return { ok: true };
    });

    api.get("/v1/me", async (req) => {
      const [u] = await db.query("SELECT name,email,college,pass_code,says_srm,ask_details,pass_tier,reg_no,school,semester,course,program,section,gender,cgpa,details_at, EXISTS(SELECT 1 FROM user_photos p WHERE p.user_id=users.id) AS has_photo FROM users WHERE id=$1", [req.uid]);
      const checkins = await db.query(`SELECT c.scope, c.scanned_at, (e.collect_od AND c.od_from IS NULL) AS ask_od
        FROM checkins c LEFT JOIN events e ON c.scope = 'event:' || e.id::text WHERE c.user_id=$1`, [req.uid]);
      // only SRM-AP addresses are asked for academic details, and only until they have been saved once
      const asked = isSrmEmail(u!.email) || u!.says_srm || u!.ask_details;   // SRM address, a personal address that says SRM-AP, or someone an organiser asked
      const needsDetails = asked && !u!.details_at;
      const extra = asked && needsExtra(u!); // saved before section and gender existed: only those two are asked
      const flagship = u!.pass_tier === "flagship" || await inAppTeam(db, req.uid!);
      // what the pass card says: SRM-AP students get the ₹99 pass free; a ₹499 holder shows the ₹499 pass; someone with neither (a guest) just sees "Secure Pass"
      const passType = flagship ? "flagship" : u!.pass_tier === "general" || isSrmEmail(u!.email) || u!.says_srm ? "general" : null;
      return { profile: { name: u!.name, email: u!.email, college: u!.college, passCode: u!.pass_code, hasPhoto: u!.has_photo, flagship, passType, needsDetails, needsExtra: extra, details: detailsOut(u!) },
        ...(needsDetails || extra ? { detailsOptions: { schools: SCHOOLS, programs: PROGRAMS, genders: GENDERS } } : {}),
        checkins: checkins.map((c) => ({ scope: c.scope, at: new Date(c.scanned_at).toISOString(), askOd: c.ask_od === true })) };
    });

    // First sign-in of an SRM-AP person: academic details, saved once. Later changes go through an organiser.
    api.put("/v1/me/details", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (req, reply) => {
      const [u] = await db.query("SELECT email, says_srm, ask_details, details_at, section, gender FROM users WHERE id=$1", [req.uid]);
      if (!isSrmEmail(u!.email) && !u!.says_srm && !u!.ask_details) return reply.code(403).send({ error: "not_needed", message: "These details are only for SRM University-AP students." });
      const b0 = (req.body ?? {}) as Record<string, unknown>;
      if (u!.details_at && needsExtra(u!) && ("section" in b0 || "gender" in b0)) { // earlier details are kept; only the missing section / gender are filled in
        const x = Extra.safeParse(req.body);
        if (!x.success) return reply.code(400).send({ error: "invalid_details", message: x.error.issues[0]?.message ?? "Please check your details.", field: String(x.error.issues[0]?.path[0] ?? "") });
        await db.query("UPDATE users SET section=COALESCE(section,$2), gender=COALESCE(gender,$3) WHERE id=$1", [req.uid, x.data.section, x.data.gender]);
        return { ok: true };
      }
      if (u!.details_at) return reply.code(409).send({ error: "already_set", message: "Your details are already saved. Ask an organiser to change them." });
      const parsed = Details.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "invalid_details", message: parsed.error.issues[0]?.message ?? "Please check your details.", field: String(parsed.error.issues[0]?.path[0] ?? "") });
      const d = parsed.data;
      const miss = cgpaMissing(d); if (miss) return reply.code(400).send({ error: "invalid_details", message: miss, field: "cgpa" });
      try {
        await db.query("UPDATE users SET reg_no=$2, school=$3, semester=$4, course=$5, program=$6, cgpa=$7, section=$8, gender=$9, details_at=now() WHERE id=$1 AND details_at IS NULL", [req.uid, d.regNo, d.school, d.semester, d.course, d.program, d.cgpa, d.section ?? null, d.gender ?? null]);
      } catch (e: any) {
        if (e?.code === "23505") return reply.code(409).send({ error: "reg_no_taken", message: "That registration number is already used by another account. Check it, or contact the organisers.", field: "regNo" });
        throw e;
      }
      return { ok: true };
    });

    // OD details for an event the student was checked in at (only events an organiser ticked "collect OD details" on). Saved once; an organiser can clear a wrong one.
    api.put("/v1/me/od", { config: { rateLimit: { max: 30, timeWindow: "10 minutes" } } }, async (req, reply) => {
      const p = OdInput.safeParse(req.body);
      if (!p.success) return reply.code(400).send({ error: "invalid_od", message: p.error.issues[0]?.message ?? "Please check the times.", field: String(p.error.issues[0]?.path[0] ?? "") });
      const d = p.data;
      const [row] = await db.query("SELECT c.id, c.od_from, e.collect_od FROM checkins c JOIN events e ON c.scope = 'event:' || e.id::text WHERE c.user_id=$1 AND e.id=$2", [req.uid, d.eventId]);
      if (!row) return reply.code(404).send({ error: "not_checked_in", message: "You are not checked in at this event." });
      if (!row.collect_od) return reply.code(400).send({ error: "not_needed", message: "This event does not collect OD details." });
      if (row.od_from) return reply.code(409).send({ error: "already_set", message: "Your OD details are already saved. Ask an organiser to change them." });
      await db.query("UPDATE checkins SET od_from=$2, od_until=$3, od_hours=$4 WHERE id=$1 AND od_from IS NULL", [row.id, d.from, d.until, d.hours]);
      return { ok: true };
    });

    // Hackathon team (flagship pass holders): lead first, then teammates. At the naming time the lead taps "Get my team name" (server picks a free founder-themed name);
    // when the 100 seconds are over, every team still without a name gets one automatically. See lib/team-names.ts.
    const myTeam = async (uid: string): Promise<{ team: Team; key: string } | null> => {
      const own = await appTeamOf(db, uid);
      if (own) return { team: own, key: "app:" + own.id };
      const [u] = await db.query("SELECT email, pass_tier FROM users WHERE id=$1", [uid]);
      if (!u || u.pass_tier !== "flagship") return null;
      const team = await teamOf(u.email);
      return team?.id ? { team, key: team.id } : null;
    };
    const namingFor = (n: Naming, isLeader: boolean, named: boolean) => {
      if (n.phase === "off") return { phase: "off", note: null, canAssign: false };
      if (named) return { phase: n.phase, note: null, canAssign: false };
      if (n.phase === "before") return { phase: "before", note: `Team names are given out at ${n.label}. Every team gets a name inspired by an Indian founder.`, canAssign: false };
      if (n.phase === "open") return { phase: "open", note: isLeader ? "Tap Get my team name now. If you don’t, a name is given to your team automatically in a moment." : "Your team lead is getting the team name now.", canAssign: isLeader };
      return { phase: "closed", note: isLeader ? "Tap Get my team name, or wait a moment: your team is being named." : "Your team is being named. Check back in a moment.", canAssign: isLeader };
    };
    api.get("/v1/me/team", async (req, reply) => {
      let found; try { found = await myTeam(req.uid!); } catch { return reply.code(502).send({ error: "unavailable", message: "Your team couldn't be loaded. Please try again." }); }
      if (!found) return { team: null, naming: { phase: "off", note: null, canAssign: false } };
      void maybeSweep(db);   // the 100 seconds are over: make sure nobody is left without a name
      const n = await naming(db, scopeOf(found.key)), claim = await claimOf(db, found.key);
      const t = found.team;
      return { team: { ...t, name: claim?.name ?? t.name, founder: claim?.founder ?? null }, naming: namingFor(n, t.isLeader, Boolean(claim)) };
    });
    api.post("/v1/me/team/name", { config: { rateLimit: { max: 12, timeWindow: "10 minutes" } } }, async (req, reply) => {
      let found; try { found = await myTeam(req.uid!); } catch { return reply.code(502).send({ error: "unavailable", message: "Your team couldn't be loaded. Please try again." }); }
      if (!found) return reply.code(404).send({ error: "no_team", message: "You are not in a team." });
      if (!found.team.isLeader) return reply.code(403).send({ error: "not_leader", message: "Only the team lead can get the team name." });
      const n = await naming(db, scopeOf(found.key)), view = namingFor(n, true, false);
      let claim: Claim | null | undefined = await claimOf(db, found.key);
      if (!claim) {
        if (view.phase === "off") return reply.code(403).send({ error: "naming_off", message: "Team names are not being given out." });
        if (view.phase === "before") return reply.code(403).send({ error: "not_yet", message: `Team names are given out at ${n.label}.` });
        const [u] = await db.query("SELECT email FROM users WHERE id=$1", [req.uid]);
        claim = await claimName(db, found.key, u?.email ?? null, "tap");
        if (!claim) return reply.code(503).send({ error: "unavailable", message: "Please try again in a moment." });
        void pushClaim(db, claim);   // written to the website in the background; the app already shows it, and the sweep retries if that fails
      }
      return { ok: true, name: claim.name, founder: claim.founder };
    });

    // One selfie per attendee, taken on first sign-in so door staff can match the face to the pass. Only an admin can reset it.
    api.put("/v1/me/photo", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
      const body = req.body as Buffer;
      const clean = Buffer.isBuffer(body) ? sanitizeJpeg(body) : null;
      if (!clean) return reply.code(400).send({ error: "bad_image", message: "That photo couldn't be used. Please try again." });
      if (await savePhoto(db, req.uid!, clean) === "exists") return reply.code(409).send({ error: "already_set", message: "Your photo is already saved. It can't be changed." });
      return { ok: true };
    });

    api.get("/v1/events", async (req) => {
      const rows = await db.query(`
        SELECT e.*,
          EXISTS (SELECT 1 FROM user_events x WHERE x.event_id=e.id AND x.user_id=$1 AND x.kind='saved') AS saved
        FROM events e WHERE e.published ORDER BY e.starts_at, e.title`, [req.uid]);
      const faqs = await db.query("SELECT question, answer FROM faqs ORDER BY position, question");
      const settings = Object.fromEntries((await db.query("SELECT key, value FROM settings")).map((r) => [r.key, r.value]));
      return {
        events: rows.map((r) => eventOut(r, { saved: r.saved })),
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

    // Browser pass: the server computes the codes, so the pass secret never reaches the browser. Returns this 30-second window and the next few
    // (about 5 minutes) so the QR keeps rotating through a patchy connection. serverTime lets the page correct for a wrong phone clock.
    api.get("/v1/pass/codes", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
      const { n } = z.object({ n: z.coerce.number().int().min(1).max(12).default(11) }).parse(req.query);
      const [u] = await db.query("SELECT pass_code, pass_secret FROM users WHERE id=$1", [req.uid]);
      const now = Date.now(); const secret = Buffer.from(u!.pass_secret);
      return { serverTime: now, stepSeconds: PASS_STEP_SEC, codes: Array.from({ length: n }, (_, i) => { const t = now + (i - 1) * PASS_STEP_SEC * 1000; return { step: Math.floor(t / 1000 / PASS_STEP_SEC), payload: passPayload(secret, u!.pass_code, t) }; }) };
    });

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
