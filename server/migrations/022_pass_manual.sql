-- A pass type an organiser set by hand in the app (Add attendee / the person's page). The website sync never clears it; the website is never told.
ALTER TABLE users ADD COLUMN pass_manual boolean NOT NULL DEFAULT false;
