# Admin guide (for the organising team)

Admin: `/admin`. Door scanner: `/checkin/` (a different login, give only this one to door volunteers). Both work on phones: the admin menu scrolls sideways along the top, lists become cards, and dialogs open as bottom sheets. Logins are in `~/.qff/CREDENTIALS.txt` on the setup machine.

## Events
- **New event**: title, track, start/end (multi-day: set the end on a later day), location, speaker, description. There is no registration or capacity: attendees just save the events they like, and they show under My Pass.
- For something with several time slots (stalls on different days), add one event per slot.
- **Hidden** events (untick "Visible in the app") aren't shown to attendees.

## Attendees
- People who register on the main website appear here by themselves within about 10 minutes (see docs/WEBSITE-SYNC.md). Only listed emails can sign in.
- **Add attendee**: name, email, college. Use it for anyone who isn't on the website.
- **Click an attendee** to see their selfie, block/unblock them, reset their device (lost phone), reset their selfie (they must retake it) or delete them.
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
