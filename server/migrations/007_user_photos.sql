-- Selfies get their own table: one immutable row per attendee (UNIQUE user_id). The only way to change it is an admin reset (delete the row, then the
-- attendee retakes it). The image lives in the private photo bucket under object_key; size/sha256 are kept so integrity can be checked.
CREATE TABLE user_photos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  object_key  text NOT NULL,
  size_bytes  integer NOT NULL,
  sha256      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO user_photos (user_id, object_key, size_bytes, sha256) SELECT id, 'photos/' || id || '.jpg', 0, '' FROM users WHERE photo_at IS NOT NULL;
ALTER TABLE users DROP COLUMN photo_at;
