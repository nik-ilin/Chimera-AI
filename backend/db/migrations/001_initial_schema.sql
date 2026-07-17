-- Migration 001: Initial schema for Chimera
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- or via the Supabase CLI: supabase db push
--
-- CONVENTIONS.md §1: RLS enabled on every table from first migration.
-- All policies restrict rows to their owner: auth.uid() = user_id.

-- ─── ENUM ─────────────────────────────────────────────────────────────────────

CREATE TYPE creator_type_enum AS ENUM ('musician', 'influencer', 'video_creator');

-- ─── user_profile ─────────────────────────────────────────────────────────────
-- One row per authenticated user.
-- Stores the CreatorContext that is injected into every AI prompt.

CREATE TABLE IF NOT EXISTS user_profile (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    artist_name text NOT NULL DEFAULT '',
    genre       text NOT NULL DEFAULT '',
    city        text NOT NULL DEFAULT '',
    brand_vibe  text NOT NULL DEFAULT '',
    instagram_handle text,
    tiktok_handle    text,
    recent_outputs   text[]   NOT NULL DEFAULT '{}',
    creator_type     creator_type_enum,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_profile_user_id_unique UNIQUE (user_id)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS user_profile_user_id_idx ON user_profile (user_id);

-- ─── updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER user_profile_updated_at
    BEFORE UPDATE ON user_profile
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Row Level Security ───────────────────────────────────────────────────────
ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;

-- SELECT: a user can only read their own profile row.
CREATE POLICY "user_profile_select_own"
    ON user_profile FOR SELECT
    USING (auth.uid() = user_id);

-- INSERT: a user can only insert a row for themselves.
CREATE POLICY "user_profile_insert_own"
    ON user_profile FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- UPDATE: a user can only update their own profile row.
CREATE POLICY "user_profile_update_own"
    ON user_profile FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- DELETE: a user can delete their own profile row (e.g. account deletion).
CREATE POLICY "user_profile_delete_own"
    ON user_profile FOR DELETE
    USING (auth.uid() = user_id);
