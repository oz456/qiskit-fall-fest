// Entry point of the Cloud Run Job `qff-backup` (scheduled every 6 h): dumps the database to a gzipped JSON in Cloud Storage.
// Local use: BACKUP_DIR=./backups node dist/backup.js
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { openDb } from "./db.ts";
import { exportTables } from "./lib/backup.ts";

const db = await openDb();
const data = await exportTables(db);
await db.close();
const body = gzipSync(JSON.stringify(data));
const name = `qff-backup-${data.createdAt.replace(/[:.]/g, "-")}.json.gz`;

if (process.env.BACKUP_DIR) {
  mkdirSync(process.env.BACKUP_DIR, { recursive: true });
  writeFileSync(`${process.env.BACKUP_DIR}/${name}`, body);
} else {
  const bucket = process.env.BACKUP_BUCKET;
  if (!bucket) throw new Error("BACKUP_BUCKET or BACKUP_DIR required");
  // Cloud Run provides credentials through the metadata server (runtime service account).
  const tok = await (await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } })).json() as { access_token: string };
  const res = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`, {
    method: "POST", headers: { Authorization: `Bearer ${tok.access_token}`, "Content-Type": "application/gzip" }, body,
  });
  if (!res.ok) throw new Error(`upload failed ${res.status}: ${await res.text()}`);
}
console.log(JSON.stringify({ msg: "backup ok", name, bytes: body.length, counts: data.counts }));
