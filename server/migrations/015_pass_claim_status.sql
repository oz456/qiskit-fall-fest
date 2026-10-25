-- Outside people who filed a pass claim that is not verified (yet): used only to show them the right message at sign-in.
CREATE TABLE pass_claim_status (
  email      text PRIMARY KEY,
  status     text NOT NULL CHECK (status IN ('pending','rejected')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
