# Deployment & operations

## Where everything lives
| Piece | Location |
|---|---|
| Service (API + `/admin` + `/check`) | Cloud Run `qff-api`, project `qiskit-511416`, region `us-east5` (next to Neon in Ohio) |
| Live URL | https://qff-api-666549809539.us-east5.run.app |
| Database | Neon project `qiskit` (Postgres). Tables are created automatically on boot (`server/migrations/`) |
| Secrets | GCP Secret Manager: `qff-database-url`, `qff-jwt-secret`, `qff-session-secret`, `qff-otp-pepper`, `qff-smtp-accounts`, `qff-admin-username`, `qff-admin-password-hash`, `qff-check-username`, `qff-check-password-hash` |
| Code | GitHub `oz456/qiskit-fall-fest` (private) |
| Logins | `~/.qff/CREDENTIALS.txt` on the machine that set this up (admin + check-in, random) |
| Android signing key | `~/.qff/event.keystore` + `keystore.properties` — **back these up** |

## Continuous deployment
Every push to `main` that touches `server/**` runs `.github/workflows/deploy.yml`:
typecheck → tests → build Docker image → push to Artifact Registry → new Cloud Run revision → `/ping` smoke test.
GitHub authenticates to GCP **keylessly** (Workload Identity Federation, restricted to this repo); no keys are stored in GitHub.
Env vars and secret wiring are kept by Cloud Run between deploys; change them with `server/deploy.sh` (or `gcloud run services update`).
Roll back: Cloud Run → `qff-api` → Revisions → send 100% traffic to an older revision.

## Email (Gmail / Workspace SMTP)
Login codes, announcements and ticket replies are sent through Gmail SMTP using **app passwords** (no SendGrid). Currently one account (`vaishnav_s@srmap.edu.in`, same one used in brainoftoru), stored in the secret `qff-smtp-accounts`.
- **Limits:** ~2,000 emails/day on Google Workspace, ~500/day on a free @gmail.com. The app enforces a per-account daily cap (`SMTP_DAILY_LIMIT`, default 1900) and shows “Emails left today” on the admin Overview. Bulk announcement emails are refused if they'd eat into a 100-email reserve kept for login codes.
- **Add more accounts (round-robin, automatic failover):** put them all in the secret as a JSON array and roll a revision:
```bash
cat > /tmp/smtp.json <<'J'
[{"user":"a@srmap.edu.in","pass":"16charapppass"},{"user":"b@gmail.com","pass":"16charapppass"}]
J
gcloud secrets versions add qff-smtp-accounts --data-file=/tmp/smtp.json && shred -u /tmp/smtp.json
gcloud run services update qff-api --region us-east5 --update-labels rev=$(date +%s)
```
(If any account is a free @gmail.com, deploy with `SMTP_DAILY_LIMIT=450`.)
- **Where to create an app password:** Google Account → Security → 2-Step Verification (must be on) → App passwords → create one named “Fall Fest”. Workspace admins can disable app passwords; if sending fails with “Application-specific password required/disabled”, ask the domain admin to allow them.
- Emails come “from” the SMTP account itself (Gmail rewrites the From address), with display name “Qiskit Fall Fest”. Codes can land in spam on first use — ask testers to mark “Not spam”.

## First-run checklist (after SendGrid)
- `/admin` → Attendees → **Import CSV** (`email,name,college`). Only these emails can sign in.
- `/admin` → Events: the six open Unstop programmes are loaded; add the extra (non-Unstop) sessions there. For multi-day events set the end on a later day.
- `/admin` → Content: FAQs and venue text.
- `/check`: hand the scanner login to door volunteers. Pick “Entry · today” (once per person per day) or a specific event. Use a phone with the camera, or a USB barcode/QR scanner into the “Backup” box.

## Event-day tips
- Set min instances to 1 to avoid cold starts: `gcloud run services update qff-api --region us-east5 --min-instances 1` (back to 0 afterwards).
- Lost phone → `/admin` → Attendees → **Reset device**.
- Take a Neon branch/snapshot before the event.

## Rotating a login
```bash
cd server && node scripts/hash-password.ts 'new-long-password'      # prints scrypt$...
printf %s '<hash>' | gcloud secrets versions add qff-check-password-hash --data-file=-
gcloud run services update qff-api --region us-east5 --update-labels rev=$(date +%s)
```
(Use `qff-admin-password-hash` for the admin; usernames are the `qff-*-username` secrets.)

## Building the APK
```bash
cd android && ./build-release.sh https://qff-api-666549809539.us-east5.run.app   # → qff/qiskit-fallfest-2026.apk
```

## Local development
`cd server && npm install && npm run dev` (embedded Postgres, mail printed to console, logins `admin / admin-dev-password` and `check / check-dev-password`), `npm test`.
