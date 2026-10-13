process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { migrate, openDb, type Db } from "../src/db.ts";
import { buildApp } from "../src/app.ts";
import { hmac, passPayload } from "../src/lib/crypto.ts";
import { config } from "../src/config.ts";
import { exportTables, importTables } from "../src/lib/backup.ts";

let app: Awaited<ReturnType<typeof buildApp>>; let db: Db;
let cookie = ""; let csrf = ""; let ccookie = ""; let ccsrf = "";
const admin = async (method: string, url: string, payload?: unknown) =>
  app.inject({ method: method as any, url, payload: payload as any, headers: { cookie, "x-csrf-token": csrf } });
const check = async (method: string, url: string, payload?: unknown) =>
  app.inject({ method: method as any, url, payload: payload as any, headers: { cookie: ccookie, "x-csrf-token": ccsrf } });
const lastOtp = async (email: string) => { // brute-force the 6-digit code from its HMAC (test-only; proves hashing, not plaintext, is stored)
  const [r] = await db.query("SELECT code_hash FROM otp_codes WHERE email=$1 ORDER BY created_at DESC LIMIT 1", [email]);
  for (let i = 0; i < 1_000_000; i++) { const c = String(i).padStart(6, "0"); if (hmac(config.otpPepper, `${email}|${c}`).toString("hex") === r!.code_hash) return c; }
  throw new Error("no code");
};

before(async () => {
  db = await openDb(); await migrate(db); app = await buildApp(db);
  const r = await app.inject({ method: "POST", url: "/admin/api/login", payload: { username: "admin", password: "admin-dev-password" } });
  assert.equal(r.statusCode, 200);
  cookie = (r.headers["set-cookie"] as string).split(";")[0]!; csrf = r.json().csrf;
  const c = await app.inject({ method: "POST", url: "/check/api/login", payload: { username: "check", password: "check-dev-password" } });
  assert.equal(c.statusCode, 200);
  ccookie = (c.headers["set-cookie"] as string).split(";")[0]!; ccsrf = c.json().csrf;
});
after(async () => { await app.close(); await db.close(); });

describe("admin security", () => {
  it("rejects unauthenticated and bad credentials", async () => {
    assert.equal((await app.inject({ url: "/admin/api/events" })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/admin/api/login", payload: { username: "admin", password: "nope" } })).statusCode, 401);
  });
  it("requires CSRF token on writes", async () => {
    const r = await app.inject({ method: "POST", url: "/admin/api/events", payload: {}, headers: { cookie } });
    assert.equal(r.statusCode, 403);
  });
});

describe("scanner/admin separation", () => {
  it("check login cannot reach admin APIs and admin login cannot scan", async () => {
    assert.equal((await check("GET", "/admin/api/users")).statusCode, 401);
    assert.equal((await app.inject({ method: "GET", url: "/check/api/scopes", headers: { cookie } })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/check/api/login", payload: { username: "admin", password: "admin-dev-password" } })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/admin/api/login", payload: { username: "check", password: "check-dev-password" } })).statusCode, 401);
  });
});

describe("check-in days", () => {
  it("always offers the festival window days even without events on them", async () => {
    await admin("PUT", "/admin/api/settings", { fest_start: "2026-10-26", fest_end: "2026-10-30" });
    const r = (await check("GET", "/check/api/scopes")).json();
    for (const d of ["2026-10-26", "2026-10-27", "2026-10-30"]) assert.ok(r.days.includes(d), d);
  });
});

describe("events: multi-day and validation", () => {
  it("creates a 3-day event and rejects end<start", async () => {
    const ok = await admin("POST", "/admin/api/events", { title: "Hackathon", track: "Hackathon", startsAt: "2026-10-16T11:00:00+05:30", endsAt: "2026-10-18T14:00:00+05:30", capacity: 1, access: "prereg" });
    assert.equal(ok.statusCode, 201);
    const bad = await admin("POST", "/admin/api/events", { title: "Bad", track: "Talk", startsAt: "2026-10-16T11:00:00+05:30", endsAt: "2026-10-16T10:00:00+05:30" });
    assert.equal(bad.statusCode, 400);
  });
});

