-- Migration 006: events table for the Personal Manager calendar
-- Run in Supabase SQL Editor AFTER migrations 001–005.
--
-- Follows the exact pattern established by 004_lyric_sessions.sql:
-- user_id FK → next_auth.users, owner-only RLS on next_auth.uid(), and the
-- shared set_updated_at() trigger from migration 001.

-- ─── ENUM ─────────────────────────────────────────────────────────────────────
-- Kinds of thing a working musician actually puts on a calendar. Extend with
-- ALTER TYPE ... ADD VALUE rather than editing this list, so existing rows stay
-- valid.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'event_type_enum') THEN
        CREATE TYPE event_type_enum AS ENUM (
            'gig', 'release', 'rehearsal', 'deadline', 'other'
        );
    END IF;
END
$$;

-- ─── events ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES next_auth.users(id) ON DELETE CASCADE,
    title       text NOT NULL,
    event_type  event_type_enum NOT NULL DEFAULT 'other',
    -- Always stored in UTC. The client sends an ISO instant and renders it in
    -- the viewer's local zone; storing a naive local time would silently shift
    -- every gig when the artist tours across a timezone.
    starts_at   timestamptz NOT NULL,
    -- NULL means "no defined end" (a release date, a deadline).
    ends_at     timestamptz,
    -- All-day events ignore the time component when rendered. The date is still
    -- carried by starts_at so ordering and range queries need no special case.
    all_day     boolean NOT NULL DEFAULT false,
    location    text NOT NULL DEFAULT '',
    notes       text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT events_title_not_blank CHECK (length(btrim(title)) > 0),
    -- An event cannot finish before it starts. Enforced here as well as in Zod
    -- because the database is the last line that a direct PostgREST call still
    -- has to pass.
    CONSTRAINT events_end_after_start CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────
-- The calendar's only hot query is "my events between X and Y", so the composite
-- (user_id, starts_at) index serves both the RLS predicate and the range scan
-- in one pass.
CREATE INDEX IF NOT EXISTS events_user_starts_idx ON events (user_id, starts_at);

-- ─── updated_at trigger (reuse function from migration 001) ───────────────────
DROP TRIGGER IF EXISTS events_updated_at ON events;
CREATE TRIGGER events_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "events_select_own"
    ON events FOR SELECT
    USING (next_auth.uid() = user_id);

CREATE POLICY "events_insert_own"
    ON events FOR INSERT
    WITH CHECK (next_auth.uid() = user_id);

-- USING gates which rows can be targeted; WITH CHECK gates the resulting row.
-- Both are required: without WITH CHECK a user could UPDATE their own event and
-- reassign user_id to somebody else, planting a row in another user's calendar.
CREATE POLICY "events_update_own"
    ON events FOR UPDATE
    USING (next_auth.uid() = user_id)
    WITH CHECK (next_auth.uid() = user_id);

CREATE POLICY "events_delete_own"
    ON events FOR DELETE
    USING (next_auth.uid() = user_id);


-- ─── saved_opportunities ──────────────────────────────────────────────────────
-- Block B2: opportunities the musician has bookmarked from the finder. The
-- ranked source payload is denormalised into JSONB because it comes from an
-- external API (Ticketmaster) whose shape we do not control and do not want to
-- migrate against every time it changes.
CREATE TABLE IF NOT EXISTS saved_opportunities (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES next_auth.users(id) ON DELETE CASCADE,
    -- Stable id from the upstream source, used to de-duplicate saves.
    source         text NOT NULL DEFAULT 'mock',
    source_id      text NOT NULL,
    name           text NOT NULL,
    -- Full normalised Opportunity object (see backend/models/opportunity.py).
    payload        jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Granite's fit score + explanation at the time of saving.
    fit_score      integer NOT NULL DEFAULT 0
                   CHECK (fit_score BETWEEN 0 AND 100),
    fit_reason     text NOT NULL DEFAULT '',
    -- The draft outreach message, kept so the user can revisit and edit it.
    draft_message  text NOT NULL DEFAULT '',
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),

    -- Saving the same opportunity twice is a no-op, not a duplicate row.
    CONSTRAINT saved_opportunities_unique_per_user UNIQUE (user_id, source, source_id)
);

CREATE INDEX IF NOT EXISTS saved_opportunities_user_idx
    ON saved_opportunities (user_id, created_at DESC);

DROP TRIGGER IF EXISTS saved_opportunities_updated_at ON saved_opportunities;
CREATE TRIGGER saved_opportunities_updated_at
    BEFORE UPDATE ON saved_opportunities
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE saved_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_opportunities_select_own"
    ON saved_opportunities FOR SELECT
    USING (next_auth.uid() = user_id);

CREATE POLICY "saved_opportunities_insert_own"
    ON saved_opportunities FOR INSERT
    WITH CHECK (next_auth.uid() = user_id);

CREATE POLICY "saved_opportunities_update_own"
    ON saved_opportunities FOR UPDATE
    USING (next_auth.uid() = user_id)
    WITH CHECK (next_auth.uid() = user_id);

CREATE POLICY "saved_opportunities_delete_own"
    ON saved_opportunities FOR DELETE
    USING (next_auth.uid() = user_id);
