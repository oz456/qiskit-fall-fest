// Loads the REAL schedule (Qiskit Fall Fest 2026, SRM University AP — the 6 programmes open on Unstop at time of writing)
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
const SITE = "https://www.qffsrmap2026.com";

if (n === 0) {
  const ev = (title: string, track: string, location: string, speaker: string, s: string, e: string, description: string) =>
    db.query("INSERT INTO events (title,track,location,speaker,starts_at,ends_at,description) VALUES ($1,$2,$3,$4,$5,$6,$7)", [title, track, location, speaker, s, e, description]);

  await ev("Hackathon – Project Q", "Hackathon", "Online → SRM University AP, Amaravati", "SRM University AP × IBM Quantum Qiskit Fall Fest",
    at("08", "00:00"), at("30", "12:00"),
    `Hybrid quantum hackathon. Teams of 2–6. Prize pool ₹1,00,000 + certificates.

Stages
• 8–12 Oct — Phase 1: online development sprint. Team lead submits the GitHub repository at ${SITE}/learning/hackathon by 12 Oct, 11:59 PM IST.
• 13–17 Oct — Shortlisting announced (rolling basis).
• 18–27 Oct — Offline registration for shortlisted teams (₹499 to confirm a spot).
• 28 Oct, 6:00 PM → 29 Oct, 6:00 PM — Grand Finale: 24-hour continuous offline hackathon at SRM University AP.
• 30 Oct, 11:00 AM — Winner announcement.`);

  await ev("Tech Reels Competition", "Competition", "Online", "SRM University AP",
    at("08", "00:00"), at("12", "23:59"),
    `Part of Day 1 – Foundations. Individual participation.
Create an engaging short-form reel that explains or showcases a technology concept.
Submit at ${SITE}/learning?challenge=1 before 11:59 PM IST on 12 Oct. Late submissions are not considered. Participation certificate for all.`);

  await ev("QISKIT 101 – Exploring Track (open to everyone)", "Workshop", "Online", "SRM University AP",
    at("08", "00:00"), at("12", "23:59"),
    `Your gateway to quantum computing: a foundational course with expert-led sessions, interactive learning and hands-on experiences.
Open to everyone — no age limit, no degree and no prior experience needed. Participation certificate.`);

  await ev("Digital Poster Creation", "Competition", "Online", "SRM University AP",
    at("09", "00:00"), at("12", "23:59"),
    `Part of Day 2. Individual participation.
Design one original digital poster on a chosen theme (e.g. “A Decade of Quantum on the Cloud”), publish it on your public social-media account, tag the official Fall Fest account, use the event hashtag, and submit the post link plus the poster file on the official website.
Submission deadline 12 Oct, 11:59 PM IST. Three overall winners; likes and followers don't count. Results on 15 Oct.`);

  await ev("Essay Competition", "Competition", "Online", "SRM University AP",
    at("08", "00:00"), at("12", "23:59"),
    `Part of Day 3 – Advanced Applications & Hackathon Launch. Individual participation.
Write an original essay on one of the 23 approved themes (e.g. “The Quantum Cloud: Democratizing the Power of Tomorrow”).
Submit on the official website by 12 Oct, 11:59 PM IST. Result announcement: 14 Oct, 5:00 PM IST. Cash prize ₹5,000 + certificate.`);

  await ev("Python Coding Challenge in Qiskit", "Competition", "Online", "SRM University AP",
    at("08", "00:00"), at("12", "23:59"),
    `Online individual programming competition: solve quantum-computing problems with Python and IBM Qiskit inside the competition window.
Solutions are scored on published test cases, followed by technical verification before final results. Open to undergraduate and postgraduate students across disciplines.`);

  await db.query(`INSERT INTO faqs (question,answer,position) VALUES
    ('What are the festival phases?','Online phase: 8–10 October 2026. Offline phase: 26–30 October 2026 at SRM University AP, Amaravati.',0),
    ('How do I get into the offline phase?','Only a limited number of selected participants are invited. Selection follows each programme''s eligibility and selection criteria; shortlisted teams are informed directly.',1),
    ('Who can join QISKIT 101?','Anyone — no age limit, degree or prior experience required.',2),
    ('Where do I submit my work?','Submissions go through the official website, ${SITE}, as described on each event page.',3)`);
  console.log("seeded real schedule");
}
await db.query("INSERT INTO settings (key,value) VALUES ('venue','SRM University AP, Amaravati') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value");
await db.query("INSERT INTO settings (key,value) VALUES ('fest_name','Qiskit Fall Fest 2026') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value");
await db.close();
