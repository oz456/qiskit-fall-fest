process.env.NODE_ENV = "test";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { migrate, openDb, type Db } from "../src/db.ts";
import { buildApp } from "../src/app.ts";
import { hashPassword, hmac, passPayload } from "../src/lib/crypto.ts";
import { config } from "../src/config.ts";
import { exportTables, importTables } from "../src/lib/backup.ts";
import { outbox } from "../src/lib/push.ts";
import { classifyEmail } from "../src/lib/website-sync.ts";
import { createServer } from "node:http";

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

const seg = (m: number, body: Buffer) => Buffer.concat([Buffer.from([0xff, m, (body.length + 2) >> 8, (body.length + 2) & 255]), body]);
/** A structurally valid JPEG (frame header + scan + EOI) with an EXIF segment that must be stripped. */
const fakeJpeg = (w = 480, h = 480, eoi = true, exif = true) => Buffer.concat([
  Buffer.from([0xff, 0xd8]), ...(exif ? [seg(0xe1, Buffer.from("Exif\0\0GPSLEAK"))] : []), seg(0xdb, Buffer.alloc(65, 1)),
  seg(0xc0, Buffer.from([8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0])), seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
  Buffer.alloc(9000, 0x42), ...(eoi ? [Buffer.from([0xff, 0xd9])] : []),
]);

before(async () => {
  db = await openDb(); await migrate(db); app = await buildApp(db);
  const r = await app.inject({ method: "POST", url: "/admin/api/login", payload: { username: "admin", password: "admin-dev-password" } });
  assert.equal(r.statusCode, 200);
  cookie = (r.headers["set-cookie"] as string).split(";")[0]!; csrf = r.json().csrf;
  const c = await app.inject({ method: "POST", url: "/checkin/api/login", payload: { username: "check", password: "check-dev-password" } });
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
    assert.equal((await app.inject({ method: "GET", url: "/checkin/api/scopes", headers: { cookie } })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/checkin/api/login", payload: { username: "admin", password: "admin-dev-password" } })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/admin/api/login", payload: { username: "check", password: "check-dev-password" } })).statusCode, 401);
  });

  it("named door logins (CHECK_ACCOUNTS) each work with their own password, and only for /checkin", async () => {
    config.checkAccounts.push({ user: "AP00000000001", hash: hashPassword("AP00000000001abc") }, { user: "AP00000000002", hash: hashPassword("AP00000000002xyz") });
    const login = (username: string, password: string, site = "checkin") => app.inject({ method: "POST", url: `/${site}/api/login`, payload: { username, password } });
    assert.equal((await login("AP00000000001", "AP00000000001abc")).statusCode, 200);
    assert.equal((await login("AP00000000002", "AP00000000002xyz")).statusCode, 200);
    assert.equal((await login("AP00000000001", "AP00000000002xyz")).statusCode, 401, "another volunteer's password does not work");
    assert.equal((await login("AP00000000001", "AP00000000001abc", "admin")).statusCode, 401, "door logins never open /admin");
    config.checkAccounts.length = 0;
  });
});

describe("check-in days", () => {
  it("always offers the festival window days even without events on them", async () => {
    await admin("PUT", "/admin/api/settings", { fest_start: "2026-10-26", fest_end: "2026-10-30" });
    const r = (await check("GET", "/checkin/api/scopes")).json();
    for (const d of ["2026-10-26", "2026-10-27", "2026-10-30"]) assert.ok(r.days.includes(d), d);
  });
});

describe("events: multi-day and validation", () => {
  it("creates a 3-day event and rejects end<start", async () => {
    const ok = await admin("POST", "/admin/api/events", { title: "Hackathon", track: "Hackathon", startsAt: "2026-10-16T11:00:00+05:30", endsAt: "2026-10-18T14:00:00+05:30" });
    assert.equal(ok.statusCode, 201);
    const bad = await admin("POST", "/admin/api/events", { title: "Bad", track: "Talk", startsAt: "2026-10-16T11:00:00+05:30", endsAt: "2026-10-16T10:00:00+05:30" });
    assert.equal(bad.statusCode, 400);
  });
});

