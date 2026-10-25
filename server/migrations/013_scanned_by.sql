-- Who did the scanning: the door login that confirmed a check-in (shown in the admin Attendance page).
ALTER TABLE staff_sessions ADD COLUMN username text;
ALTER TABLE checkins ADD COLUMN scanned_by text;
