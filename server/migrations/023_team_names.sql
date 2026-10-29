-- Hackathon team names handed out from the founders list. One row per team; the name is unique. `pushed` = the website already shows it.
CREATE TABLE team_name_claims (
  team_key   text PRIMARY KEY,                    -- the website's team id, or 'app:<uuid>' for a team made in the app
  name       text NOT NULL,
  founder    text NOT NULL,
  mode       text NOT NULL CHECK (mode IN ('tap','auto')),
  lead_email text,
  pushed     boolean NOT NULL DEFAULT false,
  claimed_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX team_name_claims_name ON team_name_claims (lower(name));
