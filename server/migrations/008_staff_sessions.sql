-- Server-side record of staff (admin / door scanner) logins, so logout and revocation really end a session instead of just clearing a cookie.
CREATE TABLE staff_sessions (
  id         text PRIMARY KEY,
  site       text NOT NULL CHECK (site IN ('admin','check')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX staff_sessions_expires ON staff_sessions (expires_at);
