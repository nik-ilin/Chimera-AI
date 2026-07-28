-- Migration 005: email/password (Credentials) auth for NextAuth
-- Run in Supabase SQL Editor AFTER migrations 001–004.
--
-- Why a SEPARATE TABLE instead of a next_auth.users.password_hash column:
-- @auth/supabase-adapter issues `select *` against next_auth.users and hands
-- the resulting row straight to Auth.js, which serialises it into the JWT and
-- the client-visible session. A password_hash column on that table would be one
-- adapter query away from leaking the hash to the browser. Keeping it in its own
-- table means the adapter can never see it, and only our own explicitly-written
-- server-side lookup (frontend/src/lib/credentials.ts) ever reads the column.
--
-- Nothing here touches the OAuth path: GitHub/Google users simply have no
-- user_credentials row, which authorize() treats as "no password set".

-- ─── user_credentials ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS next_auth.user_credentials (
    user_id       uuid PRIMARY KEY
                  REFERENCES next_auth.users (id) ON DELETE CASCADE,
    -- bcrypt hash ($2b$12$…), 60 chars. NEVER selected outside credentials.ts.
    password_hash text NOT NULL,
    -- Bumped on every password change so old reset links can be invalidated.
    updated_at    timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Only the service role may touch this table. There is deliberately NO grant to
-- `anon` or `authenticated`: the anon-key client used by Server Components
-- (lib/supabase/server.ts) must never be able to read a hash even if a future
-- RLS policy were mis-written.
REVOKE ALL ON TABLE next_auth.user_credentials FROM anon, authenticated;
GRANT ALL ON TABLE next_auth.user_credentials TO postgres;
GRANT ALL ON TABLE next_auth.user_credentials TO service_role;

-- Defence in depth: RLS on, and no policy is ever created for anon /
-- authenticated. service_role bypasses RLS, so the registration + sign-in path
-- (which runs server-side with the service-role key) still works, while any
-- accidental anon-key SELECT returns zero rows instead of a hash.
ALTER TABLE next_auth.user_credentials ENABLE ROW LEVEL SECURITY;

-- updated_at trigger. set_updated_at() lives in the public schema (migration
-- 001); it is schema-qualified here because next_auth is not on the search_path
-- for trigger execution.
DROP TRIGGER IF EXISTS user_credentials_updated_at ON next_auth.user_credentials;
CREATE TRIGGER user_credentials_updated_at
    BEFORE UPDATE ON next_auth.user_credentials
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ─── Case-insensitive email uniqueness ────────────────────────────────────────
-- Migration 002 gave next_auth.users a plain UNIQUE(email), which treats
-- "A@x.com" and "a@x.com" as different accounts — that lets someone register a
-- near-duplicate of an existing user and makes the sign-in lookup ambiguous.
-- We normalise to lowercase in application code AND enforce it here.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique
    ON next_auth.users (lower(email))
    WHERE email IS NOT NULL;

-- ─── Email verification token index ───────────────────────────────────────────
-- next_auth.verification_tokens already exists (migration 002, used by the
-- adapter's magic-link flow). The credentials flow reuses it, looking rows up by
-- `identifier` (the email) to invalidate a user's older tokens on resend.
CREATE INDEX IF NOT EXISTS verification_tokens_identifier_idx
    ON next_auth.verification_tokens (identifier);
