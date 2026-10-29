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

## Setup
- Shared key: the same value in the website's Vercel env var `GCP_ACCESS` and in Secret Manager as `qff-sync-secret` (never in git). `./server/deploy.sh` wires it into Cloud Run as `SYNC_SECRET` automatically once the secret exists.
- Scheduler job (every 10 minutes, header `Authorization: Bearer <key>`):
  `gcloud scheduler jobs create http qff-website-sync --location us-east4 --schedule "*/10 * * * *" --uri https://app.qffsrmap2026.com/integrations/website/reconcile --http-method POST --headers "Authorization=Bearer <key>"`
- Admin → Attendees → **Website sync** shows the last runs and has a "Sync now" button.
- To pause: disable the scheduler job, or remove `SYNC_SECRET` (all sync endpoints then answer 401).

## Personal-email SRM-AP students (academic details)
The one-time details form is asked of every `@srmap.edu.in` address, and also of a person with a verified pass on a personal address whose college (typed on the website) says SRM-AP. The website's passes feed carries `srmBasis` per person (`srm_email`, `personal_says_srm`, `outside`), decided by the website's single `lib/srm-group.ts` (SRM Chennai/IST and other campuses do not count). The sync stores it as `users.says_srm`. It is self-reported, so exports keep it apart (`email_type`), and the admin sees a "SAYS SRM-AP" tag. `GET /admin/api/srm-audit` lists the borderline claims for checking by hand (read-only).

## Hackathon teams (My Pass)

The hackathon teams live on the website (`hackathon_teams`, `team_members`). Flagship (₹499) holders get a **Registered events** card on My Pass; tapping it opens **Your team**: the team lead first, then teammates (view only: no inviting, adding or removing in the app).

- The app reads one person's team on demand from the website: `GET /api/integrations/qff-app/team?email=` (Bearer `GCP_ACCESS`, read-only, names and roles only, no teammate emails), and the whole list with `?all=1` (team id, name, leader). The app caches both for 30 seconds.
- A name change is `POST /api/integrations/qff-app/team {email, name}`: only the team lead, 3 to 40 characters, name not already taken. It changes nothing but `hackathon_teams.name`.

### Team names from the founders list

Every team gets a name inspired by an Indian founder (50 names in `server/src/lib/founders.ts`, for example "CRED-ibility (Kunal Shah)": the founder is part of the name everywhere).

- **When an organiser starts it** (Admin, Events, "Hackathon team names": **Start now**, or **Schedule** a time; nothing happens on its own) every team lead can tap **Get my team name** for **100 seconds**. The server picks a free name at random, so two leads can never collide, and tapping twice gives the same name.
- **When the 100 seconds are over** every team still without a name gets one automatically, including teams whose lead never opened the app (the app asks the website for all teams). Names are written to the website; if that fails it is retried (every 15 seconds, on app requests, and by the 10-minute scheduler) until it sticks. Until then the app already shows the new name.
- **Admin, Events, "Hackathon team names":** **Start now**, **Schedule** a time, **Cancel schedule**, **Switch off**, **Practice** (a 25-second countdown and a 100-second round for teams made in the app only, such as the test team; the real schedule and the website teams are untouched), and **Name all teams now** (emergency button: names every unnamed team immediately, whatever the clock says).

### Changing a team name by hand

- **Team lead (app, once the team has a name):** a **Rename** button in the team sheet. 3 to 40 characters, no other team may have the same name; the website changes too. Organisers can stop this with **Stop team leads changing names** (Admin, Events, Hackathon teams).
- **Organisers (Admin, Events, "Hackathon teams"):** every team is listed with its lead and how it got its name, with search, a filter for numbered names, and an **Edit** button.
- If the founders list (50, plus 26 in reserve) runs out, a team gets a numbered name such as "Quantum Team 7" so it is never left without one; those can be edited the same way.