describe("hardening", () => {
  it("rate limits cannot be dodged by spoofing X-Forwarded-For", async () => {
    // Cloud Run appends the real client address LAST; only that entry is trusted, so rotating the forged ones changes nothing.
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await app.inject({ method: "POST", url: "/admin/api/login", headers: { "x-forwarded-for": `forged-${i}, 203.0.113.50` }, payload: { username: "admin", password: "wrong-" + i } })).statusCode);
    assert.equal(codes[0], 401); assert.equal(codes.at(-1), 429, "the 6th+ attempt from the same real address is throttled");
  });
  it("a staff session ends server-side on logout (a stolen cookie stops working)", async () => {
    const r = await app.inject({ method: "POST", url: "/admin/api/login", payload: { username: "admin", password: "admin-dev-password" } });
    const ck = (r.headers["set-cookie"] as string).split(";")[0]!; const cs = r.json().csrf;
    assert.equal((await app.inject({ url: "/admin/api/events", headers: { cookie: ck } })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/admin/api/logout", headers: { cookie: ck, "x-csrf-token": cs } })).statusCode, 200);
    assert.equal((await app.inject({ url: "/admin/api/events", headers: { cookie: ck } })).statusCode, 401, "replaying the old cookie after logout fails");
  });
  it("login codes: any live code works, attempts are capped, and a lockout is per attendee", async () => {
    const hash = (em: string, c: string) => hmac(config.otpPepper, `${em}|${c}`).toString("hex");
    const ins = (em: string, c: string) => db.query("INSERT INTO otp_codes (email, code_hash, expires_at) VALUES ($1,$2,$3)", [em, hash(em, c), new Date(Date.now() + 600_000)]);
    let n = 0; // each call comes from its own address so only the PER-ATTENDEE limits are under test, not the per-IP one
    const verify = (em: string, code: string) => app.inject({ method: "POST", url: "/v1/auth/verify", remoteAddress: `10.9.0.${++n}`, payload: { email: em, code, deviceId: "device-hardening" } });
    // two live codes (the person asked twice): the OLDER one must still sign them in
    await admin("POST", "/admin/api/users", { email: "otp1@example.org", name: "Otp One" });
    await ins("otp1@example.org", "111111"); await ins("otp1@example.org", "222222");
    for (let i = 0; i < 3; i++) assert.equal((await verify("otp1@example.org", "000000")).statusCode, 401);
    assert.equal((await verify("otp1@example.org", "111111")).statusCode, 200, "older live code still works");
    // one code: five wrong guesses lock THAT code, even for the right value afterwards
    await admin("POST", "/admin/api/users", { email: "otp2@example.org", name: "Otp Two" });
    await ins("otp2@example.org", "333333");
    for (let i = 0; i < 5; i++) assert.equal((await verify("otp2@example.org", "000000")).statusCode, 401);
    assert.equal((await verify("otp2@example.org", "333333")).statusCode, 401, "code is burned after 5 wrong tries");
    // many wrong tries across codes -> the attendee is cooled off (429), regardless of the caller's address
    await admin("POST", "/admin/api/users", { email: "otp3@example.org", name: "Otp Three" });
    await ins("otp3@example.org", "444444"); await ins("otp3@example.org", "555555");
    let last = 0; for (let i = 0; i < 6; i++) last = (await verify("otp3@example.org", "000000")).statusCode;
    assert.equal(last, 429);
  });
});

