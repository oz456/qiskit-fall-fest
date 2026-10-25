// Loads the official offline-phase schedule (scripts/schedule.ts, from the poster) and, on a fresh database, the starter FAQs.
// Safe to re-run: events already present (same title + start) are skipped, nothing is updated or deleted.
// Usage: DATABASE_URL=... node scripts/seed.ts   (dev: no env → local embedded DB)
// Everything here can be edited afterwards in the admin site.
import { migrate, openDb, type Db } from "../src/db.ts";
import { seedSchedule } from "./schedule.ts";

// Some networks block the raw Postgres wire protocol. DB_DRIVER=neon-http seeds Neon over HTTPS (port 443) instead.
// (The service itself always uses the normal driver; it runs migrations on boot.)
async function open(): Promise<Db> {
  if (process.env.DB_DRIVER !== "neon-http") { const d = await openDb(); await migrate(d); return d; }
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL!);
  return {
    query: async (text, params) => (await sql.query(text, (params ?? []) as any[])) as any[],
    tx: async () => { throw new Error("tx unsupported over HTTP"); },
    close: async () => {},
  };
}
const db = await open();
const [{ n }] = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM events");

console.log("schedule:", await seedSchedule(db));

if (n === 0) {
  await db.query(`INSERT INTO faqs (question,answer,position) VALUES
    ('What are the festival phases?','Online phase: 8–10 October 2026. Offline phase: 26–30 October 2026 at SRM University AP, Amaravati.',0),
    ('How do I get into the offline phase?','Only a limited number of selected participants are invited. Selection follows each programme''s eligibility and selection criteria; shortlisted teams are informed directly.',1),
    ('Where is the venue?','SRM University AP, Amaravati, Andhra Pradesh.',2)`);
  console.log("seeded FAQs");
}
await db.query("INSERT INTO settings (key,value) VALUES ('venue','SRM University AP, Amaravati') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value");
await db.query("INSERT INTO settings (key,value) VALUES ('fest_start','2026-10-26') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value");
await db.query("INSERT INTO settings (key,value) VALUES ('fest_end','2026-10-30') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value");
await db.query("INSERT INTO settings (key,value) VALUES ('fest_name','Qiskit Fall Fest 2026') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value");
await db.close();
