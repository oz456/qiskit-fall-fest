# Qiskit Fall Fest 2026 — app + backend

```
qff/
  android/   Native Android app (Kotlin, Jetpack Compose)
  server/    API + admin site (Node 22, Fastify, Postgres) — one Cloud Run service
  design/    Mockup + Qiskit mark source
  docs/      DEPLOY.md (go-live runbook), SECURITY.md (controls + checklist)
  ios/       (planned) native iOS app
```

## How it fits together
- **Attendees** are pre-registered by the organisers (admin site → Attendees → add or import CSV).
  They sign in with their email + a 6-digit code (SendGrid). No passwords.
- **App ↔ server**: events, announcements, FAQs, saved/registered events and support tickets live in Postgres (Neon).
- **Pass**: a QR that rotates every 30 s, signed with a per-attendee secret that only the signed-in phone holds.
  Screenshots/forwards fail the check; each pass checks in once per day/event; one phone per account.
- **Admin site** (`/admin`): events (multi-day supported), attendees, announcements (+ optional email), support inbox,
  live check-in scanner, FAQs/content, audit log. Single login from env vars.

## Local development
```bash
cd server && npm install
npm run dev            # embedded Postgres (PGlite), mail printed to console, admin: admin / admin-dev-password
node scripts/seed.ts   # optional sample events (stop the dev server first)
npm test               # 11 integration tests
cd ../android && ./gradlew :app:assembleDebug   # debug build talks to http://10.0.2.2:8080 (emulator → your machine)
```

## Go live
See [docs/DEPLOY.md](docs/DEPLOY.md).
