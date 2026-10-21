# Security

## Implemented
**Auth (attendees)** — registered emails only; 6-digit code, 10 min expiry, stored as HMAC (never plaintext); attempts are spent atomically (max 5 per code, max 10 wrong tries per attendee per 10 min, independent of IP); max 3 codes / 10 min and 12 / day per email, 500 / hour overall; per-IP rate limits. Unlisted emails are told so (a deliberate product choice for a closed list). Short-lived access JWT (15 min) + rotating refresh token (hashed; replaying an old token kills the session). Blocked users lose access immediately (session checked in DB on every request).
**Pass anti-sharing** — QR = HMAC(per-user secret, passId|30s-window). Secret is delivered only to the signing-in device and rotated on every login → one phone per account, old phone is dead. Scanner accepts ±1 window (so screenshots/forwards fail), and each pass checks in **once per day/event** (duplicate shown with first-scan time). App sets `FLAG_SECURE` on the pass and selfie screens (no screenshots/recording/recents thumbnail); the QR stays hidden until tapped.
**Admin and Check-in are separate sites with separate credentials** — each has its own env/Secret-Manager login, cookie (scoped to `/admin` or `/check`), CSRF token and token audience; a scanner login cannot touch admin data and vice versa (covered by tests). Each uses a single credential (scrypt hash), constant-time compare, 5 attempts/15 min/IP + delay, `HttpOnly; Secure; SameSite=Strict` 8 h cookie scoped to `/admin`, CSRF token on every write + Origin check, strict CSP (no inline script/style, no third-party loads), UI never uses `innerHTML`, audit log of every change and failed login.
**API hardening** — zod validation on every input, parameterised SQL only, 100 KB body limit, security headers (HSTS, nosniff, frame-deny, no-referrer, COOP/CORP, Permissions-Policy), `no-store` on API responses, generic 500s, secrets/tokens redacted from logs, fail-fast on missing prod config, non-root container.
**Selfie** — mandatory, one immutable row per attendee (admin reset only), claimed atomically before upload, validated and stripped of EXIF, stored in a private bucket, streamed only to `/check` (via a 2-minute signed ticket) and `/admin`.
**Door verification** — a scan only verifies; the entry is recorded when the volunteer confirms against the selfie; rejections are audited.
**Staff sessions** — recorded server-side (`staff_sessions`); logout revokes immediately.
**Android** — HTTPS only (cleartext disabled in release), refresh token + pass secret encrypted with an Android-Keystore AES-GCM key, backup/transfer disabled, R8-minified, release key stored outside the repo.
**Emails** — HTML-escaped, tracking disabled.

## Known limits (accepted / mitigations)
- Shared logins (one admin, one scanner) → everyone holding them acts as that user. Hand the scanner login only to door volunteers. Rotate the password after the event; the Activity page shows what changed (not who).
- A person physically handing over their **unlocked phone** can still show a live QR. Pair with the photo/ID check at the desk (name + college shown on scan).
- Rate limits are in-memory per Cloud Run instance (OTP limits are global). Keep `max-instances` low.
- No certificate pinning (Cloud Run certs rotate; add later if needed).
- No push notifications (announcements and support replies appear on open, pull-to-refresh, every 30 s on the Support tab; a red dot marks new replies). Nothing is emailed except login codes.

## Pre-launch checklist
- [ ] Secrets only in Secret Manager; none in git/chat. Rotate anything pasted anywhere.
- [ ] Admin password ≥16 chars, unique (production already requires the scrypt hash form).
- [ ] Neon: strong password, pooled URL with `sslmode=require`; snapshot taken.
- [ ] Test on 2 phones: login, second-phone takeover, screenshot QR rejected, duplicate scan flagged.
- [ ] Cloud Run `min-instances=1` for event days.
- [ ] Release keystore backed up (`~/.qff/`).
- [x] Gmail SMTP app password(s) configured; test a real code to Gmail + college mail.

## Pre-launch audit, 19 Oct 2026

An independent code review (plus live black-box checks) found these; all but the noted ones are fixed and covered by tests.

| # | Finding | Status |
|---|---------|--------|
| 1 | Rate limits bypassable by spoofing `X-Forwarded-For` (Fastify trusted the leftmost entry) | Fixed: exactly one trusted hop (the entry Cloud Run appends). Verified live: 7 forged-IP password guesses are throttled from the 5th. |
| 2 | Login-code attempt limit was a read-then-increment race | Fixed: one atomic UPDATE spends attempts; per-code cap of 5; per-attendee cap of 10 wrong tries / 10 min (not tied to IP); a used code can't be consumed twice. |
| 3 | Mail-quota exhaustion / targeted lockout via repeated `request-code` | Mitigated: per-attendee 12 codes/day and 500 codes/hour system-wide; any live code of the attendee is accepted (a newer request no longer kills the older one). Residual: someone can still make an attendee wait ~10 min by guessing wrong 10 times. Accepted trade-off. |
| 4 | "Mandatory selfie" accepted any bytes starting with JPEG magic | Fixed: the file's segments are parsed (frame header ≥ 240×240, EOI present), EXIF/XMP/ICC/comment segments are stripped before storage; the scanner shows a loud "PHOTO UNREADABLE" if an image can't load. |
| 5 | Staff sessions were stateless (logout only cleared the cookie) | Fixed: `staff_sessions` table; logout revokes immediately. To kill every session at once, rotate `SESSION_SECRET`. |
| 6 | Photo ticket in the query string reached request logs | Fixed: the logger never records query strings. |
| 7 | `/ping` hit the DB every call | Fixed: cached 5 s. |
| 8 | CSV formula injection in the attendance export | Fixed: cells starting with `= + - @` are prefixed with `'`. |
| 9 | Android: selfie/profile in the recents thumbnail | Selfie screen is now `FLAG_SECURE`. Profile still in plain prefs (low; secrets are Keystore-encrypted). |
| 10 | Supply chain | WIF provider restricted to `oz456/qiskit-fall-fest` on `refs/heads/main`. APK SHA-256 is published on the download page. Not done: pinning GitHub Actions by commit SHA and the Docker base image by digest. |
| 11 | Plain-text staff passwords allowed in prod | Fixed: prod refuses to boot without `*_PASSWORD_HASH`. Invalid event UUID in a scan scope no longer 500s. |

Accepted by design: the app tells unlisted emails "not on the attendee list"; a QR forwarded within ~60 s can work once (rotating code + one device per account + face check at the door are the defence); no certificate pinning.
