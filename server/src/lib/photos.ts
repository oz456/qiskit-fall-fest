// Attendee selfies. Production: a private GCS bucket reached with the Cloud Run service account (metadata-server token, like the backup job).
// Dev/tests: files under PHOTO_DIR. Nothing here is ever served publicly; only the check and admin sites stream images, behind their own login.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config.ts";

const keyOf = (userId: string) => `photos/${userId}.jpg`;
let cached: { token: string; exp: number } | null = null;

async function token(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const r = await (await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } })).json() as { access_token: string; expires_in: number };
  cached = { token: r.access_token, exp: Date.now() + r.expires_in * 1000 };
  return cached.token;
}
const obj = (key: string) => `https://storage.googleapis.com/storage/v1/b/${config.photoBucket}/o/${encodeURIComponent(key)}`;

export async function putPhoto(userId: string, jpeg: Buffer): Promise<void> {
  const key = keyOf(userId);
  if (!config.photoBucket) { const f = join(config.photoDir, key); await mkdir(dirname(f), { recursive: true }); await writeFile(f, jpeg); return; }
  const res = await fetch(`https://storage.googleapis.com/upload/storage/v1/b/${config.photoBucket}/o?uploadType=media&name=${encodeURIComponent(key)}`, {
    method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "image/jpeg" }, body: new Uint8Array(jpeg),
  });
  if (!res.ok) throw new Error(`photo upload failed: ${res.status}`);
}

export async function getPhoto(userId: string): Promise<Buffer | null> {
  const key = keyOf(userId);
  if (!config.photoBucket) { try { return await readFile(join(config.photoDir, key)); } catch { return null; } }
  const res = await fetch(obj(key) + "?alt=media", { headers: { Authorization: `Bearer ${await token()}` } });
  return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
}

export async function deletePhoto(userId: string): Promise<void> {
  const key = keyOf(userId);
  if (!config.photoBucket) { await rm(join(config.photoDir, key), { force: true }); return; }
  await fetch(obj(key), { method: "DELETE", headers: { Authorization: `Bearer ${await token()}` } }).catch(() => {});
}

/** JPEG magic bytes + sane size: the only thing we accept from the app. */
export const looksLikeJpeg = (b: Buffer) => b.length > 5_000 && b.length <= 400_000 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
