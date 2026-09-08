CREATE TABLE IF NOT EXISTS app_config (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  vapid_public_key TEXT NOT NULL,
  vapid_private_key TEXT NOT NULL,
  vapid_subject TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
