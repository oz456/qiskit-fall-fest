import { createHash, createHmac, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
export const hmac = (key: string | Buffer, data: string | Buffer) => createHmac("sha256", key).update(data).digest();

/** Constant-time string equality that does not leak length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const otpCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

// scrypt$N$salt$hash  (see scripts/hash-password.ts)
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const h = scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString("base64url")}$${h.toString("base64url")}`;
}
export function verifyPasswordHash(pw: string, stored: string): boolean {
  const [alg, n, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !n || !salt || !hash) return false;
  const h = scryptSync(pw, Buffer.from(salt, "base64url"), 32, { N: Number(n), r: 8, p: 1 });
  const want = Buffer.from(hash, "base64url");
  return want.length === h.length && timingSafeEqual(h, want);
}

// ---- Signed compact tokens (HS256 JWT) ----
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
export function signJwt(payload: Record<string, unknown>, secret: string, ttlSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u({ alg: "HS256", typ: "JWT" });
  const body = b64u({ ...payload, iat: now, exp: now + ttlSec });
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
export function verifyJwt<T = Record<string, unknown>>(token: string, secret: string): (T & { exp: number }) | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts as [string, string, string];
  const want = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  if (!safeEqual(sig, want)) return null;
  try {
    if (JSON.parse(Buffer.from(head, "base64url").toString()).alg !== "HS256") return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof p.exp !== "number" || p.exp < Date.now() / 1000) return null;
    return p;
  } catch {
    return null;
  }
}

// ---- Rotating pass QR (TOTP-style) ----
export const PASS_STEP_SEC = 30;
export function passMac(secret: Buffer, passCode: string, step: number): string {
  return createHmac("sha256", secret).update(`${passCode}|${step}`).digest("base64url").slice(0, 12);
}
export function passPayload(secret: Buffer, passCode: string, nowMs = Date.now()): string {
  const step = Math.floor(nowMs / 1000 / PASS_STEP_SEC);
  return `QFF1.${passCode}.${step}.${passMac(secret, passCode, step)}`;
}
