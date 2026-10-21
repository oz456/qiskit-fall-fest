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
| Selfie bucket | `gs://qiskit-511416-qff-photos` (private, uniform access; the Cloud Run service account is `objectAdmin`). Env `PHOTO_BUCKET`. Photos are only streamed by `/check` and `/admin` behind their logins. Consider deleting them after the event. |
| Android signing key | `~/.qff/event.keystore` + `keystore.properties` — **back these up** |

## Continuous deployment
Every push to `main` that touches `server/**` runs `.github/workflows/deploy.yml`:
typecheck → tests (API + a headless-Chrome smoke test of the admin and scanner pages) → build Docker image → push to Artifact Registry → new Cloud Run revision → run the backup job once to prove it still works → `/ping` smoke test.
GitHub authenticates to GCP **keylessly** (Workload Identity Federation, restricted to this repo's `main` branch); no keys are stored in GitHub.
Env vars and secret wiring are kept by Cloud Run between deploys; change them with `server/deploy.sh` (or `gcloud run services update`).
Roll back: Cloud Run → `qff-api` → Revisions → send 100% traffic to an older revision.

## Email (Gmail / Workspace SMTP)
**Only login codes** are sent through Gmail SMTP using **app passwords** (no SendGrid). Currently one account (`vaishnav_s@srmap.edu.in`, same one used in brainoftoru), stored in the secret `qff-smtp-accounts`.
- **Limits:** ~2,000 emails/day on Google Workspace, ~500/day on a free @gmail.com. The app enforces a per-account daily cap (`SMTP_DAILY_LIMIT`, default 1900) and the admin stats endpoint reports the remaining quota. Announcements and ticket replies are deliberately **not** emailed, so the whole quota is for login codes. The server also caps codes per attendee (12/day) and system-wide (500/hour).
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

## Backups
- **Automatic:** Cloud Run Job `qff-backup` runs every 6 hours (Cloud Scheduler `qff-backup-6h`, us-east4) and writes `qff-backup-<time>.json.gz` to `gs://qiskit-511416-qff-backups/` (private bucket, files auto-deleted after 30 days). It covers attendees (incl. pass secrets), events, saved/registered, announcements, tickets, FAQs, settings, check-ins, audit log. Sign-in sessions and one-time codes are intentionally not backed up — after a restore people just sign in again.
- **Run one now:** `gcloud run jobs execute qff-backup --region us-east5 --wait` (do this right before the event and right after).
- **Restore (destructive — overwrites the target DB):**
```bash
gcloud storage ls gs://qiskit-511416-qff-backups/                         # pick a file
gcloud storage cp gs://qiskit-511416-qff-backups/<file>.json.gz .
cd server && DB_DRIVER= DATABASE_URL='<neon url>' node scripts/restore.ts ../<file>.json.gz --yes
```
(Needs a network that allows Postgres port 5432 to Neon; otherwise run it from Cloud Shell.) Restore is covered by an automated round-trip test.
- Neon also keeps its own short point-in-time history; treat the bucket as the real backup.

## Monitoring & alerts
Emails go to **pree.makes@gmail.com** only (add more recipients: Cloud Console → Monitoring → Alerting → Notification channels). 
| Alert | Fires when |
|---|---|
| Fall Fest is DOWN | the uptime check on `/ping` (every minute, checks the body) fails for ~2 min |
| server errors (5xx) | more than 5 server errors in 5 min |
| emails failing | 3+ failed login-code emails in 10 min (e.g. Gmail throttling or a revoked app password) |
| backup job failed | a scheduled backup execution fails (alerts go to one address only: add yours) |
Logs: Cloud Run → `qff-api` → Logs. Failed emails appear as “otp mail failed”.

## First-run checklist
- `/admin` → Attendees → **Import CSV** (the window shows the format and a template, including one column per event for registrations). Only these emails can sign in.
- `/admin` → Events: the app covers the **offline phase (26–30 Oct, SRM University AP)**. Loaded so far: Project Q Grand Finale (28–29 Oct) and the Winner Announcement (30 Oct). Add every other on-campus session there; for multi-day events set the end on a later day.
- `/admin` → Content → **Festival first/last day** (26–30 Oct) drives the app's countdown and guarantees those days are in the `/check` scanner even before sessions are entered.
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

## Building the apps
```bash
cd android && ./build-release.sh https://qff-api-666549809539.us-east5.run.app
# → android-artifacts/qiskit-fallfest-2026.apk, also copied to server/public/download/ (+ .sha256) so /download serves it; commit and push to publish
```
The iPhone app builds on GitHub Actions (see [IOS.md](IOS.md)). `android-artifacts/` and `ios-artifacts/` are local, git-ignored output folders. Each APK commit adds ~2.5 MB to the repo history; that's fine for this project.

**gcloud tip:** pass `--project qiskit-511416` explicitly; your default project may be different.

## Local development
`cd server && npm install && npm run dev` (embedded Postgres, mail printed to console, logins `admin / admin-dev-password` and `check / check-dev-password`), `npm test`.
