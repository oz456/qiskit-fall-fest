// Outbound email through Gmail / Google Workspace SMTP (app passwords). Several accounts are used in the order they are listed:
// the first one until its daily cap is reached (or Gmail says it is out of quota), then the second, and so on.
import nodemailer, { type Transporter } from "nodemailer";
import { config, isProd } from "../config.ts";
import type { Db } from "../db.ts";
import { eventDay } from "./util.ts";

let db: Db | null = null;
export const initMail = (d: Db) => { db = d; };

const accounts = config.smtpAccounts;
const transports = new Map<string, Transporter>();
const transportFor = (user: string, pass: string) => {
  let t = transports.get(user);
  if (!t) {
    t = nodemailer.createTransport({
      host: config.smtpHost, port: config.smtpPort, secure: config.smtpPort === 465, requireTLS: config.smtpPort !== 465,
      auth: { user, pass }, pool: true, maxConnections: 2, maxMessages: 100, connectionTimeout: 10_000, socketTimeout: 20_000,
    });
    transports.set(user, t);
  }
  return t;
};

export interface Mail { to: string; subject: string; text: string; html?: string }

/** How many more emails can go out today across all accounts. */
export async function mailRemaining(): Promise<number> {
  if (!accounts.length) return Infinity;
  const rows = await db!.query<{ account: string; sent: number }>("SELECT account, sent FROM mail_quota WHERE day=$1", [eventDay()]);
  const used = new Map(rows.map((r) => [r.account, r.sent]));
  return accounts.reduce((n, a) => n + Math.max(0, config.smtpDailyLimit - (used.get(a.user) ?? 0)), 0);
}

/** The accounts that may still send today, in the order they are configured (the first is used until it is exhausted). */
export function usable<A extends { user: string }>(list: A[], used: Map<string, number>, limit: number): A[] {
  return list.filter((a) => (used.get(a.user) ?? 0) < limit);
}
async function pick(): Promise<{ user: string; pass: string }[]> {
  const rows = await db!.query<{ account: string; sent: number }>("SELECT account, sent FROM mail_quota WHERE day=$1", [eventDay()]);
  return usable(accounts, new Map(rows.map((r) => [r.account, r.sent])), config.smtpDailyLimit);
}
/** Gmail refusing because the account is out of sending quota (not a bad address or a network blip). */
export const quotaError = (e: unknown) => /daily user sending|sending limit|quota|5\.4\.5|rate limit exceeded/i.test(String((e as Error)?.message ?? e));
const bump = (acct: string, by: number) => db!.query(
  "INSERT INTO mail_quota (day, account, sent) VALUES ($1,$2,GREATEST($3,0)) ON CONFLICT (day, account) DO UPDATE SET sent = GREATEST(mail_quota.sent + $3, 0)", [eventDay(), acct, by]);

export async function sendMail(m: Mail): Promise<void> {
  if (!accounts.length) {
    if (isProd) throw new Error("SMTP_ACCOUNTS not configured");
    console.log(`[mail:dev] to=${m.to} subject=${m.subject}\n${m.text}`);
    return;
  }
  const candidates = await pick();
  if (!candidates.length) throw new Error("daily email quota exhausted");
  let lastErr: unknown;
  for (const a of candidates) {
    await bump(a.user, 1);
    try {
      await transportFor(a.user, a.pass).sendMail({
        from: { name: config.mailFromName, address: a.user }, to: m.to, subject: m.subject, text: m.text, html: m.html,
      });
      return;
    } catch (e) {
      lastErr = e; await bump(a.user, -1);
      // Gmail says this account is out for today: stop trying it until tomorrow so every code goes straight to the next account
      if (quotaError(e)) await db!.query("INSERT INTO mail_quota (day, account, sent) VALUES ($1,$2,$3) ON CONFLICT (day, account) DO UPDATE SET sent = GREATEST(mail_quota.sent, $3)", [eventDay(), a.user, config.smtpDailyLimit]);
    }
  }
  throw new Error(`SMTP send failed: ${(lastErr as Error)?.message ?? "unknown"}`);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const shell = (title: string, inner: string) => `<!doctype html><html><body style="margin:0;background:#f6f5f0;font-family:Arial,sans-serif;color:#111a16">
<div style="max-width:480px;margin:0 auto;padding:32px 24px"><div style="font-weight:700;letter-spacing:.5px;margin-bottom:24px">QISKIT FALL FEST ’26</div>
<div style="background:#fff;border:1px solid #e6e4db;border-radius:20px;padding:28px"><h2 style="margin:0 0 12px;font-size:20px">${esc(title)}</h2>${inner}</div>
<p style="color:#6b7470;font-size:12px;margin-top:20px">You are receiving this because you are registered for Qiskit Fall Fest.</p></div></body></html>`;

export const otpMail = (to: string, code: string): Mail => ({
  to,
  subject: `${code} is your Fall Fest sign-in code`,
  text: `Your Qiskit Fall Fest sign-in code is ${code}. It expires in 10 minutes. If you didn't request it, ignore this email.`,
  html: shell("Your sign-in code", `<p style="font-size:34px;letter-spacing:8px;font-weight:700;margin:16px 0">${esc(code)}</p><p style="color:#6b7470">It expires in 10 minutes. If you didn't request it, you can ignore this email.</p>`),
});
