# Qiskit Fall Fest SRMAP 2026 ("QFF 2026"): app + backend

SRM University AP × IBM Quantum, Amaravati, 26–30 October 2026. A native Android app (direct APK download), a native iPhone app (kept in the repo, App Store release pending), a web app for iPhones in the meantime, one backend, an admin portal and a door scanner, all served from `app.qffsrmap2026.com`.

```
qff/
  android/    Native Android app (Kotlin, Jetpack Compose)        → build-release.sh writes android-artifacts/
  ios/        Native iPhone app (SwiftUI, built by GitHub Actions) → output in ios-artifacts/
  server/     API + /admin + /check + /user + landing page (Node 22, Fastify, Postgres), one Cloud Run service
  design/     Poster (theme reference), logo source and traced vector, original mockup
  docs/       ADMIN-GUIDE, DEPLOY, SECURITY, IOS, WEB-APP
  .github/    CI/CD: server (test → deploy → backup check), iOS (build/test/screenshots/IPA)
```

## How it fits together
- **Attendees** are pre-registered by the organisers (admin → Attendees → add, or import a CSV). They sign in with their email and a 6-digit code (Gmail SMTP, used **only** for login codes). An email that isn't on the list gets a clear "not on the attendee list" message.
- **First sign-in = one mandatory selfie** (front camera, can't be changed later, only an admin can reset it). The app is blocked until it exists. It is stored in a private Google Cloud Storage bucket; only the door scanner and admin can see it.
- **Pass**: a QR that rotates every 30 s, signed with a per-attendee secret held only by the signed-in phone (one phone per account). It stays hidden until tapped.
- **Door scanner** (`/check`, its own login): scanning *verifies* the pass and shows the attendee's selfie, name and college; the volunteer taps **Confirm entry** or **Reject**. Attendance is recorded on confirm (once per person per day/event).
- **Events** have an entry type: open to all, on-spot registration, or pre-registration (admin-managed). **Registered** = ticked by an admin (checkboxes or CSV) or already scanned at that event. The Hub shows All / Saved, My Pass shows registered events.
- **Support**: tickets with a chat-style thread, pull-to-refresh, and a red dot/badge on the Support tab when the team replies.
- **Notifications**: instant push notifications for exactly two things: a new announcement (to everyone) and a reply to your support ticket (to you). The app asks once, right after sign-in and selfie. Android uses Firebase Cloud Messaging; iPhone uses Apple's push service (needs the Apple Developer account, see docs/IOS.md). Nothing is emailed except login codes.
- **Admin portal** (`/admin`, its own login): events, attendees (photo, registrations, reset device/selfie), announcements (instant push + in-app list), support inbox, attendance, content/FAQs, activity log.
- **Landing page** (`/`): the Android APK (`/downloads/qff-2026.apk`, with its SHA-256) and, for iPhone, a button into the web app while the App Store release is pending.
- **iPhone web app** (`/user`, `/user/hub`, `/user/pass`, `/user/support`): same screens and backend as the apps, **iPhone only**. Android and desktop get a blocking popup that sends them to `/`. Details: [docs/WEB-APP.md](docs/WEB-APP.md).

## Design
The look comes from the fest poster (`design/theme-reference.png`): cream `#F2E7D7`, maroon `#7E1322`, ink `#161818`, orange `#EB732F`, Anton display type, and the supplied black Qiskit mark (`design/logo-source.png`, traced to `design/qiskit.svg`). Light only, no dark mode. Glass surfaces: real backdrop blur on Android (Haze) and frosted material on iPhone.

## Local development
```bash
cd server && npm install
npm run dev            # embedded Postgres (PGlite), mail printed to console, admin: admin / admin-dev-password, scanner: check / check-dev-password
node scripts/seed.ts   # optional sample events (stop the dev server first)
npm test               # API, security, and headless-Chrome tests of the admin, scanner and /user web app (skipped without Chrome)
cd ../android && ./gradlew :app:assembleDebug   # debug build talks to http://10.0.2.2:8080 (emulator → your machine)
```
iOS cannot be built on Linux; push to `main` and read the "iOS build" workflow's artifacts (see [docs/IOS.md](docs/IOS.md)).

## Production
Live on Cloud Run; every push to `main` that touches `server/**` redeploys. Web app and domain: [docs/WEB-APP.md](docs/WEB-APP.md). Operations: [docs/DEPLOY.md](docs/DEPLOY.md). Using the admin portal: [docs/ADMIN-GUIDE.md](docs/ADMIN-GUIDE.md). Security model and audit: [docs/SECURITY.md](docs/SECURITY.md).
