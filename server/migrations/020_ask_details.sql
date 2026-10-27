-- An organiser can ask any person (a hand-added account, a guest) for the SRM-AP academic details. The sync never touches this.
ALTER TABLE users ADD COLUMN ask_details boolean NOT NULL DEFAULT false;
