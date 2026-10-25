// Keeps the attendee list in step with the main website (www.qffsrmap2026.com), which owns "who is registered / who paid".
// One-way: website -> here. Attendance, passes and photos stay here. Everything is idempotent (matched by lowercase email).
import { randomBytes, randomInt } from "node:crypto";
import { config } from "../config.ts";
import type { Db, Queryable } from "../db.ts";

export type Kind = "student" | "faculty" | "unclear" | "external";
export interface WebsitePerson {
  email: string;
  name: string;
  institution?: string | null;
  isActive?: boolean;       // website whitelist flag; false = switched off there
  role?: string;            // website role: only "participant" becomes an attendee here
  flagshipPass?: boolean;   // a verified Rs 499 flagship pass -> registered for the flagship event
}
export interface SyncCounts { seen: number; created: number; updated: number; skipped: number; registered: number }

/** SRM students are name_surname@srmap.edu.in, faculty name.surname@srmap.edu.in. Only a label for admin: it never grants or blocks anything. */
export function classifyEmail(email: string): Kind {
  const e = email.trim().toLowerCase(); const at = e.lastIndexOf("@");
  if (at < 1 || e.slice(at + 1) !== "srmap.edu.in") return "external";
  const local = e.slice(0, at); const us = local.includes("_"), dot = local.includes(".");
  return us && !dot ? "student" : dot && !us ? "faculty" : "unclear";
}

const EMAIL = /^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{2,30}$/;
export const FLAGSHIP_SETTING = "flagship_event_id";

async function allocate(q: Queryable, email: string, name: string, college: string | null, kind: Kind): Promise<string | null> {
  for (let i = 0; i < 8; i++) {
    const code = `QFF-${randomInt(1000, 100000)}`;
    const r = await q.query("INSERT INTO users (email,name,college,pass_code,pass_secret,kind,source) VALUES ($1,$2,$3,$4,$5,$6,'website') ON CONFLICT DO NOTHING RETURNING id", [email, name, college, code, randomBytes(32), kind]);
    if (r[0]) return r[0].id as string;
    if ((await q.query("SELECT 1 FROM users WHERE lower(email)=$1", [email]))[0]) return null;
  }
  throw new Error("could not allocate pass code");
}

export async function upsertPeople(db: Db, people: WebsitePerson[]): Promise<SyncCounts & { failed: string[] }> {
  const out = { seen: people.length, created: 0, updated: 0, skipped: 0, registered: 0, failed: [] as string[] };
  const [fs] = await db.query("SELECT value FROM settings WHERE key=$1", [FLAGSHIP_SETTING]);
  const flagship = fs?.value && /^[0-9a-f-]{36}$/.test(fs.value) ? (await db.query("SELECT id FROM events WHERE id=$1", [fs.value]))[0]?.id as string | undefined : undefined;
  for (const p of people) {
    try {
      const email = String(p.email ?? "").trim().toLowerCase();
      const name = String(p.name ?? "").trim().slice(0, 120) || email.split("@")[0]!.replace(/[._]+/g, " ");
      if (!EMAIL.test(email) || (p.role && p.role !== "participant")) { out.skipped++; continue; }
      const college = p.institution ? String(p.institution).trim().slice(0, 160) || null : null;
      const [cur] = await db.query("SELECT id, status, source, college FROM users WHERE lower(email)=$1", [email]);
      let id = cur?.id as string | undefined;
      if (!cur) {
        if (p.isActive === false) { out.skipped++; continue; }   // switched off on the website and never seen here: nothing to add
        id = (await allocate(db, email, name, college, classifyEmail(email))) ?? undefined;
        if (id) out.created++;
      } else {
        // names and admin decisions are never overwritten; a blank college is filled; website-sourced people follow the website's on/off switch
        if (!cur.college && college) { await db.query("UPDATE users SET college=$2 WHERE id=$1", [cur.id, college]); out.updated++; }
        if (p.isActive === false && cur.source === "website" && cur.status === "active") { await db.query("UPDATE users SET status='blocked' WHERE id=$1", [cur.id]); out.updated++; }
      }
      if (id && p.flagshipPass && flagship) {
        out.registered += (await db.query("INSERT INTO user_events (user_id,event_id,kind) VALUES ($1,$2,'registered') ON CONFLICT DO NOTHING RETURNING 1", [id, flagship])).length;
      }
    } catch (e: any) { out.failed.push(`${p.email}: ${e.message}`); }
  }
  return out;
}

/** Pulls the website's full export page by page and applies it. At most one run at a time (a run older than 5 minutes is considered dead). */
export async function reconcile(db: Db, trigger: "scheduler" | "admin"): Promise<{ ok: boolean; message: string; counts?: SyncCounts }> {
  const { baseUrl, secret } = config.website;
  if (!secret) return { ok: false, message: "Website sync is not configured (SYNC_SECRET)." };
  const [busy] = await db.query("SELECT 1 FROM sync_runs WHERE status='running' AND started_at > now() - interval '5 minutes'");
  if (busy) return { ok: false, message: "A sync is already running." };
  const [run] = await db.query("INSERT INTO sync_runs (trigger) VALUES ($1) RETURNING id", [trigger]);
  const total: SyncCounts = { seen: 0, created: 0, updated: 0, skipped: 0, registered: 0 }; const failed: string[] = [];
  try {
    let cursor: string | null = null;
    for (let page = 0; page < 100; page++) {
      const url = new URL(`${baseUrl}/api/integrations/qff-app/attendees`); url.searchParams.set("limit", "500"); if (cursor) url.searchParams.set("cursor", cursor);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" }, signal: AbortSignal.timeout(25_000) });
      if (!res.ok) throw new Error(`website answered ${res.status}`);
      const body = (await res.json()) as { people?: WebsitePerson[]; nextCursor?: string | null };
      if (!Array.isArray(body.people)) throw new Error("website export has an unexpected shape");
      const r = await upsertPeople(db, body.people);
      for (const k of Object.keys(total) as (keyof SyncCounts)[]) total[k] += r[k];
      failed.push(...r.failed);
      cursor = body.nextCursor ?? null; if (!cursor) break;
    }
    await db.query("UPDATE sync_runs SET status='ok', finished_at=now(), seen=$2, created=$3, updated=$4, skipped=$5, registered=$6, error=$7 WHERE id=$1",
      [run!.id, total.seen, total.created, total.updated, total.skipped, total.registered, failed.length ? failed.slice(0, 5).join("; ").slice(0, 500) : null]);
    return { ok: true, message: `Seen ${total.seen}, added ${total.created}, updated ${total.updated}, registered ${total.registered} for the flagship event.`, counts: total };
  } catch (e: any) {
    await db.query("UPDATE sync_runs SET status='failed', finished_at=now(), error=$2 WHERE id=$1", [run!.id, String(e.message).slice(0, 500)]);
    return { ok: false, message: `Sync failed: ${e.message}` };
  }
}
