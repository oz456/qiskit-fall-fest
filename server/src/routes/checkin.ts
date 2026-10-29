// Door check-in site (/checkin): separate login, separate API. It can verify passes and read attendance counts — nothing else.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.ts";
import type { Db } from "../db.ts";
import { PASS_STEP_SEC, passMac, safeEqual, signJwt, verifyJwt } from "../lib/crypto.ts";
import { getPhoto } from "../lib/photos.ts";
import { staffAuth } from "../lib/staff.ts";
import { audit, eventDay } from "../lib/util.ts";
import { isSrmEmail } from "../lib/website-sync.ts";
import { devicesForUser, pushInBackground } from "../lib/push.ts";

const Scope = z.string().regex(/^(day:\d{4}-\d{2}-\d{2}|event:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);

export function checkinRoutes(app: FastifyInstance, db: Db) {
  const { guard, common } = staffAuth(app, db, { name: "check", base: "/checkin", user: config.checkUser, password: config.checkPassword, hash: config.checkPasswordHash, accounts: config.checkAccounts, loginLimit: 40, ttlSec: 12 * 3600 });

  app.register(async (api) => {
    api.addHook("preHandler", guard);
    common(api);

    // Temporary switch (admin, Content): door scanners only offer events that ask for OD details, e.g. Hackathon Day 1 and Day 2. On unless set to "off" in the admin.
    const odOnly = async () => { const [r] = await db.query("SELECT value FROM settings WHERE key='scan_od_only'"); return r ? r.value === "on" : process.env.NODE_ENV !== "test"; };   // unset = on (the older tests, which scan days and any event, leave it unset)
    api.get("/checkin/api/scopes", async () => {
      if (await odOnly()) {
        const od = await db.query("SELECT id,title,starts_at,ends_at FROM events WHERE published AND collect_od ORDER BY starts_at, title");
        const now = Date.now();
        const pick = od.find((e) => new Date(e.starts_at).getTime() <= now && now < new Date(e.ends_at).getTime()) ?? od.find((e) => new Date(e.starts_at).getTime() > now) ?? od.at(-1);
        return { today: eventDay(), defaultScope: pick ? `event:${pick.id}` : "", days: [], odOnly: true, events: od.map((e) => ({ id: e.id, title: e.title })) };
      }
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
      if (await odOnly() && !(await collectsOd(b.scope))) return { result: "invalid", message: "Scanning is only open for the Hackathon days right now. Pick one of them at the top." };
      const [u] = await db.query("SELECT id,email,name,college,pass_code,pass_secret,status,says_srm,ask_details,details_at,section,gender, EXISTS(SELECT 1 FROM user_photos p WHERE p.user_id=users.id) AS has_photo FROM users WHERE pass_code=$1", [code]);
      if (!u) return { result: "invalid", message: "Unknown pass." };
      const step = Number(stepStr); const nowStep = Math.floor(Date.now() / 1000 / PASS_STEP_SEC);
      const who = { name: u.name, college: u.college, passCode: u.pass_code, hasPhoto: u.has_photo };
      if (!safeEqual(mac, passMac(Buffer.from(u.pass_secret), code, step))) return { result: "invalid", message: "Pass signature is wrong. Possibly an old or forwarded code.", who: { ...who, hasPhoto: false } };
      if (Math.abs(nowStep - step) > 1) return { result: "expired", message: "This QR is stale (a screenshot?). Ask the attendee to open the live pass.", who: { ...who, hasPhoto: false } };
      if (u.status !== "active") return { result: "blocked", message: "This pass is blocked.", who: { ...who, hasPhoto: false } };
      return verdict(u, b.scope);
    });

    // There is no event registration: anyone with a pass can be checked in to any event. There is deliberately no search-and-check-in: a live QR is the only way in.
    /** Only events an organiser ticked "collect OD details" on ask for them; campus entry and every other event never do. */
    const collectsOd = async (scope: string) => {
      if (!scope.startsWith("event:")) return false;
      const [e] = await db.query("SELECT collect_od FROM events WHERE id=$1", [scope.slice(6)]);
      return !!e?.collect_od;
    };
    async function verdict(u: any, scope: string) {
      const who = { name: u.name, college: u.college, passCode: u.pass_code, hasPhoto: u.has_photo };
      const ticket = signJwt({ aud: "check-ticket", uid: u.id, scope }, config.sessionSecret, 120);
      const [prev] = await db.query("SELECT scanned_at FROM checkins WHERE user_id=$1 AND scope=$2", [u.id, scope]);
      if (prev) return { result: "duplicate", message: "Already checked in.", at: new Date(prev.scanned_at).toISOString(), who, ticket };
      const warnings: string[] = [];
      if (!u.has_photo) warnings.push("No selfie on file yet.");
      // SRM-AP students must give their academic details in the app; the volunteer can remind them
      if ((isSrmEmail(u.email) || u.says_srm || u.ask_details) && (!u.details_at || !u.section || !u.gender)) warnings.push("Academic details not filled in yet: ask them to open the app (or the web app) and complete them.");
      const collectOd = await collectsOd(scope);
      return { result: "verify", message: "Check the face, then confirm.", warning: warnings.join(" ") || undefined, who, ticket, collectOd };
    }

    const ticketOf = (t: string) => { const c = verifyJwt<{ aud: string; uid: string; scope: string }>(t, config.sessionSecret); return c && c.aud === "check-ticket" ? c : null; };

    api.post("/checkin/api/confirm", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
      const b = z.object({ ticket: z.string().max(1000), decision: z.enum(["confirm", "reject"]) }).parse(req.body);
      const t = ticketOf(b.ticket);
      if (!t) return reply.code(400).send({ result: "expired", message: "That scan timed out. Scan the pass again." });
      if (b.decision === "reject") { await audit(db, req, "check.rejected", "user", t.uid, { scope: t.scope }); return { result: "rejected", message: "Entry rejected." }; }
      const ins = await db.query("INSERT INTO checkins (user_id,scope,scanned_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING scanned_at", [t.uid, t.scope, (req as any).staffUser ?? null]);
      if (!ins[0]) return { result: "duplicate", message: "Already checked in." };
      // an OD event: nudge the student's phone straight away, so the OD form reaches them even if the app is closed
      if (await collectsOd(t.scope)) {
        const [ev] = await db.query("SELECT title FROM events WHERE id=$1", [t.scope.slice(6)]);
        pushInBackground(db, await devicesForUser(db, t.uid), { title: "You’re checked in", body: `Open the app and add your OD details for ${ev?.title ?? "this event"}.`, type: "announcement", id: `od-${t.scope.slice(6)}` }, req.log);
      }
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
