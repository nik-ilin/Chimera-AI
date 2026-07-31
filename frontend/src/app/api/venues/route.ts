/**
 * /api/venues — canonical venues.
 *
 * Created inline from the gig hub ("add a venue to this gig"), so POST
 * optionally attaches the new venue to an event in the same request. Two round
 * trips for one user action is exactly the kind of latency that makes an app
 * feel sluggish.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type { VenueRow } from "@/types/supabase";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CreateVenueSchema = z.object({
  name: z.string().trim().min(1, "Give the venue a name.").max(200),
  address: z.string().trim().max(300).default(""),
  city: z.string().trim().max(100).default(""),
  country: z.string().trim().max(100).default(""),
  lat: z.number().min(-90).max(90).nullable().default(null),
  lon: z.number().min(-180).max(180).nullable().default(null),
  capacity: z.number().int().min(0).max(500000).nullable().default(null),
  website: z.string().max(500).default(""),
  notes: z.string().trim().max(2000).default(""),
  /** When present, the new venue is attached to this gig immediately. */
  attach_to_event_id: z.string().uuid().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient() as any;
  const { data, error } = await supabase
    .from("venues")
    .select("*")
    .eq("user_id", session.user.id)
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load venues", detail: error.message },
      { status: 500 }
    );
  }
  return NextResponse.json({ venues: (data ?? []) as VenueRow[] });
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

  const parsed = CreateVenueSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  const { attach_to_event_id: attachTo, ...venue } = parsed.data;
  const supabase = createServiceClient() as any;

  const { data, error } = await supabase
    .from("venues")
    .insert({ ...venue, user_id: session.user.id })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to create venue", detail: error.message },
      { status: 500 }
    );
  }

  if (attachTo) {
    // Scoped to the caller: RLS would reject someone else's event anyway, but
    // the explicit filter keeps the intent visible.
    await supabase
      .from("events")
      .update({ venue_id: (data as VenueRow).id })
      .eq("id", attachTo)
      .eq("user_id", session.user.id);
  }

  return NextResponse.json(data as VenueRow, { status: 201 });
}
