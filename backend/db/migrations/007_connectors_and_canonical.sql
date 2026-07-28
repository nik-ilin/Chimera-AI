-- Migration 007: connector layer + canonical entity model
-- Run in Supabase SQL Editor AFTER migrations 001–006.
--
-- This is the foundation for the Manager module. Two ideas drive the schema:
--
-- 1. CANONICAL, NEVER PROVIDER-SHAPED.
--    Venue/Contact/Booking/Release/Expense are OUR shapes. A provider's id
--    never becomes a primary key and never leaks into a column name — it is
--    recorded in `external_refs`, which maps (entity_type, entity_id) to
--    (provider, external_id). Swapping Google Calendar for CalDAV therefore
--    touches one adapter and zero tables.
--
-- 2. A GIG IS A HUB.
--    `events` (migration 006) becomes the spine. Venue, promoter, bookings,
--    expenses, setlist and fee all hang off an event_id, so the portal can
--    render one gig with everything attached instead of five disconnected lists.
--
-- Secrets note: OAuth tokens live in `connection_secrets`, a service-role-only
-- table, for the same reason password_hash lives outside next_auth.users
-- (migration 005) — the anon-key client used by Server Components must never be
-- able to read a bearer token, even by accident.

-- ─── ENUMS ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'connection_status_enum') THEN
        CREATE TYPE connection_status_enum AS ENUM (
            'disconnected',  -- never connected, or revoked by the user
            'connected',     -- healthy, token valid
            'error',         -- last sync or refresh failed; see last_error
            'expired',       -- refresh token rejected; needs re-consent
            'syncing'        -- a sync run is in flight
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_kind_enum') THEN
        CREATE TYPE booking_kind_enum AS ENUM (
            'accommodation', 'travel', 'backline', 'other'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'booking_status_enum') THEN
        CREATE TYPE booking_status_enum AS ENUM (
            'option', 'confirmed', 'cancelled'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expense_kind_enum') THEN
        CREATE TYPE expense_kind_enum AS ENUM (
            'fee_in', 'travel', 'accommodation', 'crew', 'gear', 'marketing', 'other'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_status_enum') THEN
        CREATE TYPE sync_status_enum AS ENUM (
            'pending', 'running', 'success', 'failed', 'retrying'
        );
    END IF;
END
$$;

-- ─── connections ──────────────────────────────────────────────────────────────
-- One row per (user, provider). Metadata only — readable by its owner so the UI
-- can render live connection health. Contains NO tokens.

CREATE TABLE IF NOT EXISTS connections (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             uuid NOT NULL REFERENCES next_auth.users(id) ON DELETE CASCADE,
    -- Adapter key from the connector registry, e.g. 'google_calendar', 'caldav'.
    provider            text NOT NULL,
    status              connection_status_enum NOT NULL DEFAULT 'disconnected',
    -- Human-facing identity of the connected account, e.g. the Google email.
    -- Display only; never used for authorisation.
    account_label       text NOT NULL DEFAULT '',
    scopes              text[] NOT NULL DEFAULT '{}',

    -- Sync bookkeeping. `sync_cursor` is adapter-defined (a Google syncToken, a
    -- CalDAV ctag, an ISO timestamp) and is what makes syncs incremental.
    last_synced_at      timestamptz,
    sync_cursor         text NOT NULL DEFAULT '',
    last_error          text NOT NULL DEFAULT '',
    consecutive_failures integer NOT NULL DEFAULT 0,

    -- Non-secret adapter settings (CalDAV URL, selected calendar id, …).
    config              jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT connections_unique_per_user UNIQUE (user_id, provider)
);

CREATE INDEX IF NOT EXISTS connections_user_idx ON connections (user_id);

DROP TRIGGER IF EXISTS connections_updated_at ON connections;
CREATE TRIGGER connections_updated_at
    BEFORE UPDATE ON connections
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "connections_select_own" ON connections FOR SELECT
    USING (next_auth.uid() = user_id);
CREATE POLICY "connections_insert_own" ON connections FOR INSERT
    WITH CHECK (next_auth.uid() = user_id);
CREATE POLICY "connections_update_own" ON connections FOR UPDATE
    USING (next_auth.uid() = user_id) WITH CHECK (next_auth.uid() = user_id);
CREATE POLICY "connections_delete_own" ON connections FOR DELETE
    USING (next_auth.uid() = user_id);

-- ─── connection_secrets ───────────────────────────────────────────────────────
-- Encrypted OAuth material, isolated from `connections`.
--
-- Values are Fernet ciphertext (AES-128-CBC + HMAC) produced by
-- backend/services/connectors/vault.py using OAUTH_TOKEN_ENCRYPTION_KEY. So the
-- database never holds a usable token even to someone with full SQL access —
-- they would also need the key, which lives only in the backend environment.

CREATE TABLE IF NOT EXISTS connection_secrets (
    connection_id    uuid PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
    access_token_enc  text NOT NULL DEFAULT '',
    refresh_token_enc text NOT NULL DEFAULT '',
    -- Plaintext expiry is fine and necessary: the refresh scheduler must know
    -- when to act without decrypting anything.
    expires_at        timestamptz,
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- No grants to anon/authenticated, and RLS enabled with NO policy: only the
-- service role (which bypasses RLS) can reach this table. An accidental
-- anon-key SELECT returns zero rows rather than ciphertext.
REVOKE ALL ON TABLE connection_secrets FROM anon, authenticated;
GRANT ALL ON TABLE connection_secrets TO postgres, service_role;
ALTER TABLE connection_secrets ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS connection_secrets_updated_at ON connection_secrets;
CREATE TRIGGER connection_secrets_updated_at
    BEFORE UPDATE ON connection_secrets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── sync_runs ────────────────────────────────────────────────────────────────
-- Durable record of every sync attempt. This is what makes the sync engine
-- resumable: a crashed process leaves a 'running' row that the next tick can
-- reclaim, and `next_retry_at` drives exponential backoff across restarts
-- rather than living in an in-memory timer that a deploy would erase.

CREATE TABLE IF NOT EXISTS sync_runs (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id  uuid NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
    user_id        uuid NOT NULL REFERENCES next_auth.users(id) ON DELETE CASCADE,
    status         sync_status_enum NOT NULL DEFAULT 'pending',
    direction      text NOT NULL DEFAULT 'pull',   -- 'pull' | 'push' | 'both'
    attempt        integer NOT NULL DEFAULT 0,
    next_retry_at  timestamptz,
    started_at     timestamptz,
    finished_at    timestamptz,
    error          text NOT NULL DEFAULT '',
    -- {"pulled": 12, "pushed": 3, "skipped": 40, "conflicts": 1}
    stats          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sync_runs_connection_idx ON sync_runs (connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sync_runs_due_idx ON sync_runs (next_retry_at)
    WHERE status IN ('pending', 'retrying');

ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sync_runs_select_own" ON sync_runs FOR SELECT
    USING (next_auth.uid() = user_id);

-- ─── venues ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS venues (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES next_auth.users(id) ON DELETE CASCADE,
    name         text NOT NULL,
    address      text NOT NULL DEFAULT '',
    city         text NOT NULL DEFAULT '',
    country      text NOT NULL DEFAULT '',
    -- Coordinates power the map view and the tour-routing distance maths.
    -- Nullable because a venue typed by hand may never be geocoded.
    lat          double precision,
    lon          double precision,
    capacity     integer,
    website      text NOT NULL DEFAULT '',
    notes        text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT venues_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS venues_user_idx ON venues (user_id, name);

DROP TRIGGER IF EXISTS venues_updated_at ON venues;
CREATE TRIGGER venues_updated_at BEFORE UPDATE ON venues
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
CREATE POLICY "venues_select_own" ON venues FOR SELECT USING (next_auth.uid() = user_id);
CREATE POLICY "venues_insert_own" ON venues FOR INSERT WITH CHECK (next_auth.uid() = user_id);
CREATE POLICY "venues_update_own" ON venues FOR UPDATE
    USING (next_auth.uid() = user_id) WITH CHECK (next_auth.uid() = user_id);
CREATE POLICY "venues_delete_own" ON venues FOR DELETE USING (next_auth.uid() = user_id);

-- ─── contacts ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS contacts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES next_auth.users(id) ON DELETE CASCADE,
    name         text NOT NULL,
    -- 'promoter' | 'booker' | 'venue' | 'agency' | 'press' | 'crew' | 'other'
    role         text NOT NULL DEFAULT 'other',
    organisation text NOT NULL DEFAULT '',
    email        text NOT NULL DEFAULT '',
    phone        text NOT NULL DEFAULT '',
    notes        text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT contacts_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS contacts_user_idx ON contacts (user_id, name);

DROP TRIGGER IF EXISTS contacts_updated_at ON contacts;
CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contacts_select_own" ON contacts FOR SELECT USING (next_auth.uid() = user_id);
CREATE POLICY "contacts_insert_own" ON contacts FOR INSERT WITH CHECK (next_auth.uid() = user_id);
CREATE POLICY "contacts_update_own" ON contacts FOR UPDATE
    USING (next_auth.uid() = user_id) WITH CHECK (next_auth.uid() = user_id);
CREATE POLICY "contacts_delete_own" ON contacts FOR DELETE USING (next_auth.uid() = user_id);

-- ─── events: promote to gig hub ───────────────────────────────────────────────
-- Additive only, so migration 006's calendar keeps working untouched.

ALTER TABLE events ADD COLUMN IF NOT EXISTS venue_id uuid
    REFERENCES venues(id) ON DELETE SET NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS promoter_id uuid
    REFERENCES contacts(id) ON DELETE SET NULL;
-- Money in minor units (cents) to avoid float rounding on fees and settlements.
ALTER TABLE events ADD COLUMN IF NOT EXISTS fee_cents bigint NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EUR';
-- 'enquiry' | 'held' | 'confirmed' | 'settled' | 'cancelled'
ALTER TABLE events ADD COLUMN IF NOT EXISTS gig_status text NOT NULL DEFAULT 'confirmed';
ALTER TABLE events ADD COLUMN IF NOT EXISTS setlist text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS rider text NOT NULL DEFAULT '';
-- Groups gigs into a tour so P&L and routing can roll up.
ALTER TABLE events ADD COLUMN IF NOT EXISTS tour_id uuid;
-- Which connection produced this row, when it came from a sync rather than the
-- user. NULL = created in Chimera.
ALTER TABLE events ADD COLUMN IF NOT EXISTS source_connection_id uuid
    REFERENCES connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS events_venue_idx ON events (venue_id);
CREATE INDEX IF NOT EXISTS events_tour_idx ON events (tour_id);

-- ─── bookings ─────────────────────────────────────────────────────────────────
-- Accommodation / travel attached to a gig. This is the entity that makes
-- "book a hotel → it appears inside the gig" literal rather than aspirational.

CREATE TABLE IF NOT EXISTS bookings (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES next_auth.users(id) ON DELETE CASCADE,
    -- The gig this belongs to. ON DELETE CASCADE: a hotel booked for a
    -- cancelled show has no meaning on its own.
    event_id      uuid REFERENCES events(id) ON DELETE CASCADE,
    kind          booking_kind_enum NOT NULL DEFAULT 'accommodation',
    status        booking_status_enum NOT NULL DEFAULT 'option',
    name          text NOT NULL,
    address       text NOT NULL DEFAULT '',
    lat           double precision,
    lon           double precision,
    check_in      timestamptz,
    check_out     timestamptz,
    reference     text NOT NULL DEFAULT '',
    cost_cents    bigint NOT NULL DEFAULT 0,
    currency      text NOT NULL DEFAULT 'EUR',
    url           text NOT NULL DEFAULT '',
    notes         text NOT NULL DEFAULT '',
    -- Provider payload kept verbatim for display without a migration per field.
    payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT bookings_name_not_blank CHECK (length(btrim(name)) > 0),
    CONSTRAINT bookings_dates_ordered CHECK (
        check_out IS NULL OR check_in IS NULL OR check_out >= check_in
    )
);

CREATE INDEX IF NOT EXISTS bookings_user_idx ON bookings (user_id, check_in);
CREATE INDEX IF NOT EXISTS bookings_event_idx ON bookings (event_id);

DROP TRIGGER IF EXISTS bookings_updated_at ON bookings;
CREATE TRIGGER bookings_updated_at BEFORE UPDATE ON bookings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bookings_select_own" ON bookings FOR SELECT USING (next_auth.uid() = user_id);
CREATE POLICY "bookings_insert_own" ON bookings FOR INSERT WITH CHECK (next_auth.uid() = user_id);
CREATE POLICY "bookings_update_own" ON bookings FOR UPDATE
    USING (next_auth.uid() = user_id) WITH CHECK (next_auth.uid() = user_id);
CREATE POLICY "bookings_delete_own" ON bookings FOR DELETE USING (next_auth.uid() = user_id);

-- ─── releases ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS releases (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES next_auth.users(id) ON DELETE CASCADE,
    title        text NOT NULL,
    -- 'single' | 'ep' | 'album' | 'video'
    kind         text NOT NULL DEFAULT 'single',
    release_date date,
    label        text NOT NULL DEFAULT '',
    artwork_url  text NOT NULL DEFAULT '',
    tracks       jsonb NOT NULL DEFAULT '[]'::jsonb,
    notes        text NOT NULL DEFAULT '',
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT releases_title_not_blank CHECK (length(btrim(title)) > 0)
);

CREATE INDEX IF NOT EXISTS releases_user_idx ON releases (user_id, release_date DESC);

DROP TRIGGER IF EXISTS releases_updated_at ON releases;
CREATE TRIGGER releases_updated_at BEFORE UPDATE ON releases
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE releases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "releases_select_own" ON releases FOR SELECT USING (next_auth.uid() = user_id);
CREATE POLICY "releases_insert_own" ON releases FOR INSERT WITH CHECK (next_auth.uid() = user_id);
CREATE POLICY "releases_update_own" ON releases FOR UPDATE
    USING (next_auth.uid() = user_id) WITH CHECK (next_auth.uid() = user_id);
CREATE POLICY "releases_delete_own" ON releases FOR DELETE USING (next_auth.uid() = user_id);

-- ─── expenses ─────────────────────────────────────────────────────────────────
-- The ledger behind per-gig and per-tour P&L. Fed automatically when a booking
-- is confirmed, and manually for everything else.

CREATE TABLE IF NOT EXISTS expenses (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES next_auth.users(id) ON DELETE CASCADE,
    event_id     uuid REFERENCES events(id) ON DELETE CASCADE,
    -- Set when this row was generated from a booking, so re-syncing a booking
    -- updates its expense instead of duplicating it.
    booking_id   uuid REFERENCES bookings(id) ON DELETE CASCADE,
    kind         expense_kind_enum NOT NULL DEFAULT 'other',
    description  text NOT NULL DEFAULT '',
    -- Signed minor units: positive = money in (fees), negative = money out.
    -- One signed column keeps P&L a plain SUM() with no CASE gymnastics.
    amount_cents bigint NOT NULL DEFAULT 0,
    currency     text NOT NULL DEFAULT 'EUR',
    incurred_on  date NOT NULL DEFAULT CURRENT_DATE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS expenses_user_idx ON expenses (user_id, incurred_on DESC);
CREATE INDEX IF NOT EXISTS expenses_event_idx ON expenses (event_id);
-- One expense per booking; the sync path upserts on this.
CREATE UNIQUE INDEX IF NOT EXISTS expenses_booking_unique ON expenses (booking_id)
    WHERE booking_id IS NOT NULL;

DROP TRIGGER IF EXISTS expenses_updated_at ON expenses;
CREATE TRIGGER expenses_updated_at BEFORE UPDATE ON expenses
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "expenses_select_own" ON expenses FOR SELECT USING (next_auth.uid() = user_id);
CREATE POLICY "expenses_insert_own" ON expenses FOR INSERT WITH CHECK (next_auth.uid() = user_id);
CREATE POLICY "expenses_update_own" ON expenses FOR UPDATE
    USING (next_auth.uid() = user_id) WITH CHECK (next_auth.uid() = user_id);
CREATE POLICY "expenses_delete_own" ON expenses FOR DELETE USING (next_auth.uid() = user_id);

-- ─── external_refs ────────────────────────────────────────────────────────────
-- The single place a provider id is allowed to exist.
--
-- Generic (entity_type, entity_id) rather than a FK per table: adding a new
-- syncable entity needs no schema change, and the sync engine has exactly one
-- code path for "have I seen this remote object before?".

CREATE TABLE IF NOT EXISTS external_refs (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid NOT NULL REFERENCES next_auth.users(id) ON DELETE CASCADE,
    connection_id  uuid REFERENCES connections(id) ON DELETE CASCADE,
    -- 'event' | 'venue' | 'contact' | 'booking' | 'release' | 'opportunity'
    entity_type    text NOT NULL,
    entity_id      uuid NOT NULL,
    provider       text NOT NULL,
    external_id    text NOT NULL,
    -- Remote version marker (ETag / sequence / updated timestamp). Lets a pull
    -- skip unchanged objects and lets a push detect a lost update.
    etag           text NOT NULL DEFAULT '',
    remote_updated_at timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),

    -- THE idempotency guarantee: replaying a sync cannot create a duplicate
    -- local entity for the same remote object.
    CONSTRAINT external_refs_unique UNIQUE (user_id, provider, entity_type, external_id)
);

CREATE INDEX IF NOT EXISTS external_refs_entity_idx ON external_refs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS external_refs_connection_idx ON external_refs (connection_id);

DROP TRIGGER IF EXISTS external_refs_updated_at ON external_refs;
CREATE TRIGGER external_refs_updated_at BEFORE UPDATE ON external_refs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE external_refs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "external_refs_select_own" ON external_refs FOR SELECT
    USING (next_auth.uid() = user_id);
CREATE POLICY "external_refs_insert_own" ON external_refs FOR INSERT
    WITH CHECK (next_auth.uid() = user_id);
CREATE POLICY "external_refs_update_own" ON external_refs FOR UPDATE
    USING (next_auth.uid() = user_id) WITH CHECK (next_auth.uid() = user_id);
CREATE POLICY "external_refs_delete_own" ON external_refs FOR DELETE
    USING (next_auth.uid() = user_id);
