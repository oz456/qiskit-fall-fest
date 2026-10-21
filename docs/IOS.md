# iOS app

Native SwiftUI app in `ios/` (iOS 16+, iPhone). Same design system, features and backend as the Android app:
email-code sign-in, Hub (multi-day events, day chips, filters, hero), event sheet, My Pass (live 30-second QR, tilt card,
full-screen QR with brightness boost), Support (mentor / grievance / tickets with replies / FAQs), announcements, offline cache,
mandatory first-sign-in selfie (AVFoundation front camera), registered-events My Pass, chat-style support threads with a tab badge for new replies, light-only poster theme with frosted-glass surfaces, Dynamic Type, VoiceOver labels, haptics, Keychain storage for the refresh token and pass secret.

## How it is built (no Mac needed)
Xcode is not available on Linux, so **GitHub Actions builds it on a macOS runner** (`.github/workflows/ios.yml`, runs on every push touching `ios/`):
1. generates the Xcode project from `ios/project.yml` (XcodeGen)
2. runs the unit tests — they decode **real payloads captured from the backend** (`ios/QFFTests/Fixtures`) and check that the iPhone
   generates a pass-QR payload **byte-identical to the server's verifier**
3. renders every screen in the iOS Simulator (light only) → artifact `ios-screenshots`
4. builds a Release `.ipa` for devices (unsigned) → artifact `FallFest-unsigned-ipa`

Get the latest files: GitHub → Actions → “iOS build” → newest run → Artifacts (or `gh run download <id> -R oz456/qiskit-fall-fest`).

## What is verified and what is not
Verified in CI: compiles; all screens render; API payloads decode; pass QR matches the server.
**Not verified (needs a physical iPhone):** real sign-in end-to-end with an emailed code, the real selfie camera and its permission prompt, Keychain on device, brightness behaviour, VoiceOver feel. The simulator has no camera, so the selfie screen is only rendered, not exercised. Test on at least two iPhones before launch.
iOS cannot block screenshots; the app hides the QR while the screen is being recorded/mirrored and while it is in the app switcher, and the
30-second rotating code (plus one device per account and once-per-day check-in) is what actually stops forwarded passes.

## Getting it onto iPhones — the Apple part
Apple only runs apps that are signed by Apple-issued certificates, so an `.ipa` alone (what the Android `.apk` is) cannot just be shared.
| Route | Needs | Good for |
|---|---|---|
| **TestFlight** (recommended) | Apple Developer Program ($99/yr). Public link, up to 10,000 testers, no review for internal testers, light review for the first external build | all attendees |
| **App Store** | same account + App Review | public release |
| Sideload (Sideloadly / AltStore) with `FallFest-unsigned.ipa` | a free Apple ID; re-signs the app on the user's own computer, expires every 7 days, 3 apps max | organisers / a few testers only |

### Enabling TestFlight (≈15 minutes once you have the Apple account)
1. App Store Connect → My Apps → **+ New App** → bundle ID `org.qiskit.fallfest.amaravati` (register it under Certificates, Identifiers & Profiles first).
2. Users and Access → Integrations → App Store Connect API → generate a key (role *App Manager*), download the `.p8`; note Key ID and Issuer ID.
3. In GitHub repo settings → Secrets add `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (the file's text).
4. Actions → **iOS release (TestFlight)** → Run workflow. (`ios-release.yml` is written but untested until real credentials exist.)
5. In TestFlight create a public link and put it on the `/download` page.

## Notifications on iPhone
The app asks for notification permission once (after sign-in and selfie) and registers with APNs. Delivery needs the Apple Developer account: create an APNs key and give the server `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID` (see DEPLOY.md). Not testable in the simulator or with an unsigned IPA.

## Cost note
macOS runner minutes count 10× on private repos (free plan: 200 macOS minutes/month ≈ 15–20 builds). The workflow only runs when `ios/**` changes.