describe("attendee flow", () => {
  const email = "alex@example.org"; let tokens: any; let eventId: string;
  it("only registered emails get codes; unknown emails are told so", async () => {
    await admin("POST", "/admin/api/users", { email, name: "Alex Morgan", college: "SRM AP" });
    const a = await app.inject({ method: "POST", url: "/v1/auth/request-code", payload: { email } });
    const b = await app.inject({ method: "POST", url: "/v1/auth/request-code", payload: { email: "stranger@example.org" } });
    assert.equal(a.statusCode, 200);
    assert.equal(b.statusCode, 404); assert.equal(b.json().error, "not_registered"); assert.match(b.json().message, /isn.t registered yet/);
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
    const jpeg = fakeJpeg();
    const put = (body: Buffer) => app.inject({ method: "PUT", url: "/v1/me/photo", headers: { authorization: `Bearer ${tokens.accessToken}`, "content-type": "image/jpeg" }, payload: body });
    assert.equal((await put(Buffer.alloc(8000, 1))).statusCode, 400, "not a jpeg");
    assert.equal((await put(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(9000, 7)]))).statusCode, 400, "magic bytes + junk is not a photo");
    assert.equal((await put(fakeJpeg(64, 64))).statusCode, 400, "too small to identify anyone");
    assert.equal((await put(fakeJpeg(480, 480, false))).statusCode, 400, "truncated file");
    const both = await Promise.all([put(jpeg), put(jpeg)]); // two phones / a double tap at the same instant
    assert.deepEqual(both.map((r) => r.statusCode).sort(), [200, 409], "exactly one upload wins");
    assert.equal((await put(jpeg)).statusCode, 409, "only once");
    assert.equal((await db.query("SELECT 1 FROM user_photos WHERE user_id=$1", [u!.id])).length, 1);
    assert.equal((await me()).json().profile.hasPhoto, true);
    const v = (await check("POST", "/checkin/api/scan", { payload: passPayload(Buffer.from(u!.pass_secret), u!.pass_code), scope: "day:2026-10-19" })).json();
    assert.equal(v.who.hasPhoto, true);
    const img = await app.inject({ url: `/checkin/api/photo?ticket=${encodeURIComponent(v.ticket)}`, headers: { cookie: ccookie } });
    assert.equal(img.statusCode, 200); assert.equal(img.rawPayload[0], 0xff); assert.ok(!img.rawPayload.includes("GPSLEAK"), "EXIF/location data is stripped before storage");
    assert.equal((await app.inject({ url: `/checkin/api/photo?ticket=${encodeURIComponent(v.ticket)}` })).statusCode, 401, "needs the scanner login");
    assert.equal((await admin("GET", `/admin/api/users/${u!.id}/photo`)).statusCode, 200);
    await admin("DELETE", `/admin/api/users/${u!.id}/photo`);
    assert.equal((await me()).json().profile.hasPhoto, false);
    assert.equal((await put(jpeg)).statusCode, 200, "after a reset they can retake it");
    assert.equal((await app.inject({ url: "/v1/events", headers: { authorization: `Bearer ${tokens.accessToken}` } })).statusCode, 200);
  });
  it("saving an event is the attendee's; there is no event registration", async () => {
    const h = { authorization: `Bearer ${tokens.accessToken}` };
    const ev = (await app.inject({ url: "/v1/events", headers: h })).json().events; eventId = ev[0].id;
    for (const gone of ["registered", "registrationRequired", "access", "capacity", "spotsLeft"]) assert.equal(gone in ev[0], false, `${gone} is not part of an event any more`);
    assert.equal((await app.inject({ method: "PUT", url: `/v1/events/${eventId}/saved`, headers: h })).statusCode, 200);
    // regression: Android sends a body-less PUT as a web form; that used to be a 415 ("couldn't save")
    assert.equal((await app.inject({ method: "PUT", url: `/v1/events/${eventId}/saved`, headers: { ...h, "content-type": "application/x-www-form-urlencoded" } })).statusCode, 200);
    assert.equal((await app.inject({ method: "PUT", url: `/v1/events/${eventId}/saved`, headers: { ...h, "content-type": "application/octet-stream" }, payload: "hi" })).statusCode, 415);
    assert.equal((await app.inject({ method: "PUT", url: `/v1/events/${eventId}/registration`, headers: h })).statusCode, 404);
    assert.equal((await admin("POST", `/admin/api/events/${eventId}/registrations`, { emails: [email] })).statusCode, 404, "the admin has no enrolment either");
    assert.equal((await app.inject({ url: "/v1/events", headers: h })).json().events[0].saved, true);
    await admin("POST", "/admin/api/users", { email: "sam@example.org", name: "Sam" });
  });

  it("CSV import adds people by email, name and college; repeats and bad rows are reported", async () => {
    const csv = `email,name,college\nlee@example.org,Lee,SRM\nlee@example.org,Lee,SRM\nbad-email,Bad,`;
    const imp = (await admin("POST", "/admin/api/users/import", { csv })).json();
    assert.deepEqual([imp.added, imp.skipped, imp.invalid.length], [1, 1, 1]);
  });
  it("tickets: user creates, admin replies, user sees reply", async () => {
    const h = { authorization: `Bearer ${tokens.accessToken}` };
    const t = await app.inject({ method: "POST", url: "/v1/tickets", headers: h, payload: { kind: "General", topic: "Wi-Fi & power", message: "Wi-Fi is down on floor 2" } });
    assert.equal(t.statusCode, 201);
    await admin("POST", `/admin/api/tickets/${t.json().id}/reply`, { body: "On it!" });
    const list = (await app.inject({ url: "/v1/tickets", headers: h })).json();
    assert.equal(list[0].messages.at(-1).body, "On it!"); assert.equal(list[0].status, "in_progress");
  });
  it("notifications: only announcements and support replies, delivered to the right devices", async () => {
    const h = { authorization: `Bearer ${tokens.accessToken}` };
    const tok = "fcm-token-alex-" + "x".repeat(40), tok2 = "fcm-token-kim-" + "y".repeat(40);
    // registering a token needs a signed-in attendee; a second attendee (Kim) registers too
    assert.equal((await app.inject({ method: "PUT", url: "/v1/me/push-token", headers: h, payload: { token: tok, platform: "android" } })).statusCode, 200);
    assert.equal((await app.inject({ method: "PUT", url: "/v1/me/push-token", payload: { token: tok, platform: "android" } })).statusCode, 401);
    await admin("POST", "/admin/api/users", { email: "kim@example.org", name: "Kim" });
    const kim = (await db.query("SELECT id FROM users WHERE email='kim@example.org'"))[0]!.id;
    await db.query("INSERT INTO push_tokens (token,user_id,platform) VALUES ($1,$2,'android')", [tok2, kim]);
    const summary = (await admin("GET", "/admin/api/push")).json(); assert.equal(summary.devices, 2);
    // announcement -> every device, instantly
    outbox.length = 0;
    const a = await admin("POST", "/admin/api/announcements", { title: "Doors open at 9", body: "Main block desk." });
    assert.equal(a.json().notified, 2);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(outbox.map((o) => o.token).sort(), [tok, tok2].sort());
    assert.ok(outbox.every((o) => o.push.type === "announcement" && o.push.title === "Doors open at 9"));
    // support reply -> only that attendee's device
    outbox.length = 0;
    const list = (await app.inject({ url: "/v1/tickets", headers: h })).json(); const tid = list[0].id;
    await admin("POST", `/admin/api/tickets/${tid}/reply`, { body: "We are on it." });
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(outbox.map((o) => o.token), [tok]); assert.equal(outbox[0]!.push.type, "ticket"); assert.equal(outbox[0]!.push.id, tid);
    // nothing else triggers a notification: saving an event, creating a ticket, scanning
    outbox.length = 0;
    await app.inject({ method: "PUT", url: `/v1/events/${eventId}/saved`, headers: h });
    await admin("POST", "/admin/api/events", { title: "Silent", track: "Talk", startsAt: "2026-10-27T10:00:00+05:30", endsAt: "2026-10-27T11:00:00+05:30" });
    assert.equal(outbox.length, 0, "no other action sends a notification");
    // a blocked attendee stops receiving; logging out removes the token
    await admin("PATCH", `/admin/api/users/${kim}`, { status: "blocked" });
    assert.equal((await db.query("SELECT 1 FROM push_tokens WHERE token=$1", [tok2])).length, 0);
    assert.equal((await app.inject({ method: "DELETE", url: `/v1/me/push-token?token=${tok}`, headers: h })).statusCode, 200);
    assert.equal((await admin("GET", "/admin/api/push")).json().devices, 0);
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
    const v = (await check("POST", "/checkin/api/scan", { payload: live, scope })).json();
    assert.equal(v.result, "verify"); assert.equal(v.who.hasPhoto, true);
    assert.equal((await admin("GET", `/admin/api/attendance?scope=${scope}`)).json().rows.length, 0);
    // 2) reject records nothing; confirm records once
    assert.equal((await check("POST", "/checkin/api/confirm", { ticket: v.ticket, decision: "reject" })).json().result, "rejected");
    assert.equal((await check("POST", "/checkin/api/confirm", { ticket: v.ticket, decision: "confirm" })).json().result, "ok");
    assert.equal((await check("POST", "/checkin/api/confirm", { ticket: v.ticket, decision: "confirm" })).json().result, "duplicate");
    assert.equal((await check("POST", "/checkin/api/scan", { payload: live, scope })).json().result, "duplicate");
    assert.equal((await check("POST", "/checkin/api/confirm", { ticket: "garbage", decision: "confirm" })).statusCode, 400);
    assert.equal((await check("POST", "/checkin/api/scan", { payload: passPayload(secret, u!.pass_code, Date.now() - 5 * 60_000), scope: "day:2026-10-17" })).json().result, "expired");
    assert.equal((await check("POST", "/checkin/api/scan", { payload: passPayload(Buffer.alloc(32, 1), u!.pass_code), scope: "day:2026-10-17" })).json().result, "invalid");
  });
  it("admin sees attendance recorded by the scanner", async () => {
    const r = (await admin("GET", "/admin/api/attendance?scope=day:2026-10-16")).json();
    assert.equal(r.rows.length, 1); assert.equal(r.rows[0].email, "alex@example.org");
  });
  it("old device secret stops working after re-login (device binding)", async () => {
    const [u] = await db.query("SELECT pass_code FROM users WHERE email='alex@example.org'");
    const stale = passPayload(Buffer.alloc(32, 7), u!.pass_code);
    assert.equal((await check("POST", "/checkin/api/scan", { payload: stale, scope: "day:2026-10-18" })).json().result, "invalid");
  });
});

