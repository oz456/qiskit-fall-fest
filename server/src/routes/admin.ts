// Admin API (single shared admin credential from env). Mounted under /admin/api.
import { randomBytes, randomInt } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { config } from "../config.ts";
import type { Db, Queryable } from "../db.ts";
import { staffAuth } from "../lib/staff.ts";
import { reconcile } from "../lib/website-sync.ts";
import { mailRemaining } from "../lib/mail.ts";
import { getPhoto, removePhoto } from "../lib/photos.ts";
import { devicesForAll, devicesForUser, pushInBackground } from "../lib/push.ts";
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
      const left = await mailRemaining();
      return { ...s, mail_remaining: Number.isFinite(left) ? left : null };
    });

    // ---- events ----
    api.get("/admin/api/events", async () => {
      const rows = await db.query(`SELECT e.*,
        (SELECT count(*)::int FROM user_events r WHERE r.event_id=e.id AND r.kind='saved') AS saved FROM events e ORDER BY starts_at, title`);
      return rows.map((r) => eventOut(r, { saved: r.saved }));
    });
    api.post("/admin/api/events", async (req, reply) => {
      const b = EventInput.parse(req.body);
      const [r] = await db.query("INSERT INTO events (title,description,track,location,speaker,starts_at,ends_at,published) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",
        [b.title, b.description, b.track, b.location, b.speaker, b.startsAt, b.endsAt, b.published]);
      await audit(db, req, "event.create", "event", r!.id, { title: b.title });
      return reply.code(201).send({ id: r!.id });
    });
    api.put("/admin/api/events/:id", async (req, reply) => {
      const { id } = Id.parse(req.params); const b = EventInput.parse(req.body);
      const r = await db.query("UPDATE events SET title=$2,description=$3,track=$4,location=$5,speaker=$6,starts_at=$7,ends_at=$8,published=$9,updated_at=now() WHERE id=$1 RETURNING id",
        [id, b.title, b.description, b.track, b.location, b.speaker, b.startsAt, b.endsAt, b.published]);
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
      const f = z.object({
        q: z.string().max(100).optional(), kind: z.enum(["student", "faculty", "unclear", "external"]).optional(),
        selfie: z.enum(["yes", "no"]).optional(), app: z.enum(["yes", "no"]).optional(), status: z.enum(["active", "blocked"]).optional(),
        checkedin: z.enum(["yes", "no"]).optional(), source: z.enum(["admin", "import", "website", "srm"]).optional(), pass: z.enum(["general", "flagship", "none"]).optional(),
        sort: z.enum(["newest", "name", "checkins"]).default("newest"), limit: z.coerce.number().int().min(1).max(500).default(200), offset: z.coerce.number().int().min(0).max(100000).default(0),
      }).parse(req.query);
      const like = f.q ? `%${f.q.replace(/[%_\\]/g, "\\$&").toLowerCase()}%` : "%";
      const HAS_APP = "EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL)", HAS_PHOTO = "EXISTS(SELECT 1 FROM user_photos p WHERE p.user_id=u.id)", HAS_CHECKIN = "EXISTS(SELECT 1 FROM checkins c WHERE c.user_id=u.id)";
      const yn = (v: string | undefined, expr: string) => (v === "yes" ? `AND ${expr}` : v === "no" ? `AND NOT ${expr}` : "");
      const where = `(lower(u.email) LIKE $1 OR lower(u.name) LIKE $1 OR lower(u.pass_code) LIKE $1) AND ($2::text IS NULL OR u.kind=$2) AND ($3::text IS NULL OR u.status=$3) AND ($4::text IS NULL OR u.source=$4) AND ($5::text IS NULL OR ($5='none' AND u.pass_tier IS NULL) OR u.pass_tier=$5)
        ${yn(f.selfie, HAS_PHOTO)} ${yn(f.app, HAS_APP)} ${yn(f.checkedin, HAS_CHECKIN)}`;
      const args = [like, f.kind ?? null, f.status ?? null, f.source ?? null, f.pass ?? null];
      const order = f.sort === "name" ? "lower(u.name), u.email" : f.sort === "checkins" ? "checkins DESC, u.created_at DESC" : "u.created_at DESC";
      const [t] = await db.query(`SELECT count(*)::int AS n FROM users u WHERE ${where}`, args);
      const [all] = await db.query("SELECT count(*)::int AS n FROM users");
      const rows = await db.query(`SELECT u.id,u.email,u.name,u.college,u.pass_code,u.status,u.created_at,u.kind,u.source,u.pass_tier,
        ${HAS_APP} AS has_app, ${HAS_PHOTO} AS has_photo, (SELECT count(*)::int FROM checkins c WHERE c.user_id=u.id) AS checkins
        FROM users u WHERE ${where} ORDER BY ${order} LIMIT ${f.limit} OFFSET ${f.offset}`, args);
      return { total: t!.n, all: all!.n, rows: rows.map((u) => ({ id: u.id, email: u.email, name: u.name, college: u.college, passCode: u.pass_code, status: u.status, kind: u.kind, source: u.source, passTier: u.pass_tier, hasApp: u.has_app, hasPhoto: u.has_photo, checkins: u.checkins })) };
    });
    // Who is in the app, by how they got in: SRM address, ₹99 pass, ₹499 pass, or neither. Signed in = has a live session.
    api.get("/admin/api/access-summary", async () => {
      const [r] = await db.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL))::int AS signed_in,
        count(*) FILTER (WHERE lower(u.email) LIKE '%@srmap.edu.in')::int AS srm,
        count(*) FILTER (WHERE u.pass_tier='general')::int AS general, count(*) FILTER (WHERE u.pass_tier='flagship')::int AS flagship,
        count(*) FILTER (WHERE lower(u.email) NOT LIKE '%@srmap.edu.in' AND u.pass_tier IS NULL)::int AS outside_without_pass
        FROM users u`);
      const [sync] = await db.query("SELECT value FROM settings WHERE key='passes_synced_at'");
      return { total: r!.total, signedIn: r!.signed_in, srm: r!.srm, general: r!.general, flagship: r!.flagship, outsideWithoutPass: r!.outside_without_pass, passesSyncedAt: sync?.value ?? null };
    });
    // Removes outside people (not @srmap.edu.in) who hold no verified ₹99/₹499 pass AND never signed in, never did a selfie and never checked in.
    // Anyone who signed in, took a selfie, checked in, was added by hand or has a pass is never touched. Refuses to run before the pass list has been synced.
    api.post("/admin/api/cleanup-nonpass", async (req) => {
      const { dryRun } = z.object({ dryRun: z.boolean().default(true) }).parse(req.body ?? {});
      const [sync] = await db.query("SELECT value FROM settings WHERE key='passes_synced_at'");
      if (!sync || Date.now() - Date.parse(sync.value) > 24 * 3600_000) return { ok: false, message: "The pass list has not been synced from the website in the last 24 hours, so nobody can be judged yet. Run Sync now first." };
      const WHERE = `u.source IN ('website','import') AND lower(u.email) NOT LIKE '%@srmap.edu.in' AND u.pass_tier IS NULL
        AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=u.id) AND NOT EXISTS(SELECT 1 FROM user_photos p WHERE p.user_id=u.id) AND NOT EXISTS(SELECT 1 FROM checkins c WHERE c.user_id=u.id)`;
      const [c] = await db.query(`SELECT count(*)::int AS n FROM users u WHERE ${WHERE}`);
      if (dryRun) return { ok: true, dryRun: true, wouldRemove: c!.n };
      await db.query(`DELETE FROM users u WHERE ${WHERE}`);
      await audit(db, req, "users.cleanup_nonpass", "user", undefined, { removed: c!.n });
      return { ok: true, dryRun: false, removed: c!.n };
    });
    api.get("/admin/api/users/:id/photo", async (req, reply) => {
      const { id } = Id.parse(req.params);
      const img = await getPhoto(db, id);
      if (!img) return reply.code(404).send({ error: "not_found" });
      return reply.header("Content-Type", "image/jpeg").header("Cache-Control", "no-store").send(img);
    });
    // Lets someone retake their selfie (wrong person, bad photo): the app asks for a new one at next sign-in.
    api.delete("/admin/api/users/:id/photo", async (req) => {
      const { id } = Id.parse(req.params);
      await removePhoto(db, id);
      await audit(db, req, "user.photo_reset", "user", id); return { ok: true };
    });
    api.post("/admin/api/users", async (req, reply) => {
      const b = UserInput.parse(req.body);
      const id = await createUser(db, b.email, b.name, b.college);
      if (!id) return reply.code(409).send({ error: "exists", message: "That email is already registered." });
      await audit(db, req, "user.create", "user", id); return reply.code(201).send({ id });
    });
    // CSV columns: email, name, college.
    api.post("/admin/api/users/import", { bodyLimit: 1_000_000 }, async (req) => {
      const { csv } = z.object({ csv: z.string().max(900_000) }).parse(req.body);
      const rows = parseCsv(csv); const out = { added: 0, skipped: 0, invalid: [] as string[] };
      const head = rows[0]?.map((h) => h.trim().toLowerCase()) ?? [];
      const hasHead = head.includes("email");
      const col = (n: string, d: number) => (hasHead ? head.indexOf(n) : d);
      for (const r of rows.slice(hasHead ? 1 : 0).slice(0, 5000)) {
        const parsed = UserInput.safeParse({ email: r[col("email", 0)] ?? "", name: r[col("name", 1)] ?? "", college: (r[col("college", 2)] ?? "").trim() || null });
        if (!parsed.success) { out.invalid.push(String(r[col("email", 0)] ?? "(blank)").slice(0, 80)); continue; }
        if (await createUser(db, parsed.data.email, parsed.data.name, parsed.data.college)) out.added++; else out.skipped++;
      }
      await audit(db, req, "user.import", "user", undefined, { added: out.added, skipped: out.skipped });
      return out;
    });
    api.patch("/admin/api/users/:id", async (req) => {
      const { id } = Id.parse(req.params);
      const b = z.object({ status: z.enum(["active", "blocked"]).optional(), name: z.string().trim().min(1).max(100).optional() }).refine((x) => x.status || x.name, "Nothing to change.").parse(req.body);
      if (b.name) { await db.query("UPDATE users SET name=$2 WHERE id=$1", [id, b.name]); await audit(db, req, "user.rename", "user", id, { name: b.name }); }
      if (b.status) {
        await db.tx(async (q) => {
          await q.query("UPDATE users SET status=$2 WHERE id=$1", [id, b.status]);
          if (b.status === "blocked") { await q.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [id]); await q.query("DELETE FROM push_tokens WHERE user_id=$1", [id]); }
        });
        await audit(db, req, "user." + b.status, "user", id);
      }
      return { ok: true };
    });
    api.post("/admin/api/users/:id/reset-device", async (req) => { // frees the pass for a new phone (e.g. lost device)
      const { id } = Id.parse(req.params);
      await db.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [id]);
      await db.query("DELETE FROM push_tokens WHERE user_id=$1", [id]); // the old phone stops getting notifications
      await audit(db, req, "user.reset_device", "user", id); return { ok: true };
    });
    api.delete("/admin/api/users/:id", async (req) => {
      const { id } = Id.parse(req.params);
      await removePhoto(db, id); await db.query("DELETE FROM users WHERE id=$1", [id]); await audit(db, req, "user.delete", "user", id); return { ok: true };
    });

    // ---- announcements ----
    api.get("/admin/api/announcements", async () => (await db.query("SELECT * FROM announcements ORDER BY created_at DESC LIMIT 100")).map((a) => ({ id: a.id, title: a.title, body: a.body, emailed: a.emailed, createdAt: new Date(a.created_at).toISOString() })));
    api.post("/admin/api/announcements", async (req, reply) => {
      const b = AnnouncementInput.parse(req.body);
      // Announcements are in-app only: the daily mail quota is reserved for login codes.
      const [a] = await db.query("INSERT INTO announcements (title,body) VALUES ($1,$2) RETURNING id", [b.title, b.body]);
      await audit(db, req, "announcement.create", "announcement", a!.id);
      // Instant notification to every device that has them on. Responds right away; delivery continues in the background.
      const devices = await devicesForAll(db);
      pushInBackground(db, devices, { title: b.title, body: b.body.length > 160 ? b.body.slice(0, 157) + "…" : b.body, type: "announcement", id: a!.id }, req.log);
      return reply.code(201).send({ id: a!.id, notified: devices.length });
    });
    api.get("/admin/api/push", async () => { const [r] = await db.query("SELECT count(*)::int AS n FROM push_tokens t JOIN users u ON u.id=t.user_id AND u.status='active'"); return { devices: r!.n }; });
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
      const [owner] = await db.query("SELECT user_id FROM tickets WHERE id=$1", [id]);
      pushInBackground(db, await devicesForUser(db, owner!.user_id), { title: `Reply on ${t.code}`, body: body.length > 160 ? body.slice(0, 157) + "…" : body, type: "ticket", id }, req.log);
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

    // ---- website sync (people come from the main website; see lib/website-sync.ts) ----
    api.get("/admin/api/sync", async () => {
      const runs = await db.query("SELECT id,started_at,finished_at,trigger,status,seen,created,updated,skipped,error FROM sync_runs ORDER BY started_at DESC LIMIT 8");
      const [c] = await db.query("SELECT count(*) FILTER (WHERE source='website')::int AS website, count(*)::int AS total FROM users");
      return { configured: Boolean(config.website.secret), websiteUrl: config.website.baseUrl, fromWebsite: c!.website, total: c!.total,
        runs: runs.map((r) => ({ at: new Date(r.started_at).toISOString(), trigger: r.trigger, status: r.status, seen: r.seen, created: r.created, updated: r.updated, skipped: r.skipped, error: r.error })) };
    });
    api.post("/admin/api/sync/run", { config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req) => { const r = await reconcile(db, "admin"); await audit(db, req, "sync.run", undefined, undefined, { ok: r.ok }); return r; });

    // ---- attendance (read-only view of what the /check scanners recorded) ----
    api.get("/admin/api/attendance", async (req) => {
      const { scope } = z.object({ scope: z.string().max(60).optional() }).parse(req.query);
      const summary = await db.query("SELECT c.scope, e.title, count(*)::int AS n, max(c.scanned_at) AS last FROM checkins c LEFT JOIN events e ON c.scope = 'event:' || e.id::text GROUP BY c.scope, e.title ORDER BY c.scope"
);
      const rows = scope ? await db.query(`SELECT u.name, u.email, u.college, u.pass_code, c.scanned_at, c.scanned_by FROM checkins c JOIN users u ON u.id=c.user_id WHERE c.scope=$1 ORDER BY c.scanned_at DESC LIMIT 2000`, [scope]) : [];
      return { summary: summary.map((r) => ({ scope: r.scope, title: r.title ?? null, count: r.n, last: new Date(r.last).toISOString() })), rows: rows.map((r) => ({ name: r.name, email: r.email, college: r.college, passCode: r.pass_code, at: new Date(r.scanned_at).toISOString(), scannedById: r.scanned_by ?? null, scannedByName: r.scanned_by ? config.checkNames[r.scanned_by] ?? null : null })) };
    });

    api.get("/admin/api/audit", async () => (await db.query("SELECT id, at, action, entity, entity_id, detail, ip FROM audit_log ORDER BY id DESC LIMIT 200")).map((a) => ({ ...a, at: new Date(a.at).toISOString() })));
  });
}
