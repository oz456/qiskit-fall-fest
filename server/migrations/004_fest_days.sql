INSERT INTO settings (key, value) VALUES ('fest_start', '2026-10-26') ON CONFLICT (key) DO NOTHING;
INSERT INTO settings (key, value) VALUES ('fest_end', '2026-10-30') ON CONFLICT (key) DO NOTHING
