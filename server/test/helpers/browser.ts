// Headless Chrome driven over the DevTools protocol, shared by the browser tests. Skipped automatically when no Chrome/Chromium exists
// (set CHROME_BIN to override). The camera is a synthetic video stream, so the selfie step can be exercised for real.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const chromeBin = [process.env.CHROME_BIN, "google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].filter(Boolean)
  .find((b) => spawnSync(b!, ["--version"], { stdio: "ignore" }).status === 0);

export const UA = {
  ios: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
  desktop: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

export class Browser {
  errors: string[] = []; logs: string[] = [];
  private ws!: WebSocket; private chrome!: ChildProcess; private pend = new Map<number, (r: any) => void>(); private nid = 0;
  static async launch(): Promise<Browser> {
    const b = new Browser(); const port = 9500 + Math.floor(Math.random() * 400);
    b.chrome = spawn(chromeBin!, ["--headless=new", "--no-sandbox", "--disable-gpu", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "qff-b-"))}`, "about:blank"], { stdio: "ignore" });
    let tabs: any[] = []; for (let i = 0; i < 60 && !tabs.some((t) => t.type === "page"); i++) { await b.wait(200); tabs = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json()).catch(() => []); }
    b.ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl); await new Promise((r) => (b.ws.onopen = r));
    b.ws.onmessage = (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id) b.pend.get(d.id)?.(d.result ?? d.error);
      else if (d.method === "Runtime.exceptionThrown") b.errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
      else if (d.method === "Log.entryAdded" && d.params.entry.level === "error") b.logs.push(d.params.entry.text + " " + (d.params.entry.url ?? ""));
    };
    for (const m of ["Runtime.enable", "Page.enable", "Log.enable", "Network.enable"]) await b.cdp(m);
    return b;
  }
  close() { try { this.chrome.kill(); } catch { /* already gone */ } }
  wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  cdp = (method: string, params: object = {}) => new Promise<any>((res) => { const id = ++this.nid; this.pend.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); });
  async ev(expression: string) { const r = await this.cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed"); return r.result?.value; }
  async until(expression: string, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (await this.ev(expression).catch(() => false)) return true; await this.wait(120); } return false; }
  tap(sel: string) { return this.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e) throw new Error('missing ${sel.replace(/'/g, "")}');e.click();return true})()`); }
  type(sel: string, v: string) { return this.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.focus();e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`); }
  goto(url: string) { return this.cdp("Page.navigate", { url }); }
  /** Pretend to be a device. `chPlatform` is what Chromium would send as Sec-CH-UA-Platform; `navPlatform` is navigator.platform. */
  async device(kind: "ios" | "android" | "desktop", opts: { navPlatform?: string; chPlatform?: string } = {}) {
    const mobile = kind !== "desktop";
    const navPlatform = opts.navPlatform ?? (kind === "ios" ? "iPhone" : kind === "android" ? "Linux armv81" : "Linux x86_64");
    const ch = opts.chPlatform ?? (kind === "ios" ? "iOS" : kind === "android" ? "Android" : "Linux");
    await this.cdp("Emulation.setUserAgentOverride", { userAgent: UA[kind], platform: navPlatform, userAgentMetadata: { platform: ch, platformVersion: "17.4", architecture: "", model: "", mobile, brands: [{ brand: "Not A;Brand", version: "99" }] } });
    await this.cdp("Emulation.setDeviceMetricsOverride", { width: mobile ? 390 : 1280, height: mobile ? 844 : 800, deviceScaleFactor: 2, mobile });
    await this.cdp("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: 5 });
    await this.cdp("Emulation.setFocusEmulationEnabled", { enabled: true }); // parallel test browsers must all count as visible and focused
  }
}
