// Hackathon teams live on the main website. The app asks for one person's team when they open it, and relays a rename from the team lead.
import { config } from "./../config.ts";

export type TeamMember = { name: string; role: "leader" | "member"; status: "accepted" | "invited"; you: boolean };
export type Team = { name: string; vertical: string | null; problemStatementId: string | null; finalized: boolean; isLeader: boolean; members: TeamMember[] };

const cache = new Map<string, { at: number; team: Team | null }>();
const TTL_MS = 30_000;

const headers = () => ({ Authorization: `Bearer ${config.website.secret}`, Accept: "application/json", "Content-Type": "application/json" });
const url = (email?: string) => { const u = new URL(`${config.website.baseUrl}/api/integrations/qff-app/team`); if (email) u.searchParams.set("email", email); return u; };

/** The person's team, or null when they have none. Throws when the website cannot be reached (callers show "try again"). */
export async function teamOf(email: string): Promise<Team | null> {
  if (!config.website.secret) return null;
  const key = email.toLowerCase(), hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.team;
  const res = await fetch(url(key), { headers: headers(), signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`website answered ${res.status}`);
  const team = ((await res.json()) as { team?: Team | null }).team ?? null;
  if (cache.size > 2000) cache.clear();
  cache.set(key, { at: Date.now(), team });
  return team;
}

export type RenameResult = { ok: true; name: string } | { ok: false; status: number; error: string; message: string };

export async function renameTeam(email: string, name: string): Promise<RenameResult> {
  if (!config.website.secret) return { ok: false, status: 503, error: "unavailable", message: "Team names can't be changed right now." };
  const res = await fetch(url(), { method: "POST", headers: headers(), body: JSON.stringify({ email: email.toLowerCase(), name }), signal: AbortSignal.timeout(10_000) });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; name?: string; error?: string; message?: string };
  cache.clear();   // every teammate should see the new name straight away
  if (res.ok && body.ok) return { ok: true, name: body.name ?? name };
  const known = new Set(["invalid_name", "name_taken", "not_leader", "no_team"]);
  const error = body.error && known.has(body.error) ? body.error : "unavailable";
  return { ok: false, status: known.has(error) ? res.status : 502, error, message: known.has(error) && body.message ? body.message : "Team names can't be changed right now. Please try again in a minute." };
}

// ---- teams made inside the app by an organiser (see migration 021): used before the website is asked ----
import type { Db } from "../db.ts";

export async function inAppTeam(db: Db, uid: string): Promise<boolean> {
  return (await db.query("SELECT 1 FROM app_team_members WHERE user_id=$1", [uid])).length > 0;
}

export async function appTeamOf(db: Db, uid: string): Promise<Team | null> {
  const [mine] = await db.query("SELECT t.id, t.name, m.leader FROM app_team_members m JOIN app_teams t ON t.id=m.team_id WHERE m.user_id=$1", [uid]);
  if (!mine) return null;
  const rows = await db.query("SELECT u.id, u.name, m.leader FROM app_team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=$1 ORDER BY m.leader DESC, lower(u.name)", [mine.id]);
  return { name: mine.name, vertical: null, problemStatementId: null, finalized: false, isLeader: mine.leader === true,
    members: rows.map((r) => ({ name: r.name, role: r.leader ? "leader" as const : "member" as const, status: "accepted" as const, you: r.id === uid })) };
}

export async function renameAppTeam(db: Db, uid: string, name: string): Promise<RenameResult> {
  const [mine] = await db.query("SELECT t.id, m.leader FROM app_team_members m JOIN app_teams t ON t.id=m.team_id WHERE m.user_id=$1", [uid]);
  if (!mine) return { ok: false, status: 404, error: "no_team", message: "You are not in a team." };
  if (!mine.leader) return { ok: false, status: 403, error: "not_leader", message: "Only the team lead can rename the team." };
  const [clash] = await db.query("SELECT 1 FROM app_teams WHERE lower(name)=lower($1) AND id<>$2", [name, mine.id]);
  if (clash) return { ok: false, status: 409, error: "name_taken", message: `The team name "${name}" is already taken.` };
  await db.query("UPDATE app_teams SET name=$2 WHERE id=$1", [mine.id, name]);
  return { ok: true, name };
}

// ---- when renaming is allowed: the organiser's switch (settings.team_rename = 'off') and a deadline (settings.team_rename_until, IST "YYYY-MM-DDTHH:mm") ----
export const DEFAULT_RENAME_UNTIL = "2026-10-29T15:00";   // 3:00 PM IST on 29 Oct 2026 unless an organiser sets another time

const IST_FMT = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", ...o });

export async function renameWindow(db: Db, now = new Date()): Promise<{ open: boolean; note: string | null }> {
  const rows = await db.query("SELECT key, value FROM settings WHERE key IN ('team_rename','team_rename_until')");
  const set = Object.fromEntries(rows.map((r) => [r.key as string, r.value as string]));
  const raw = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(set.team_rename_until ?? "") ? set.team_rename_until! : DEFAULT_RENAME_UNTIL;
  const until = new Date(raw + ":00+05:30");
  if (set.team_rename === "off" || now >= until) return { open: false, note: null };
  const sameDay = IST_FMT({ dateStyle: "short" }).format(now) === IST_FMT({ dateStyle: "short" }).format(until);
  const time = IST_FMT({ hour: "numeric", minute: "2-digit", hour12: true }).format(until).toUpperCase();
  return { open: true, note: `You can rename your team until ${sameDay ? time : IST_FMT({ weekday: "short", day: "numeric", month: "short" }).format(until) + ", " + time}.` };
}
