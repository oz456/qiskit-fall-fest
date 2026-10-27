-- OD (on-duty) details collected at the door, only for events an organiser ticks "collect OD details" on.
ALTER TABLE events ADD COLUMN collect_od boolean NOT NULL DEFAULT false;
-- clock times on the event day as HH:MM (24 h), and the number of hours; filled in by the door volunteer when the check-in is confirmed
ALTER TABLE checkins ADD COLUMN od_from text;
ALTER TABLE checkins ADD COLUMN od_until text;
ALTER TABLE checkins ADD COLUMN od_hours numeric(4,2);
