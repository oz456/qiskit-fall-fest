CREATE TABLE mail_quota (
  day     date NOT NULL,
  account text NOT NULL,
  sent    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, account)
)
