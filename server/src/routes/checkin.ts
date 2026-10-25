// Door check-in site (/checkin): separate login, separate API. It can verify passes and read attendance counts — nothing else.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.ts";
import type { Db } from "../db.ts";
import { PASS_STEP_SEC, passMac, safeEqual, signJwt, verifyJwt } from "../lib/crypto.ts";
import { getPhoto } from "../lib/photos.ts";
import { staffAuth } from "../lib/staff.ts";
import { audit, eventDay } from "../lib/util.ts";

const Scope = z.string().regex(/^(day:\d{4}-\d{2}-\d{2}|event:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);

export function checkinRoutes(app: FastifyInstance, db: Db) {
  const { guard, common } = staffAuth(app, db, { name: "check", base: "/checkin", user: config.checkUser, password: config.checkPassword, hash: config.checkPasswordHash, accounts: config.checkAccounts, loginLimit: 40, ttlSec: 12 * 3600 });

  app.register(async (api) => {
    api.addHook("preHandler", guard);
    common(api);

    api.get("/checkin/api/scopes", async () => {
      // Entry days = every day of the festival window (admin setting) ∪ every day any event touches, so a gate can be scanned
      // on a day even before sessions for it are entered.
      const set = new Set<string>();
      const addRange = (a: string, b: string) => { for (let t = Date.parse(a + "T00:00:00Z"); t <= Date.parse(b + "T00:00:00Z") && set.size < 90; t += 86400_000) set.add(new Date(t).toISOString().slice(0, 10)); };
      const [r] = await db.query("SELECT min(starts_at) AS a, max(ends_at) AS b FROM events WHERE published");
      if (r?.a && r?.b) addRange(eventDay(new Date(r.a)), eventDay(new Date(r.b)));
      const st = Object.fromEntries((await db.query("SELECT key, value FROM settings WHERE key IN ('fest_start','fest_end')")).map((x) => [x.key, x.value]));
      if (/^\d{4}-\d{2}-\d{2}$/.test(st.fest_start ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(st.fest_end ?? "")) addRange(st.fest_start, st.fest_end);
      const days = [...set].sort();
      const events = await db.query("SELECT id,title,starts_at,ends_at FROM events WHERE published ORDER BY starts_at, title");
      const today = eventDay();
      const defaultDay = days.includes(today) ? today : days.find((d) => d > today) ?? days.at(-1) ?? today;
      return { today, defaultScope: `day:${defaultDay}`, days, events: events.map((e) => ({ id: e.id, title: e.title })) };
    });

    api.get("/checkin/api/stats", async (req) => {
      const { scope } = z.object({ scope: Scope }).parse(req.query);
      const [c] = await db.query("SELECT count(*)::int AS n FROM checkins WHERE scope=$1", [scope]);
      const [t] = await db.query("SELECT count(*)::int AS n FROM users WHERE status='active'");
      const recent = await db.query("SELECT u.name, u.college, u.pass_code, c.scanned_at FROM checkins c JOIN users u ON u.id=c.user_id WHERE c.scope=$1 ORDER BY c.scanned_at DESC LIMIT 12", [scope]);
      return { count: c!.n, total: t!.n, recent: recent.map((r) => ({ name: r.name, college: r.college, passCode: r.pass_code, at: new Date(r.scanned_at).toISOString() })) };
    });

    // Scanning only VERIFIES the pass. The door volunteer compares the face with the attendee's selfie, then confirms or rejects;
    // the check-in is recorded on confirm. The short-lived ticket binds that decision to this attendee and scope.
    api.post("/checkin/api/scan", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
      const b = z.object({ payload: z.string().max(200), scope: Scope }).parse(req.body);
      const m = /^QFF1\.([A-Z0-9-]{4,20})\.(\d{1,12})\.([A-Za-z0-9_-]{12})$/.exec(b.payload.trim());
      if (!m) return { result: "invalid", message: "Not a Fall Fest pass." };
      const [, code, stepStr, mac] = m as unknown as [string, string, string, string];
      const [u] = await db.query("SELECT id,name,college,pass_code,pass_secret,status, EXISTS(SELECT 1 FROM user_photos p WHERE p.user_id=users.id) AS has_photo FROM users WHERE pass_code=$1", [code]);
      if (!u) return { result: "invalid", message: "Unknown pass." };
      const step = Number(stepStr); const nowStep = Math.floor(Date.now() / 1000 / PASS_STEP_SEC);
      const who = { name: u.name, college: u.college, passCode: u.pass_code, hasPhoto: u.has_photo };
      if (!safeEqual(mac, passMac(Buffer.from(u.pass_secret), code, step))) return { result: "invalid", message: "Pass signature is wrong. Possibly an old or forwarded code.", who: { ...who, hasPhoto: false } };
      if (Math.abs(nowStep - step) > 1) return { result: "expired", message: "This QR is stale (a screenshot?). Ask the attendee to open the live pass.", who: { ...who, hasPhoto: false } };
      if (u.status !== "active") return { result: "blocked", message: "This pass is blocked.", who: { ...who, hasPhoto: false } };
      return verdict(u, b.scope);
    });

    // Shared by the QR scan and the manual lookup. There is no event registration: anyone with a pass can be checked in to any event.
    async function verdict(u: any, scope: string, manual = false) {
      const who = { name: u.name, college: u.college, passCode: u.pass_code, hasPhoto: u.has_photo };
      const ticket = signJwt({ aud: "check-ticket", uid: u.id, scope }, config.sessionSecret, 120);
      const [prev] = await db.query("SELECT scanned_at FROM checkins WHERE user_id=$1 AND scope=$2", [u.id, scope]);
      if (prev) return { result: "duplicate", message: "Already checked in.", at: new Date(prev.scanned_at).toISOString(), who, ticket };
      const warnings: string[] = [];
      if (manual) warnings.push("Found by search, no QR was scanned. Compare the face with the selfie carefully.");
      if (!u.has_photo) warnings.push("No selfie on file yet.");
      return { result: "verify", message: "Check the face, then confirm.", warning: warnings.join(" ") || undefined, who, ticket };
    }

    // Phone dead or screen cracked: find the person by name, pass code or email, then go through the same face check.
    api.get("/checkin/api/lookup", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
      const { q } = z.object({ q: z.string().trim().min(3).max(80) }).parse(req.query);
      const like = `%${q.replace(/[%_\\]/g, "\\$&").toLowerCase()}%`;
      const rows = await db.query("SELECT u.id,u.name,u.college,u.pass_code,u.status, EXISTS(SELECT 1 FROM user_photos p WHERE p.user_id=u.id) AS has_photo FROM users u WHERE lower(u.name) LIKE $1 OR lower(u.pass_code) LIKE $1 OR lower(u.email) LIKE $1 ORDER BY u.name LIMIT 8", [like]);
      return rows.map((r) => ({ id: r.id, name: r.name, college: r.college, passCode: r.pass_code, hasPhoto: r.has_photo, blocked: r.status !== "active" }));
    });
    api.post("/checkin/api/scan-manual", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req) => {
      const b = z.object({ userId: z.string().uuid(), scope: Scope }).parse(req.body);
      const [u] = await db.query("SELECT id,name,college,pass_code,status, EXISTS(SELECT 1 FROM user_photos p WHERE p.user_id=users.id) AS has_photo FROM users WHERE id=$1", [b.userId]);
      if (!u) return { result: "invalid", message: "Unknown person." };
      await audit(db, req, "check.manual_lookup", "user", u.id, { scope: b.scope });
      if (u.status !== "active") return { result: "blocked", message: "This pass is blocked.", who: { name: u.name, college: u.college, passCode: u.pass_code, hasPhoto: false } };
      return verdict(u, b.scope, true);
    });

    const ticketOf = (t: string) => { const c = verifyJwt<{ aud: string; uid: string; scope: string }>(t, config.sessionSecret); return c && c.aud === "check-ticket" ? c : null; };

    api.post("/checkin/api/confirm", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
      const b = z.object({ ticket: z.string().max(1000), decision: z.enum(["confirm", "reject"]) }).parse(req.body);
      const t = ticketOf(b.ticket);
      if (!t) return reply.code(400).send({ result: "expired", message: "That scan timed out. Scan the pass again." });
      if (b.decision === "reject") { await audit(db, req, "check.rejected", "user", t.uid, { scope: t.scope }); return { result: "rejected", message: "Entry rejected." }; }
      const ins = await db.query("INSERT INTO checkins (user_id,scope) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING scanned_at", [t.uid, t.scope]);
      if (!ins[0]) return { result: "duplicate", message: "Already checked in." };
      return { result: "ok", message: "Checked in." };
    });

    api.get("/checkin/api/photo", async (req, reply) => {
      const { ticket } = z.object({ ticket: z.string().max(1000) }).parse(req.query);
      const t = ticketOf(ticket);
      const img = t ? await getPhoto(db, t.uid) : null;
      if (!img) return reply.code(404).send({ error: "not_found" });
      return reply.header("Content-Type", "image/jpeg").header("Cache-Control", "no-store").send(img);
    });
  });
}
