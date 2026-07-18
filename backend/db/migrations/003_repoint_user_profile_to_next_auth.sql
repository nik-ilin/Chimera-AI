-- Migration 003: point user_profile at the adapter's identity (next_auth.users)
-- Run in Supabase SQL Editor AFTER 001 and 002.
--
-- Why: 001 created user_profile.user_id as a FK to auth.users (Supabase's own
-- Auth). But this app authenticates with NextAuth + @auth/supabase-adapter,
-- whose users live in next_auth.users — NOT auth.users. Left as-is, the first
-- /api/profile call would fail: the FK insert violates auth.users, and RLS
-- (auth.uid()) never matches. This migration re-points both the FK and the RLS
-- policies to the next_auth identity, which is what session.user.id and the
-- minted JWT (sub = next_auth user id) actually carry.

-- ─── Re-point the foreign key ─────────────────────────────────────────────────
ALTER TABLE user_profile
    DROP CONSTRAINT IF EXISTS user_profile_user_id_fkey;

ALTER TABLE user_profile
    ADD CONSTRAINT user_profile_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES next_auth.users (id) ON DELETE CASCADE;

-- ─── Swap RLS policies from auth.uid() to next_auth.uid() ─────────────────────
-- next_auth.uid() reads request.jwt.claim.sub from the Supabase-compatible JWT
-- minted in the NextAuth session callback, so owner-only isolation still holds.
DROP POLICY IF EXISTS "user_profile_select_own" ON user_profile;
DROP POLICY IF EXISTS "user_profile_insert_own" ON user_profile;
DROP POLICY IF EXISTS "user_profile_update_own" ON user_profile;
DROP POLICY IF EXISTS "user_profile_delete_own" ON user_profile;

CREATE POLICY "user_profile_select_own"
    ON user_profile FOR SELECT
    USING (next_auth.uid() = user_id);

CREATE POLICY "user_profile_insert_own"
    ON user_profile FOR INSERT
    WITH CHECK (next_auth.uid() = user_id);

CREATE POLICY "user_profile_update_own"
    ON user_profile FOR UPDATE
    USING (next_auth.uid() = user_id)
    WITH CHECK (next_auth.uid() = user_id);

CREATE POLICY "user_profile_delete_own"
    ON user_profile FOR DELETE
    USING (next_auth.uid() = user_id);