describe("attendee flow", () => {
  const email = "alex@example.org"; let tokens: any; let eventId: string;
  it("only registered emails get codes, with identical responses", async () => {
    await admin("POST", "/admin/api/users", { email, name: "Alex Morgan", college: "SRM AP" });
    const a = await app.inject({ method: "POST", url: "/v1/auth/request-code", payload: { email } });
    const b = await app.inject({ method: "POST", url: "/v1/auth/request-code", payload: { email: "stranger@example.org" } });
    assert.deepEqual(a.json(), b.json());
    const [{ n }] = await db.query<{ n: number }>("SELECT count(*)::int n FROM otp_codes WHERE email='stranger@example.org'");
    assert.equal(n, 0);
  });
  it("wrong codes lock after 5 attempts", async () => {
    const good = await lastOtp(email);
    for (let i = 0; i < 5; i++) assert.equal((await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { email, code: "000000" === good ? "111111" : "000000", deviceId: "device-aaaa1" } })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { email, code: good, deviceId: "device-aaaa1" } })).statusCode, 401);
    await db.query("UPDATE otp_codes SET consumed_at=now()");
    await db.query("DELETE FROM otp_codes");
  });
  it("signs in, then a second device logs out the first", async () => {
    await app.inject({ method: "POST", url: "/v1/auth/request-code", payload: { email } });
    const r = await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { email, code: await lastOtp(email), deviceId: "device-aaaa1" } });
    assert.equal(r.statusCode, 200); tokens = r.json();
    const h = { authorization: `Bearer ${tokens.accessToken}` };
    assert.equal((await app.inject({ url: "/v1/me", headers: h })).statusCode, 200);
    await db.query("DELETE FROM otp_codes");
    await app.inject({ method: "POST", url: "/v1/auth/request-code", payload: { email } });
    const r2 = await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { email, code: await lastOtp(email), deviceId: "device-bbbb2" } });
    assert.equal(r2.statusCode, 200);
    assert.equal((await app.inject({ url: "/v1/me", headers: h })).statusCode, 401, "old device must be revoked");
    tokens = r2.json();
  });
  it("refresh rotates and replay revokes the session", async () => {
    const r1 = await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: tokens.refreshToken } });
    assert.equal(r1.statusCode, 200);
    const replay = await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: tokens.refreshToken } });
    assert.equal(replay.statusCode, 401);
    const again = await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: r1.json().refreshToken } });
    assert.equal(again.statusCode, 401, "session killed after replay");
    // sign back in for later tests
    await db.query("DELETE FROM otp_codes");
    await app.inject({ method: "POST", url: "/v1/auth/request-code", payload: { email } });
    tokens = (await app.inject({ method: "POST", url: "/v1/auth/verify", payload: { email, code: await lastOtp(email), deviceId: "device-cccc3" } })).json();
  });
  it("selfie: one upload, scanner sees it by ticket, admin can reset", async () => {
    const [u] = await db.query("SELECT id, pass_code, pass_secret FROM users WHERE email='alex@example.org'");
    const me = () => app.inject({ url: "/v1/me", headers: { authorization: `Bearer ${tokens.accessToken}` } });
    assert.equal((await me()).json().profile.hasPhoto, false);
    assert.equal((await app.inject({ url: "/v1/events", headers: { authorization: `Bearer ${tokens.accessToken}` } })).json().error, "photo_required", "no photo, no app");
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(8000, 1)]);
    const put = (body: Buffer) => app.inject({ method: "PUT", url: "/v1/me/photo", headers: { authorization: `Bearer ${tokens.accessToken}`, "content-type": "image/jpeg" }, payload: body });
    assert.equal((await put(Buffer.alloc(8000, 1))).statusCode, 400, "not a jpeg");
    const both = await Promise.all([put(jpeg), put(jpeg)]); // two phones / a double tap at the same instant
    assert.deepEqual(both.map((r) => r.statusCode).sort(), [200, 409], "exactly one upload wins");
    assert.equal((await put(jpeg)).statusCode, 409, "only once");
    assert.equal((await db.query("SELECT 1 FROM user_photos WHERE user_id=$1", [u!.id])).length, 1);
    assert.equal((await me()).json().profile.hasPhoto, true);
    const v = (await check("POST", "/check/api/scan", { payload: passPayload(Buffer.from(u!.pass_secret), u!.pass_code), scope: "day:2026-10-19" })).json();
    assert.equal(v.who.hasPhoto, true);
    const img = await app.inject({ url: `/check/api/photo?ticket=${encodeURIComponent(v.ticket)}`, headers: { cookie: ccookie } });
    assert.equal(img.statusCode, 200); assert.equal(img.rawPayload.length, jpeg.length);
    assert.equal((await app.inject({ url: `/check/api/photo?ticket=${encodeURIComponent(v.ticket)}` })).statusCode, 401, "needs the scanner login");
    assert.equal((await admin("GET", `/admin/api/users/${u!.id}/photo`)).statusCode, 200);
    await admin("DELETE", `/admin/api/users/${u!.id}/photo`);
    assert.equal((await me()).json().profile.hasPhoto, false);
    assert.equal((await put(jpeg)).statusCode, 200, "after a reset they can retake it");
    assert.equal((await app.inject({ url: "/v1/events", headers: { authorization: `Bearer ${tokens.accessToken}` } })).statusCode, 200);
  });
  it("saving is the attendee's; enrolment is the admin's", async () => {
    const h = { authorization: `Bearer ${tokens.accessToken}` };
    const ev = (await app.inject({ url: "/v1/events", headers: h })).json().events; eventId = ev[0].id;
    assert.equal(ev[0].access, "prereg"); assert.equal(ev[0].registrationRequired, true);
    assert.equal((await app.inject({ method: "PUT", url: `/v1/events/${eventId}/saved`, headers: h })).statusCode, 200);
    // attendees cannot enrol themselves any more
    assert.equal((await app.inject({ method: "PUT", url: `/v1/events/${eventId}/registration`, headers: h })).statusCode, 404);
    let e2 = (await app.inject({ url: "/v1/events", headers: h })).json().events[0];
    assert.equal(e2.saved, true); assert.equal(e2.registered, false);
    // the admin enrols by email; unknown emails are reported back
    const en = await admin("POST", `/admin/api/events/${eventId}/enrolled`, { emails: [email, "nobody@example.org"] });
    assert.equal(en.statusCode, 200); assert.equal(en.json().added, 1); assert.deepEqual(en.json().notFound, ["nobody@example.org"]);
    e2 = (await app.inject({ url: "/v1/events", headers: h })).json().events[0];
    assert.equal(e2.registered, true); assert.equal(e2.spotsLeft, 0);
    assert.equal((await admin("GET", `/admin/api/events/${eventId}/enrolled`)).json().length, 1);
    const who = (await admin("GET", "/admin/api/users?q=alex")).json()[0];
    assert.equal(who.enrolled.length, 1);
    await admin("POST", "/admin/api/users", { email: "sam@example.org", name: "Sam" });
  });

  it("tickets: user creates, admin replies, user sees reply", async () => {
    const h = { authorization: `Bearer ${tokens.accessToken}` };
    const t = await app.inject({ method: "POST", url: "/v1/tickets", headers: h, payload: { kind: "General", topic: "Wi-Fi & power", message: "Wi-Fi is down on floor 2" } });
    assert.equal(t.statusCode, 201);
    await admin("POST", `/admin/api/tickets/${t.json().id}/reply`, { body: "On it!" });
    const list = (await app.inject({ url: "/v1/tickets", headers: h })).json();
    assert.equal(list[0].messages.at(-1).body, "On it!"); assert.equal(list[0].status, "in_progress");
  });
});

