/**
 * Shared Zod schemas for calendar events.
 *
 * Lives outside the route files so the collection route, the item route, and
 * the client form all validate against ONE definition — a field added here
 * cannot be forgotten in one of the three places.
 */
import { z } from "zod";

export const EVENT_TYPES = ["gig", "release", "rehearsal", "deadline", "other"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Human labels + the accent each type gets in the calendar grid. */
export const EVENT_TYPE_META: Record<
  EventType,
  { label: string; dot: string; chip: string }
> = {
  gig: {
    label: "Gig",
    dot: "bg-chimera-clay",
    chip: "bg-chimera-clay-muted text-chimera-clay",
  },
  release: {
    label: "Release",
    dot: "bg-chimera-plum",
    chip: "bg-chimera-plum-muted text-chimera-plum",
  },
  rehearsal: {
    label: "Rehearsal",
    dot: "bg-chimera-gold",
    chip: "bg-chimera-gold/15 text-chimera-gold",
  },
  deadline: {
    label: "Deadline",
    dot: "bg-destructive",
    chip: "bg-destructive/10 text-destructive",
  },
  other: {
    label: "Other",
    dot: "bg-muted-foreground",
    chip: "bg-secondary text-muted-foreground",
  },
};

/**
 * An ISO 8601 instant. We validate by round-tripping through Date rather than
 * with a regex: the regex would accept "2026-02-31T00:00:00Z", which Postgres
 * then rejects with an opaque 500 instead of a clean 422.
 */
const isoInstant = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), "Must be a valid ISO 8601 date-time.");

const eventFields = {
  title: z.string().trim().min(1, "Give the event a title.").max(200),
  event_type: z.enum(EVENT_TYPES),
  starts_at: isoInstant,
  ends_at: isoInstant.nullable().optional(),
  all_day: z.boolean(),
  location: z.string().trim().max(300),
  notes: z.string().trim().max(2000),
};

/**
 * Rejects an end before the start. Mirrors the events_end_after_start CHECK in
 * migration 006 so the user gets a field-level message instead of a database
 * constraint error.
 */
function endAfterStart<T extends { starts_at?: string; ends_at?: string | null }>(
  value: T,
  ctx: z.RefinementCtx
): void {
  if (!value.starts_at || !value.ends_at) return;
  if (Date.parse(value.ends_at) < Date.parse(value.starts_at)) {
    ctx.addIssue({
      code: "custom",
      path: ["ends_at"],
      message: "End time must be after the start time.",
    });
  }
}

export const CreateEventSchema = z
  .object({
    ...eventFields,
    event_type: eventFields.event_type.default("other"),
    all_day: eventFields.all_day.default(false),
    location: eventFields.location.default(""),
    notes: eventFields.notes.default(""),
  })
  .superRefine(endAfterStart);

/**
 * PATCH body. Every field optional, but at least one must be present —
 * an empty PATCH is a client bug worth surfacing rather than a silent no-op.
 */
export const UpdateEventSchema = z
  .object({
    title: eventFields.title.optional(),
    event_type: eventFields.event_type.optional(),
    starts_at: eventFields.starts_at.optional(),
    ends_at: eventFields.ends_at,
    all_day: eventFields.all_day.optional(),
    location: eventFields.location.optional(),
    notes: eventFields.notes.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No fields to update.")
  .superRefine(endAfterStart);

export type CreateEventInput = z.infer<typeof CreateEventSchema>;
export type UpdateEventInput = z.infer<typeof UpdateEventSchema>;

/** Query params for GET /api/events — an optional [from, to) window. */
export const ListEventsQuerySchema = z.object({
  from: isoInstant.optional(),
  to: isoInstant.optional(),
});
