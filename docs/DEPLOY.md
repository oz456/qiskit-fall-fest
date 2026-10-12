# Deployment & operations

## Where everything lives
| Piece | Location |
|---|---|
| Service (API + `/admin` + `/check`) | Cloud Run `qff-api`, project `qiskit-511416`, region `us-east5` (next to Neon in Ohio) |
| Live URL | https://qff-api-666549809539.us-east5.run.app |
| Database | Neon project `qiskit` (Postgres). Tables are created automatically on boot (`server/migrations/`) |
| Secrets | GCP Secret Manager: `qff-database-url`, `qff-jwt-secret`, `qff-session-secret`, `qff-otp-pepper`, `qff-admin-username`, `qff-admin-password-hash`, `qff-check-username`, `qff-check-password-hash`, `qff-sendgrid-key` |
| Code | GitHub `oz456/qiskit-fall-fest` (private) |
| Logins | `~/.qff/CREDENTIALS.txt` on the machine that set this up (admin + check-in, random) |
| Android signing key | `~/.qff/event.keystore` + `keystore.properties` — **back these up** |

## Continuous deployment
Every push to `main` that touches `server/**` runs `.github/workflows/deploy.yml`:
typecheck → tests → build Docker image → push to Artifact Registry → new Cloud Run revision → `/ping` smoke test.
GitHub authenticates to GCP **keylessly** (Workload Identity Federation, restricted to this repo); no keys are stored in GitHub.
Env vars and secret wiring are kept by Cloud Run between deploys; change them with `server/deploy.sh` (or `gcloud run services update`).
Roll back: Cloud Run → `qff-api` → Revisions → send 100% traffic to an older revision.

## ⚠ Still needed: SendGrid (login codes are emailed through it)
Until this is done nobody can receive a sign-in code.
1. SendGrid → Settings → Sender Authentication → verify a **domain** (best) or a **Single Sender** address.
2. Create an API key with only **Mail Send** permission.
3. Store it and the sender, then roll a new revision:
```bash
printf %s 'SG.xxxxxxxx' | gcloud secrets versions add qff-sendgrid-key --data-file=-
gcloud run services update qff-api --region us-east5 \
  --update-env-vars MAIL_FROM=no-reply@yourdomain.org --update-labels rev=$(date +%s)
```
4. Add your own email in `/admin` → Attendees, sign in on a phone, confirm the code arrives (check spam).

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
