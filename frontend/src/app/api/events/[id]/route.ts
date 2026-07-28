/**
 * /api/events/[id] — update and delete a single calendar event.
 *
 * Ownership is enforced by the RLS policies from migration 006: a PATCH or
 * DELETE naming another user's event id matches zero rows and returns 404
 * rather than touching it. The explicit .eq("user_id", …) below makes that
 * intent visible in the query and keeps the behaviour correct even if RLS were
 * ever misconfigured.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { UpdateEventSchema } from "@/lib/events-schema";
import type { EventRow } from "@/types/supabase";

/** Reject malformed ids before they reach Postgres, which 500s on a bad uuid. */
const IdSchema = z.string().uuid("Not a valid event id.");

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

  const parsed = UpdateEventSchema.safeParse(raw);
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
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", session.user.id)
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to update event", detail: error.message },
      { status: 500 }
    );
  }
  // No row matched: either the id doesn't exist or it belongs to someone else.
  // Both return 404 — distinguishing them would confirm the existence of
  // another user's event.
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data as EventRow);
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  // .select() so we can tell "deleted" from "matched nothing" — a bare delete
  // reports success either way, which would let the UI drop an event it never
  // actually removed.
  const { data, error } = await supabase
    .from("events")
    .delete()
    .eq("id", id)
    .eq("user_id", session.user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to delete event", detail: error.message },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, id });
}
