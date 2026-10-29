// Hackathon team names, handed out from the founders list. At the start time every team lead can tap "Get my team name" for 100 seconds
// (the server picks a free name at random, so two leads can never collide); when the 100 seconds are over every team still without a name
// gets one automatically, including teams whose lead never opened the app. Names are written to the website too (retried until they stick).
import type { Db } from "../db.ts";
import { FOUNDERS, RESERVE } from "./founders.ts";

/** The team name as shown everywhere (app, website): the team name with the founder in brackets, e.g. "Zepto Zoomers (Kaivalya Vohra)". */
export const fullName = (f: { team: string; founder: string }) => `${f.team} (${f.founder})`;
import { renameTeam, websiteTeams } from "./team.ts";

export type EditResult = { ok: true; name: string } | { ok: false; status: number; error: string; message: string };

export const WINDOW_SEC = 100;

export type Phase = "off" | "before" | "open" | "closed";
export type Scope = "web" | "app";   // website teams use the real schedule; teams made in the app can also have a practice schedule
export type Naming = { phase: Phase; startsAt: Date; endsAt: Date; label: string | null; scheduled: boolean };   // label = "11:30 AM" or "Fri 30 Oct, 11:30 AM"; null while nothing is scheduled

const IST = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", ...o });

async function settings(db: Db) {
  const rows = await db.query("SELECT key, value FROM settings WHERE key IN ('team_names','team_names_at','team_names_practice_at','team_names_done_at')");
  return Object.fromEntries(rows.map((r) => [r.key as string, r.value as string]));
}

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export async function naming(db: Db, scope: Scope = "web", now = new Date()): Promise<Naming> {
  const st = await settings(db);
  // nothing happens until an organiser presses "Start now" or schedules a time (Admin, Events); a practice round overrides it for teams made in the app
  const real = STAMP.test(st.team_names_at ?? "") ? st.team_names_at! : null;
  const raw = scope === "app" && STAMP.test(st.team_names_practice_at ?? "") ? st.team_names_practice_at! : real;
  if (!raw) return { phase: st.team_names === "off" ? "off" : "before", startsAt: new Date(8.64e15), endsAt: new Date(8.64e15), label: null, scheduled: false };
  const startsAt = new Date((raw.length === 16 ? raw + ":00" : raw) + "+05:30"), endsAt = new Date(startsAt.getTime() + WINDOW_SEC * 1000);
  const phase: Phase = st.team_names === "off" ? "off" : now < startsAt ? "before" : now < endsAt ? "open" : "closed";
  const time = IST({ hour: "numeric", minute: "2-digit", hour12: true }).format(startsAt).toUpperCase();
  const sameDay = IST({ dateStyle: "short" }).format(now) === IST({ dateStyle: "short" }).format(startsAt);
  return { phase, startsAt, endsAt, scheduled: true, label: sameDay ? time : `${IST({ weekday: "short", day: "numeric", month: "short" }).format(startsAt)}, ${time}` };
}

export type Claim = { team_key: string; name: string; founder: string; mode: string; lead_email: string | null; pushed: boolean };

export async function claimOf(db: Db, teamKey: string): Promise<Claim | undefined> {
  return (await db.query("SELECT team_key, name, founder, mode, lead_email, pushed FROM team_name_claims WHERE team_key=$1", [teamKey]))[0] as Claim | undefined;
}

/** Give this team a free name, chosen at random. Safe to call twice and from many leads at once: the unique index decides, and a loser just picks again. */
export async function claimName(db: Db, teamKey: string, leadEmail: string | null, mode: "tap" | "auto", alsoTaken: Iterable<string> = []): Promise<Claim | null> {
  const outside = new Set([...alsoTaken].map((n) => n.toLowerCase()));
  for (let i = 0; i < 30; i++) {
    const have = await claimOf(db, teamKey); if (have) return have;
    const used = new Set((await db.query("SELECT lower(name) AS n FROM team_name_claims")).map((r) => r.n as string));
    const isFree = (f: { team: string; founder: string }) => !used.has(fullName(f).toLowerCase()) && !outside.has(fullName(f).toLowerCase());
    // the 50 founders first, then the reserve founders, and a plain numbered name if even those are gone: a team is never left without one
    let free = FOUNDERS.filter(isFree); if (!free.length) free = RESERVE.filter(isFree);
    let pick: { name: string; founder: string };
    if (free.length) { const f = free[Math.floor(Math.random() * free.length)]!; pick = { name: fullName(f), founder: f.founder }; }
    else { let n = 1; while (used.has(`quantum team ${n}`) || outside.has(`quantum team ${n}`)) n++; pick = { name: `Quantum Team ${n}`, founder: "Qiskit Fall Fest" }; }
    const r = await db.query("INSERT INTO team_name_claims (team_key, name, founder, mode, lead_email) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING team_key", [teamKey, pick.name, pick.founder, mode, leadEmail]);
    if (r[0]) return (await claimOf(db, teamKey))!;
  }
  return null;
}

