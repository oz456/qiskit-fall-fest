-- Who may sign in: every @srmap.edu.in address (account made on first login), plus outside attendees who hold a verified
-- General (₹99) or Flagship (₹499) pass on the website. pass_tier is copied from the website by the sync.
ALTER TABLE users ADD COLUMN pass_tier text CHECK (pass_tier IN ('general','flagship'));
-- true while the name was guessed from the email address; the website's real name replaces it on the next sync
ALTER TABLE users ADD COLUMN name_derived boolean NOT NULL DEFAULT false;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_source_check;
ALTER TABLE users ADD CONSTRAINT users_source_check CHECK (source IN ('admin','import','website','srm'));
