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
/** Gig lifecycle. Mirrors events.gig_status (migration 007). */
export const GIG_STATUSES = [
  "enquiry",
  "held",
  "confirmed",
  "settled",
  "cancelled",
] as const;
export type GigStatusValue = (typeof GIG_STATUSES)[number];

export const GIG_STATUS_META: Record<GigStatusValue, { label: string; chip: string }> = {
  enquiry: { label: "Enquiry", chip: "bg-secondary text-muted-foreground" },
  held: { label: "Held", chip: "bg-chimera-gold/15 text-chimera-gold" },
  confirmed: { label: "Confirmed", chip: "bg-chimera-clay-muted text-chimera-clay" },
  settled: { label: "Settled", chip: "bg-emerald-600/10 text-emerald-700" },
  cancelled: { label: "Cancelled", chip: "bg-destructive/10 text-destructive" },
};

/**
 * Gig-hub fields (migration 007). Separate from `eventFields` because they are
 * only meaningful on a gig, and because a calendar sync must never be able to
 * write them — see the field allowlist in services/sync.py.
 */
const gigFields = {
  venue_id: z.string().uuid().nullable(),
  promoter_id: z.string().uuid().nullable(),
  // Minor units, so no float rounding on a settlement.
  fee_cents: z.number().int().min(0).max(1_000_000_00),
  currency: z.string().length(3),
  gig_status: z.enum(GIG_STATUSES),
  setlist: z.string().trim().max(5000),
  rider: z.string().trim().max(5000),
};

export const UpdateEventSchema = z
  .object({
    title: eventFields.title.optional(),
    event_type: eventFields.event_type.optional(),
    starts_at: eventFields.starts_at.optional(),
    ends_at: eventFields.ends_at,
    all_day: eventFields.all_day.optional(),
    location: eventFields.location.optional(),
    notes: eventFields.notes.optional(),
    venue_id: gigFields.venue_id.optional(),
    promoter_id: gigFields.promoter_id.optional(),
    fee_cents: gigFields.fee_cents.optional(),
    currency: gigFields.currency.optional(),
    gig_status: gigFields.gig_status.optional(),
    setlist: gigFields.setlist.optional(),
    rider: gigFields.rider.optional(),
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