/** Write the claimed name to wherever the team lives (the website, or the app's own table). Returns true when done. */
export async function pushClaim(db: Db, c: Claim): Promise<boolean> {
  try {
    if (c.team_key.startsWith("app:")) { await db.query("UPDATE app_teams SET name=$2 WHERE id=$1", [c.team_key.slice(4), c.name]); }
    else {
      if (!c.lead_email) return false;
      const r = await renameTeam(c.lead_email, c.name);
      if (!r.ok) return false;
    }
    await db.query("UPDATE team_name_claims SET pushed=true WHERE team_key=$1", [c.team_key]); return true;
  } catch { return false; }
}

/** Start a practice round for the teams made in the app: old practice names are cleared, the window opens after `delaySec`, and lasts 100 seconds. Real teams and the real schedule are untouched. */
export async function startPractice(db: Db, delaySec: number): Promise<string> {
  const stamp = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "medium" }).format(new Date(Date.now() + delaySec * 1000)).replace(" ", "T");
  await db.query("DELETE FROM team_name_claims WHERE team_key LIKE 'app:%'");
  await db.query("INSERT INTO settings (key,value) VALUES ('team_names_practice_at',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [stamp]);
  return stamp;
}

let running = false;
export const scopeOf = (teamKey: string): Scope => (teamKey.startsWith("app:") ? "app" : "web");

/** Name every team that has none, and write unwritten names to the website. Idempotent; returns what is still missing. */
export async function sweep(db: Db, which: { web: boolean; app: boolean }): Promise<{ assigned: number; pushed: number; missing: number; websiteReachable: boolean }> {
  if (running) return { assigned: 0, pushed: 0, missing: -1, websiteReachable: true };
  running = true;
  try {
    const teams: { key: string; leadEmail: string; name: string }[] = [];
    let reachable = true; const taken: string[] = [];
    if (which.web) { try { for (const t of await websiteTeams(true)) { teams.push({ key: t.id, leadEmail: t.leadEmail, name: t.name }); taken.push(t.name); } } catch { reachable = false; } }
    if (which.app) for (const t of await db.query("SELECT t.id, t.name, u.email FROM app_teams t JOIN app_team_members m ON m.team_id=t.id AND m.leader JOIN users u ON u.id=m.user_id")) teams.push({ key: "app:" + t.id, leadEmail: t.email, name: t.name });
    let assigned = 0, pushed = 0, missing = 0;
    for (const t of teams) {
      let c: Claim | null | undefined = await claimOf(db, t.key);
      if (!c) { c = await claimName(db, t.key, t.leadEmail, "auto", taken.filter((n) => n !== t.name)); if (c) assigned++; }
      if (!c) { missing++; continue; }
      if (!c.pushed && (await pushClaim(db, c))) pushed++; else if (!c.pushed) missing++;
    }
    if (which.web && reachable && missing === 0) await db.query("INSERT INTO settings (key,value) VALUES ('team_names_done_at',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [new Date().toISOString()]);
    return { assigned, pushed, missing, websiteReachable: reachable };
  } finally { running = false; }
}

/** Once a window's 100 seconds are over, name every team still without one. Cheap to call often. */
export async function maybeSweep(db: Db): Promise<void> {
  try {
    const [web, app] = [await naming(db, "web"), await naming(db, "app")];
    const [done] = await db.query("SELECT value FROM settings WHERE key='team_names_done_at'");
    const webNeeded = web.phase === "closed" && !(done && new Date(done.value) > web.endsAt), appNeeded = app.phase === "closed";
    if (webNeeded || appNeeded) await sweep(db, { web: webNeeded, app: appNeeded });
  } catch { /* the next call tries again */ }
}

/** Change a team's name by hand (the team lead in the app, or an organiser in the admin). The name must be 3 to 40 characters and not used by any other team; it is written to the website too. */
export async function editName(db: Db, teamKey: string, leadEmail: string | null, raw: string): Promise<EditResult> {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length < 3 || name.length > 40 || /[\u0000-\u001f<>]/.test(name)) return { ok: false, status: 400, error: "invalid_name", message: "A team name must be 3 to 40 characters." };
  const taken = (m: string): EditResult => ({ ok: false, status: 409, error: "name_taken", message: m });
  const [clash] = await db.query("SELECT 1 FROM team_name_claims WHERE lower(name)=lower($1) AND team_key<>$2", [name, teamKey]);
  if (clash) return taken(`The team name "${name}" is already taken.`);
  if (!teamKey.startsWith("app:")) {
    try { if ((await websiteTeams()).some((t) => t.id !== teamKey && t.name.toLowerCase() === name.toLowerCase())) return taken(`The team name "${name}" is already taken.`); } catch { /* the website's own check decides */ }
  }
  try {
    await db.query(`INSERT INTO team_name_claims (team_key, name, founder, mode, lead_email, pushed) VALUES ($1,$2,'Edited by hand','edit',$3,false)
      ON CONFLICT (team_key) DO UPDATE SET name=EXCLUDED.name, mode='edit', lead_email=COALESCE(EXCLUDED.lead_email, team_name_claims.lead_email), pushed=false`, [teamKey, name, leadEmail]);
  } catch (e: any) { if (e?.code === "23505") return taken(`The team name "${name}" is already taken.`); throw e; }
  const c = await claimOf(db, teamKey); if (c) await pushClaim(db, c);   // if the website is slow, the sweep keeps trying; the app already shows the new name
  return { ok: true, name };
}
