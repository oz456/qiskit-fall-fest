-- Event registration is gone: attendees only save events to "My pass", and anyone with a pass can be scanned in anywhere.
DELETE FROM user_events WHERE kind = 'registered';
ALTER TABLE user_events DROP CONSTRAINT IF EXISTS user_events_kind_check;
ALTER TABLE user_events ADD CONSTRAINT user_events_kind_check CHECK (kind = 'saved');
ALTER TABLE events DROP COLUMN IF EXISTS registration_required;
ALTER TABLE events DROP COLUMN IF EXISTS access;
ALTER TABLE events DROP COLUMN IF EXISTS capacity;
ALTER TABLE sync_runs DROP COLUMN IF EXISTS registered;
DELETE FROM settings WHERE key = 'flagship_event_id';
