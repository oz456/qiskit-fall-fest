# Security

## Implemented
**Auth (attendees)** — registered emails only; 6-digit code, 10 min expiry, stored as HMAC (never plaintext), max 5 attempts, max 3 codes / 10 min / email, per-IP rate limits; identical response for unknown emails (no enumeration). Short-lived access JWT (15 min) + rotating refresh token (hashed; replaying an old token kills the session). Blocked users lose access immediately (session checked in DB on every request).
**Pass anti-sharing** — QR = HMAC(per-user secret, passId|30s-window). Secret is delivered only to the signing-in device and rotated on every login → one phone per account, old phone is dead. Scanner accepts ±1 window (so screenshots/forwards fail), and each pass checks in **once per day/event** (duplicate shown with first-scan time). App sets `FLAG_SECURE` on the pass screen (no screenshots/recording/recents thumbnail).
**Admin** — single credential from env (scrypt hash supported), constant-time compare, 5 attempts/15 min/IP + delay, `HttpOnly; Secure; SameSite=Strict` 8 h cookie scoped to `/admin`, CSRF token on every write + Origin check, strict CSP (no inline script/style, no third-party loads), UI never uses `innerHTML`, audit log of every change and failed login.
**API hardening** — zod validation on every input, parameterised SQL only, 100 KB body limit, security headers (HSTS, nosniff, frame-deny, no-referrer, COOP/CORP, Permissions-Policy), `no-store` on API responses, generic 500s, secrets/tokens redacted from logs, fail-fast on missing prod config, non-root container.
**Registration capacity** — seat check is serialised with a row lock (no overbooking).
**Android** — HTTPS only (cleartext disabled in release), refresh token + pass secret encrypted with an Android-Keystore AES-GCM key, backup/transfer disabled, R8-minified, release key stored outside the repo.
**Emails** — HTML-escaped, tracking disabled.

## Known limits (accepted / mitigations)
- Single shared admin login → everyone with it is "the admin". Rotate the password after the event; the Activity page shows what changed (not who).
- A person physically handing over their **unlocked phone** can still show a live QR. Pair with the photo/ID check at the desk (name + college shown on scan).
- Rate limits are in-memory per Cloud Run instance (OTP limits are global). Keep `max-instances` low.
- No certificate pinning (Cloud Run certs rotate; add later if needed).
- No push notifications yet (announcements are fetched on open / pull-to-refresh / email). FCM can be added.

## Pre-launch checklist
- [ ] Secrets only in Secret Manager; none in git/chat. Rotate anything pasted anywhere.
- [ ] SendGrid domain authenticated; send a real test to Gmail + college mail.
- [ ] Admin password ≥16 chars, unique.
- [ ] Neon: strong password, pooled URL with `sslmode=require`; snapshot taken.
- [ ] Test on 2 phones: login, second-phone takeover, screenshot QR rejected, duplicate scan flagged.
- [ ] Cloud Run `min-instances=1` for event days.
- [ ] Release keystore backed up (`~/.qff/`).
