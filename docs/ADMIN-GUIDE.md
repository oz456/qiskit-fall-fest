# Admin guide (for the organising team)

Admin: `/admin`. Door scanner: `/checkin/` (a different login, give only this one to door volunteers). Both work on phones: the admin menu scrolls sideways along the top, lists become cards, and dialogs open as bottom sheets. Logins are in `~/.qff/CREDENTIALS.txt` on the setup machine.

## Events
- **New event**: title, track, start/end (multi-day: set the end on a later day), location, speaker, description. There is no registration or capacity: attendees just save the events they like, and they show under My Pass.
- For something with several time slots (stalls on different days), add one event per slot.
- **Hidden** events (untick "Visible in the app") aren't shown to attendees.

## Attendees
- People who register on the main website appear here by themselves within about 10 minutes (see docs/WEBSITE-SYNC.md). Only listed emails can sign in.
- **Add attendee**: name, email, college. Use it for anyone who isn't on the website.
- **Click an attendee** to see their selfie, block/unblock them, reset their device (lost phone), reset their selfie (they must retake it), clear their academic details (they are asked again) or delete them. SRM-AP people give registration number, school, semester, section, gender (Male or Female), course, program and CGPA once (people who saved before section and gender existed are asked for just those two) on first sign-in; **Download student details** on the Attendees page exports them as CSV.
- **Import CSV**: columns `email,name,college` (the window has a **Download template** button). Existing emails are skipped, not duplicated.

## Door scanner (`/checkin`)
1. Pick what you're scanning for: *Campus entry* for a day (once per person per day) or a specific event.
2. Point the camera at the attendee's live QR. There is no search-and-check-in: a live QR is the only way in, so nobody can be checked in as a proxy. Each volunteer has their own login; the admin Attendance page shows who scanned whom and when.
3. The sheet shows the selfie, name and college. **Compare the face**, then **Confirm entry** or **Reject**.
4. Warnings: "No selfie on file yet", "Already checked in" (shows when), "Stale QR" (a screenshot), "Invalid pass".
5. If the photo can't load the sheet says PHOTO UNREADABLE: check the person's ID instead.

## Support, announcements, content
- **Support**: open a ticket, reply (the attendee sees it in the app after they refresh; the Support tab shows a red dot), change its status. Replies are *not* emailed; the attendee gets a push notification instead.
- **Announcements** are sent **instantly as a push notification** to every phone that has notifications on (the page shows how many), and are listed in the app's bell menu. They are not emailed (the daily mail quota is kept for login codes). Support replies also push to that attendee's phone.
- **Content**: festival name/venue/first and last day (drives the countdown and the scanner's days), support note, FAQs.
- **Attendance**: pick *Campus entry* or an event; download the list as CSV.
- **Activity** (bottom of the menu): every admin change and failed login.

## OD details at the door
In the Events page, open an event and tick **OD needed**. After a student is checked in at the door for that event, **their own app** (Android, iPhone or web app) asks them for OD from time, OD until time and number of hours (the hours are worked out from the two times and can be corrected). **Later** keeps an "Add OD details" button under the event in My Pass. The volunteer is only told that the student will be asked, and nothing is asked for other events or campus entry. The answers show only on the Attendance page (extra columns and in the CSV) for that event; **Clear** next to a row empties a wrong entry so the student can fill it in again. Older Android installs do not have the form until they update.

## Pass type on Add attendee

"Add attendee" asks for a **Pass type**: No pass, ₹99 General or ₹499 Flagship. You can change it later from the person's page ("Pass type"). It is kept in this app only: the website is never told, and the website sync never removes it (the person shows "SET BY HAND"). Choosing "As on the website" hands the decision back to the website. A ₹499 pass here gives the Hackathon card on My Pass. People you gave a pass by hand are left out of the "Matches the website?" comparison on the sync card.

## Quick messages (Announcements)

The Announcements page has ready-made messages above the form: Hackathon (kickoff, mentors, 2 hours / 1 hour / 30 minutes / 10 minutes left, submissions closed, judging, results soon, slow Wi-Fi), Food and breaks (snacks, tea and coffee, lunch, dinner, stretch break) and General (pass reminder, group photo, thank you). Tap one to fill the title and message, change the words if you like, then press Publish. Nothing is sent by tapping a preset. The wording lives in the `PRESETS` list at the top of the announcements section of `server/public/admin/admin.js`.

## "SRM-AP student or outside?" (personal emails)

People who signed in with a personal email but whose college on the website says SRM-AP are asked once, right after the sign-in code and before anything else: **SRM-AP student** (then the academic details form) or **Outside student** (never asked for registration number, semester or OD details). Their answer shows on their page as CONFIRMED SRM-AP or SAYS OUTSIDE. "Reset details" clears it, so they are asked again. If you tick "Ask for academic details" for someone, they skip the question and get the form. Outside students are also no longer shown the OD form; only SRM-AP people (and anyone you asked) are.
