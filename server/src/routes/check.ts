// Door-scanning site (/check): separate login, separate API. It can verify passes and read attendance counts — nothing else.
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.ts";
import type { Db } from "../db.ts";
import { PASS_STEP_SEC, passMac, safeEqual } from "../lib/crypto.ts";
import { staffAuth } from "../lib/staff.ts";
import { eventDay } from "../lib/util.ts";

const Scope = z.string().regex(/^(day:\d{4}-\d{2}-\d{2}|event:[0-9a-f-]{36})$/);

export function checkRoutes(app: FastifyInstance, db: Db) {
  const { guard, common } = staffAuth(app, db, { name: "check", user: config.checkUser, password: config.checkPassword, hash: config.checkPasswordHash, ttlSec: 12 * 3600 });

  app.register(async (api) => {
    api.addHook("preHandler", guard);
    common(api);

    api.get("/check/api/scopes", async () => {
      const [r] = await db.query("SELECT min(starts_at) AS a, max(ends_at) AS b FROM events WHERE published");
      const days: string[] = [];
      if (r?.a && r?.b) for (let d = new Date(r.a); eventDay(d) <= eventDay(new Date(r.b)) && days.length < 60; d = new Date(d.getTime() + 86400_000)) days.push(eventDay(d));
      const events = await db.query("SELECT id,title,starts_at,ends_at FROM events WHERE published ORDER BY starts_at, title");
      const today = eventDay();
      const defaultDay = days.includes(today) ? today : days.find((d) => d > today) ?? days.at(-1) ?? today;
      return { today, defaultScope: `day:${defaultDay}`, days, events: events.map((e) => ({ id: e.id, title: e.title })) };
    });

    api.get("/check/api/stats", async (req) => {
      const { scope } = z.object({ scope: Scope }).parse(req.query);
      const [c] = await db.query("SELECT count(*)::int AS n FROM checkins WHERE scope=$1", [scope]);
      const [t] = await db.query("SELECT count(*)::int AS n FROM users WHERE status='active'");
      const recent = await db.query("SELECT u.name, u.college, u.pass_code, c.scanned_at FROM checkins c JOIN users u ON u.id=c.user_id WHERE c.scope=$1 ORDER BY c.scanned_at DESC LIMIT 12", [scope]);
      return { count: c!.n, total: t!.n, recent: recent.map((r) => ({ name: r.name, college: r.college, passCode: r.pass_code, at: new Date(r.scanned_at).toISOString() })) };
    });

    api.post("/check/api/scan", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
      const b = z.object({ payload: z.string().max(200), scope: Scope }).parse(req.body);
      const m = /^QFF1\.([A-Z0-9-]{4,20})\.(\d{1,12})\.([A-Za-z0-9_-]{12})$/.exec(b.payload.trim());
      if (!m) return { result: "invalid", message: "Not a Fall Fest pass." };
      const [, code, stepStr, mac] = m as unknown as [string, string, string, string];
      const [u] = await db.query("SELECT id,name,college,pass_code,pass_secret,status FROM users WHERE pass_code=$1", [code]);
      if (!u) return { result: "invalid", message: "Unknown pass." };
      const step = Number(stepStr); const nowStep = Math.floor(Date.now() / 1000 / PASS_STEP_SEC);
      const who = { name: u.name, college: u.college, passCode: u.pass_code };
      if (!safeEqual(mac, passMac(Buffer.from(u.pass_secret), code, step))) return { result: "invalid", message: "Pass signature is wrong. Possibly an old or forwarded code.", who };
      if (Math.abs(nowStep - step) > 1) return { result: "expired", message: "This QR is stale (a screenshot?). Ask the attendee to open the live pass.", who };
      if (u.status !== "active") return { result: "blocked", message: "This pass is blocked.", who };
      let warning: string | undefined;
      if (b.scope.startsWith("event:")) {
        const [e] = await db.query("SELECT registration_required FROM events WHERE id=$1", [b.scope.slice(6)]);
        if (e?.registration_required) {
          const [reg] = await db.query("SELECT 1 FROM user_events WHERE user_id=$1 AND event_id=$2 AND kind='registered'", [u.id, b.scope.slice(6)]);
          if (!reg) warning = "Not registered for this event.";
        }
      }
      const ins = await db.query("INSERT INTO checkins (user_id,scope) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING scanned_at", [u.id, b.scope]);
      if (!ins[0]) {
        const [prev] = await db.query("SELECT scanned_at FROM checkins WHERE user_id=$1 AND scope=$2", [u.id, b.scope]);
        return { result: "duplicate", message: "Already checked in.", at: new Date(prev!.scanned_at).toISOString(), who };
      }
      return { result: "ok", message: "Checked in.", warning, who };
    });
  });
}
