CREATE TABLE IF NOT EXISTS tasks (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_email TEXT NOT NULL,
  task_date DATE NOT NULL,
  task_name TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL CHECK (priority IN ('high','medium','low')) DEFAULT 'medium',
  task_time TIME,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  due_at_utc TIMESTAMPTZ,
  reminder_at_utc TIMESTAMPTZ,
  qstash_message_id TEXT,
  push_sent_at TIMESTAMPTZ,
  email_sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tasks_user_date_idx ON tasks(user_id, task_date);

CREATE TABLE IF NOT EXISTS notification_settings (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_minutes INTEGER NOT NULL DEFAULT 10 CHECK (reminder_minutes BETWEEN 1 AND 1440),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  subscription JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id);
