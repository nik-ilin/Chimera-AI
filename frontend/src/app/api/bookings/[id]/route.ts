/**
 * /api/bookings/[id] — update or remove one booking.
 *
 * Every mutation re-syncs the linked expense row, so confirming, re-pricing or
 * cancelling a booking keeps the gig P&L correct without manual bookkeeping.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { syncExpense } from "@/lib/bookings";
import type { BookingRow } from "@/types/supabase";

/* eslint-disable @typescript-eslint/no-explicit-any */

const IdSchema = z.string().uuid();

const isoish = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Must be a valid date-time.");

const UpdateBookingSchema = z
  .object({
    event_id: z.string().uuid().nullable().optional(),
    kind: z.enum(["accommodation", "travel", "backline", "other"]).optional(),
    status: z.enum(["option", "confirmed", "cancelled"]).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    address: z.string().trim().max(300).optional(),
    check_in: isoish.nullable().optional(),
    check_out: isoish.nullable().optional(),
    reference: z.string().trim().max(120).optional(),
    cost_cents: z.number().int().min(0).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No fields to update.");

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = UpdateBookingSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const supabase = (await createClient()) as any;
  const { data, error } = await supabase
    .from("bookings")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", session.user.id)
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to update booking", detail: error.message },
      { status: 500 }
    );
  }
  // 404 for both "missing" and "someone else's" — distinguishing them would
  // confirm another user's row exists.
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const booking = data as BookingRow;
  await syncExpense(supabase, session.user.id, booking);
  return NextResponse.json(booking);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = (await createClient()) as any;
  // The expense row cascades via booking_id ON DELETE CASCADE (migration 007),
  // so there is nothing to clean up here.
  const { data, error } = await supabase
    .from("bookings")
    .delete()
    .eq("id", id)
    .eq("user_id", session.user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to delete booking", detail: error.message },
      { status: 500 }
    );
  }
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true, id });
}
