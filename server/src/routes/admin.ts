// Admin API (single shared admin credential from env). Mounted under /admin/api.
import { randomBytes, randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.ts";
import type { Db, Queryable } from "../db.ts";
import { staffAuth } from "../lib/staff.ts";
import { announcementMail, sendMail, ticketReplyMail } from "../lib/mail.ts";
import { AnnouncementInput, EventInput, FaqInput, SettingsInput, TicketReply, TicketStatus, UserInput } from "../lib/schemas.ts";
import { audit, eventDay, eventOut } from "../lib/util.ts";

const Id = z.object({ id: z.string().uuid() });

/** Minimal RFC4180-ish CSV parser (quotes, commas, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

async function createUser(q: Queryable, email: string, name: string, college: string | null): Promise<string | null> {
  for (let i = 0; i < 8; i++) {
    const code = `QFF-${randomInt(1000, 100000)}`;
    const r = await q.query("INSERT INTO users (email,name,college,pass_code,pass_secret) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id", [email, name, college, code, randomBytes(32)]);
    if (r[0]) return r[0].id as string;
    const [dup] = await q.query("SELECT 1 FROM users WHERE lower(email)=$1", [email]);
    if (dup) return null; // email already exists; otherwise pass_code collided → retry
  }
  throw new Error("could not allocate pass code");
}

export function adminRoutes(app: FastifyInstance, db: Db) {
  const { guard, common } = staffAuth(app, db, { name: "admin", user: config.adminUser, password: config.adminPassword, hash: config.adminPasswordHash, ttlSec: 8 * 3600 });

  app.register(async (api) => {
    api.addHook("preHandler", guard);
    common(api);

    // ---- dashboard ----
    api.get("/admin/api/stats", async () => {
      const [s] = await db.query(`SELECT
        (SELECT count(*)::int FROM users) AS users,
        (SELECT count(DISTINCT user_id)::int FROM sessions WHERE revoked_at IS NULL) AS app_users,
        (SELECT count(*)::int FROM events) AS events,
        (SELECT count(*)::int FROM tickets WHERE status <> 'resolved') AS open_tickets,
        (SELECT count(*)::int FROM checkins WHERE scope = $1) AS checked_in_today`, ["day:" + eventDay()]);
      return s;
    });

    // ---- events ----
    api.get("/admin/api/events", async () => {
      const rows = await db.query(`SELECT e.*, (SELECT count(*)::int FROM user_events r WHERE r.event_id=e.id AND r.kind='registered') AS registered,
        (SELECT count(*)::int FROM user_events r WHERE r.event_id=e.id AND r.kind='saved') AS saved FROM events e ORDER BY starts_at, title`);
      return rows.map((r) => eventOut(r, { registered: r.registered, saved: r.saved }));
    });
    api.post("/admin/api/events", async (req, reply) => {
      const b = EventInput.parse(req.body);
      const [r] = await db.query("INSERT INTO events (title,description,track,location,speaker,starts_at,ends_at,capacity,registration_required,published) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id",
        [b.title, b.description, b.track, b.location, b.speaker, b.startsAt, b.endsAt, b.capacity, b.registrationRequired, b.published]);
      await audit(db, req, "event.create", "event", r!.id, { title: b.title });
      return reply.code(201).send({ id: r!.id });
    });
    api.put("/admin/api/events/:id", async (req, reply) => {
      const { id } = Id.parse(req.params); const b = EventInput.parse(req.body);
      const r = await db.query("UPDATE events SET title=$2,description=$3,track=$4,location=$5,speaker=$6,starts_at=$7,ends_at=$8,capacity=$9,registration_required=$10,published=$11,updated_at=now() WHERE id=$1 RETURNING id",
        [id, b.title, b.description, b.track, b.location, b.speaker, b.startsAt, b.endsAt, b.capacity, b.registrationRequired, b.published]);
      if (!r[0]) return reply.code(404).send({ error: "not_found" });
      await audit(db, req, "event.update", "event", id, { title: b.title });
      return { ok: true };
    });
    api.delete("/admin/api/events/:id", async (req) => {
      const { id } = Id.parse(req.params);
      await db.query("DELETE FROM events WHERE id=$1", [id]); await audit(db, req, "event.delete", "event", id);
      return { ok: true };
    });

    // ---- attendees ----
    api.get("/admin/api/users", async (req) => {
      const { q } = z.object({ q: z.string().max(100).optional() }).parse(req.query);
      const like = q ? `%${q.replace(/[%_\\]/g, "\\$&").toLowerCase()}%` : "%";
      const rows = await db.query(`SELECT u.id,u.email,u.name,u.college,u.pass_code,u.status,u.created_at,
        EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL) AS has_app,
        (SELECT count(*)::int FROM checkins c WHERE c.user_id=u.id) AS checkins
        FROM users u WHERE lower(u.email) LIKE $1 OR lower(u.name) LIKE $1 OR lower(u.pass_code) LIKE $1 ORDER BY u.created_at DESC LIMIT 500`, [like]);
      return rows.map((u) => ({ id: u.id, email: u.email, name: u.name, college: u.college, passCode: u.pass_code, status: u.status, hasApp: u.has_app, checkins: u.checkins }));
    });
    api.post("/admin/api/users", async (req, reply) => {
      const b = UserInput.parse(req.body);
      const id = await createUser(db, b.email, b.name, b.college);
      if (!id) return reply.code(409).send({ error: "exists", message: "That email is already registered." });
      await audit(db, req, "user.create", "user", id); return reply.code(201).send({ id });
    });
    api.post("/admin/api/users/import", { bodyLimit: 1_000_000 }, async (req) => {
      const { csv } = z.object({ csv: z.string().max(900_000) }).parse(req.body);
      const rows = parseCsv(csv); const out = { added: 0, skipped: 0, invalid: [] as string[] };
      const head = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
      const hasHead = head.includes("email");
      const col = (n: string, d: number) => (hasHead ? head.indexOf(n) : d);
      for (const r of rows.slice(hasHead ? 1 : 0).slice(0, 5000)) {
        const parsed = UserInput.safeParse({ email: r[col("email", 0)] ?? "", name: r[col("name", 1)] ?? "", college: (r[col("college", 2)] ?? "").trim() || null });
        if (!parsed.success) { out.invalid.push(String(r[col("email", 0)] ?? "(blank)").slice(0, 80)); continue; }
        (await createUser(db, parsed.data.email, parsed.data.name, parsed.data.college)) ? out.added++ : out.skipped++;
      }
      await audit(db, req, "user.import", "user", undefined, { added: out.added, skipped: out.skipped });
      return out;
    });
    api.patch("/admin/api/users/:id", async (req) => {
      const { id } = Id.parse(req.params);
      const b = z.object({ status: z.enum(["active", "blocked"]) }).parse(req.body);
      await db.tx(async (q) => {
        await q.query("UPDATE users SET status=$2 WHERE id=$1", [id, b.status]);
        if (b.status === "blocked") await q.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [id]);
      });
      await audit(db, req, "user." + b.status, "user", id); return { ok: true };
    });
    api.post("/admin/api/users/:id/reset-device", async (req) => { // frees the pass for a new phone (e.g. lost device)
      const { id } = Id.parse(req.params);
      await db.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [id]);
      await audit(db, req, "user.reset_device", "user", id); return { ok: true };
    });
    api.delete("/admin/api/users/:id", async (req) => {
      const { id } = Id.parse(req.params);
      await db.query("DELETE FROM users WHERE id=$1", [id]); await audit(db, req, "user.delete", "user", id); return { ok: true };
    });

    // ---- announcements ----
    api.get("/admin/api/announcements", async () => (await db.query("SELECT * FROM announcements ORDER BY created_at DESC LIMIT 100")).map((a) => ({ id: a.id, title: a.title, body: a.body, emailed: a.emailed, createdAt: new Date(a.created_at).toISOString() })));
    api.post("/admin/api/announcements", async (req, reply) => {
      const b = AnnouncementInput.parse(req.body);
      const [a] = await db.query("INSERT INTO announcements (title,body) VALUES ($1,$2) RETURNING id", [b.title, b.body]);
      let sent = 0, failed = 0;
      if (b.sendEmail) {
        const users = await db.query("SELECT email FROM users WHERE status='active'");
        for (let i = 0; i < users.length; i += 10) {
          const res = await Promise.allSettled(users.slice(i, i + 10).map((u) => sendMail(announcementMail(u.email, b.title, b.body))));
          for (const r of res) r.status === "fulfilled" ? sent++ : failed++;
        }
        await db.query("UPDATE announcements SET emailed=$2 WHERE id=$1", [a!.id, sent]);
      }
      await audit(db, req, "announcement.create", "announcement", a!.id, { sent, failed });
      return reply.code(201).send({ id: a!.id, emailed: sent, failed });
    });
    api.delete("/admin/api/announcements/:id", async (req) => {
      const { id } = Id.parse(req.params);
      await db.query("DELETE FROM announcements WHERE id=$1", [id]); await audit(db, req, "announcement.delete", "announcement", id); return { ok: true };
    });

    // ---- support ----
    api.get("/admin/api/tickets", async (req) => {
      const { status } = z.object({ status: z.enum(["open", "in_progress", "resolved"]).optional() }).parse(req.query);
      const rows = await db.query(`SELECT t.*, u.name, u.email, u.pass_code,
        (SELECT body FROM ticket_messages m WHERE m.ticket_id=t.id ORDER BY created_at DESC LIMIT 1) AS last_body,
        (SELECT author FROM ticket_messages m WHERE m.ticket_id=t.id ORDER BY created_at DESC LIMIT 1) AS last_author
        FROM tickets t JOIN users u ON u.id=t.user_id WHERE ($1::text IS NULL OR t.status=$1) ORDER BY t.updated_at DESC LIMIT 200`, [status ?? null]);
      return rows.map((t) => ({ id: t.id, code: t.code, kind: t.kind, topic: t.topic, status: t.status, name: t.name, email: t.email, passCode: t.pass_code, lastBody: t.last_body, lastAuthor: t.last_author, updatedAt: new Date(t.updated_at).toISOString() }));
    });
    api.get("/admin/api/tickets/:id", async (req, reply) => {
      const { id } = Id.parse(req.params);
      const [t] = await db.query("SELECT t.*, u.name, u.email, u.pass_code FROM tickets t JOIN users u ON u.id=t.user_id WHERE t.id=$1", [id]);
      if (!t) return reply.code(404).send({ error: "not_found" });
      const m = await db.query("SELECT author, body, created_at FROM ticket_messages WHERE ticket_id=$1 ORDER BY created_at", [id]);
      return { id: t.id, code: t.code, kind: t.kind, topic: t.topic, status: t.status, name: t.name, email: t.email, passCode: t.pass_code, messages: m.map((x) => ({ author: x.author, body: x.body, at: new Date(x.created_at).toISOString() })) };
    });
    api.post("/admin/api/tickets/:id/reply", async (req, reply) => {
      const { id } = Id.parse(req.params); const { body } = TicketReply.parse(req.body);
      const [t] = await db.query("SELECT t.code, u.email FROM tickets t JOIN users u ON u.id=t.user_id WHERE t.id=$1", [id]);
      if (!t) return reply.code(404).send({ error: "not_found" });
      await db.query("INSERT INTO ticket_messages (ticket_id,author,body) VALUES ($1,'admin',$2)", [id, body]);
      await db.query("UPDATE tickets SET updated_at=now(), status=CASE WHEN status='open' THEN 'in_progress' ELSE status END WHERE id=$1", [id]);
      sendMail(ticketReplyMail(t.email, t.code, body)).catch((e) => req.log.error({ err: e.message }, "reply mail failed"));
      await audit(db, req, "ticket.reply", "ticket", id); return { ok: true };
    });
    api.patch("/admin/api/tickets/:id", async (req) => {
      const { id } = Id.parse(req.params); const { status } = TicketStatus.parse(req.body);
      await db.query("UPDATE tickets SET status=$2, updated_at=now() WHERE id=$1", [id, status]); await audit(db, req, "ticket.status", "ticket", id, { status }); return { ok: true };
    });

    // ---- content: FAQs + settings ----
    api.get("/admin/api/faqs", async () => (await db.query("SELECT id, question, answer, position FROM faqs ORDER BY position, question")));
    api.post("/admin/api/faqs", async (req, reply) => {
      const b = FaqInput.parse(req.body);
      const [r] = await db.query("INSERT INTO faqs (question,answer,position) VALUES ($1,$2,$3) RETURNING id", [b.question, b.answer, b.position]);
      await audit(db, req, "faq.create", "faq", r!.id); return reply.code(201).send({ id: r!.id });
    });
    api.put("/admin/api/faqs/:id", async (req) => {
      const { id } = Id.parse(req.params); const b = FaqInput.parse(req.body);
      await db.query("UPDATE faqs SET question=$2,answer=$3,position=$4 WHERE id=$1", [id, b.question, b.answer, b.position]); await audit(db, req, "faq.update", "faq", id); return { ok: true };
    });
    api.delete("/admin/api/faqs/:id", async (req) => {
      const { id } = Id.parse(req.params); await db.query("DELETE FROM faqs WHERE id=$1", [id]); await audit(db, req, "faq.delete", "faq", id); return { ok: true };
    });
    api.get("/admin/api/settings", async () => Object.fromEntries((await db.query("SELECT key,value FROM settings")).map((r) => [r.key, r.value])));
    api.put("/admin/api/settings", async (req) => {
      const b = SettingsInput.parse(req.body);
      for (const [k, v] of Object.entries(b)) await db.query("INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [k, v]);
      await audit(db, req, "settings.update"); return { ok: true };
    });

    // ---- attendance (read-only view of what the /check scanners recorded) ----
    api.get("/admin/api/attendance", async (req) => {
      const { scope } = z.object({ scope: z.string().max(60).optional() }).parse(req.query);
      const summary = await db.query("SELECT scope, count(*)::int AS n, max(scanned_at) AS last FROM checkins GROUP BY scope ORDER BY scope");
      const rows = scope ? await db.query(`SELECT u.name, u.email, u.college, u.pass_code, c.scanned_at FROM checkins c JOIN users u ON u.id=c.user_id WHERE c.scope=$1 ORDER BY c.scanned_at DESC LIMIT 2000`, [scope]) : [];
      return { summary: summary.map((r) => ({ scope: r.scope, count: r.n, last: new Date(r.last).toISOString() })), rows: rows.map((r) => ({ name: r.name, email: r.email, college: r.college, passCode: r.pass_code, at: new Date(r.scanned_at).toISOString() })) };
    });

    api.get("/admin/api/audit", async () => (await db.query("SELECT id, at, action, entity, entity_id, detail, ip FROM audit_log ORDER BY id DESC LIMIT 200")).map((a) => ({ ...a, at: new Date(a.at).toISOString() })));
  });
}
