-- a team name changed by hand (the team lead in the app, or an organiser in the admin) is a third way a name comes about
ALTER TABLE team_name_claims DROP CONSTRAINT team_name_claims_mode_check;
ALTER TABLE team_name_claims ADD CONSTRAINT team_name_claims_mode_check CHECK (mode IN ('tap','auto','edit'));
