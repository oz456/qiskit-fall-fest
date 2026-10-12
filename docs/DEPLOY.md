# Go-live runbook

## 0. What you provide
| Need | Used for |
|---|---|
| GCP project with billing + `gcloud` access (Cloud Run, Cloud Build, Artifact Registry, Secret Manager) | hosting |
| Neon project → **pooled** connection string | database |
| SendGrid account, **verified sender / authenticated domain**, API key (Mail Send only) | login codes, announcements, ticket replies |
| Admin username + a strong password (I'll give you a hash command) | admin site login |
| Real schedule, FAQs, venue text; the attendee list (CSV: `email,name,college`) | content |
| (Later) Apple Developer account | iOS |

## 1. Neon
Create a project + database. Copy the **pooled** connection string (`...-pooler...neon.tech/neondb?sslmode=require`). Tables are created automatically on first boot (`migrations/`).

## 2. SendGrid
Settings → Sender Authentication → authenticate your domain (SPF/DKIM) or at least a Single Sender. Create an API key with **Mail Send** permission only. Without domain auth, codes land in spam — do this days before the event.

## 3. Secrets (Secret Manager)
```bash
PROJECT=your-project; gcloud config set project $PROJECT
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com
mk() { printf %s "$2" | gcloud secrets create "$1" --data-file=-; }
mk qff-database-url        'postgresql://...pooler.../neondb?sslmode=require'
mk qff-jwt-secret          "$(openssl rand -base64 48)"
mk qff-session-secret      "$(openssl rand -base64 48)"
mk qff-otp-pepper          "$(openssl rand -base64 48)"
mk qff-sendgrid-key        'SG.xxxxx'
cd qff/server && mk qff-admin-password-hash "$(npm run -s hash-password -- 'a-long-unique-admin-password')"
# let Cloud Run's service account read them:
SA=$(gcloud projects describe $PROJECT --format='value(projectNumber)')-compute@developer.gserviceaccount.com
for s in qff-database-url qff-jwt-secret qff-session-secret qff-otp-pepper qff-sendgrid-key qff-admin-password-hash; do
  gcloud secrets add-iam-policy-binding $s --member serviceAccount:$SA --role roles/secretmanager.secretAccessor; done
```

## 4. Deploy
First deploy (URL unknown yet → set after):
```bash
cd qff/server
PROJECT=$PROJECT MAIL_FROM=no-reply@yourdomain.org ADMIN_USERNAME=fest-admin PUBLIC_URL=https://placeholder.invalid ./deploy.sh
gcloud run services describe qff-api --region asia-south1 --format='value(status.url)'   # → your URL
PROJECT=$PROJECT MAIL_FROM=... ADMIN_USERNAME=... PUBLIC_URL=<that url> ./deploy.sh      # redeploy with the real URL
```
Optional: map a custom domain (`gcloud beta run domain-mappings create`), then use that as `PUBLIC_URL`.

## 5. First-time setup in the admin site (`<url>/admin/`)
1. Sign in. **Content** → set festival name, venue, support note, FAQs.
2. **Events** → create the schedule. For multi-day events (hackathon) set the end on a later day; leave single-day events as they are. Use capacity + "registration required" for seat-limited ones.
3. **Attendees** → Import CSV.
4. Send yourself a test: add your own email, sign in on a phone, post a test announcement with email on.

## 6. Build the APK
```bash
cd qff/android && ./build-release.sh https://<your-url>      # → qff/qiskit-fallfest-2026.apk
```
Signing key lives in `~/.qff/` — **back it up** (losing it means users can't update in place).

## 7. Event-day ops
- **Door**: Admin → Check-in on a volunteer phone (camera) or USB scanner. Pick "Entry · today". Result card: green ✔ / amber duplicate / red invalid-or-stale.
- Lost phone → Attendees → **Reset device** (they sign in on the new phone).
- Unregistered walk-ins → Attendees → Add (they can sign in immediately).
- Watch the **Support** inbox; replies also email the attendee.

## 8. Cost / scale notes
Cloud Run scales to zero; Neon free tier is enough for a few thousand attendees. `deploy.sh` caps at 3 instances (rate limits are per instance; OTP limits are global in the DB). Set `--min-instances 1` for the event days to avoid cold starts.

## 9. Backups
Neon keeps point-in-time history; before the event take a manual branch/snapshot, and again after.
