/**
 * Booking → expense bridge.  SERVER ONLY.
 *
 * Lives here rather than in the route file because a Next.js Route Handler may
 * only export HTTP verbs and a small set of config fields — exporting a helper
 * from one is a build error, and the two booking routes both need this.
 */
import "server-only";

import type { BookingRow } from "@/types/supabase";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Keep the expense ledger in step with a booking.
 *
 * Only CONFIRMED bookings with a cost produce a ledger row — an option the user
 * is still comparing must not drag the gig's P&L down. Any other state removes
 * the row, so cancelling a hotel cleans up after itself and the net figure
 * stays honest.
 *
 * Upsert on booking_id (UNIQUE in migration 007) makes this idempotent: editing
 * a booking updates its expense instead of stacking duplicates, and re-running
 * after a retry is harmless.
 *
 * @param supabase An RLS-scoped client for the calling user.
 */
export async function syncExpense(
  supabase: any,
  userId: string,
  booking: BookingRow
): Promise<void> {
  const shouldHaveExpense = booking.status === "confirmed" && booking.cost_cents > 0;

  if (!shouldHaveExpense) {
    await supabase
      .from("expenses")
      .delete()
      .eq("booking_id", booking.id)
      .eq("user_id", userId);
    return;
  }

  const kind = booking.kind === "travel" ? "travel" : "accommodation";
  // Date the cost to check-in when we have it; otherwise today.
  const incurredOn = (booking.check_in ?? new Date().toISOString()).slice(0, 10);

  await supabase.from("expenses").upsert(
    {
      user_id: userId,
      event_id: booking.event_id,
      booking_id: booking.id,
      kind,
      description: booking.name,
      // Negative = money out. One signed column keeps P&L a plain SUM().
      amount_cents: -Math.abs(booking.cost_cents),
      currency: booking.currency,
      incurred_on: incurredOn,
    },
    { onConflict: "booking_id" }
  );
}
