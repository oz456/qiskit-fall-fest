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
