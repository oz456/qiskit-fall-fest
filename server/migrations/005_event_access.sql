-- How a person gets into an event: open to all, register at the venue, or admin-managed pre-registration (paid / approved).
ALTER TABLE events ADD COLUMN access text NOT NULL DEFAULT 'open' CHECK (access IN ('open','onspot','prereg'));
UPDATE events SET access = 'prereg' WHERE registration_required;
