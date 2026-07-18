-- Migration 004: lyric_sessions table for multi-turn ghostwriting
-- Run in Supabase SQL Editor AFTER migrations 001–003.
--
-- CONVENTIONS.md §4: Ghostwriting multi-turn memory.
-- Stores the full turn history per session. FastAPI feeds a windowed/
-- summarised context so tokens stay bounded; sessions are resumable by ID.

CREATE TABLE IF NOT EXISTS lyric_sessions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL REFERENCES next_auth.users(id) ON DELETE CASCADE,
    title            text NOT NULL DEFAULT 'Untitled Session',
    genre            text NOT NULL DEFAULT '',
    theme            text NOT NULL DEFAULT '',
    rhyme_scheme     text NOT NULL DEFAULT 'ABAB',
    -- Full turn history as JSONB array: [{role, content, timestamp}]
    turn_history     jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Rolling summary produced by Granite when history exceeds the window
    history_summary  text NOT NULL DEFAULT '',
    -- Last generated output stored for context continuity
    last_output      jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lyric_sessions_user_id_idx ON lyric_sessions (user_id);
CREATE INDEX IF NOT EXISTS lyric_sessions_updated_at_idx ON lyric_sessions (updated_at DESC);

-- updated_at trigger (reuse function from migration 001)
CREATE TRIGGER lyric_sessions_updated_at
    BEFORE UPDATE ON lyric_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE lyric_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lyric_sessions_select_own"
    ON lyric_sessions FOR SELECT
    USING (next_auth.uid() = user_id);

CREATE POLICY "lyric_sessions_insert_own"
    ON lyric_sessions FOR INSERT
    WITH CHECK (next_auth.uid() = user_id);

CREATE POLICY "lyric_sessions_update_own"
    ON lyric_sessions FOR UPDATE
    USING (next_auth.uid() = user_id)
    WITH CHECK (next_auth.uid() = user_id);

CREATE POLICY "lyric_sessions_delete_own"
    ON lyric_sessions FOR DELETE
    USING (next_auth.uid() = user_id);
