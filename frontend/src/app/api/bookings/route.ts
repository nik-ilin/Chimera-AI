/**
 * /api/bookings — accommodation and travel attached to a gig.
 *
 * This is the entity that makes "book a hotel → it shows up inside the gig"
 * literal: a booking always carries an event_id, so the gig hub can render it
 * without any join table.
 *
 * Confirming a booking also writes an expense row, so the P&L stays correct
 * without the user doing double entry. See syncExpense below.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { syncExpense } from "@/lib/bookings";
import type { BookingRow } from "@/types/supabase";

/* eslint-disable @typescript-eslint/no-explicit-any */

const isoish = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "Must be a valid date-time.");

const CreateBookingSchema = z
  .object({
    event_id: z.string().uuid().nullable().default(null),
    kind: z.enum(["accommodation", "travel", "backline", "other"]).default("accommodation"),
    status: z.enum(["option", "confirmed", "cancelled"]).default("option"),
    name: z.string().trim().min(1, "Give the booking a name.").max(200),
    address: z.string().trim().max(300).default(""),
    lat: z.number().nullable().default(null),
    lon: z.number().nullable().default(null),
    check_in: isoish.nullable().default(null),
    check_out: isoish.nullable().default(null),
    reference: z.string().trim().max(120).default(""),
    cost_cents: z.number().int().min(0).default(0),
    currency: z.string().length(3).default("EUR"),
    url: z.string().max(500).default(""),
    notes: z.string().trim().max(2000).default(""),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .refine(
    (v) => !v.check_in || !v.check_out || Date.parse(v.check_out) >= Date.parse(v.check_in),
    { path: ["check_out"], message: "Check-out must be after check-in." }
  );

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const eventId = new URL(request.url).searchParams.get("event_id");
  const supabase = createServiceClient() as any;

  let query = supabase
    .from("bookings")
    .select("*")
    .eq("user_id", session.user.id)
    .order("check_in", { ascending: true });
  if (eventId) query = query.eq("event_id", eventId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Failed to load bookings", detail: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ bookings: (data ?? []) as BookingRow[] });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateBookingSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const supabase = createServiceClient() as any;
  const { data, error } = await supabase
    .from("bookings")
    .insert({ ...parsed.data, user_id: session.user.id })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to create booking", detail: error.message },
      { status: 500 }
    );
  }

  const booking = data as BookingRow;
  await syncExpense(supabase, session.user.id, booking);
  return NextResponse.json(booking, { status: 201 });
}
