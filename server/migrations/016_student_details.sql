-- One-time academic details for @srmap.edu.in people, asked on their first sign-in. details_at is NULL until they are saved.
ALTER TABLE users ADD COLUMN reg_no text;
ALTER TABLE users ADD COLUMN school text;
ALTER TABLE users ADD COLUMN semester int CHECK (semester BETWEEN 1 AND 8);
ALTER TABLE users ADD COLUMN course text;
ALTER TABLE users ADD COLUMN program text;
ALTER TABLE users ADD COLUMN cgpa numeric(4,2) CHECK (cgpa BETWEEN 0 AND 10);
ALTER TABLE users ADD COLUMN details_at timestamptz;
CREATE UNIQUE INDEX users_reg_no_key ON users (upper(reg_no)) WHERE reg_no IS NOT NULL;
