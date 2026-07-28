/**
 * /api/events — list and create calendar events.
 *
 * Security (CONVENTIONS.md §1):
 * - Session validated server-side before any Supabase access.
 * - Supabase queried as the authenticated user (anon key + minted Supabase
 *   JWT), so the owner-only RLS policies in migration 006 are what actually
 *   enforce isolation. The .eq("user_id", …) filters below are a second layer,
 *   not the primary control.
 * - Zod-validated input; unknown fields are stripped by the schema.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CreateEventSchema, ListEventsQuerySchema } from "@/lib/events-schema";
import type { EventRow } from "@/types/supabase";

/**
 * GET /api/events?from=<iso>&to=<iso>
 *
 * Returns the caller's events, optionally windowed. The calendar fetches one
 * month at a time rather than the whole history, so an artist with years of
 * gigs still gets a fast first paint.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = ListEventsQuerySchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid range", detail: parsed.error.flatten() },
      { status: 422 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  let query = supabase
    .from("events")
    .select("*")
    .eq("user_id", session.user.id)
    .order("starts_at", { ascending: true });

  if (parsed.data.from) query = query.gte("starts_at", parsed.data.from);
  if (parsed.data.to) query = query.lt("starts_at", parsed.data.to);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json(
      { error: "Failed to load events", detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ events: (data ?? []) as EventRow[] });
}

/**
 * POST /api/events — create an event.
 *
 * user_id is taken from the SESSION, never from the request body. Trusting a
 * client-supplied user_id would let anyone write into another artist's
 * calendar; RLS would reject it, but only because the session JWT disagrees —
 * better not to offer the field at all.
 */
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

  const parsed = CreateEventSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 422 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const { data, error } = await supabase
    .from("events")
    .insert({ ...parsed.data, user_id: session.user.id })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to create event", detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data as EventRow, { status: 201 });
}
