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

/**
 * The only image we accept from the app. Walks the JPEG's segments and returns a CLEANED copy, or null if it isn't a plausible photo:
 * must start with SOI and end with EOI, carry a frame header of at least 240x240 (at most 4096), and fit the size limits.
 * EXIF / XMP / ICC / comment segments are dropped (that is where GPS and device data live).
 */
export function sanitizeJpeg(b: Buffer): Buffer | null {
  if (b.length < 8_000 || b.length > 400_000 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const out: Buffer[] = [b.subarray(0, 2)];
  let i = 2; let dims: [number, number] | null = null;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1]!;
    if (m === 0xff) { i++; continue; } // fill byte
    if (m === 0xd9 || (m >= 0xd0 && m <= 0xd8) || m === 0x01) return null; // EOI / RSTn / SOI / TEM before the scan: not a normal baseline photo
    const len = b.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > b.length) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { // a frame header: precision, height, width
      if (len < 8) return null;
      dims = [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    }
    if (m === 0xda) { // start of scan: compressed data follows until EOI
      if (!dims || dims[0] < 240 || dims[1] < 240 || dims[0] > 4096 || dims[1] > 4096) return null;
      if (b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return null;
      out.push(b.subarray(i));
      return Buffer.concat(out);
    }
    const strip = (m >= 0xe1 && m <= 0xef) || m === 0xfe;
    if (!strip) out.push(b.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return null;
}
