-- Migration 008: event reminders
-- Run in Supabase SQL Editor AFTER migrations 001–007.
--
-- Reminders are stored as an OFFSET (minutes before the event), not as an
-- absolute timestamp. Rescheduling a gig — which drag-and-drop now makes a
-- one-gesture operation — must move its reminder with it; an absolute time
-- would silently detach and fire on the wrong day.
--
-- How they actually fire: Chimera has no push infrastructure, so reminders are
-- emitted as RFC 5545 VALARM components in the .ics export and pushed to the
-- connected calendar. The user's own calendar app raises the notification. That
-- is a real, working mechanism rather than a fake bell icon — and it means a
-- reminder survives even if Chimera is closed.

-- NULL = no reminder. 0 is meaningful ("at start time"), so the column must be
-- nullable rather than defaulting to 0.
ALTER TABLE events ADD COLUMN IF NOT EXISTS reminder_minutes integer;

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_reminder_sane;
ALTER TABLE events ADD CONSTRAINT events_reminder_sane
    CHECK (reminder_minutes IS NULL OR (reminder_minutes >= 0 AND reminder_minutes <= 40320));
-- Upper bound is 4 weeks. Beyond that a "reminder" is really a separate task,
-- and an unbounded value would produce nonsense VALARM triggers.

COMMENT ON COLUMN events.reminder_minutes IS
    'Minutes before starts_at to remind. NULL = none. Emitted as a VALARM in .ics export and on calendar push.';
