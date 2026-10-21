-- Devices that have turned notifications on. One row per device token; a token belongs to one attendee at a time.
CREATE TABLE push_tokens (
  token      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform   text NOT NULL CHECK (platform IN ('android','ios')),
  apns_env   text CHECK (apns_env IN ('production','sandbox')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_user ON push_tokens (user_id);
