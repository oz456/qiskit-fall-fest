-- One selfie per attendee, captured on first sign-in. The image itself lives in the private photo bucket (photos/<user id>.jpg).
ALTER TABLE users ADD COLUMN photo_at timestamptz;
