import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config, isProd } from "./config.ts";

export type Row = Record<string, any>;
export interface Queryable { query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]> }
export interface Db extends Queryable { tx<R>(fn: (q: Queryable) => Promise<R>): Promise<R>; close(): Promise<void> }

export async function openDb(): Promise<Db> {
  if (config.databaseUrl) {
    const pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 5,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 8_000,
      statement_timeout: 10_000,
      ssl: isProd ? { rejectUnauthorized: true } : undefined,
    });
    pool.on("error", (err) => console.error("pg pool error", err.message));
    return {
      async query(sql, params) { return (await pool.query(sql, params as any[])).rows; },
      async tx(fn) {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const r = await fn({ query: async (s, p) => (await c.query(s, p as any[])).rows });
          await c.query("COMMIT");
          return r;
        } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
      },
      close: () => pool.end(),
    };
  }
  if (isProd) throw new Error("DATABASE_URL required in production");
  // Zero-setup local dev/test: embedded Postgres (WASM). Not used in production.
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(process.env.NODE_ENV === "test" ? undefined : ".pglite");
  return {
    async query(sql, params) { return (await db.query(sql, params as any[])).rows as any[]; },
    async tx(fn) { return db.transaction((t) => fn({ query: async (s, p) => (await t.query(s, p as any[])).rows as any[] })); },
    close: () => db.close(),
  };
}

export async function migrate(db: Db): Promise<void> {
  await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name));
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(dir, f), "utf8");
    // Run each migration atomically, statement by statement (PGlite / extended protocol safe).
    await db.tx(async (q) => {
      for (const stmt of sql.split(/;\s*(?:\r?\n|$)/).map((s) => s.trim()).filter(Boolean)) await q.query(stmt);
      await q.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
    });
    console.log("migration applied:", f);
  }
}
