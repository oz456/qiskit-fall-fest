# Admin guide (for the organising team)

Admin: `/admin/`. Door scanner: `/check/` (a different login, give only this one to door volunteers). Both work on phones: the admin menu scrolls sideways along the top, lists become cards, and dialogs open as bottom sheets. Logins are in `~/.qff/CREDENTIALS.txt` on the setup machine.

## Events
- **New event**: title, track, start/end (multi-day: set the end on a later day), location, speaker, description.
- **Entry** decides what attendees see in the app:
  - *Open to all*: "just walk in".
  - *On-spot registration*: "register at the venue desk".
  - *Pre-registration required*: only people you enrol get in; the scanner warns for anyone else.
- For something with several time slots (stalls on different days), add one event per slot.
- **Hidden** events (untick "Visible in the app") aren't shown to attendees.

## Attendees and registrations
- **Add attendee**: name, email, college, and tick the events they are registered for. Only listed emails can sign in.
- **Click an attendee** to see their selfie, block/unblock them, reset their device (lost phone), reset their selfie (they must retake it), delete them, or change their ticked events and press *Save registrations*.
- **Import CSV**: the window shows the exact format for *today's* events and a **Download template** button. Columns: `email,name,college`, then one column per event, headed by the event's exact title. Put `1` (or yes) under an event for "registered", `0` or empty for "not". Existing emails are not duplicated but a 1 still registers them; a 0 never removes a registration (untick it in the attendee's panel).
- An attendee also appears as *registered* for an event once the scanner has confirmed them at that event.

## Door scanner (`/check`)
1. Pick what you're scanning for: *Venue entry* for a day (once per person per day) or a specific event.
2. Point the camera at the attendee's live QR (or paste a code under "Enter a code manually").
3. The sheet shows the selfie, name and college. **Compare the face**, then **Confirm entry** or **Reject**.
4. Warnings: "Not enrolled" (pre-registration events), "No selfie on file yet", "Already checked in" (shows when), "Stale QR" (a screenshot), "Invalid pass".
5. If the photo can't load the sheet says PHOTO UNREADABLE: check the person's ID instead.

## Support, announcements, content
- **Support**: open a ticket, reply (the attendee sees it in the app after they refresh; the Support tab shows a red dot), change its status. Replies are *not* emailed; the attendee gets a push notification instead.
- **Announcements** are sent **instantly as a push notification** to every phone that has notifications on (the page shows how many), and are listed in the app's bell menu. They are not emailed (the daily mail quota is kept for login codes). Support replies also push to that attendee's phone.
- **Content**: festival name/venue/first and last day (drives the countdown and the scanner's days), support note, FAQs.
- **Attendance**: pick *Venue entry* or an event; download the list as CSV.
- **Activity** (bottom of the menu): every admin change and failed login.
