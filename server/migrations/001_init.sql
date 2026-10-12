-- Qiskit Fall Fest schema. All timestamps are timestamptz (UTC); display tz is applied in clients.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  name          text NOT NULL,
  college       text,
  pass_code     text NOT NULL UNIQUE,            -- short human id printed on the pass, e.g. QFF-4092
  pass_secret   bytea NOT NULL,                  -- HMAC key for the rotating QR; rotated on every login
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));

CREATE TABLE events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  track         text NOT NULL DEFAULT 'Main' CHECK (track IN ('Main','Workshop','Talk','Hackathon','Social')),
  location      text NOT NULL DEFAULT '',
  speaker       text NOT NULL DEFAULT '',
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,            -- may be on a later day: multi-day events are first-class
  capacity      integer CHECK (capacity IS NULL OR capacity > 0),
  registration_required boolean NOT NULL DEFAULT false,
  published     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX events_starts ON events (starts_at);

-- kind: 'saved' = bookmark on "My pass"; 'registered' = confirmed seat (counts toward capacity)
CREATE TABLE user_events (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('saved','registered')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id, kind)
);
CREATE INDEX user_events_event ON user_events (event_id, kind);

CREATE TABLE announcements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  body       text NOT NULL,
  emailed    integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('General','Mentor help','Grievance')),
  topic      text NOT NULL,
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_user ON tickets (user_id, created_at DESC);
CREATE INDEX tickets_status ON tickets (status, updated_at DESC);

CREATE TABLE ticket_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author     text NOT NULL CHECK (author IN ('user','admin')),
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_messages_ticket ON ticket_messages (ticket_id, created_at);

CREATE TABLE faqs (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,
  answer   text NOT NULL,
  position integer NOT NULL DEFAULT 0
);

CREATE TABLE settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE otp_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  code_hash   text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_email ON otp_codes (lower(email), created_at DESC);

-- One row per signed-in device. A user has at most one live session (older ones are revoked on login).
CREATE TABLE sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash      text NOT NULL,
  prev_refresh_hash text,
  device_id         text NOT NULL,
  device_name       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_used_at      timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz
);
CREATE INDEX sessions_user ON sessions (user_id);
CREATE UNIQUE INDEX sessions_refresh ON sessions (refresh_hash);

-- scope examples: 'day:2026-10-16' (venue entry) or 'event:<uuid>' (session attendance).
CREATE TABLE checkins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope      text NOT NULL,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope)
);

CREATE TABLE audit_log (
  id        bigserial PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  action    text NOT NULL,
  entity    text,
  entity_id text,
  detail    jsonb,
  ip        text
);
CREATE INDEX audit_at ON audit_log (at DESC);

INSERT INTO settings (key, value) VALUES
  ('fest_name', 'Qiskit Fall Fest 2026'),
  ('venue', 'Amaravati'),
  ('support_note', 'Volunteers reply within minutes during the event.');
