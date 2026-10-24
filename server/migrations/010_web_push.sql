-- Browser (home-screen web app) notifications: the token is the push-service endpoint URL, plus the subscription's encryption keys.
ALTER TABLE push_tokens DROP CONSTRAINT push_tokens_platform_check;
ALTER TABLE push_tokens ADD CONSTRAINT push_tokens_platform_check CHECK (platform IN ('android','ios','web'));
ALTER TABLE push_tokens ADD COLUMN p256dh text;
ALTER TABLE push_tokens ADD COLUMN auth text;
