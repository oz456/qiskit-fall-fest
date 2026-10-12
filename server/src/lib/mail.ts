import { config, isProd } from "../config.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface Mail { to: string; subject: string; text: string; html?: string }

/** Sends through SendGrid's v3 API. In dev (no key) it logs instead of sending. */
export async function sendMail(m: Mail): Promise<void> {
  if (!config.sendgridKey) {
    if (isProd) throw new Error("SENDGRID_API_KEY missing");
    console.log(`[mail:dev] to=${m.to} subject=${m.subject}\n${m.text}`);
    return;
  }
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.sendgridKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: m.to }] }],
      from: { email: config.mailFrom, name: config.mailFromName },
      subject: m.subject,
      content: [{ type: "text/plain", value: m.text }, ...(m.html ? [{ type: "text/html", value: m.html }] : [])],
      tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`SendGrid ${res.status}`);
}

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

export const announcementMail = (to: string, title: string, body: string): Mail => ({
  to,
  subject: title,
  text: `${title}\n\n${body}`,
  html: shell(title, `<p style="white-space:pre-wrap;line-height:1.6">${esc(body)}</p>`),
});

export const ticketReplyMail = (to: string, code: string, body: string): Mail => ({
  to,
  subject: `Update on your ticket ${code}`,
  text: `The Fall Fest team replied to ${code}:\n\n${body}\n\nOpen the app to respond.`,
  html: shell(`Reply on ${code}`, `<p style="white-space:pre-wrap;line-height:1.6">${esc(body)}</p><p style="color:#6b7470">Open the app to respond.</p>`),
});
