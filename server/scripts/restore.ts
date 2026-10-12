// DESTRUCTIVE: replaces all data in DATABASE_URL with the contents of a backup.
// Usage:  gcloud storage cp gs://<bucket>/<file>.json.gz . && DATABASE_URL=... node scripts/restore.ts <file>.json.gz --yes
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { migrate, openDb } from "../src/db.ts";
import { importTables } from "../src/lib/backup.ts";

const file = process.argv[2];
if (!file || !process.argv.includes("--yes")) { console.error("usage: restore.ts <backup.json.gz> --yes   (this overwrites the target database!)"); process.exit(1); }
const data = JSON.parse(gunzipSync(readFileSync(file)).toString());
const db = await openDb();
await migrate(db);
await importTables(db, data);
console.log("restored from", file, data.counts);
await db.close();