describe("web app: device gate and browser sessions", () => {
  const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
  const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
  const get = (url: string, ua: string, extra: Record<string, string> = {}) => app.inject({ url, headers: { "user-agent": ua, ...extra } });

  it("iPhone gets the app; Android and desktop only ever get the popup (pages, scripts, fonts, manifest, even missing files)", async () => {
    for (const path of ["/attendee", "/attendee/", "/attendee/hub", "/attendee/pass", "/attendee/support"]) {
      const r = await get(path, IOS); assert.equal(r.statusCode, 200, path); assert.match(r.headers["content-type"] as string, /html/);
    }
    for (const path of ["/attendee", "/attendee/hub", "/attendee/js/main.js", "/attendee/css/attendee.css", "/attendee/manifest.webmanifest", "/attendee/nothing.png"]) {
      const a = await get(path, ANDROID); assert.equal(a.statusCode, 403, "android " + path); assert.match(a.body, /isn’t available on Android/); assert.match(a.body, /href="\/\?from=user/);
      const d = await get(path, DESKTOP); assert.equal(d.statusCode, 403, "desktop " + path); assert.match(d.body, /Open this on your iPhone/);
      assert.equal(a.headers["cache-control"], "no-store");
    }
    assert.ok(!(await get("/attendee/hub", ANDROID)).body.includes("<script"), "the popup has no script to tamper with");
    // spoof attempts: a Chromium client hint that contradicts an iPhone user-agent, or an Android hint on a desktop UA
    assert.equal((await get("/attendee/hub", IOS, { "sec-ch-ua-platform": '"Windows"' })).statusCode, 403);
    assert.equal((await get("/attendee/hub", DESKTOP, { "sec-ch-ua-platform": '"Android"' })).statusCode, 403);
    assert.match((await get("/attendee/hub", DESKTOP, { "sec-ch-ua-platform": '"Android"' })).body, /isn’t available on Android/);
  });

  it("the landing page, and downloads work for everyone", async () => {
    for (const ua of [IOS, ANDROID, DESKTOP]) { const r = await get("/", ua); assert.equal(r.statusCode, 200); assert.match(r.body, /Download the app \(APK\)/); assert.match(r.body, /href="\/attendee"/); }
    assert.equal((await get("/downloads/qff-2026.apk", ANDROID)).headers["content-type"], "application/vnd.android.package-archive");
    assert.match((await get("/robots.txt", DESKTOP)).body, /Disallow: \/attendee/);
    assert.equal((await get("/admin", DESKTOP)).statusCode, 200); assert.equal((await get("/checkin", DESKTOP)).statusCode, 200);
    assert.match(String((await get("/attendee/hub", IOS)).headers["x-robots-tag"]), /noindex/);
  });

  it("browser sessions: refresh token only in an HttpOnly cookie, pass secret never sent, rotation + replay detection, real logout", async () => {
    const em = "web@example.org";
    await admin("POST", "/admin/api/users", { email: em, name: "Web Tester" });
    const W = (extra: Record<string, string> = {}) => ({ "user-agent": IOS, "x-qff-client": "web", ...extra });
    // the API refuses browser calls from Android / desktop
    assert.equal((await app.inject({ method: "POST", url: "/v1/auth/request-code", headers: { ...W(), "user-agent": ANDROID }, payload: { email: em } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/v1/auth/request-code", headers: { ...W(), "user-agent": DESKTOP }, payload: { email: em } })).json().error, "platform_not_supported");
    // cross-site POST refused
    assert.equal((await app.inject({ method: "POST", url: "/v1/auth/request-code", headers: W({ origin: "https://evil.example" }), payload: { email: em } })).statusCode, 403);
    assert.equal((await app.inject({ method: "POST", url: "/v1/auth/request-code", headers: W(), payload: { email: em } })).statusCode, 200);
    const v = await app.inject({ method: "POST", url: "/v1/auth/verify", headers: W(), payload: { email: em, code: await lastOtp(em), deviceId: "web-device-0001", deviceName: "Web (iPhone)" } });
    assert.equal(v.statusCode, 200);
    const body = v.json(); assert.ok(body.accessToken); assert.equal(body.refreshToken, undefined, "no refresh token in the body"); assert.equal(body.passSecret, undefined, "no pass secret in the body");
    const setCookie = String(v.headers["set-cookie"]); assert.match(setCookie, /qff_rt=/); assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=Strict/i); assert.match(setCookie, /Path=\/v1\/auth/);
    const rt1 = /qff_rt=([^;]+)/.exec(setCookie)![1]!;
    // a cookie alone is not accepted from a non-browser client (no web header) ...
    assert.equal((await app.inject({ method: "POST", url: "/v1/auth/refresh", headers: { cookie: `qff_rt=${rt1}` }, payload: {} })).statusCode, 401);
    // ... and a refresh token in the body is ignored for browsers
    assert.equal((await app.inject({ method: "POST", url: "/v1/auth/refresh", headers: W(), payload: { refreshToken: rt1 } })).statusCode, 401);
    // normal browser refresh rotates the cookie
    const r1 = await app.inject({ method: "POST", url: "/v1/auth/refresh", headers: W({ cookie: `qff_rt=${rt1}` }), payload: {} });
    assert.equal(r1.statusCode, 200); assert.equal(r1.json().refreshToken, undefined);
    const rt2 = /qff_rt=([^;]+)/.exec(String(r1.headers["set-cookie"]))![1]!; assert.notEqual(rt2, rt1);
    // two tabs racing with the same cookie: inside a short grace window the stale one just gets an access token (no new cookie, no sign-out)
    const race = await app.inject({ method: "POST", url: "/v1/auth/refresh", headers: W({ cookie: `qff_rt=${rt1}` }), payload: {} });
    assert.equal(race.statusCode, 200); assert.ok(race.json().accessToken); assert.equal(race.headers["set-cookie"], undefined);
    // later, replaying the old cookie is treated as theft: the whole session dies, including the fresh cookie
    await db.query("UPDATE sessions SET last_used_at = now() - interval '1 minute'");
    assert.equal((await app.inject({ method: "POST", url: "/v1/auth/refresh", headers: W({ cookie: `qff_rt=${rt1}` }), payload: {} })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/v1/auth/refresh", headers: W({ cookie: `qff_rt=${rt2}` }), payload: {} })).statusCode, 401);
    // sign in again, add the (mandatory) selfie, fetch pass codes, then log out without any access token
    await app.inject({ method: "POST", url: "/v1/auth/request-code", headers: W(), payload: { email: em } });
    const v2 = await app.inject({ method: "POST", url: "/v1/auth/verify", headers: W(), payload: { email: em, code: await lastOtp(em), deviceId: "web-device-0001" } });
    const at = v2.json().accessToken; const rt3 = /qff_rt=([^;]+)/.exec(String(v2.headers["set-cookie"]))![1]!;
    const A = { ...W(), authorization: `Bearer ${at}` };
    assert.equal((await app.inject({ url: "/v1/pass/codes", headers: A })).json().error, "photo_required");
    assert.equal((await app.inject({ method: "PUT", url: "/v1/me/photo", headers: { ...A, "content-type": "image/jpeg" }, payload: fakeJpeg() })).statusCode, 200);
    const codes = (await app.inject({ url: "/v1/pass/codes", headers: A })).json();
    assert.equal(codes.codes.length, 11); assert.equal(codes.stepSeconds, 30);
    const [u] = await db.query("SELECT pass_secret, pass_code FROM users WHERE email=$1", [em]);
    assert.equal(codes.codes[1].payload, passPayload(Buffer.from(u!.pass_secret), u!.pass_code), "codes[1] is the current 30-second window");
    const sc = (await check("POST", "/checkin/api/scan", { payload: codes.codes[1].payload, scope: "day:2026-10-29" })).json();
    assert.equal(sc.result, "verify", "a code from the web app scans at the door");
    const lo = await app.inject({ method: "POST", url: "/v1/auth/web-logout", headers: W({ cookie: `qff_rt=${rt3}` }), payload: {} });
    assert.equal(lo.statusCode, 200); assert.match(String(lo.headers["set-cookie"]), /qff_rt=;/);
    assert.equal((await app.inject({ url: "/v1/me", headers: A })).statusCode, 401, "the access token dies with the session");
    assert.equal((await app.inject({ method: "POST", url: "/v1/auth/refresh", headers: W({ cookie: `qff_rt=${rt3}` }), payload: {} })).statusCode, 401);
  });
});

describe("web push endpoints", () => {
  it("only accepts the browser vendors' push services (no arbitrary hosts the server could be made to call)", async () => {
    const { isPushServiceUrl } = await import("../src/routes/attendee.ts");
    for (const ok of ["https://web.push.apple.com/Qabc", "https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/w/?token=x"]) assert.equal(isPushServiceUrl(ok), true, ok);
    for (const bad of ["https://127.0.0.1/x", "https://evil.example/x", "https://web.push.apple.com.evil.example/x", "http://web.push.apple.com/x", "https://web.push.apple.com:8443/x", "https://attendee@web.push.apple.com/x", "https://169.254.169.254/", "nonsense"]) assert.equal(isPushServiceUrl(bad), false, bad);
  });
});

describe("addresses: one canonical URL per page, proper 404s", () => {
  const ios = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
  const get = (url: string, headers: Record<string, string> = {}) => app.inject({ method: "GET", url, headers: { "user-agent": ios, ...headers } });
  it("duplicate spellings redirect permanently to the canonical address; retired names are simply gone", async () => {
    for (const [from, to] of [["/admin/", "/admin"], ["/checkin/", "/checkin"], ["/index.html", "/"], ["/admin/index.html", "/admin"], ["/checkin/index.html", "/checkin"],
      ["/attendee/index.html", "/attendee"], ["/attendee/hub/", "/attendee/hub"], ["/attendee/pass/", "/attendee/pass"], ["/attendee/support/", "/attendee/support"], ["/favicon.ico", "/shared/favicon.ico"]] as const) {
      const r = await get(from); assert.equal(r.statusCode, 301, from); assert.equal(r.headers.location, to, from);
    }
    for (const gone of ["/user", "/user/hub", "/check", "/scan", "/download", "/download/qiskit-fallfest-2026.apk"]) assert.equal((await get(gone, { accept: "application/json" })).statusCode, 404, gone);
    assert.equal((await get("/attendee/anything")).statusCode, 302); assert.equal((await get("/attendee/anything")).headers.location, "/attendee");
    for (const ok of ["/", "/admin", "/checkin", "/attendee", "/attendee/hub", "/attendee/pass", "/attendee/support", "/admin/admin.js", "/checkin/checkin.js", "/checkin/vendor/jsQR.js", "/admin/qiskit.svg"]) assert.equal((await get(ok)).statusCode, 200, ok);
  });
  it("unknown addresses: a branded page for browsers, JSON for API clients", async () => {
    const page = await get("/no-such-page", { accept: "text/html,application/xhtml+xml" });
    assert.equal(page.statusCode, 404); assert.match(String(page.headers["content-type"]), /text\/html/); assert.match(page.body, /Page not found/);
    const json = await get("/no-such-page", { accept: "application/json" }); assert.equal(json.statusCode, 404); assert.equal(json.json().error, "not_found");
    const api = await get("/v1/no-such", { accept: "text/html" }); assert.equal(api.statusCode, 404); assert.equal(api.json().error, "not_found");
  });
  it("the APK is a download with the right type", async () => {
    const r = await get("/downloads/qff-2026.apk"); assert.equal(r.statusCode, 200);
    assert.match(String(r.headers["content-disposition"]), /attachment; filename="qff-2026.apk"/); assert.match(String(r.headers["content-type"]), /android\.package-archive/);
  });
});

describe("website sync: people registered on the main website become attendees here", () => {
  const KEY = "sync-test-secret-0123456789"; const auth = { authorization: `Bearer ${KEY}` };
  const push = (people: unknown[], headers: Record<string, string> = auth) => app.inject({ method: "POST", url: "/integrations/website/attendees", headers, payload: { people } });

  it("labels SRM addresses: underscore = student, dot = faculty, anything else on the domain = unclear, other domains = external", () => {
    assert.equal(classifyEmail("vaishnav_s@srmap.edu.in"), "student"); assert.equal(classifyEmail("Vaishnav_S@SRMAP.edu.in"), "student");
    assert.equal(classifyEmail("vaishnav.s@srmap.edu.in"), "faculty"); assert.equal(classifyEmail("vaishnav@srmap.edu.in"), "unclear");
    assert.equal(classifyEmail("a_b.c@srmap.edu.in"), "unclear"); assert.equal(classifyEmail("a_b@gmail.com"), "external"); assert.equal(classifyEmail("a_b@x.srmap.edu.in"), "external");
  });
  it("only the shared key gets in", async () => {
    config.website.secret = KEY;
    assert.equal((await push([{ email: "x@example.org", name: "X" }], {})).statusCode, 401);
    assert.equal((await push([{ email: "x@example.org", name: "X" }], { authorization: "Bearer wrong-key-wrong-key-wrong" })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/integrations/website/reconcile" })).statusCode, 401);
    config.website.secret = undefined; assert.equal((await push([{ email: "x@example.org", name: "X" }])).statusCode, 401, "no key configured = closed"); config.website.secret = KEY;
  });
  it("adds people once, keeps names and admin decisions, labels them, skips non-participants", async () => {
    const a = (await push([{ email: "Ravi_K@srmap.edu.in", name: "Ravi Kumar", institution: "SRM AP" }, { email: "prof.rao@srmap.edu.in", name: "Prof Rao" }, { email: "ext@example.org", name: "Ext Person", institution: "IIT" },
      { email: "mentor@example.org", name: "A Mentor", role: "mentor" }, { email: "gone@example.org", name: "Gone", isActive: false }, { email: "not-an-email", name: "Bad" }])).json();
    assert.deepEqual([a.created, a.skipped, a.failed], [3, 3, 0]);
    const rows = (await admin("GET", "/admin/api/users")).json().rows; const by = (e: string) => rows.find((u: any) => u.email === e);
    assert.equal(by("ravi_k@srmap.edu.in").kind, "student"); assert.equal(by("ravi_k@srmap.edu.in").source, "website"); assert.equal(by("prof.rao@srmap.edu.in").kind, "faculty"); assert.equal(by("ext@example.org").kind, "external");
    assert.equal(by("mentor@example.org"), undefined); assert.equal(by("gone@example.org"), undefined);
    const again = (await push([{ email: "ravi_k@srmap.edu.in", name: "Changed Name", institution: "Other" }])).json();
    assert.deepEqual([again.created, again.updated], [0, 0]); assert.equal(by("ravi_k@srmap.edu.in").name, "Ravi Kumar");
    assert.equal((await admin("GET", "/admin/api/users?kind=faculty")).json().rows.map((u: any) => u.email).join(), "prof.rao@srmap.edu.in");
    // switched off on the website -> blocked here, but only for people who came from the website
    await push([{ email: "ravi_k@srmap.edu.in", name: "Ravi Kumar", isActive: false }]);
    assert.equal((await admin("GET", "/admin/api/users")).json().rows.find((u: any) => u.email === "ravi_k@srmap.edu.in").status, "blocked");
    await admin("POST", "/admin/api/users", { email: "adminmade@example.org", name: "Admin Made", college: null });
    await push([{ email: "adminmade@example.org", name: "Admin Made", isActive: false }]);
    assert.equal((await admin("GET", "/admin/api/users")).json().rows.find((u: any) => u.email === "adminmade@example.org").status, "active", "admin-created people are never switched off by the website");
  });
  it("the attendee list filters by selfie, app use, status and source, counts the matches, sorts and pages", async () => {
    const get = async (qs: string) => (await admin("GET", "/admin/api/users" + qs)).json();
    const all = await get(""); assert.equal(all.total, all.all); assert.ok(all.total >= 4);
    const withPhoto = await get("?selfie=yes"), noPhoto = await get("?selfie=no");
    assert.equal(withPhoto.total + noPhoto.total, all.total, "yes + no covers everyone");
    assert.equal(withPhoto.rows.every((u: any) => u.hasPhoto), true); assert.equal(noPhoto.rows.every((u: any) => !u.hasPhoto), true);
    const web = await get("?source=website"); assert.ok(web.total >= 3); assert.equal(web.rows.every((u: any) => u.source === "website"), true);
    assert.equal((await get("?status=blocked")).rows.map((u: any) => u.email).includes("ravi_k@srmap.edu.in"), true);
    assert.equal((await get("?app=no&selfie=no&source=website&kind=faculty")).total, 1, "filters combine");
    const byName = (await get("?sort=name")).rows.map((u: any) => u.name.toLowerCase()); assert.deepEqual(byName, [...byName].sort());
    const page = await get("?limit=2&offset=1"); assert.equal(page.rows.length, 2); assert.equal(page.total, all.total, "total ignores paging");
    assert.equal((await admin("GET", "/admin/api/users?selfie=maybe")).statusCode, 400);
  });
  it("an email that isn't registered yet gets a pointer to the website; after the sync it can log in", async () => {
    const r = await app.inject({ method: "POST", url: "/v1/auth/request-code", payload: { email: "late.comer@example.org" } });
    assert.equal(r.statusCode, 404); assert.match(r.json().message, /Register on the Fall Fest website first/);
    await push([{ email: "late.comer@example.org", name: "Late Comer" }]);
    assert.equal((await app.inject({ method: "POST", url: "/v1/auth/request-code", payload: { email: "late.comer@example.org" } })).statusCode, 200);
  });
  it("pulls the website's export (several pages) on a schedule or from the admin button, and logs it", async () => {
    const pages = [{ people: [{ email: "p1@example.org", name: "P One" }, { email: "p2_x@srmap.edu.in", name: "P Two" }], nextCursor: "c2" }, { people: [{ email: "p3@example.org", name: "P Three" }], nextCursor: null }];
    let seenAuth = ""; const srv = createServer((req, res) => { seenAuth = String(req.headers.authorization); const cur = new URL(req.url!, "http://x").searchParams.get("cursor"); res.setHeader("content-type", "application/json"); res.end(JSON.stringify(pages[cur ? 1 : 0])); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r)); const was = config.website.baseUrl; config.website.baseUrl = `http://127.0.0.1:${(srv.address() as any).port}`;
    try {
      const run = (await admin("POST", "/admin/api/sync/run")).json(); assert.equal(run.ok, true); assert.equal(seenAuth, `Bearer ${KEY}`);
      assert.deepEqual([run.counts.seen, run.counts.created], [3, 3]);
      const sch = (await app.inject({ method: "POST", url: "/integrations/website/reconcile", headers: auth })).json(); assert.equal(sch.ok, true); assert.equal(sch.counts.created, 0, "second run adds nothing");
      const st = (await admin("GET", "/admin/api/sync")).json(); assert.equal(st.configured, true); assert.ok(st.runs.some((r: any) => r.trigger === "scheduler" && r.status === "ok"));
      await db.query("INSERT INTO sync_runs (trigger) VALUES ('admin')"); // a run in progress blocks a second one
      assert.match((await admin("POST", "/admin/api/sync/run")).json().message, /already running/); await db.query("DELETE FROM sync_runs WHERE status='running'");
      srv.close(); srv.closeAllConnections();
      const down = (await admin("POST", "/admin/api/sync/run")).json(); assert.equal(down.ok, false); assert.match(down.message, /Sync failed/);
    } finally { config.website.baseUrl = was; srv.close(); }
  });
});

describe("check-in: anyone with a pass can be let in to any event; lookup for dead phones", () => {
  it("scanning someone at any event just works and shows up in attendance", async () => {
    const [ev] = await db.query("INSERT INTO events (title,description,track,location,starts_at,ends_at) VALUES ('Any Event','x','Main','SRM',now(),now() + interval '2 hours') RETURNING id");
    const u = (await db.query("SELECT id,pass_code,pass_secret FROM users WHERE email='ext@example.org'"))[0]!;
    const scope = `event:${ev!.id}`;
    const v = (await check("POST", "/checkin/api/scan", { payload: passPayload(Buffer.from(u.pass_secret), u.pass_code), scope })).json();
    assert.equal(v.result, "verify"); assert.doesNotMatch(v.warning ?? "", /registered/, "no registration warning exists any more");
    assert.equal((await check("POST", "/checkin/api/confirm", { ticket: v.ticket, decision: "confirm" })).json().result, "ok");
    const att = (await admin("GET", `/admin/api/attendance?scope=${encodeURIComponent(scope)}`)).json(); assert.equal(att.rows.length, 1); assert.equal(att.rows[0].name, "Ext Person");
  });
  it("finds a person by name or pass code, then runs the same face check", async () => {
    await admin("POST", "/admin/api/users", { email: "fin@example.org", name: "Finalist" });
    assert.equal((await check("GET", "/checkin/api/lookup?q=ab")).statusCode, 400, "needs 3+ characters");
    assert.equal((await app.inject({ url: "/checkin/api/lookup?q=finalist" })).statusCode, 401, "scanner login required");
    const hits = (await check("GET", "/checkin/api/lookup?q=finalist")).json(); assert.equal(hits.length, 1); assert.equal(hits[0].name, "Finalist");
    const byCode = (await check("GET", `/checkin/api/lookup?q=${hits[0].passCode.toLowerCase()}`)).json(); assert.equal(byCode[0].id, hits[0].id);
    const scope = "day:2026-10-26";
    const v = (await check("POST", "/checkin/api/scan-manual", { userId: hits[0].id, scope })).json();
    assert.equal(v.result, "verify"); assert.match(v.warning, /Found by search, no QR was scanned/); assert.equal(v.who.name, "Finalist");
    assert.equal((await check("POST", "/checkin/api/confirm", { ticket: v.ticket, decision: "confirm" })).json().result, "ok");
    assert.equal((await check("POST", "/checkin/api/scan-manual", { userId: hits[0].id, scope })).json().result, "duplicate");
    assert.equal((await check("POST", "/checkin/api/scan-manual", { userId: "a1b2c3d4-e5f6-4a8b-9c0d-1e2f3a4b5c6d", scope })).json().result, "invalid");
    await db.query("UPDATE users SET status='blocked' WHERE id=$1", [hits[0].id]);
    assert.equal((await check("POST", "/checkin/api/scan-manual", { userId: hits[0].id, scope: "day:2026-10-27" })).json().result, "blocked");
    await db.query("UPDATE users SET status='active' WHERE id=$1", [hits[0].id]);
    assert.ok((await db.query("SELECT 1 FROM audit_log WHERE action='check.manual_lookup'")).length >= 2, "manual lookups are on the record");
  });
});
