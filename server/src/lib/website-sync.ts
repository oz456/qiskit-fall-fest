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
  passTier?: "general" | "flagship" | null; // verified festival pass on the website (undefined = this feed does not say)
}
export interface SyncCounts { seen: number; created: number; updated: number; skipped: number }

/** SRM students are name_surname@srmap.edu.in, faculty name.surname@srmap.edu.in. Only a label for admin: it never grants or blocks anything. */
export function classifyEmail(email: string): Kind {
  const e = email.trim().toLowerCase(); const at = e.lastIndexOf("@");
  if (at < 1 || e.slice(at + 1) !== "srmap.edu.in") return "external";
  const local = e.slice(0, at); const us = local.includes("_"), dot = local.includes(".");
  return us && !dot ? "student" : dot && !us ? "faculty" : "unclear";
}

export const isSrmEmail = (email: string) => email.trim().toLowerCase().endsWith("@srmap.edu.in");

/** krish_shrivastava@srmap.edu.in -> "Krish Shrivastava"; gyan.sah@srmap.edu.in -> "Gyan Sah". A stand-in until the website's real name arrives. */
export function nameFromEmail(email: string): string {
  const local = email.trim().toLowerCase().split("@")[0] ?? "";
  const words = local.split(/[._\-+]+/).map((w) => w.replace(/\d+$/g, "")).filter((w) => w.length > 0);
  const name = words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
  return (name || local).slice(0, 120);
}

const EMAIL = /^[^\s@]{1,100}@[^\s@]{1,100}\.[^\s@]{2,30}$/;

export async function allocate(q: Queryable, email: string, name: string, college: string | null, kind: Kind, source: "website" | "srm" = "website", derived = false, passTier: string | null = null): Promise<string | null> {
  for (let i = 0; i < 8; i++) {
    const code = `QFF-${randomInt(1000, 100000)}`;
    const r = await q.query("INSERT INTO users (email,name,college,pass_code,pass_secret,kind,source,name_derived,pass_tier) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id", [email, name, college, code, randomBytes(32), kind, source, derived, passTier]);
    if (r[0]) return r[0].id as string;
    if ((await q.query("SELECT 1 FROM users WHERE lower(email)=$1", [email]))[0]) return null;
  }
  throw new Error("could not allocate pass code");
}

export async function upsertPeople(db: Db, people: WebsitePerson[]): Promise<SyncCounts & { failed: string[] }> {
  const out = { seen: people.length, created: 0, updated: 0, skipped: 0, failed: [] as string[] };
  // one lookup for the whole batch: most people already exist and need no further queries
  const wanted = [...new Set(people.map((p) => String(p.email ?? "").trim().toLowerCase()).filter(Boolean))];
  const known = new Map<string, any>((await db.query("SELECT lower(email) AS e, id, status, source, college, name, name_derived, pass_tier FROM users WHERE lower(email) = ANY($1::text[])", [wanted])).map((r) => [r.e as string, r]));
  for (const p of people) {
    try {
      const email = String(p.email ?? "").trim().toLowerCase();
      const given = String(p.name ?? "").trim().slice(0, 120);
      const name = given || nameFromEmail(email);
      if (!EMAIL.test(email) || (p.role && p.role !== "participant")) { out.skipped++; continue; }
      const college = p.institution ? String(p.institution).trim().slice(0, 160) || null : null;
      const cur = known.get(email);
      if (!cur) {
        if (p.isActive === false) { out.skipped++; continue; }   // switched off on the website and never seen here: nothing to add
        // SRM addresses can always sign in; anyone else is only let in with a verified pass
        if (!isSrmEmail(email) && !p.passTier) { out.skipped++; continue; }
        if (await allocate(db, email, name, college, classifyEmail(email), "website", !given, p.passTier ?? null)) out.created++;
      } else {
        // admin decisions are never overwritten; a blank college is filled; website-sourced people follow the website's on/off switch
        if (!cur.college && college) { await db.query("UPDATE users SET college=$2 WHERE id=$1", [cur.id, college]); out.updated++; }
        // a name guessed from the email is replaced by the real one; a name that was set properly is never touched
        if (cur.name_derived && given && given !== cur.name) { await db.query("UPDATE users SET name=$2, name_derived=false WHERE id=$1", [cur.id, given]); out.updated++; }
        if (p.passTier !== undefined && (p.passTier ?? null) !== cur.pass_tier) { await db.query("UPDATE users SET pass_tier=$2 WHERE id=$1", [cur.id, p.passTier ?? null]); out.updated++; }
        if (p.isActive === false && cur.source === "website" && cur.status === "active") { await db.query("UPDATE users SET status='blocked' WHERE id=$1", [cur.id]); out.updated++; }
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
  const total: SyncCounts = { seen: 0, created: 0, updated: 0, skipped: 0 }; const failed: string[] = [];
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
    // second feed: who holds a verified ₹99 / ₹499 pass (sets pass_tier, and lets outside pass-holders in)
    let passesOk = false;
    try {
      let pc: string | null = null; const seenPass = new Set<string>();
      for (let page = 0; page < 100; page++) {
        const url = new URL(`${baseUrl}/api/integrations/qff-app/passes`); url.searchParams.set("limit", "500"); if (pc) url.searchParams.set("cursor", pc);
        const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" }, signal: AbortSignal.timeout(25_000) });
        if (!res.ok) throw new Error(`passes feed answered ${res.status}`);
        const body = (await res.json()) as { people?: { email: string; name?: string; tier: "general" | "flagship" }[]; nextCursor?: string | null };
        if (!Array.isArray(body.people)) throw new Error("passes feed has an unexpected shape");
        for (const x of body.people) seenPass.add(String(x.email).toLowerCase());
        const r = await upsertPeople(db, body.people.map((x) => ({ email: x.email, name: x.name ?? "", passTier: x.tier })));
        total.created += r.created; total.updated += r.updated; failed.push(...r.failed);
        pc = body.nextCursor ?? null; if (!pc) break;
      }
      if (seenPass.size === 0) throw new Error("passes feed was empty"); // never wipe pass marks because of an empty answer
      // anyone we marked as a pass-holder who is no longer verified on the website loses the mark
      await db.query("UPDATE users SET pass_tier=NULL WHERE pass_tier IS NOT NULL AND NOT (lower(email) = ANY($1::text[]))", [[...seenPass]]);
      passesOk = true;
    } catch (e: any) { failed.push(`passes: ${e.message}`); }
    if (passesOk) await db.query("INSERT INTO settings (key,value) VALUES ('passes_synced_at',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [new Date().toISOString()]);
    await db.query("UPDATE sync_runs SET status='ok', finished_at=now(), seen=$2, created=$3, updated=$4, skipped=$5, error=$6 WHERE id=$1",
      [run!.id, total.seen, total.created, total.updated, total.skipped, failed.length ? failed.slice(0, 5).join("; ").slice(0, 500) : null]);
    return { ok: true, message: `Seen ${total.seen}, added ${total.created}, updated ${total.updated}.`, counts: total };
  } catch (e: any) {
    await db.query("UPDATE sync_runs SET status='failed', finished_at=now(), error=$2 WHERE id=$1", [run!.id, String(e.message).slice(0, 500)]);
    return { ok: false, message: `Sync failed: ${e.message}` };
  }
}
