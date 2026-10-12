# Qiskit Fall Fest 2026 — app + backend

```
qff/
  android/   Native Android app (Kotlin, Jetpack Compose)
  server/    API + admin site (Node 22, Fastify, Postgres) — one Cloud Run service
  design/    Mockup + Qiskit mark source
  docs/      DEPLOY.md (hosting, CI/CD, operations), SECURITY.md (controls + checklist)
  .github/   CI: test + deploy to Cloud Run on every push to main
  ios/       (planned) native iOS app
```

## How it fits together
- **Attendees** are pre-registered by the organisers (admin site → Attendees → add or import CSV).
  They sign in with their email + a 6-digit code (Gmail SMTP). No passwords.
- **App ↔ server**: events, announcements, FAQs, saved/registered events and support tickets live in Postgres (Neon).
- **Pass**: a QR that rotates every 30 s, signed with a per-attendee secret that only the signed-in phone holds.
  Screenshots/forwards fail the check; each pass checks in once per day/event; one phone per account.
- **Admin site** (`/admin`): events (multi-day supported), attendees, announcements (+ optional email), support inbox,
  attendance reports, FAQs/content, audit log. Its own login (env/Secret Manager).
- **Check-in site** (`/check`): phone-friendly door scanner with a **separate login**. Verifies the live QR and records attendance
  (once per day or per event). It cannot read or change anything else.

## Local development
```bash
cd server && npm install
npm run dev            # embedded Postgres (PGlite), mail printed to console, admin: admin / admin-dev-password, scanner: check / check-dev-password
node scripts/seed.ts   # optional sample events (stop the dev server first)
npm test               # 13 integration tests
cd ../android && ./gradlew :app:assembleDebug   # debug build talks to http://10.0.2.2:8080 (emulator → your machine)
```

## Production
Live on Cloud Run; every push to `main` redeploys. Details and the one remaining step (Gmail SMTP) in [docs/DEPLOY.md](docs/DEPLOY.md).