describe("backup & restore", () => {
  it("round-trips everything, including pass secrets, so a restored pass still verifies", async () => {
    const [u] = await db.query("SELECT pass_code, pass_secret FROM users WHERE email='alex@example.org'");
    const snap = JSON.parse(JSON.stringify(await exportTables(db)));            // as it would be written to a file
    const before = snap.counts;
    await db.query("DELETE FROM user_events"); await db.query("DELETE FROM tickets"); await db.query("DELETE FROM events");
    await importTables(db, snap);
    const after = (await exportTables(db)).counts;
    assert.deepEqual(after, before);
    const [u2] = await db.query("SELECT pass_secret FROM users WHERE email='alex@example.org'");
    assert.equal(Buffer.from(u2!.pass_secret).toString("hex"), Buffer.from(u!.pass_secret).toString("hex"));
  });
});

describe("rotating QR check-in", () => {
  it("accepts a live code once, rejects duplicate, stale and forged", async () => {
    const [u] = await db.query("SELECT pass_code, pass_secret FROM users WHERE email='alex@example.org'");
    const secret = Buffer.from(u!.pass_secret); const scope = "day:2026-10-16";
    const live = passPayload(secret, u!.pass_code);
    // 1) scan only verifies; nothing is recorded until the volunteer confirms
    const v = (await check("POST", "/check/api/scan", { payload: live, scope })).json();
    assert.equal(v.result, "verify"); assert.equal(v.who.hasPhoto, true);
    assert.equal((await admin("GET", `/admin/api/attendance?scope=${scope}`)).json().rows.length, 0);
    // 2) reject records nothing; confirm records once
    assert.equal((await check("POST", "/check/api/confirm", { ticket: v.ticket, decision: "reject" })).json().result, "rejected");
    assert.equal((await check("POST", "/check/api/confirm", { ticket: v.ticket, decision: "confirm" })).json().result, "ok");
    assert.equal((await check("POST", "/check/api/confirm", { ticket: v.ticket, decision: "confirm" })).json().result, "duplicate");
    assert.equal((await check("POST", "/check/api/scan", { payload: live, scope })).json().result, "duplicate");
    assert.equal((await check("POST", "/check/api/confirm", { ticket: "garbage", decision: "confirm" })).statusCode, 400);
    assert.equal((await check("POST", "/check/api/scan", { payload: passPayload(secret, u!.pass_code, Date.now() - 5 * 60_000), scope: "day:2026-10-17" })).json().result, "expired");
    assert.equal((await check("POST", "/check/api/scan", { payload: passPayload(Buffer.alloc(32, 1), u!.pass_code), scope: "day:2026-10-17" })).json().result, "invalid");
  });
  it("admin sees attendance recorded by the scanner", async () => {
    const r = (await admin("GET", "/admin/api/attendance?scope=day:2026-10-16")).json();
    assert.equal(r.rows.length, 1); assert.equal(r.rows[0].email, "alex@example.org");
  });
  it("old device secret stops working after re-login (device binding)", async () => {
    const [u] = await db.query("SELECT pass_code FROM users WHERE email='alex@example.org'");
    const stale = passPayload(Buffer.alloc(32, 7), u!.pass_code);
    assert.equal((await check("POST", "/check/api/scan", { payload: stale, scope: "day:2026-10-18" })).json().result, "invalid");
  });
});
