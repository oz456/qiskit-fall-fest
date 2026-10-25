-- People now arrive from the main website (registrations / whitelist) as well as from admin. Keep track of where each came from and
-- what kind of address it is, and keep a log of sync runs for the admin "Website sync" card.
ALTER TABLE users ADD COLUMN kind   text NOT NULL DEFAULT 'external' CHECK (kind IN ('student','faculty','unclear','external'));
ALTER TABLE users ADD COLUMN source text NOT NULL DEFAULT 'admin'    CHECK (source IN ('admin','import','website'));

-- SRM addresses: students are name_surname@srmap.edu.in (underscore), faculty are name.surname@srmap.edu.in (dot); anything else on the domain is "unclear".
UPDATE users SET kind = CASE
  WHEN lower(email) !~ '@srmap\.edu\.in$' THEN 'external'
  WHEN split_part(lower(email), '@', 1) LIKE '%\_%' AND split_part(lower(email), '@', 1) NOT LIKE '%.%' THEN 'student'
  WHEN split_part(lower(email), '@', 1) LIKE '%.%'  AND split_part(lower(email), '@', 1) NOT LIKE '%\_%' THEN 'faculty'
  ELSE 'unclear' END;

CREATE TABLE sync_runs (
  id          bigserial PRIMARY KEY,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  trigger     text NOT NULL,                 -- 'scheduler' | 'admin' | 'push'
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','failed')),
  seen        int NOT NULL DEFAULT 0,        -- people the website reported
  created     int NOT NULL DEFAULT 0,
  updated     int NOT NULL DEFAULT 0,
  skipped     int NOT NULL DEFAULT 0,        -- not a participant (admin/mentor/tester) or inactive and unknown
  registered  int NOT NULL DEFAULT 0,        -- flagship-pass holders newly registered for the flagship event
  error       text
);
CREATE INDEX sync_runs_started ON sync_runs (started_at DESC);
