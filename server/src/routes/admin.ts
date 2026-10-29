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
import { WINDOW_SEC, editName, naming, startPractice, sweep } from "../lib/team-names.ts";
import { websiteTeams } from "../lib/team.ts";
import { audit, eventDay, eventOut } from "../lib/util.ts";
import { detailsOut } from "../lib/details.ts";

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
      return rows.map((r) => eventOut(r, { saved: r.saved, collectOd: r.collect_od }));
    });
    api.post("/admin/api/events", async (req, reply) => {
      const b = EventInput.parse(req.body);
      const [r] = await db.query("INSERT INTO events (title,description,track,location,speaker,starts_at,ends_at,published,collect_od) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id",
        [b.title, b.description, b.track, b.location, b.speaker, b.startsAt, b.endsAt, b.published, b.collectOd]);
      await audit(db, req, "event.create", "event", r!.id, { title: b.title });
      return reply.code(201).send({ id: r!.id });
    });
    api.put("/admin/api/events/:id", async (req, reply) => {
      const { id } = Id.parse(req.params); const b = EventInput.parse(req.body);
      const r = await db.query("UPDATE events SET title=$2,description=$3,track=$4,location=$5,speaker=$6,starts_at=$7,ends_at=$8,published=$9,collect_od=$10,updated_at=now() WHERE id=$1 RETURNING id",
        [id, b.title, b.description, b.track, b.location, b.speaker, b.startsAt, b.endsAt, b.published, b.collectOd]);
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
      const rows = await db.query(`SELECT u.id,u.email,u.name,u.college,u.pass_code,u.status,u.created_at,u.kind,u.source,u.pass_tier,u.pass_manual,u.says_srm,u.ask_details,u.reg_no,u.school,u.semester,u.course,u.program,u.section,u.gender,u.cgpa,u.details_at,
        ${HAS_APP} AS has_app, ${HAS_PHOTO} AS has_photo, (SELECT count(*)::int FROM checkins c WHERE c.user_id=u.id) AS checkins,
        (SELECT max(s.last_used_at) FROM sessions s WHERE s.user_id=u.id) AS last_active
        FROM users u WHERE ${where} ORDER BY ${order} LIMIT ${f.limit} OFFSET ${f.offset}`, args);
      return { total: t!.n, all: all!.n, rows: rows.map((u) => ({ id: u.id, email: u.email, name: u.name, college: u.college, passCode: u.pass_code, status: u.status, kind: u.kind, source: u.source, passTier: u.pass_tier, passManual: u.pass_manual, saysSrm: u.says_srm, askDetails: u.ask_details, details: detailsOut(u), hasApp: u.has_app, hasPhoto: u.has_photo, checkins: u.checkins, createdAt: new Date(u.created_at).toISOString(), lastActive: u.last_active ? new Date(u.last_active).toISOString() : null })) };
    });
    // Who is in the app, by how they got in: SRM address, ₹99 pass, ₹499 pass, or neither. Signed in = has a live session.
    api.get("/admin/api/access-summary", async () => {
      const OUT = "lower(u.email) NOT LIKE '%@srmap.edu.in'";
      const [r] = await db.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL))::int AS signed_in,
        count(*) FILTER (WHERE lower(u.email) LIKE '%@srmap.edu.in')::int AS srm,
        count(*) FILTER (WHERE ${OUT} AND u.pass_tier='general')::int AS outside_general,
        count(*) FILTER (WHERE ${OUT} AND u.pass_tier='flagship')::int AS outside_flagship,
        count(*) FILTER (WHERE lower(u.email) LIKE '%@srmap.edu.in' AND u.pass_tier IS NOT NULL)::int AS srm_with_pass,
        count(*) FILTER (WHERE ${OUT} AND u.says_srm)::int AS says_srm,
        count(*) FILTER (WHERE ${OUT} AND u.says_srm AND u.pass_tier='flagship')::int AS says_srm_flagship,
        count(*) FILTER (WHERE ${OUT} AND u.says_srm AND u.pass_tier='general')::int AS says_srm_general,
        count(*) FILTER (WHERE ${OUT} AND NOT u.says_srm AND u.pass_tier='flagship')::int AS other_flagship,
        count(*) FILTER (WHERE ${OUT} AND NOT u.says_srm AND u.pass_tier='general')::int AS other_general,
        count(*) FILTER (WHERE ${OUT} AND NOT u.says_srm AND u.pass_tier IS NULL)::int AS outside_no_pass,
        count(*) FILTER (WHERE ${OUT} AND u.says_srm AND u.pass_tier IS NULL)::int AS says_srm_no_pass,
        count(*) FILTER (WHERE lower(u.email) LIKE '%@srmap.edu.in' AND u.pass_tier='general')::int AS srm_general,
        count(*) FILTER (WHERE lower(u.email) LIKE '%@srmap.edu.in' AND u.pass_tier='flagship')::int AS srm_flagship,
        count(*) FILTER (WHERE u.pass_manual AND u.pass_tier='general')::int AS manual_general,
        count(*) FILTER (WHERE u.pass_manual AND u.pass_tier='flagship')::int AS manual_flagship,
        count(*) FILTER (WHERE (lower(u.email) LIKE '%@srmap.edu.in' OR u.says_srm) AND u.details_at IS NOT NULL)::int AS details_given
        FROM users u`);
      const [sync] = await db.query("SELECT value FROM settings WHERE key='passes_synced_at'");
      return { total: r!.total, signedIn: r!.signed_in, srm: r!.srm, outsideGeneral: r!.outside_general, outsideFlagship: r!.outside_flagship, srmWithPass: r!.srm_with_pass, saysSrm: r!.says_srm, saysSrmFlagship: r!.says_srm_flagship, saysSrmGeneral: r!.says_srm_general, otherFlagship: r!.other_flagship, otherGeneral: r!.other_general, outsideNoPass: r!.outside_no_pass, saysSrmNoPass: r!.says_srm_no_pass, srmGeneral: r!.srm_general, srmFlagship: r!.srm_flagship, detailsGiven: r!.details_given, manualGeneral: r!.manual_general, manualFlagship: r!.manual_flagship, passesSyncedAt: sync?.value ?? null };
    });
    // Outside people whose payment is waiting for review or was rejected (they see the matching message at sign-in).
    api.get("/admin/api/pass-claims-waiting", async () => (await db.query("SELECT email, status, updated_at FROM pass_claim_status ORDER BY status, email")).map((r) => ({ email: r.email, status: r.status, at: new Date(r.updated_at).toISOString() })));
    // Cross-check against the website's own pass table: claims by tier / status / paid-or-free / SRM-or-outside.
    api.get("/admin/api/pass-report", async () => {
      const { baseUrl, secret } = config.website; if (!secret) return { ok: false, message: "Website sync is not configured." };
      const res = await fetch(`${baseUrl}/api/integrations/qff-app/passes?summary=1`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(25_000) });
      if (!res.ok) return { ok: false, message: `The website answered ${res.status}.` };
      return { ok: true, ...(await res.json() as object) };
    });
    // Integrity checks on the outside-SRM people who paid (amount vs tier, reused bank references, reviewer, name match).
    api.get("/admin/api/pass-audit", async () => {
      const { baseUrl, secret } = config.website; if (!secret) return { ok: false, message: "Website sync is not configured." };
      const res = await fetch(`${baseUrl}/api/integrations/qff-app/passes?audit=1`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(25_000) });
      if (!res.ok) return { ok: false, message: `The website answered ${res.status}.` };
      return { ok: true, ...(await res.json() as object) };
    });
    // Read-only: personal-address claims whose college says SRM-AP, and claims that mention SRM but name another campus, to check by hand.
    api.get("/admin/api/srm-audit", async () => {
      const { baseUrl, secret } = config.website; if (!secret) return { ok: false, message: "Website sync is not configured." };
      const res = await fetch(`${baseUrl}/api/integrations/qff-app/passes?audit=srm`, { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(25_000) });
      if (!res.ok) return { ok: false, message: `The website answered ${res.status}.` };
      return { ok: true, ...(await res.json() as object) };
    });
    api.post("/admin/api/cleanup-nonpass", async (req) => {
      const { dryRun, includeSignedIn } = z.object({ dryRun: z.boolean().default(true), includeSignedIn: z.boolean().default(false) }).parse(req.body ?? {});
      const [sync] = await db.query("SELECT value FROM settings WHERE key='passes_synced_at'");
      if (!sync || Date.now() - Date.parse(sync.value) > 24 * 3600_000) return { ok: false, message: "The pass list has not been synced from the website in the last 24 hours, so nobody can be judged yet. Run Sync now first." };
      // includeSignedIn: also people who signed in or took a selfie (their selfie is deleted from storage too). Still never anyone added by hand, anyone ever checked in at a door, or anyone whose payment is still waiting for review.
      const WHERE = `u.source IN ('website','import') AND lower(u.email) NOT LIKE '%@srmap.edu.in' AND u.pass_tier IS NULL AND NOT EXISTS(SELECT 1 FROM checkins c WHERE c.user_id=u.id)
        AND NOT EXISTS(SELECT 1 FROM pass_claim_status w WHERE lower(w.email)=lower(u.email) AND w.status='pending')
        ${includeSignedIn ? "" : "AND NOT EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=u.id) AND NOT EXISTS(SELECT 1 FROM user_photos p WHERE p.user_id=u.id)"}`;
      const ids = (await db.query<{ id: string }>(`SELECT u.id FROM users u WHERE ${WHERE}`)).map((r) => r.id);
      if (dryRun) return { ok: true, dryRun: true, wouldRemove: ids.length };
      for (const id of ids) { await removePhoto(db, id).catch(() => {}); await db.query("DELETE FROM users WHERE id=$1", [id]); } // photo first: the stored image goes, then the account and its sessions
      await audit(db, req, "users.cleanup_nonpass", "user", undefined, { removed: ids.length, includeSignedIn });
      return { ok: true, dryRun: false, removed: ids.length };
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
      if (b.passTier) await db.query("UPDATE users SET pass_tier=$2, pass_manual=true WHERE id=$1", [id, b.passTier]);   // app only: nothing is sent to the website
      await audit(db, req, "user.create", "user", id, b.passTier ? { passTier: b.passTier } : undefined); return reply.code(201).send({ id });
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
      const b = z.object({ status: z.enum(["active", "blocked"]).optional(), name: z.string().trim().min(1).max(100).optional(), askDetails: z.boolean().optional(), passTier: z.enum(["general", "flagship"]).nullable().optional() }).refine((x) => x.status || x.name || x.askDetails !== undefined || x.passTier !== undefined, "Nothing to change.").parse(req.body);
      if (b.passTier !== undefined) {   // set by hand in the app only; "none" goes back to whatever the website says
        await db.query("UPDATE users SET pass_tier=$2, pass_manual=$3 WHERE id=$1", [id, b.passTier, b.passTier !== null]);
        await audit(db, req, "user.pass_tier", "user", id, { passTier: b.passTier });
      }
      if (b.askDetails !== undefined) { await db.query("UPDATE users SET ask_details=$2 WHERE id=$1", [id, b.askDetails]); await audit(db, req, b.askDetails ? "user.ask_details" : "user.stop_ask_details", "user", id); }
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
    // Academic details people gave on first sign-in. Clearing them makes the app ask that person again (e.g. a typo).
    api.get("/admin/api/students", async () => {
      const rows = await db.query("SELECT name,email,says_srm,reg_no,school,semester,course,program,section,gender,cgpa FROM users WHERE details_at IS NOT NULL ORDER BY lower(name)");
      return { rows: rows.map((u) => ({ name: u.name, email: u.email, emailType: u.says_srm && !u.email.toLowerCase().endsWith("@srmap.edu.in") ? "personal_says_srm" : "srm_email", regNo: u.reg_no, school: u.school, semester: u.semester, course: u.course, program: u.program, section: u.section ?? "", gender: u.gender ?? "", cgpa: u.cgpa === null ? null : Number(u.cgpa) })) };
    });
    api.delete("/admin/api/users/:id/details", async (req) => {
      const { id } = Id.parse(req.params);
      await db.query("UPDATE users SET reg_no=NULL, school=NULL, semester=NULL, course=NULL, program=NULL, section=NULL, gender=NULL, cgpa=NULL, details_at=NULL WHERE id=$1", [id]);
      await audit(db, req, "user.reset_details", "user", id);
      return { ok: true };
    });
    // Frees someone who hit the sign-in limits (too many codes requested, or too many wrong codes) without waiting for them to cool off.
    api.post("/admin/api/users/:id/reset-login-limit", async (req) => {
      const { id } = Id.parse(req.params);
      const [u] = await db.query("SELECT email FROM users WHERE id=$1", [id]);
      if (u) { await db.query("DELETE FROM otp_codes WHERE lower(email)=lower($1)", [u.email]); await audit(db, req, "user.reset_login_limit", "user", id); }
      return { ok: !!u };
    });
    // A wrong OD entry: clearing it lets the student fill it in again from their app.
    api.post("/admin/api/attendance/:id/clear-od", async (req) => {
      const { id } = Id.parse(req.params);
      await db.query("UPDATE checkins SET od_from=NULL, od_until=NULL, od_hours=NULL WHERE id=$1", [id]);
      await audit(db, req, "attendance.clear_od", "checkin", id);
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

    // ---- teams made inside the app (testing, or people the website does not know). Never writes to the website. See migration 021. ----
    api.get("/admin/api/app-teams", async () => (await db.query(`SELECT t.id, t.name, t.created_at, json_agg(json_build_object('email', u.email, 'name', u.name, 'leader', m.leader) ORDER BY m.leader DESC, u.email) AS members
      FROM app_teams t JOIN app_team_members m ON m.team_id=t.id JOIN users u ON u.id=m.user_id GROUP BY t.id ORDER BY t.created_at DESC`)).map((t) => ({ id: t.id, name: t.name, createdAt: new Date(t.created_at).toISOString(), members: t.members })));
    api.post("/admin/api/app-teams", async (req, reply) => {
      const b = z.object({ name: z.string().trim().min(3).max(40), leadEmail: z.string().email(), memberEmails: z.array(z.string().email()).max(5).default([]) }).parse(req.body);
      const emails = [...new Set([b.leadEmail, ...b.memberEmails].map((e) => e.toLowerCase()))];
      const users = await db.query("SELECT id, lower(email) AS email FROM users WHERE lower(email) = ANY($1::text[])", [emails]);
      const missing = emails.filter((e) => !users.some((u) => u.email === e));
      if (missing.length) return reply.code(404).send({ error: "no_such_person", message: "Not in the app yet: " + missing.join(", ") });
      const taken = await db.query("SELECT u.email FROM app_team_members m JOIN users u ON u.id=m.user_id WHERE u.id = ANY($1::uuid[])", [users.map((u) => u.id)]);
      if (taken.length) return reply.code(409).send({ error: "already_in_team", message: "Already in an app team: " + taken.map((t) => t.email).join(", ") });
      const [dupe] = await db.query("SELECT 1 FROM app_teams WHERE lower(name)=lower($1)", [b.name]);
      if (dupe) return reply.code(409).send({ error: "name_taken", message: "That team name is already used." });
      const [t] = await db.query("INSERT INTO app_teams (name) VALUES ($1) RETURNING id", [b.name]);
      for (const u of users) await db.query("INSERT INTO app_team_members (team_id, user_id, leader) VALUES ($1,$2,$3)", [t!.id, u.id, u.email === b.leadEmail.toLowerCase()]);
      await audit(db, req, "app_team.create", "app_team", t!.id, { name: b.name, members: emails.length });
      return reply.code(201).send({ id: t!.id });
    });
    api.delete("/admin/api/app-teams/:id", async (req) => {
      const { id } = Id.parse(req.params); await db.query("DELETE FROM app_teams WHERE id=$1", [id]); await audit(db, req, "app_team.delete", "app_team", id); return { ok: true };
    });

    // ---- hackathon team names from the founders list (see lib/team-names.ts) ----
    api.get("/admin/api/team-names", async () => {
      const st = Object.fromEntries((await db.query("SELECT key, value FROM settings WHERE key IN ('team_names','team_names_at','team_names_practice_at','team_names_done_at')")).map((r) => [r.key as string, r.value as string]));
      const claims = await db.query("SELECT team_key, name, founder, mode, lead_email, pushed, claimed_at FROM team_name_claims ORDER BY claimed_at");
      const [web, app] = [await naming(db, "web"), await naming(db, "app")];
      return { enabled: st.team_names !== "off", at: st.team_names_at || null, label: web.label, windowSec: WINDOW_SEC, webPhase: web.phase, appPhase: app.phase, practiceAt: st.team_names_practice_at ?? null, doneAt: st.team_names_done_at ?? null,
        claims: claims.map((c) => ({ team: c.team_key.startsWith("app:") ? "app team" : "website team", name: c.name, founder: c.founder, mode: c.mode, leadEmail: c.lead_email, onWebsite: c.pushed, at: new Date(c.claimed_at).toISOString() })) };
    });
    // Every hackathon team with its lead and current name, and a way to change a name by hand. Website teams need the website to answer.
    api.get("/admin/api/teams", async () => {
      const claims = new Map((await db.query("SELECT team_key, name, mode, pushed FROM team_name_claims")).map((c) => [c.team_key as string, c]));
      const rows: any[] = []; let websiteReachable = true;
      let paid = new Set<string>();
      try {
        const all = await websiteTeams(true);
        paid = new Set((await db.query("SELECT lower(email) AS e FROM users WHERE pass_tier='flagship' AND lower(email) = ANY($1::text[])", [all.map((t) => t.leadEmail.toLowerCase())])).map((r) => r.e as string));
        for (const t of all) { const c = claims.get(t.id); rows.push({ eligible: paid.has(t.leadEmail.toLowerCase()), key: t.id, kind: "website", name: c?.name ?? t.name, wasName: c ? t.name : null, mode: c?.mode ?? null, onWebsite: c ? c.pushed : true, leadName: t.leadName, leadEmail: t.leadEmail }); }
      } catch { websiteReachable = false; }
      for (const t of await db.query("SELECT t.id, t.name, u.name AS lead_name, u.email FROM app_teams t JOIN app_team_members m ON m.team_id=t.id AND m.leader JOIN users u ON u.id=m.user_id")) {
        const c = claims.get("app:" + t.id); rows.push({ eligible: true, key: "app:" + t.id, kind: "app", name: c?.name ?? t.name, wasName: null, mode: c?.mode ?? null, onWebsite: true, leadName: t.lead_name, leadEmail: t.email });
      }
      rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return { websiteReachable, teams: rows };
    });
    api.post("/admin/api/teams/rename", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
      const b = z.object({ key: z.string().min(1).max(80), name: z.string().max(100) }).parse(req.body);
      let leadEmail: string | null = null;
      if (b.key.startsWith("app:")) leadEmail = (await db.query("SELECT u.email FROM app_team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=$1 AND m.leader", [b.key.slice(4)]))[0]?.email ?? null;
      else { try { leadEmail = (await websiteTeams()).find((t) => t.id === b.key)?.leadEmail ?? null; } catch { return reply.code(502).send({ error: "unavailable", message: "The website did not answer. Try again in a moment." }); } }
      if (!leadEmail) return reply.code(404).send({ error: "no_such_team", message: "That team was not found." });
      const r = await editName(db, b.key, leadEmail, b.name);
      if (!r.ok) return reply.code(r.status).send({ error: r.error, message: r.message });
      await audit(db, req, "team.rename", "team", undefined, { key: b.key, name: r.name }); return { ok: true, name: r.name };
    });

    // Start the real round now: every team lead has 100 seconds to tap, then the rest are named automatically. Or schedule it for a time, or cancel a schedule.
    const setNamesAt = async (value: string | null) => {
      if (value) await db.query("INSERT INTO settings (key,value) VALUES ('team_names_at',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [value]); else await db.query("DELETE FROM settings WHERE key='team_names_at'");
      await db.query("DELETE FROM settings WHERE key='team_names_done_at'");
    };
    api.post("/admin/api/team-names/start", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req) => {
      const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "medium" }).format(new Date()).replace(" ", "T");
      await setNamesAt(stamp); await audit(db, req, "team_names.start"); return { ok: true, startsAt: stamp };
    });
    api.post("/admin/api/team-names/schedule", { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } }, async (req, reply) => {
      const { at } = z.object({ at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) }).parse(req.body);
      if (new Date(at + ":00+05:30").getTime() < Date.now() - 60_000) return reply.code(400).send({ error: "in_the_past", message: "Pick a time that has not passed yet, or press Start now." });
      await setNamesAt(at); await audit(db, req, "team_names.schedule", undefined, undefined, { at }); return { ok: true, at };
    });
    api.post("/admin/api/team-names/cancel", async (req) => { await setNamesAt(null); await audit(db, req, "team_names.cancel"); return { ok: true }; });
    // Practice round: only for teams made in the app (e.g. the test team). Starts in 25 seconds, lasts 100 seconds, then names are given out. The real schedule is untouched.
    api.post("/admin/api/team-names/practice", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req) => {
      const stamp = await startPractice(db, 25);
      await audit(db, req, "team_names.practice"); return { ok: true, startsAt: stamp };
    });
    // Emergency button: name every team that has no name right now, whatever the clock says.
    api.post("/admin/api/team-names/run", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req) => {
      const r = await sweep(db, { web: true, app: true }); await audit(db, req, "team_names.run", undefined, undefined, { assigned: r.assigned, missing: r.missing }); return r;
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
      const summary = await db.query("SELECT c.scope, e.title, coalesce(bool_or(e.collect_od), false) AS od, count(*)::int AS n, max(c.scanned_at) AS last FROM checkins c LEFT JOIN events e ON c.scope = 'event:' || e.id::text GROUP BY c.scope, e.title ORDER BY c.scope"
);
      const rows = scope ? await db.query(`SELECT c.id AS checkin_id, u.name, u.email, u.college, u.pass_code, c.scanned_at, c.scanned_by, c.od_from, c.od_until, c.od_hours, u.reg_no, u.school, u.semester, u.section, u.gender, u.course, u.program, u.cgpa, u.details_at FROM checkins c JOIN users u ON u.id=c.user_id WHERE c.scope=$1 ORDER BY c.scanned_at DESC LIMIT 2000`, [scope]) : [];
      return { summary: summary.map((r) => ({ scope: r.scope, title: r.title ?? null, collectOd: r.od === true, count: r.n, last: new Date(r.last).toISOString() })), rows: rows.map((r) => ({ id: r.checkin_id, details: r.details_at ? { regNo: r.reg_no, school: r.school, semester: r.semester, section: r.section ?? null, gender: r.gender ?? null, course: r.course, program: r.program, cgpa: r.cgpa === null ? null : Number(r.cgpa) } : null, name: r.name, email: r.email, college: r.college, passCode: r.pass_code, at: new Date(r.scanned_at).toISOString(), odFrom: r.od_from ?? null, odUntil: r.od_until ?? null, odHours: r.od_hours === null ? null : Number(r.od_hours), scannedById: r.scanned_by ?? null, scannedByName: r.scanned_by ? config.checkNames[r.scanned_by] ?? null : null })) };
    });

    api.get("/admin/api/audit", async () => (await db.query("SELECT id, at, action, entity, entity_id, detail, ip FROM audit_log ORDER BY id DESC LIMIT 200")).map((a) => ({ ...a, at: new Date(a.at).toISOString() })));
  });
}
