// The /attendee web app, driven in a real (headless) browser: device gate, sign-in, selfie, hub, pass QR, support, sign-out.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildApp } from "../src/app.ts";
import { config } from "../src/config.ts";
import { hmac } from "../src/lib/crypto.ts";
import { migrate, openDb } from "../src/db.ts";
import { Browser, chromeBin } from "./helpers/browser.ts";

describe("web app in a browser", { skip: chromeBin ? false : "no Chrome/Chromium found" }, () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let db: Awaited<ReturnType<typeof openDb>>; let b: Browser; let base = "";
  const iso = (d: string, h: number) => new Date(Date.parse(`2026-10-${d}T00:00:00+05:30`) + h * 3600_000).toISOString();
  const code = (email: string, c: string) => db.query("INSERT INTO otp_codes (email, code_hash, expires_at) VALUES ($1,$2,$3)", [email, hmac(config.otpPepper, `${email}|${c}`).toString("hex"), new Date(Date.now() + 600_000)]);
  let eventIds: string[] = [];

  before(async () => {
    db = await openDb(); await migrate(db); app = await buildApp(db);
    await app.listen({ port: 0, host: "127.0.0.1" }); base = `http://127.0.0.1:${(app.server.address() as any).port}`;
    for (const [t, tr, s, e, acc] of [["Inauguration", "Main", iso("26", 10), iso("26", 11), "open"], ["Grand Finale", "Hackathon", iso("28", 18), iso("29", 18), "prereg"]] as const)
      eventIds.push((await db.query("INSERT INTO events (title,description,track,location,starts_at,ends_at,access,registration_required) VALUES ($1,'Sample','" + tr + "','SRM University AP',$2,$3,$4,$5) RETURNING id", [t, s, e, acc, acc === "prereg"]))[0]!.id);
    await db.query("INSERT INTO settings (key,value) VALUES ('fest_start','2026-10-26'),('fest_end','2026-10-30') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value");
    const [u] = await db.query("INSERT INTO users (email,name,college,pass_code,pass_secret) VALUES ('web@example.org','Web Tester','SRM AP','QFF-7777',$1) RETURNING id", [Buffer.alloc(32, 9)]);
    await db.query("INSERT INTO user_events (user_id,event_id,kind) VALUES ($1,$2,'registered')", [u!.id, eventIds[1]]);
    b = await Browser.launch();
  });
  after(async () => { b?.close(); await app?.close(); });

  it("Android sees a blocking popup, can only go to the downloads page, and the API refuses it too", async () => {
    await b.device("android"); await b.goto(base + "/attendee/hub");
    assert.ok(await b.until(`!!document.querySelector('.dialog')`));
    assert.match(await b.ev(`document.querySelector('.dialog').textContent`), /isn’t available on Android/);
    assert.equal(await b.ev(`!!document.querySelector('.tabbar, .signin, .hero')`), false, "no part of the app is rendered");
    assert.equal(await b.ev(`document.querySelectorAll('script').length`), 0, "no script was even delivered");
    assert.equal(await b.ev(`fetch('/v1/auth/request-code',{method:'POST',headers:{'x-qff-client':'web','content-type':'application/json'},body:'{"email":"web@example.org"}'}).then(r=>r.status)`), 403);
    assert.equal(await b.ev(`fetch('/attendee/js/main.js').then(r=>r.status)`), 403, "the app's scripts are refused");
    await b.tap(".dialog .btn"); assert.ok(await b.until(`location.pathname === '/'`));
    assert.ok(await b.until(`!document.getElementById('notice').hidden`)); assert.match(await b.ev(`document.getElementById('notice').textContent`), /isn’t available on Android/);
  });

  it("desktop browsers, and an iPhone user-agent on a non-iPhone device, are blocked as well", async () => {
    await b.device("desktop"); await b.goto(base + "/attendee");
    assert.ok(await b.until(`!!document.querySelector('.dialog')`)); assert.match(await b.ev(`document.querySelector('.dialog').textContent`), /Open this on your iPhone/);
    // a laptop claiming to be an iPhone in its user-agent, but giving itself away through the client hint -> server refuses
    await b.device("ios", { chPlatform: "Windows" }); await b.goto(base + "/attendee");
    assert.ok(await b.until(`!!document.querySelector('.dialog')`)); assert.equal(await b.ev(`!!document.querySelector('.signin')`), false);
    // server fooled, but the page itself notices navigator.platform is not an iPhone -> blocked in the browser
    await b.device("ios", { navPlatform: "Linux x86_64" }); await b.goto(base + "/attendee");
    assert.ok(await b.until(`!!document.querySelector('.dialog')`)); assert.equal(await b.ev(`!!document.querySelector('.signin')`), false);
  });

  it("iPhone: landing page shows the web-app button, then sign in -> selfie -> hub -> QR that scans at the door -> support -> sign out", async () => {
    await b.device("ios"); await b.goto(base + "/");
    assert.ok(await b.until(`!!document.querySelector('a.webapp')`)); assert.match(await b.ev(`document.querySelector('#ios').textContent`), /still being published to the App Store/);
    await b.tap("a.webapp"); assert.ok(await b.until(`location.pathname === '/attendee' && !!document.querySelector('.signin')`));
    assert.match(await b.ev(`document.querySelector('.hero-title').textContent`), /Qiskit\s*Fall Fest\s*SRMAP 2026/i);

    // unknown email -> the server's plain message
    await b.type("input[type=email]", "nobody@example.org"); await b.tap(".form .btn");
    assert.ok(await b.until(`!!document.querySelector('.err')`)); assert.match(await b.ev(`document.querySelector('.err').textContent`), /isn't on the attendee list/);
    // sign in with an emailed code
    await b.type("input[type=email]", "web@example.org"); await code("web@example.org", "246810"); await b.tap(".form .btn");
    assert.ok(await b.until(`!!document.querySelector('.codes')`));
    await b.type(".codes input", "000000"); assert.ok(await b.until(`!!document.querySelector('.err')`)); assert.match(await b.ev(`document.querySelector('.err').textContent`), /incorrect or has expired/);
    await b.type(".codes input", "246810");
    // mandatory selfie: nothing else is reachable until it is saved
    assert.ok(await b.until(`!!document.querySelector('.selfie')`));
    assert.equal(await b.ev(`fetch('/v1/events',{headers:{'x-qff-client':'web'}}).then(r=>r.status)`), 401);
    assert.ok(await b.until(`document.querySelector('.shutter') && !document.querySelector('.shutter').disabled`, 10000));
    await b.tap(".shutter"); assert.ok(await b.until(`!!document.querySelector('.frame img')`));
    await b.tap(".twobtn .btn:last-child"); assert.ok(await b.until(`!!document.querySelector('.dialog')`)); await b.tap(".dialog .actions .btn");
    assert.ok(await b.until(`!!document.querySelector('.tabbar') && !!document.querySelector('.hero')`, 10000));
    assert.equal((await db.query("SELECT 1 FROM user_photos"))[0] ? 1 : 0, 1, "the selfie reached the server");
    assert.equal(await b.ev(`location.pathname`), "/attendee/hub");
    // the refresh token is not readable by the page, and nothing secret is in storage
    assert.equal(await b.ev(`document.cookie`), "", "no script-readable cookie (the session cookie is HttpOnly)");
    assert.equal(await b.ev(`JSON.stringify(Object.keys(localStorage).filter(k=>/token|secret|refresh/i.test(k)))`), "[]");

    // hub content + event sheet + save
    assert.match(await b.ev(`document.querySelector('.list').textContent`), /Inauguration/);
    await b.tap(".row .save"); assert.ok(await b.until(`document.querySelector('.row .save').classList.contains('on')`));
    assert.equal((await db.query("SELECT 1 FROM user_events WHERE kind='saved'")).length, 1, "saving reached the server");
    await b.tap(".row.card"); assert.ok(await b.until(`!!document.querySelector('.sheet .access')`)); await b.ev(`history.back()`); assert.ok(await b.until(`!document.querySelector('.sheet')`));

    // pass: hidden until tapped, then a rotating QR that really scans at the door
    await b.tap(".tab[aria-label='My Pass']"); assert.ok(await b.until(`location.pathname === '/attendee/pass' && !!document.querySelector('.pass')`));
    assert.equal(await b.ev(`!!document.querySelector('canvas.qr, .qrfull')`), false, "no QR until tapped");
    assert.match(await b.ev(`document.querySelector('.list').textContent`), /Grand Finale/, "registered events are listed");
    await b.tap(".pass .btn"); assert.ok(await b.until(`!!document.querySelector('.qrfull canvas')`));
    await b.wait(600);
    const jsqr = readFileSync(new URL("../public/checkin/vendor/jsQR.js", import.meta.url), "utf8");
    const decoded = await b.ev(`(()=>{${jsqr}; const c=document.querySelector('.qrfull canvas'); const o=document.createElement('canvas'); const pad=Math.round(c.width*0.1); o.width=o.height=c.width+2*pad; const g=o.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,o.width,o.height); g.drawImage(c,pad,pad); const d=g.getImageData(0,0,o.width,o.height); const f=window.jsQR; const out=[]; for (const sz of [c.width+2*pad, 700, 600, 500, 450, 400, 350, 300, 250, 200]) { const t=document.createElement('canvas'); t.width=t.height=sz; const k=t.getContext('2d'); k.fillStyle='#fff'; k.fillRect(0,0,sz,sz); k.drawImage(o,0,0,sz,sz); const dd=k.getImageData(0,0,sz,sz); const r=f(dd.data,sz,sz); if(r) return r.data; out.push(sz);} return 'nodecode '+out.join(',')})()`);
    assert.match(String(decoded), /^QFF1\.QFF-7777\.\d+\.[A-Za-z0-9_-]{12}$/, "the QR decodes to a pass code");
    const lg = await app.inject({ method: "POST", url: "/checkin/api/login", payload: { username: "check", password: "check-dev-password" } });
    const scan = (await app.inject({ method: "POST", url: "/checkin/api/scan", headers: { cookie: String(lg.headers["set-cookie"]).split(";")[0]!, "x-csrf-token": lg.json().csrf }, payload: { payload: decoded, scope: "day:2026-10-26" } })).json();
    assert.equal(scan.result, "verify", "the door scanner accepts the code shown by the web app"); assert.equal(scan.who.name, "Web Tester"); assert.equal(scan.who.hasPhoto, true);
    await b.tap(".qrfull"); assert.ok(await b.until(`!document.querySelector('.qrfull')`));

    // support: ticket, reply, thread, red dot
    await b.tap(".tab[aria-label='Support']"); assert.ok(await b.until(`location.pathname === '/attendee/support' && !!document.querySelector('.support-opts')`));
    await b.tap(".card.press"); assert.ok(await b.until(`!!document.querySelector('.sheet .area')`));
    await b.type(".sheet .area", "My QR is not scanning at the gate"); await b.tap(".sheet .btn"); assert.ok(await b.until(`!!document.querySelector('.sheet .empty')`)); await b.tap(".sheet .btn");
    assert.ok(await b.until(`!!document.querySelector('.tkt')`));
    const t = (await db.query("SELECT id FROM tickets"))[0]!; await db.query("INSERT INTO ticket_messages (ticket_id,author,body) VALUES ($1,'admin','Try max brightness.')", [t.id]);
    await b.tap(".tab[aria-label='Hub']"); await b.tap(".tab[aria-label='Support']");
    assert.ok(await b.until(`!!document.querySelector('.tkt .pill.pri')`), "a new reply is flagged");
    assert.equal(await b.ev(`!!document.querySelector('.tab .dot')`), true, "red dot on the Support tab");
    await b.tap(".tkt"); assert.ok(await b.until(`!!document.querySelector('.thread .msg.team')`));
    assert.equal(await b.ev(`getComputedStyle(document.querySelector('.msg.me')).justifyContent`), "flex-end", "your messages sit on the right");
    await b.ev(`history.back()`);

    // reload keeps the session (cookie), sign-out ends it for real
    await b.goto(base + "/attendee/pass"); assert.ok(await b.until(`!!document.querySelector('.pass')`, 10000), "session survives a reload");
    await b.tap(".tab[aria-label='Hub']"); assert.ok(await b.until(`!!document.querySelector('.hero')`)); await b.tap(".avatar"); assert.ok(await b.until(`!!document.querySelector('.sheet')`));
    await b.ev(`[...document.querySelectorAll('.sheet button')].find((x) => /Sign out/.test(x.textContent)).click()`); assert.ok(await b.until(`!!document.querySelector('.dialog')`)); await b.tap(".dialog .actions .btn");
    assert.ok(await b.until(`!!document.querySelector('.signin')`)); assert.equal(await b.ev(`location.pathname`), "/attendee");
    assert.equal((await db.query("SELECT 1 FROM sessions WHERE revoked_at IS NULL")).length, 0, "the session was revoked on the server");
    await b.goto(base + "/attendee/hub"); assert.ok(await b.until(`!!document.querySelector('.signin')`), "after sign-out the app asks to sign in again");

    const real = b.errors; assert.deepEqual(real, [], "no JavaScript errors anywhere in the journey");
  });
});
