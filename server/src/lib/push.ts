// Push notifications. Exactly two kinds exist: a new announcement (to everyone) and a support-ticket reply (to that attendee). Nothing else.
// Android: Firebase Cloud Messaging HTTP v1, authenticated as the Cloud Run service account (metadata-server token).
// iPhone: Apple's APNs HTTP/2 API directly, with a .p8 key (stays off until APNS_* are configured).
// Sending is per device token with bounded concurrency, so the whole list gets it within seconds and dead tokens are pruned as we learn of them.
import { createPrivateKey, sign } from "node:crypto";
import http2 from "node:http2";
import { config } from "../config.ts";
import type { Queryable } from "../db.ts";

export interface Push { title: string; body: string; type: "announcement" | "ticket"; id?: string }
export interface Sent { devices: number; delivered: number; removed: number }
/** Test hook: in NODE_ENV=test nothing leaves the process; messages are recorded here instead. */
export const outbox: { token: string; platform: string; push: Push }[] = [];

let gToken: { v: string; exp: number } | null = null;
async function googleToken(): Promise<string> {
  if (config.fcmTestToken) return config.fcmTestToken;
  if (gToken && gToken.exp > Date.now() + 60_000) return gToken.v;
  const r = await (await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", { headers: { "Metadata-Flavor": "Google" } })).json() as { access_token: string; expires_in: number };
  gToken = { v: r.access_token, exp: Date.now() + r.expires_in * 1000 };
  return gToken.v;
}
let projectId: string | undefined = config.fcmProject;
async function fcmProject(): Promise<string> {
  if (projectId) return projectId;
  projectId = await (await fetch("http://metadata.google.internal/computeMetadata/v1/project/project-id", { headers: { "Metadata-Flavor": "Google" } })).text();
  return projectId;
}

/** "gone" = the token is dead, delete it. "ok"/"retry" otherwise. */
async function sendAndroid(token: string, p: Push): Promise<"ok" | "gone" | "fail"> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${await fcmProject()}/messages:send`, {
    method: "POST", headers: { Authorization: `Bearer ${await googleToken()}`, "Content-Type": "application/json", ...(config.fcmTestToken ? { "x-goog-user-project": await fcmProject() } : {}) },
    body: JSON.stringify({ message: {
      token, notification: { title: p.title, body: p.body }, data: { type: p.type, ...(p.id ? { id: p.id } : {}) },
      android: { priority: "HIGH", notification: { channel_id: p.type === "ticket" ? "support" : "announcements", tag: p.type === "ticket" ? `ticket-${p.id}` : undefined } },
    } }),
  });
  if (res.ok) return "ok";
  const err = await res.json().catch(() => ({})) as { error?: { status?: string; details?: { errorCode?: string }[] } };
  const code = err.error?.details?.find((d) => d.errorCode)?.errorCode ?? err.error?.status;
  return res.status === 404 || code === "UNREGISTERED" || code === "INVALID_ARGUMENT" ? "gone" : "fail";
}

let apnsJwt: { v: string; exp: number } | null = null;
function apnsAuth(): string {
  const a = config.apns!;
  if (apnsJwt && apnsJwt.exp > Date.now()) return apnsJwt.v;
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "ES256", kid: a.keyId }), body = b64({ iss: a.teamId, iat: Math.floor(Date.now() / 1000) });
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key: createPrivateKey(a.key), dsaEncoding: "ieee-p1363" }).toString("base64url");
  apnsJwt = { v: `${head}.${body}.${sig}`, exp: Date.now() + 40 * 60_000 }; // Apple wants a fresh token every 20-60 min
  return apnsJwt.v;
}
function sendApns(session: http2.ClientHttp2Session, token: string, p: Push): Promise<"ok" | "gone" | "fail"> {
  return new Promise((resolve) => {
    const req = session.request({ ":method": "POST", ":path": `/3/device/${token}`, authorization: `bearer ${apnsAuth()}`, "apns-topic": config.apns!.topic, "apns-push-type": "alert", "apns-priority": "10" });
    let status = 0; req.on("response", (h) => { status = Number(h[":status"]); });
    req.on("data", () => {}); req.on("error", () => resolve("fail"));
    req.on("end", () => resolve(status === 200 ? "ok" : status === 410 || status === 400 ? "gone" : "fail"));
    req.setTimeout(10_000, () => { req.close(); resolve("fail"); });
    req.end(JSON.stringify({ aps: { alert: { title: p.title, body: p.body }, sound: "default", "thread-id": p.type }, type: p.type, ...(p.id ? { id: p.id } : {}) }));
  });
}

type Dev = { token: string; platform: string; apns_env: string | null };

export async function deliver(db: Queryable, devices: Dev[], p: Push, log: { warn: (o: object, m: string) => void } = console as any): Promise<Sent> {
  const out: Sent = { devices: devices.length, delivered: 0, removed: 0 };
  if (config.env === "test") { for (const d of devices) outbox.push({ token: d.token, platform: d.platform, push: p }); out.delivered = devices.length; return out; }
  const sessions = new Map<string, http2.ClientHttp2Session>();
  const apns = (env: string | null) => {
    const host = env === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com";
    if (!sessions.has(host)) sessions.set(host, http2.connect(host));
    return sessions.get(host)!;
  };
  const dead: string[] = []; let i = 0;
  const worker = async () => {
    for (let d = devices[i++]; d; d = devices[i++]) {
      try {
        const r = d.platform === "android" ? await sendAndroid(d.token, p) : config.apns ? await sendApns(apns(d.apns_env), d.token, p) : "fail";
        if (r === "ok") out.delivered++; else if (r === "gone") dead.push(d.token);
      } catch (e: any) { log.warn({ err: e.message }, "push send failed"); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(25, devices.length) }, worker));
  for (const s of sessions.values()) s.close();
  if (dead.length) { await db.query("DELETE FROM push_tokens WHERE token = ANY($1::text[])", [dead]); out.removed = dead.length; }
  return out;
}

const ACTIVE = "JOIN users u ON u.id = t.user_id AND u.status = 'active'";
/** Everyone with notifications on. Fire-and-forget callers should not await this. */
export const devicesForAll = (db: Queryable) => db.query<Dev>(`SELECT t.token, t.platform, t.apns_env FROM push_tokens t ${ACTIVE}`);
export const devicesForUser = (db: Queryable, userId: string) => db.query<Dev>(`SELECT t.token, t.platform, t.apns_env FROM push_tokens t ${ACTIVE} WHERE t.user_id = $1`, [userId]);

export function pushInBackground(db: Queryable, devices: Dev[], p: Push, log: { warn: (o: object, m: string) => void; info?: (o: object, m: string) => void }) {
  if (!devices.length) return;
  void deliver(db, devices, p, log).then((r) => log.info?.({ ...r, type: p.type }, "push sent")).catch((e) => log.warn({ err: e.message }, "push failed"));
}
