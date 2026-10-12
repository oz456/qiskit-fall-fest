// Loads the REAL offline-phase schedule (Qiskit Fall Fest 2026, SRM University AP, 26–30 Oct).
// if the events table is empty. Usage: DATABASE_URL=... node scripts/seed.ts   (dev: no env → local embedded DB)
// Everything here can be edited afterwards in the admin site; extra (non-Unstop) events are added there too.
import { migrate, openDb, type Db } from "../src/db.ts";

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
const T = "+05:30";
const at = (d: string, hm: string) => `2026-10-${d}T${hm}:00${T}`;

if (n === 0) {
  const ev = (title: string, track: string, location: string, speaker: string, s: string, e: string, description: string) =>
    db.query("INSERT INTO events (title,track,location,speaker,starts_at,ends_at,description) VALUES ($1,$2,$3,$4,$5,$6,$7)", [title, track, location, speaker, s, e, description]);
  const VENUE = "SRM University AP, Amaravati";

  // The app covers the OFFLINE phase (26–30 Oct) only. Online programmes (Unstop submissions etc.) are deliberately not listed.
  await ev("Project Q – Grand Finale (24-hour Hackathon)", "Hackathon", VENUE, "SRM University AP × IBM Quantum Qiskit Fall Fest",
    at("28", "18:00"), at("29", "18:00"),
    `The finale of the Project Q hackathon: 24 hours of continuous, on-campus building for the confirmed (shortlisted) teams.
Teams build, refine and present their final solution live to the judging panel. Prize pool ₹1,00,000 plus certificates.
Starts Wed 28 Oct, 6:00 PM · ends Thu 29 Oct, 6:00 PM.`);

  await ev("Project Q – Winner Announcement", "Main", VENUE, "Judging panel",
    at("30", "11:00"), at("30", "12:00"),
    `Final results, top teams and winners of Project Q. Cash prizes, certificates and special awards, based on jury evaluation.`);

  await db.query(`INSERT INTO faqs (question,answer,position) VALUES
    ('What are the festival phases?','Online phase: 8–10 October 2026. Offline phase: 26–30 October 2026 at SRM University AP, Amaravati.',0),
    ('How do I get into the offline phase?','Only a limited number of selected participants are invited. Selection follows each programme''s eligibility and selection criteria; shortlisted teams are informed directly.',1),
    ('Where is the venue?','SRM University AP, Amaravati, Andhra Pradesh.',2)`);
  console.log("seeded real schedule");
}
await db.query("INSERT INTO settings (key,value) VALUES ('venue','SRM University AP, Amaravati') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value");
await db.query("INSERT INTO settings (key,value) VALUES ('fest_start','2026-10-26') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value");
await db.query("INSERT INTO settings (key,value) VALUES ('fest_end','2026-10-30') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value");
await db.query("INSERT INTO settings (key,value) VALUES ('fest_name','Qiskit Fall Fest 2026') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value");
await db.close();
