// The official five-day schedule, copied row for row from the poster "schedule of qff.jpeg" (26–30 Oct 2026, IST).
// Rows, times and venues are the poster's. Speakers come from the earlier offline schedule (the poster lists none); descriptions stay empty.
import type { Queryable } from "../src/db.ts";

type Track = "Main" | "Workshop" | "Talk" | "Hackathon" | "Social" | "Competition";
const AUD = "Auditorium, X-Lab", ALC = "CV Raman Block – ALC Classrooms", ATRIUM = "Atrium, V-Block (SR Block)";
// [day, start, end, title, track, location, speaker]
const ROWS: [number, string, string, string, Track, string, string][] = [
  [26, "10:00", "10:55", "Inauguration Ceremony (Welcome, Lamp Ceremony, Addresses)", "Main", AUD, "Dr. Varsha, Prof. C.V. Tomy, Prof. Somnath Bhattacharyya, Prof. Ch. Satish Kumar"],
  [26, "11:10", "13:00", "Special Addresses by Guest Speakers", "Talk", AUD, "Atul Tripathi, Prof. Durga B. Rao Dasari"],
  [26, "14:00", "15:05", "Hands-on In-Class Modules (Briefing & Guided Session)", "Workshop", AUD, "Gyan"],
  [26, "15:30", "16:30", "QTalk – 2-Minute Quantum Talk (Parallel)", "Social", ALC, "Student Organizing Committee"],
  [26, "15:30", "16:30", "Quantum Word Puzzles / Quantum Skribble (Parallel)", "Social", ALC, "Student Organizing Committee"],

  [27, "10:00", "11:30", "Industry Expert Speeches (1 – 5)", "Talk", AUD, "Qbit Force, Vijay Krishna Somaraju, Amitab Dev Lab, Krishnapriya, Lakshmi"],
  [27, "11:30", "13:00", "QCTF – Competition Block I", "Competition", AUD, "QCTF Team"],
  [27, "11:30", "13:00", "Open Games (QChess, Quantum Casino, Entanglement Partners, QEscapes)", "Social", ALC, "Jaswanth, Pujith, Jyoshna, Student Organizing Committee"],
  [27, "14:00", "15:15", "QCTF – Competition Block II", "Competition", AUD, "QCTF Team"],
  [27, "15:30", "17:30", "QCTF – Final Challenge Window & Leaderboard Freeze", "Competition", AUD, "QCTF Team"],

  [28, "10:00", "10:20", "Day 3 Opening & Activity Briefing", "Main", AUD, "Organizing Team"],
  [28, "10:00", "17:00", "Quantum Tech Expo (Day 2)", "Main", ATRIUM, "Exhibitors / Student Teams"],
  [28, "10:00", "13:00", "Quantum Startup Pitch Fest (Parallel Event)", "Competition", "Mini-Auditorium, SR Block", ""],
  [28, "10:20", "13:00", "Hands-on Workshops (1 & 2)", "Workshop", AUD, "Bharadwaj Mummaneni"],
  [28, "14:00", "15:15", "Conclave / Debate – Quantum vs Classical", "Social", "Grand Stairs (V Block, SR Block)", "Moderators / Participants"],
  [28, "16:00", "16:30", "QTalk – Open Round", "Social", ALC, "Student Organizing Committee"],
  [28, "17:40", "18:00", "Hackathon Phase 2 – Opening Ceremony", "Hackathon", AUD, "Sathish A."],

  [29, "10:00", "17:00", "Quantum Tech Expo (Day 3)", "Main", ATRIUM, "Exhibitors / Student Teams"],
  [29, "10:00", "13:00", "Hands-on Workshop 3 – Sample Then Diagonalize", "Workshop", AUD, "Bharadwaj Mummaneni"],
  [29, "11:30", "13:00", "Hands-on Workshop 4 – Hands-on Projects & Submission", "Workshop", AUD, ""],
  [29, "15:30", "16:30", "Quantum Casino / QEscapes (Parallel)", "Social", ALC, "Pujith, Jyoshna"],
  [29, "16:00", "17:00", "Apex Trails 2.0", "Social", "SR Grand Stairs", ""],
  [29, "17:00", "21:00", "BGMI Fresher Series / VR Tennis / Valorant Vanguard Series", "Social", "CV Grand Stairs / V101, V106", ""],

  [30, "10:00", "17:00", "Quantum Tech Expo (Day 4)", "Main", ATRIUM, "Exhibitors / Student Teams"],
  [30, "10:00", "13:00", "Industry Expert Sessions & Panel Discussions", "Talk", AUD, ""],
  [30, "14:00", "16:00", "Hackathon Finals – Project Presentations", "Hackathon", AUD, ""],
  [30, "16:00", "17:00", "Valedictory Ceremony & Prize Distribution", "Main", AUD, ""],
  [30, "17:00", "17:30", "Closing Remarks", "Main", AUD, ""],
];
const at = (d: number, hm: string) => `2026-10-${d}T${hm}:00+05:30`;

/** Adds every row that is not there yet (matched on title + start). Existing events are left exactly as they are. Returns counts. */
export async function seedSchedule(db: Queryable) {
  let added = 0, skipped = 0;
  for (const [d, s, e, title, track, location, speaker] of ROWS) {
    const [ex] = await db.query("SELECT 1 FROM events WHERE title=$1 AND starts_at=$2", [title, at(d, s)]);
    if (ex) { skipped++; continue; }
    await db.query("INSERT INTO events (title,track,location,speaker,starts_at,ends_at) VALUES ($1,$2,$3,$4,$5,$6)", [title, track, location, speaker, at(d, s), at(d, e)]);
    added++;
  }
  return { added, skipped, total: ROWS.length };
}
