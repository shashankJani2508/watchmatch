-- WatchMatch Supabase schema
-- Run this in your Supabase SQL editor or via the migration script

-- ─── Sessions ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status                 TEXT NOT NULL DEFAULT 'waiting_b',
  partner_a_preferences  JSONB,
  partner_b_preferences  JSONB,
  pool_a                 JSONB NOT NULL DEFAULT '[]',
  pool_b                 JSONB NOT NULL DEFAULT '[]',
  seen_tmdb_ids          JSONB NOT NULL DEFAULT '[]',
  round                  INTEGER NOT NULL DEFAULT 1,
  matched_tmdb_id        INTEGER,
  matched_type           TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Swipes ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS swipes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  partner      CHAR(1) NOT NULL CHECK (partner IN ('a', 'b')),
  tmdb_id      INTEGER NOT NULL,
  title_type   TEXT NOT NULL CHECK (title_type IN ('movie', 'tv')),
  liked        BOOLEAN NOT NULL,
  round        INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, partner, tmdb_id, title_type, round)
);

CREATE INDEX IF NOT EXISTS idx_swipes_session ON swipes(session_id);

-- ─── updated_at trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sessions_updated_at ON sessions;
CREATE TRIGGER sessions_updated_at
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE swipes   ENABLE ROW LEVEL SECURITY;

-- Allow all access via service role key (anon access controlled by session ID knowledge)
DROP POLICY IF EXISTS "sessions_all" ON sessions;
CREATE POLICY "sessions_all" ON sessions FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "swipes_all" ON swipes;
CREATE POLICY "swipes_all" ON swipes FOR ALL USING (true) WITH CHECK (true);

-- ─── Realtime ────────────────────────────────────────────────────────────────
-- Enable realtime so the client gets instant updates when partner submits
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
