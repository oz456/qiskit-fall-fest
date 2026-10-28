// Logical backup/restore of everything that matters (ephemeral tables like OTP codes and sessions are skipped:
// after a restore people simply sign in again).
import type { Db, Queryable } from "../db.ts";

// Parents before children so FK constraints hold on restore.
export const TABLES = ["settings", "users", "app_teams", "app_team_members", "user_photos", "events", "user_events", "announcements", "tickets", "ticket_messages", "faqs", "checkins", "audit_log"] as const;

const enc = (v: unknown): unknown => (v instanceof Uint8Array ? { $hex: Buffer.from(v).toString("hex") } : v instanceof Date ? v.toISOString() : v);
const dec = (v: unknown): unknown => (v && typeof v === "object" && "$hex" in (v as any) ? Buffer.from((v as any).$hex, "hex") : v);

export async function exportTables(db: Queryable) {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const t of TABLES) {
    const rows = await db.query(`SELECT * FROM ${t}`);
    tables[t] = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, enc(v)])));
  }
  return { format: "qff-backup", version: 1, createdAt: new Date().toISOString(), counts: Object.fromEntries(TABLES.map((t) => [t, tables[t]!.length])), tables };
}

/** Replaces the contents of every backed-up table with the backup's rows, atomically. DESTRUCTIVE. */
export async function importTables(db: Db, data: Awaited<ReturnType<typeof exportTables>>) {
  if (data.format !== "qff-backup" || data.version !== 1) throw new Error("not a qff backup file");
  await db.tx(async (q) => {
    for (const t of [...TABLES].reverse()) await q.query(`DELETE FROM ${t}`);
    for (const t of TABLES) {
      for (const row of data.tables[t] ?? []) {
        const cols = Object.keys(row);
        if (!cols.length) continue;
        await q.query(`INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(",")})`, cols.map((c) => {
          const v = dec(row[c]);
          return v !== null && typeof v === "object" && !(v instanceof Uint8Array) ? JSON.stringify(v) : v; // jsonb columns
        }));
      }
    }
    // audit_log.id is bigserial: keep the sequence ahead of restored ids
    await q.query("SELECT setval(pg_get_serial_sequence('audit_log','id'), COALESCE((SELECT max(id) FROM audit_log), 0) + 1, false)");
  });
}
