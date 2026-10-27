-- Two more one-time details for SRM-AP people: class section and gender (Male / Female).
ALTER TABLE users ADD COLUMN section text;
ALTER TABLE users ADD COLUMN gender text CHECK (gender IN ('Male','Female'));
