ALTER TABLE events DROP CONSTRAINT IF EXISTS events_track_check;
ALTER TABLE events ADD CONSTRAINT events_track_check CHECK (track IN ('Main','Workshop','Talk','Hackathon','Social','Competition'));
CREATE INDEX IF NOT EXISTS checkins_scope ON checkins (scope, scanned_at DESC);
