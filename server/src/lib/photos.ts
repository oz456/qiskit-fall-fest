// Attendee selfies. Row in `user_photos` (one per attendee, immutable until an admin resets it) + the image in a private GCS bucket.
// Production: the bucket is reached with the Cloud Run service account (metadata-server token, like the backup job).
// Dev/tests: files under PHOTO_DIR. Nothing here is ever served publicly; only the check and admin sites stream images, behind their own login.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config.ts";
import type { Queryable } from "../db.ts";

let cached: { token: string; exp: number } | null = null;
async function token(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const r = await (await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } })).json() as { access_token: string; expires_in: number };
  cached = { token: r.access_token, exp: Date.now() + r.expires_in * 1000 };
  return cached.token;
}
const obj = (key: string) => `https://storage.googleapis.com/storage/v1/b/${config.photoBucket}/o/${encodeURIComponent(key)}`;

async function putObject(key: string, jpeg: Buffer): Promise<void> {
  if (!config.photoBucket) { const f = join(config.photoDir, key); await mkdir(dirname(f), { recursive: true }); await writeFile(f, jpeg); return; }
  const res = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${config.photoBucket}/o?uploadType=media&name=${encodeURIComponent(key)}`, {
    method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "image/jpeg" }, body: new Uint8Array(jpeg),
  });
  if (!res.ok) throw new Error(`photo upload failed: ${res.status}`);
}
async function getObject(key: string): Promise<Buffer | null> {
  if (!config.photoBucket) { try { return await readFile(join(config.photoDir, key)); } catch { return null; } }
  const res = await fetch(obj(key) + "?alt=media", { headers: { Authorization: `Bearer ${await token()}` } });
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}
async function deleteObject(key: string): Promise<void> {
  if (!config.photoBucket) { await rm(join(config.photoDir, key), { force: true }); return; }
  await fetch(obj(key), { method: "DELETE", headers: { Authorization: `Bearer ${await token()}` } }).catch(() => {});
}

/** Stores the attendee's selfie exactly once. The row is claimed first, so two simultaneous uploads can never both write. */
export async function savePhoto(q: Queryable, userId: string, jpeg: Buffer): Promise<"saved" | "exists"> {
  const id = randomUUID();
  const claim = await q.query(
    "INSERT INTO user_photos (id, user_id, object_key, size_bytes, sha256) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id) DO NOTHING RETURNING id",
    [id, userId, `photos/${userId}/${id}.jpg`, jpeg.length, createHash("sha256").update(jpeg).digest("hex")],
  );
  if (!claim[0]) return "exists";
  try { await putObject(`photos/${userId}/${id}.jpg`, jpeg); }
  catch (e) { await q.query("DELETE FROM user_photos WHERE id=$1", [id]); throw e; } // nothing was stored: let them try again
  return "saved";
}

export async function getPhoto(q: Queryable, userId: string): Promise<Buffer | null> {
  const [r] = await q.query("SELECT object_key FROM user_photos WHERE user_id=$1", [userId]);
  return r ? getObject(r.object_key) : null;
}

/** Admin reset or account deletion: the image and its row go away together. */
export async function removePhoto(q: Queryable, userId: string): Promise<void> {
  const [r] = await q.query("DELETE FROM user_photos WHERE user_id=$1 RETURNING object_key", [userId]);
  if (r) await deleteObject(r.object_key);
}

/** JPEG magic bytes + sane size: the only thing we accept from the app. */
export const looksLikeJpeg = (b: Buffer) => b.length > 5_000 && b.length <= 400_000 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
