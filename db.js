import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn('[warn] DATABASE_URL is not set — see .env.example');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const query = (text, params) => pool.query(text, params);

const SCHEMA = `
  CREATE EXTENSION IF NOT EXISTS pgcrypto;

  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    token TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    goal_band REAL,
    target_date TEXT,
    status TEXT NOT NULL DEFAULT 'in_progress'
  );

  CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    section TEXT NOT NULL,
    type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    options_json TEXT,
    correct_answer TEXT
  );

  CREATE TABLE IF NOT EXISTS answers (
    id SERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    answer TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS results (
    session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    cefr_level TEXT NOT NULL,
    estimated_ielts REAL NOT NULL,
    skills_json TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS roadmaps (
    session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    content_json TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS vocab_words (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    word TEXT NOT NULL,
    pos TEXT,
    cefr_level TEXT,
    status TEXT NOT NULL,
    arabic TEXT,
    frequency_rank INTEGER,
    importance INTEGER,
    example_sentence TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS vocab_words_user_word_idx ON vocab_words(user_id, LOWER(word));
  CREATE INDEX IF NOT EXISTS vocab_words_status_idx ON vocab_words(user_id, status);

  DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'users' AND column_name = 'verified'
    ) THEN
      ALTER TABLE users ADD COLUMN verified BOOLEAN NOT NULL DEFAULT FALSE;
      UPDATE users SET verified = TRUE; -- grandfather anyone who signed up before verification existed
    END IF;
  END $$;

  CREATE TABLE IF NOT EXISTS email_verifications (
    token TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    ip TEXT,
    success BOOLEAN NOT NULL,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS login_attempts_email_time_idx ON login_attempts(email, attempted_at DESC);

  CREATE TABLE IF NOT EXISTS rate_limits (
    id SERIAL PRIMARY KEY,
    key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS rate_limits_key_time_idx ON rate_limits(key, created_at DESC);

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_sent_at TIMESTAMPTZ,
    last_word_id INTEGER
  );
  CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id);
`;

export async function initDb() {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA);
    console.log('[info] Postgres schema ready');
  } finally {
    client.release();
  }
}
