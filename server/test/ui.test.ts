// Browser smoke test: drives the REAL admin and scanner pages in headless Chrome and fails on any JavaScript error.
// (A typo like a missing `const r =` in the login handler passes every API test but breaks the page; this catches that class.)
// Skipped automatically when no Chrome/Chromium is installed. CI runners have Chrome; set CHROME_BIN to override.
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.ts";
import { migrate, openDb } from "../src/db.ts";

const chromeBin = [process.env.CHROME_BIN, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean)
  .find((b) => spawnSync(b!, ["--version"], { stdio: "ignore" }).status === 0);

describe("browser smoke (admin + scanner)", { skip: chromeBin ? false : "no Chrome/Chromium found" }, () => {
  let db: Awaited<ReturnType<typeof openDb>>; let app: Awaited<ReturnType<typeof buildApp>>; let chrome: ChildProcess; let ws: WebSocket;
  const errors: string[] = []; const pend = new Map<number, (r: any) => void>(); let nid = 0;
  const cdp = (method: string, params: object = {}) => new Promise<any>((res) => { const id = ++nid; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const ev = async (expression: string) => (await cdp("Runtime.evaluate", { expression, returnByValue: true })).result?.value;
  const until = async (expression: string, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expression)) return true; await wait(150); } return false; };
  let base = ""; const debugPort = 9500 + Math.floor(Math.random() * 400);

  before(async () => {
    db = await openDb(); await migrate(db); app = await buildApp(db);
    await app.listen({ port: 0, host: "127.0.0.1" }); base = `http://127.0.0.1:${(app.server.address() as any).port}`;
    chrome = spawn(chromeBin!, ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "qff-ui-"))}`, "about:blank"], { stdio: "ignore" });
    let tabs: any[] = []; for (let i = 0; i < 50 && !tabs.some((t) => t.type === "page"); i++) { await wait(200); tabs = await fetch(`http://127.0.0.1:${debugPort}/json`).then((r) => r.json()).catch(() => []); }
    ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
    ws.onmessage = (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id) pend.get(d.id)?.(d.result);
      else if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
      else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("console.error: " + d.params.args.map((a: any) => a.value ?? a.description).join(" "));
    };
    await cdp("Runtime.enable"); await cdp("Page.enable");
  });
  after(async () => { try { chrome?.kill(); } catch {} await app?.close(); });

  const login = async (path: string, user: string, pass: string) => {
    await cdp("Page.navigate", { url: base + path });
    assert.ok(await until(`!!document.querySelector('input[type=password]')`), "login form renders");
    await ev(`(()=>{const [u,p]=document.querySelectorAll('input');const set=(i,v)=>{i.value=v;i.dispatchEvent(new Event('input',{bubbles:true}))};set(u,${JSON.stringify(user)});set(p,${JSON.stringify(pass)});document.querySelector('form').requestSubmit();})()`);
  };

  it("admin: signing in shows the portal with no script errors, and every page opens", async () => {
    await login("/admin", "admin", "admin-dev-password");
    assert.ok(await until(`!!document.querySelector('nav')`), "the portal appears right after login (no refresh needed)");
    assert.equal(await ev(`document.querySelector('.err')?.textContent || ''`), "", "no error text on the login form");
    for (const page of ["events", "people", "announce", "support", "attendance", "content", "activity"]) {
      await ev(`location.hash = '#${page}'`); await wait(700);
      assert.ok(await ev(`!!document.querySelector('main h1')`), `page '${page}' renders a heading`);
    }
    assert.deepEqual(errors, [], "no JavaScript errors in the admin portal");
  });

  it("admin: the attendee panel's Block, Reset device and Reset selfie buttons work", async () => {
    errors.length = 0;
    const [u] = await db.query("INSERT INTO users (email,name,college,pass_code,pass_secret) VALUES ('panel@example.org','Panel Tester','SRM AP','QFF-0042',$1) RETURNING id", [Buffer.alloc(32, 2)]);
    await db.query("INSERT INTO user_photos (user_id, object_key, size_bytes, sha256) VALUES ($1,'photos/x.jpg',0,'')", [u!.id]);
    await ev(`window.confirm = () => true`);
    await ev(`location.hash = '#people'`); await wait(300);
    assert.ok(await until(`[...document.querySelectorAll('tr.click')].some(r => r.textContent.includes('Panel Tester'))`), "the attendee is listed");
    const open = () => ev(`[...document.querySelectorAll('tr.click')].find(r => r.textContent.includes('Panel Tester')).click()`);
    const press = async (label: string) => { assert.ok(await until(`[...document.querySelectorAll('.modal button, [role=dialog] button, button')].some(b => b.textContent.trim() === ${JSON.stringify(label)})`), `button "${label}" is there`); await ev(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`); await wait(600); };
    await open(); await press("Block");
    assert.equal((await db.query("SELECT status FROM users WHERE id=$1", [u!.id]))[0]!.status, "blocked", "Block blocked them");
    await open(); await press("Unblock");
    assert.equal((await db.query("SELECT status FROM users WHERE id=$1", [u!.id]))[0]!.status, "active", "Unblock unblocked them");
    await db.query("INSERT INTO sessions (user_id, refresh_hash, device_id, expires_at) VALUES ($1,'h','d', now() + interval '1 day')", [u!.id]);
    assert.equal((await db.query("SELECT 1 FROM sessions WHERE user_id=$1 AND revoked_at IS NULL", [u!.id])).length, 1, "test session exists");
    await open(); await press("Reset device"); await wait(800);
    assert.equal((await db.query("SELECT 1 FROM sessions WHERE user_id=$1 AND revoked_at IS NULL", [u!.id])).length, 0, "Reset device signed them out");
    await open(); await press("Reset selfie");
    assert.equal((await db.query("SELECT 1 FROM user_photos WHERE user_id=$1", [u!.id])).length, 0, "Reset selfie removed the photo");
    assert.deepEqual(errors, [], "no JavaScript errors");
  });

  it("scanner: signing in shows the scan screen with no script errors", async () => {
    errors.length = 0;
    // one existing check-in, so the "Latest" list has something to draw
    const [u] = await db.query("INSERT INTO users (email,name,college,pass_code,pass_secret) VALUES ('ui@example.org','Ui Tester','SRM AP','QFF-0001',$1) RETURNING id", [Buffer.alloc(32, 1)]);
    const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    await db.query("INSERT INTO checkins (user_id, scope) VALUES ($1,$2)", [u!.id, `day:${d}`]);
    await db.query("INSERT INTO settings (key,value) VALUES ('fest_start',$1),('fest_end',$1) ON CONFLICT (key) DO UPDATE SET value=$1", [d]); // gives the scanner today as an entry day
    await login("/checkin", "check", "check-dev-password");
    assert.ok(await until(`!!document.querySelector('.scopebar select')`), "the scan screen appears right after login");
    assert.ok(await until(`document.querySelector('.recent')?.textContent.includes('Ui Tester')`), "the Latest list shows real names (not [object HTMLDivElement])");
    assert.deepEqual(errors.filter((e) => !/getUserMedia|Permission|NotAllowed|NotFound|Requested device/i.test(e)), [], "no JavaScript errors on the scanner (camera permission errors are expected headless)");
  });
});
