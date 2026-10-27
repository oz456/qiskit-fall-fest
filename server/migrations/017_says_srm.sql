-- A personal-address person whose college (typed on the website) says SRM-AP. Self-reported, so it is kept apart from SRM addresses;
-- the sync sets it from the website's passes feed. It only decides who is asked for the one-time academic details.
ALTER TABLE users ADD COLUMN says_srm boolean NOT NULL DEFAULT false;
