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
    for (const [t, tr, s, e] of [["Inauguration", "Main", iso("26", 10), iso("26", 11)], ["Grand Finale", "Hackathon", iso("28", 18), iso("29", 18)]] as const)
      eventIds.push((await db.query("INSERT INTO events (title,description,track,location,starts_at,ends_at) VALUES ($1,'Sample','" + tr + "','SRM University AP',$2,$3) RETURNING id", [t, s, e]))[0]!.id);
    await db.query("INSERT INTO settings (key,value) VALUES ('fest_start','2026-10-26'),('fest_end','2026-10-30') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value");
    const [u] = await db.query("INSERT INTO users (email,name,college,pass_code,pass_secret) VALUES ('web@example.org','Web Tester','SRM AP','QFF-7777',$1) RETURNING id", [Buffer.alloc(32, 9)]);
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

  it("when Android is allowed, an Android phone opens the app (sign-in screen), and the landing page offers both the APK and the web app", async () => {
    const was = config.webAppPlatforms; config.webAppPlatforms = ["ios", "android"];
    try {
      await b.device("android"); await b.goto(base + "/attendee");
      assert.ok(await b.until(`!!document.querySelector('.signin')`, 15000), "the sign-in screen, not the popup");
      assert.equal(await b.ev(`!!document.querySelector('.dialog')`), false);
      assert.equal(await b.ev(`fetch('/v1/auth/request-code',{method:'POST',headers:{'x-qff-client':'web','content-type':'application/json'},body:'{"email":"nobody@example.org"}'}).then(r=>r.status)`), 404, "the API answers (not 403)");
      await b.goto(base + "/");
      assert.ok(await b.until(`!!document.querySelector('#android .btn.alt')`));
      assert.deepEqual(await b.ev(`[...document.querySelectorAll('#android .pair .btn')].map((a) => a.getAttribute('href'))`), ["/downloads/qff-2026.apk", "/attendee"], "APK first, web app second");
      assert.equal(await b.ev(`(() => { const [a, c] = [...document.querySelectorAll('#android .pair .btn')].map((x) => x.getBoundingClientRect()); return Math.abs(a.width - c.width) < 1 && Math.abs(a.height - c.height) < 2; })()`), true, "both buttons are the same size");
    } finally { config.webAppPlatforms = was; }
  });
  it("when desktop is allowed, a laptop sees the app inside a phone-sized frame and can sign in there; Android stays blocked", async () => {
    const was = config.webAppPlatforms; config.webAppPlatforms = ["ios", "desktop"];
    try {
      await b.device("desktop"); await b.goto(base + "/attendee");
      assert.ok(await b.until(`!!document.querySelector('.devphone iframe')`));
      const r = await b.ev(`fetch('/attendee').then(r=>r.text())`); assert.match(r, /data-desktop="1"/);
      await b.ev(`navigator.serviceWorker.getRegistrations().then((r) => Promise.all(r.map((x) => x.unregister()))).then(() => caches.keys()).then((k) => Promise.all(k.map((x) => caches.delete(x)))).then(() => 1)`);
      await b.device("android"); await b.goto(base + "/attendee/hub");
      assert.ok(await b.until(`!!document.querySelector('.dialog')`));
    } finally { config.webAppPlatforms = was; }
  });

  it("iPhone: landing page shows the web-app button, then sign in -> selfie -> hub -> QR that scans at the door -> support -> sign out", async () => {
    await b.device("ios"); await b.goto(base + "/");
    assert.ok(await b.until(`!!document.querySelector('a.webapp')`)); assert.match(await b.ev(`document.querySelector('#ios').textContent`), /isn’t on the App Store yet/);
    await b.tap("a.webapp"); assert.ok(await b.until(`location.pathname === '/attendee' && !!document.querySelector('.signin')`));
    assert.match(await b.ev(`document.querySelector('.hero-title').textContent`), /Qiskit\s*Fall Fest\s*SRMAP 2026/i);

    // the atom drawing must never sit on top of the email field (it once swallowed taps and hid the text)
    assert.equal(await b.ev(`(() => { const r = document.querySelector('.field input').getBoundingClientRect(); return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.field'); })()`), true, "nothing covers the email field");
    // unknown email -> the server's plain message
    await b.type("input[type=email]", "nobody@example.org"); await b.tap(".form .btn");
    assert.ok(await b.until(`!!document.querySelector('.err')`)); assert.match(await b.ev(`document.querySelector('.err').textContent`), /register on the Fall Fest website/i);
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
    // add-to-home-screen card: iPhone Safari gets the steps (no install button exists there); dismissing hides it
    assert.ok(await b.until(`!!document.querySelector('.sheet') && /Add QFF 2026 to your home screen/.test(document.querySelector('.sheet').textContent)`, 8000), "the one-time home-screen popup appears after sign-in");
    await b.ev(`[...document.querySelectorAll('.sheet button')].find((x) => /Not now/.test(x.textContent)).click()`); assert.ok(await b.until(`!document.querySelector('.sheet')`));
    assert.equal(await b.ev(`localStorage.getItem('qff.installAsked')`), "1", "asked once");
    assert.ok(await b.until(`!!document.querySelector('.install')`), "the home-screen card is offered");
    await b.tap(".install .go"); assert.ok(await b.until(`!!document.querySelector('.sheet .steps')`)); assert.match(await b.ev(`document.querySelector('.sheet .steps').textContent`), /Add to Home Screen/);
    await b.ev(`history.back()`); assert.ok(await b.until(`!document.querySelector('.sheet')`));
    await b.tap(".install .x"); assert.ok(await b.until(`!document.querySelector('.install')`), "dismissed");
    assert.equal(await b.ev(`location.pathname`), "/attendee/hub");
    // the refresh token is not readable by the page, and nothing secret is in storage
    assert.equal(await b.ev(`document.cookie`), "", "no script-readable cookie (the session cookie is HttpOnly)");
    assert.equal(await b.ev(`JSON.stringify(Object.keys(localStorage).filter(k=>/token|secret|refresh/i.test(k)))`), "[]");

    // hub content + event sheet + save
    // the day strip opens on today's date when today is a fest day (26-30 Oct), otherwise on ALL DAYS
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const on = await b.ev(`document.querySelector('.chip.on')?.textContent`);
    if (today >= "2026-10-26" && today <= "2026-10-30") assert.ok(on.includes(String(Number(today.slice(8)))), "today is selected: " + on); else assert.match(on, /ALL/);
    await b.tap(".chip:first-child"); assert.ok(await b.until(`/Inauguration/.test(document.querySelector('.list').textContent)`));
    await b.tap(".row .save"); assert.ok(await b.until(`document.querySelector('.row .save').classList.contains('on')`));
    assert.equal((await db.query("SELECT 1 FROM user_events WHERE kind='saved'")).length, 1, "saving reached the server");
    await b.tap(".row.card"); assert.ok(await b.until(`!!document.querySelector('.sheet .infoCard')`)); await b.ev(`history.back()`); assert.ok(await b.until(`!document.querySelector('.sheet')`));

    // pass: hidden until tapped, then a rotating QR that really scans at the door
    await b.tap(".tab[aria-label='My Pass']"); assert.ok(await b.until(`location.pathname === '/attendee/pass' && !!document.querySelector('.pass')`));
    assert.equal(await b.ev(`!!document.querySelector('canvas.qr, .qrfull')`), false, "no QR until tapped");
    assert.match(await b.ev(`document.querySelector('.list').textContent`), /Inauguration/, "saved events are listed under My pass");
    await b.tap(".pass .btn"); assert.ok(await b.until(`!!document.querySelector('.qrfull canvas')`));
    await b.wait(600);
    const jsqr = readFileSync(new URL("../public/checkin/vendor/jsQR.js", import.meta.url), "utf8");
    const decoded = await b.ev(`(()=>{${jsqr}; const c=document.querySelector('.qrfull canvas'); const o=document.createElement('canvas'); const pad=Math.round(c.width*0.1); o.width=o.height=c.width+2*pad; const g=o.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,o.width,o.height); g.drawImage(c,pad,pad); const d=g.getImageData(0,0,o.width,o.height); const f=window.jsQR; const out=[]; for (const sz of [c.width+2*pad, 700, 600, 500, 450, 400, 350, 300, 250, 200]) { const t=document.createElement('canvas'); t.width=t.height=sz; const k=t.getContext('2d'); k.fillStyle='#fff'; k.fillRect(0,0,sz,sz); k.drawImage(o,0,0,sz,sz); const dd=k.getImageData(0,0,sz,sz); const r=f(dd.data,sz,sz); if(r) return r.data; out.push(sz);} return 'nodecode '+out.join(',')})()`);
    assert.match(String(decoded), /^QFF1\.QFF-7777\.\d+\.[A-Za-z0-9_-]{12}$/, "the QR decodes to a pass code");
    const lg = await app.inject({ method: "POST", url: "/checkin/api/login", payload: { username: "check", password: "check-dev-password" } });
    const scan = (await app.inject({ method: "POST", url: "/checkin/api/scan", headers: { cookie: String(lg.headers["set-cookie"]).split(";")[0]!, "x-csrf-token": lg.json().csrf }, payload: { payload: decoded, scope: "day:2026-10-26" } })).json();
    assert.equal(scan.result, "verify", "the door scanner accepts the code shown by the web app"); assert.equal(scan.who.name, "Web Tester"); assert.equal(scan.who.hasPhoto, true);
    // the door confirms the check-in: the attendee's phone shows a popup within seconds, closes the QR, and lists it under "Attended events"
    const hdr = { cookie: String(lg.headers["set-cookie"]).split(";")[0]!, "x-csrf-token": lg.json().csrf };
    assert.equal((await app.inject({ method: "POST", url: "/checkin/api/confirm", headers: hdr, payload: { ticket: scan.ticket, decision: "confirm" } })).json().result, "ok");
    assert.ok(await b.until(`!!document.querySelector('.dialog') && /checked in/i.test(document.querySelector('.dialog').textContent)`, 25000), "popup on scan");
    assert.match(await b.ev(`document.querySelector('.dialog').textContent`), /Campus entry/);
    assert.equal(await b.ev(`!!document.querySelector('.qrfull')`), false, "the QR closes when the scan is done");
    await b.tap(".dialog .btn"); assert.ok(await b.until(`!document.querySelector('.dialog')`));
    assert.match(await b.ev(`document.querySelector('.list').textContent`), /Inauguration/, "saved events are always visible");
    assert.match(await b.ev(`document.querySelector('.fold').textContent`), /Attended events \(1\)/);
    assert.equal(await b.ev(`document.querySelectorAll('.list').length`), 1, "attended list is folded away at first");
    await b.tap(".fold"); assert.match(await b.ev(`document.querySelector('.screen').textContent`), /Campus entry[\s\S]*Checked in/, "the arrow opens the attended list");
    await b.tap(".fold"); assert.equal(await b.ev(`document.querySelectorAll('.list').length`), 1, "and folds it again");
    // an event that collects OD details: after the door check-in, the STUDENT is asked in the app (not the volunteer)
    const odEv = (await db.query("INSERT INTO events (title,description,track,location,starts_at,ends_at,collect_od) VALUES ('OD Session','x','Workshop','SRM',now(),now() + interval '2 hours', true) RETURNING id"))[0]!.id;
    await db.query("INSERT INTO checkins (user_id, scope) SELECT id, $1 FROM users WHERE email='web@example.org'", ["event:" + odEv]);
    assert.ok(await b.until(`!!document.querySelector('.dialog') && /checked in/i.test(document.querySelector('.dialog').textContent)`, 25000), "popup for the OD event");
    await b.tap(".dialog .btn"); assert.ok(await b.until(`!document.querySelector('.dialog')`));
    assert.ok(await b.until(`!!document.querySelector('.sheet [name=odFrom]')`, 15000), "the OD form opens in the student's app");
    const setv = (name: string, v: string) => b.ev(`(() => { const e = document.querySelector('[name=${name}]'); e.value = '${v}'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await setv("odFrom", "10:00"); await setv("odUntil", "12:30");
    assert.equal(await b.ev(`document.querySelector('[name=odHours]').value`), "2.5", "hours are worked out from the two times");
    await b.ev(`[...document.querySelectorAll('.sheet button')].find((x) => /^Save$/.test(x.textContent)).click()`);
    assert.ok(await b.until(`!document.querySelector('.sheet [name=odFrom]')`, 15000), "saved and closed");
    const [od] = await db.query("SELECT od_from, od_until, od_hours FROM checkins WHERE scope=$1", ["event:" + odEv]);
    assert.deepEqual([od!.od_from, od!.od_until, Number(od!.od_hours)], ["10:00", "12:30", 2.5]);

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
    await b.goto(base + "/attendee/pass"); assert.ok(await b.until(`!!document.querySelector('.pass')`, 25000), "session survives a reload");
    assert.equal(await b.ev(`/\\bnull\\b|\\bundefined\\b/.test(document.body.innerText)`), false, "no stray null/undefined text on the pass screen");
    await b.tap(".tab[aria-label='Hub']"); assert.ok(await b.until(`!!document.querySelector('.hero')`)); await b.tap(".avatar"); assert.ok(await b.until(`!!document.querySelector('.sheet')`));
    await b.ev(`[...document.querySelectorAll('.sheet button')].find((x) => /Sign out/.test(x.textContent)).click()`); assert.ok(await b.until(`!!document.querySelector('.dialog')`)); await b.tap(".dialog .actions .btn");
    assert.ok(await b.until(`!!document.querySelector('.signin')`)); assert.equal(await b.ev(`location.pathname`), "/attendee");
    assert.equal((await db.query("SELECT 1 FROM sessions WHERE revoked_at IS NULL")).length, 0, "the session was revoked on the server");
    await b.goto(base + "/attendee/hub"); assert.ok(await b.until(`!!document.querySelector('.signin')`), "after sign-out the app asks to sign in again");

    const real = b.errors; assert.deepEqual(real, [], "no JavaScript errors anywhere in the journey");
  });
  it("an SRM person fills in the one-time details form before the selfie; it is never asked again", async () => {
    await db.query("INSERT INTO users (email,name,college,pass_code,pass_secret) VALUES ('details_web@srmap.edu.in','Details Web','SRM University-AP','QFF-8888',$1)", [Buffer.alloc(32, 7)]);
    await b.device("ios"); await b.cdp("Network.clearBrowserCookies"); await b.goto(base + "/attendee");
    await b.ev(`localStorage.clear()`); await b.goto(base + "/attendee");
    assert.ok(await b.until(`!!document.querySelector('.signin')`, 15000));
    await b.type("input[type=email]", "details_web@srmap.edu.in"); await code("details_web@srmap.edu.in", "112233"); await b.tap(".form .btn");
    assert.ok(await b.until(`!!document.querySelector('.codes')`)); await b.type(".codes input", "112233");
    assert.ok(await b.until(`!!document.querySelector('.details')`), "details come first");
    assert.equal(await b.ev(`!!document.querySelector('.selfie, .tabbar')`), false);
    const fill = (name: string, v: string) => `(() => { const e = document.querySelector('[name=${name}]'); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`;
    await b.ev(fill("regNo", "ap25110010999")); await b.ev(fill("school", "SEAS")); await b.ev(fill("semester", "3")); await b.ev(fill("program", "B.Tech")); await b.ev(fill("course", "CSE")); await b.ev(fill("section", "s12")); await b.ev(fill("gender", "Female")); await b.ev(fill("cgpa", "11"));
    await b.ev(`document.querySelector('.details form, form.details').requestSubmit()`);
    assert.ok(await b.until(`/0 to 10/.test(document.querySelector('.err')?.textContent || '')`), "a bad CGPA is explained");
    await b.ev(fill("cgpa", "8.5")); await b.ev(`document.querySelector('form.details').requestSubmit()`);
    assert.ok(await b.until(`!!document.querySelector('.selfie')`, 10000), "then the selfie");
    const [u] = await db.query("SELECT reg_no, school, semester, cgpa, section, gender FROM users WHERE email='details_web@srmap.edu.in'");
    assert.deepEqual([u!.reg_no, u!.school, u!.semester, Number(u!.cgpa), u!.section, u!.gender], ["AP25110010999", "SEAS", 3, 8.5, "S12", "Female"]);
    await b.goto(base + "/attendee"); assert.ok(await b.until(`!!document.querySelector('.selfie')`, 10000)); assert.equal(await b.ev(`!!document.querySelector('.details')`), false, "not asked again");
  });
});
