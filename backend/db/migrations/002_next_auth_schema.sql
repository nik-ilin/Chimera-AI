-- Migration 002: next_auth schema required by @auth/supabase-adapter
-- Run this in Supabase SQL Editor AFTER 001_initial_schema.sql.
--
-- Why: the NextAuth SupabaseAdapter (frontend/src/lib/auth.ts) reads/writes a
-- dedicated `next_auth` schema (users / sessions / accounts / verification_tokens).
-- Without these tables, the GitHub OAuth *callback* fails with an AdapterError
-- that Auth.js surfaces to the client as error=Configuration.
--
-- IMPORTANT (dashboard step, not SQL): after running this, go to
--   Supabase → Project Settings → API → Exposed schemas → add "next_auth"
-- or PostgREST will not serve the schema and the error persists.
--
-- Source: official Auth.js Supabase adapter setup.

CREATE SCHEMA IF NOT EXISTS next_auth;

GRANT USAGE ON SCHEMA next_auth TO service_role;
GRANT ALL ON SCHEMA next_auth TO postgres;

-- ─── users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS next_auth.users (
    id             uuid NOT NULL DEFAULT gen_random_uuid(),
    name           text,
    email          text,
    "emailVerified" timestamptz,
    image          text,
    CONSTRAINT users_pkey PRIMARY KEY (id),
    CONSTRAINT email_unique UNIQUE (email)
);
GRANT ALL ON TABLE next_auth.users TO postgres;
GRANT ALL ON TABLE next_auth.users TO service_role;

-- next_auth.uid(): the id of the user making the current request, read from the
-- Supabase-compatible JWT minted in the NextAuth session callback.
CREATE OR REPLACE FUNCTION next_auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
AS $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

-- ─── sessions ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS next_auth.sessions (
    id             uuid NOT NULL DEFAULT gen_random_uuid(),
    expires        timestamptz NOT NULL,
    "sessionToken" text NOT NULL,
    "userId"       uuid,
    CONSTRAINT sessions_pkey PRIMARY KEY (id),
    CONSTRAINT sessiontoken_unique UNIQUE ("sessionToken"),
    CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES next_auth.users (id) ON DELETE CASCADE
);
GRANT ALL ON TABLE next_auth.sessions TO postgres;
GRANT ALL ON TABLE next_auth.sessions TO service_role;

-- ─── accounts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS next_auth.accounts (
    id                   uuid NOT NULL DEFAULT gen_random_uuid(),
    type                 text NOT NULL,
    provider             text NOT NULL,
    "providerAccountId"  text NOT NULL,
    refresh_token        text,
    access_token         text,
    expires_at           bigint,
    token_type           text,
    scope                text,
    id_token             text,
    session_state        text,
    oauth_token_secret   text,
    oauth_token          text,
    "userId"             uuid,
    CONSTRAINT accounts_pkey PRIMARY KEY (id),
    CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId")
        REFERENCES next_auth.users (id) ON DELETE CASCADE
);
GRANT ALL ON TABLE next_auth.accounts TO postgres;
GRANT ALL ON TABLE next_auth.accounts TO service_role;

-- ─── verification_tokens ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS next_auth.verification_tokens (
    identifier text,
    token      text,
    expires    timestamptz NOT NULL,
    CONSTRAINT verification_tokens_pkey PRIMARY KEY (token),
    CONSTRAINT token_unique UNIQUE (token),
    CONSTRAINT token_identifier_unique UNIQUE (token, identifier)
);
GRANT ALL ON TABLE next_auth.verification_tokens TO postgres;
GRANT ALL ON TABLE next_auth.verification_tokens TO service_role;
