# Website sync: the main website feeds the attendee list

The main website (`www.qffsrmap2026.com`, repo `qiskitfallfest-srmap/QisKit-Fall-Fest-2026`) owns **who is registered or paid**. This app owns **the pass and attendance**. People flow one way, website → app. Nothing in the app is ever written back to the website.

## What happens
1. Someone registers on the website (self-registration, Google Form, or an admin adds them to the whitelist).
2. The website immediately tells the app (`POST /integrations/website/attendees`). If that call fails, nothing breaks on the website.
3. Every 10 minutes Cloud Scheduler calls `POST /integrations/website/reconcile`; the app pulls the website's full export (`GET <website>/api/integrations/qff-app/attendees`) and fills any gaps. The first run is the backfill of everyone already registered.
4. The person can now sign in to the Android, iPhone or web app with the same email. An email that isn't there yet gets: "Register on the Fall Fest website first… it appears here within a few minutes."

## Rules
- Matched by lowercase email; never duplicated. The app's name for a person is never overwritten, a blank college is filled in. Phone numbers are not sent or stored.
- Only website role `participant` becomes an attendee (admin / mentor / tester are skipped).
- SRM addresses are labelled for admin: `name_surname@srmap.edu.in` = student, `name.surname@srmap.edu.in` = faculty, other SRM addresses = unclear, everything else = outside SRM. A label only; it never grants or blocks access.
- Switched off on the website → blocked here, but only for people who came from the website. People an admin created or blocked are never changed by the sync.
- There is no event registration in the app: anyone with a pass can be scanned in at any event, and the Rs 99 / Rs 499 passes are not tracked here.
- `/checkin` has "No QR? Find the person" (name, pass code or email) for dead phones. It goes through the same face check and is written to the activity log.

## Setup
- Shared key: the same value in the website's Vercel env var `GCP_ACCESS` and in Secret Manager as `qff-sync-secret` (never in git). `./server/deploy.sh` wires it into Cloud Run as `SYNC_SECRET` automatically once the secret exists.
- Scheduler job (every 10 minutes, header `Authorization: Bearer <key>`):
  `gcloud scheduler jobs create http qff-website-sync --location us-east4 --schedule "*/10 * * * *" --uri https://app.qffsrmap2026.com/integrations/website/reconcile --http-method POST --headers "Authorization=Bearer <key>"`
- Admin → Attendees → **Website sync** shows the last runs and has a "Sync now" button.
- To pause: disable the scheduler job, or remove `SYNC_SECRET` (all sync endpoints then answer 401).
