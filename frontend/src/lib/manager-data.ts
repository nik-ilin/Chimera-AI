/**
 * Manager data access — SERVER ONLY.
 *
 * Shared reads for the timeline, the map and the gig hub, so a Server Component
 * and a Route Handler can never drift on what "a gig with everything attached"
 * means.
 *
 * Every query runs through lib/supabase/server.ts, i.e. as the authenticated
 * user under RLS. The .eq("user_id", …) filters are a second layer, not the
 * primary control (migration 007 policies are).
 */
import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import type {
  BookingRow,
  ContactRow,
  EventRow,
  ExpenseRow,
  VenueRow,
} from "@/types/supabase";

/** An event plus every entity that hangs off it. The gig-hub payload. */
export interface GigBundle {
  event: EventRow;
  venue: VenueRow | null;
  promoter: ContactRow | null;
  bookings: BookingRow[];
  expenses: ExpenseRow[];
  /** Fee in, costs out, net — all in minor units. */
  finance: { feeCents: number; costCents: number; netCents: number; currency: string };
}

/** Timeline row: an event with just enough joined data to render a card. */
export interface TimelineEvent extends EventRow {
  venue: Pick<VenueRow, "id" | "name" | "city" | "country" | "lat" | "lon" | "capacity"> | null;
  promoter: Pick<ContactRow, "id" | "name" | "email"> | null;
  bookingCount: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Events in a window, with venue/promoter joined and booking counts.
 *
 * PostgREST embedding does the join in ONE round-trip. Fetching events then
 * looping to fetch each venue would be an N+1 that gets slow exactly when a
 * user has an interesting amount of data.
 */
export async function loadTimeline(
  userId: string,
  opts: { from?: string; to?: string; limit?: number } = {}
): Promise<TimelineEvent[]> {
  const supabase = createServiceClient() as any;

  let query = supabase
    .from("events")
    .select(
      `*,
       venue:venues!events_venue_id_fkey (id, name, city, country, lat, lon, capacity),
       promoter:contacts!events_promoter_id_fkey (id, name, email),
       bookings (id)`
    )
    .eq("user_id", userId)
    .order("starts_at", { ascending: true });

  if (opts.from) query = query.gte("starts_at", opts.from);
  if (opts.to) query = query.lt("starts_at", opts.to);
  if (opts.limit) query = query.limit(opts.limit);

  const { data, error } = await query;
  if (error) {
    // A read failure must not blank the whole portal; the caller renders an
    // empty state and the client can retry.
    console.error("[manager] loadTimeline failed:", error.message);
    return [];
  }

  return (data ?? []).map((row: any) => ({
    ...row,
    venue: row.venue ?? null,
    promoter: row.promoter ?? null,
    bookingCount: Array.isArray(row.bookings) ? row.bookings.length : 0,
  })) as TimelineEvent[];
}

/** One gig with venue, promoter, bookings, expenses and a P&L rollup. */
export async function loadGig(userId: string, eventId: string): Promise<GigBundle | null> {
  const supabase = createServiceClient() as any;

  const { data: event, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !event) return null;

  // Independent reads — fire them together rather than awaiting in sequence.
  const [venueResult, promoterResult, bookingsResult, expensesResult] = await Promise.all([
    event.venue_id
      ? supabase.from("venues").select("*").eq("id", event.venue_id).maybeSingle()
      : Promise.resolve({ data: null }),
    event.promoter_id
      ? supabase.from("contacts").select("*").eq("id", event.promoter_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("bookings")
      .select("*")
      .eq("event_id", eventId)
      .eq("user_id", userId)
      .order("check_in", { ascending: true }),
    supabase
      .from("expenses")
      .select("*")
      .eq("event_id", eventId)
      .eq("user_id", userId)
      .order("incurred_on", { ascending: true }),
  ]);

  const bookings = (bookingsResult.data ?? []) as BookingRow[];
  const expenses = (expensesResult.data ?? []) as ExpenseRow[];

  return {
    event: event as EventRow,
    venue: (venueResult.data ?? null) as VenueRow | null,
    promoter: (promoterResult.data ?? null) as ContactRow | null,
    bookings,
    expenses,
    finance: rollUp(event as EventRow, bookings, expenses),
  };
}

/**
 * Fee in, costs out, net.
 *
 * Costs come from CONFIRMED bookings plus ledger rows. Cancelled bookings are
 * excluded, and `option` bookings are too — a hotel you are merely considering
 * should not make a gig look unprofitable.
 *
 * A booking that already has a linked expense row is counted ONCE, from the
 * ledger, since expenses.booking_id is the authoritative link (migration 007
 * enforces one expense per booking).
 */
export function rollUp(
  event: EventRow,
  bookings: BookingRow[],
  expenses: ExpenseRow[]
): GigBundle["finance"] {
  const ledgerBookingIds = new Set(
    expenses.map((e) => e.booking_id).filter((id): id is string => Boolean(id))
  );

  const bookingCosts = bookings
    .filter((b) => b.status === "confirmed" && !ledgerBookingIds.has(b.id))
    .reduce((sum, b) => sum + b.cost_cents, 0);

  // Ledger amounts are signed: negative = money out.
  const ledgerOut = expenses
    .filter((e) => e.amount_cents < 0)
    .reduce((sum, e) => sum + Math.abs(e.amount_cents), 0);
  const ledgerIn = expenses
    .filter((e) => e.amount_cents > 0 && e.kind !== "fee_in")
    .reduce((sum, e) => sum + e.amount_cents, 0);

  const feeCents = event.fee_cents + ledgerIn;
  const costCents = bookingCosts + ledgerOut;

  return {
    feeCents,
    costCents,
    netCents: feeCents - costCents,
    currency: event.currency || "EUR",
  };
}

// formatMoney deliberately lives in lib/money.ts, not here: this module is
// server-only, and Client Components need the formatter.
