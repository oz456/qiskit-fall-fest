-- Teams made by an organiser inside the app (for testing, or people the website does not know). They never touch the website's database.
-- Everyone in one counts as registered for the Hackathon on My Pass, and the sync cannot take that away.
CREATE TABLE app_teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX app_teams_name_lower ON app_teams (lower(name));
CREATE TABLE app_team_members (
  team_id uuid NOT NULL REFERENCES app_teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  leader  boolean NOT NULL DEFAULT false
);
