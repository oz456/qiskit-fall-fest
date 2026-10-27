# iPhone web app (`/attendee`) and the domain

Plan: no Google Play / App Store accounts. **Android** installs the APK from the landing page. **iPhone** uses the web app until the native app is published. Everything is served by the one Cloud Run service on `app.qffsrmap2026.com`.

| Path | What |
|---|---|
| `/` | Landing page: APK download (+ SHA-256, install steps) and the iPhone card with the web-app button |
| `/attendee` | Web app sign-in; `/attendee/hub`, `/attendee/pass`, `/attendee/support` are the three tabs (same screens as the mobile apps) |
| `/admin`, `/checkin` | Admin portal, door check-in scanner |
| `/downloads/qff-2026.apk` | The APK. |

### Address rules
- One canonical address per page, no trailing slash: `/`, `/admin`, `/checkin`, `/attendee`, `/attendee/hub`, `/attendee/pass`, `/attendee/support`. Duplicate spellings redirect permanently (301): `/admin/`, `/checkin/`, `/index.html`, `/attendee/hub/`, `/attendee/index.html`. Any other `/attendee/...` goes to `/attendee`.
- Unknown addresses: a branded "Page not found" page for browsers, `{"error":"not_found","message":"Not found."}` JSON for API clients and anything under `/v1`, `/admin/api`, `/checkin/api`.
- APIs: `/v1/...` attendee API (shared by Android, iPhone and web; versioned, existing apps depend on it), `/admin/api/...` and `/checkin/api/...` staff APIs. Health probe: `/ping`.
- `/downloads/qff-2026.apk` is served as an attachment; the matching `.sha256` sits next to it.

## Who may use `/attendee`
**Whoever `WEB_APP_PLATFORMS` allows** (comma list of `ios`, `android`, `desktop`; the code default is `ios`, production runs `ios,android,desktop`). On Android the root page shows the APK download and the web app as two equal buttons. The check runs in three places:
1. **Server, on every `/attendee/**` request** (page, scripts, fonts, manifest, even missing files): Android/desktop get a small HTML popup, no app code at all, with a button to `/`.
2. **Server, on every API call from the web app** (`x-qff-client: web`): 403 `platform_not_supported`.
3. **Browser**: the page re-checks user-agent, `navigator.platform` and client hints and shows the same popup.
The user-agent comes from the browser, so a technical user can fake it with developer tools; that is true of every web restriction. It stops all normal use. An iPhone in "Desktop website" mode or in a non-Safari browser that hides its iPhone identity is also blocked (fail closed). To open the web app to everyone for testing, set `WEB_APP_PLATFORMS=ios,android,desktop`. With `desktop` allowed, a laptop/PC browser shows the app inside a phone-sized frame (an iframe of `/attendee`, same origin).

## Sign-in and security
- Same email + 6-digit code flow as the apps. The 15-minute access token lives only in page memory. The refresh token is an `HttpOnly; Secure; SameSite=Strict` cookie (`qff_rt`, path `/v1/auth`) that scripts can't read; it rotates on use and a replayed token revokes the session. Sign-out revokes it server-side (`POST /v1/auth/web-logout`).
- The pass secret never reaches the browser: the server computes the rotating QR payloads (`GET /v1/pass/codes`, current + next ~5 minutes) and the page just draws them.
- State-changing browser calls must carry an allowed `Origin`. No inline scripts/styles are allowed (CSP). `/attendee`, `/admin`, `/checkin`, `/v1` are `noindex`.
- The native Android/iPhone API behaviour is unchanged.

## Notifications on iPhone
Web push works only after **Share → Add to Home Screen** and opening the app from its icon (iOS 16.4+, Apple's rule). The profile sheet explains this and offers the toggle. Still only announcements and support replies. Needs VAPID keys:
```bash
cd server && npm run vapid          # prints a key pair: copy it straight into Secret Manager, do not paste it anywhere else
printf '%s' '<public>'  | gcloud secrets create qff-vapid-public  --data-file=- --project qiskit-511416
printf '%s' '<private>' | gcloud secrets create qff-vapid-private --data-file=- --project qiskit-511416
gcloud secrets add-iam-policy-binding qff-vapid-public  --member serviceAccount:qff-run@qiskit-511416.iam.gserviceaccount.com --role roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding qff-vapid-private --member serviceAccount:qff-run@qiskit-511416.iam.gserviceaccount.com --role roles/secretmanager.secretAccessor
./server/deploy.sh                  # wires them in automatically once both exist
```
Without keys the web app works normally and simply offers no notifications.

## Putting it on `app.qffsrmap2026.com`
1. Verify the domain with Google (Search Console / `gcloud domains verify`) for the account that owns the project.
2. Map it to the service in a region that supports domain mappings (us-east4; **us-east5 does not**):
   `gcloud beta run domain-mappings create --service qff-api --domain app.qffsrmap2026.com --region us-east4 --project qiskit-511416`.
3. In Cloudflare add `CNAME app → ghs.googlehosted.com`, **DNS only** (grey cloud). Certificates are issued automatically.
4. Redeploy with `PUBLIC_URL=https://app.qffsrmap2026.com ./server/deploy.sh` (sets cookie origins, push subject, scanner links).
5. Rebuild the Android APK with the new API base URL (see android/build-release.sh) and commit it so the landing page serves the new build; the old APK keeps working on the run.app address as long as that service URL exists.

## Testing before release
Run `npm test` (includes a headless-Chrome run of the whole web journey with a fake camera). The real-iPhone checks that remain manual: camera permission prompt in Safari, Add to Home Screen + notification permission, the QR scanning at the door from the phone's actual screen, `.ics` download.

## Add to home screen
The web app is a PWA (manifest + service worker). The Hub shows a dismissible card, and the profile sheet a row, inviting people to add it to their home screen: Android Chrome gets the browser's own install dialog (`beforeinstallprompt`), iPhone gets the two Share steps (Safari has no install button). Nothing shows inside the installed app, on a laptop, or in browsers that cannot install. Dismissing hides the card for 3 days.
