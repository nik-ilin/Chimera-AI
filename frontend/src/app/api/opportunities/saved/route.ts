/**
 * /api/opportunities/saved — list, save, and unsave opportunities.
 *
 * Persisted to saved_opportunities (migration 006) with owner-only RLS on
 * next_auth.uid(), exactly like events. user_id always comes from the session,
 * never the body.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type { SavedOpportunityRow } from "@/types/supabase";

const SaveSchema = z.object({
  source: z.string().max(40).default("mock"),
  source_id: z.string().min(1).max(200),
  name: z.string().min(1).max(300),
  // The normalised Opportunity object, stored as JSONB so an upstream API
  // shape change doesn't require a migration.
  payload: z.record(z.string(), z.unknown()).default({}),
  fit_score: z.number().int().min(0).max(100).default(0),
  fit_reason: z.string().max(1000).default(""),
  draft_message: z.string().max(4000).default(""),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceClient() as any;
  const { data, error } = await supabase
    .from("saved_opportunities")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load saved opportunities", detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ saved: (data ?? []) as SavedOpportunityRow[] });
}

/**
 * POST — save (or re-save) an opportunity.
 *
 * Upsert on the (user_id, source, source_id) unique constraint, so saving the
 * same venue twice updates the stored draft rather than 409-ing. Re-saving
 * after generating a message is the normal flow, so that has to be graceful.
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

  const parsed = SaveSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", detail: parsed.error.flatten() },
      { status: 422 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceClient() as any;
  const { data, error } = await supabase
    .from("saved_opportunities")
    .upsert(
      { ...parsed.data, user_id: session.user.id, updated_at: new Date().toISOString() },
      { onConflict: "user_id,source,source_id" }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to save opportunity", detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data as SavedOpportunityRow, { status: 201 });
}

const DeleteSchema = z.object({
  source: z.string().max(40),
  source_id: z.string().min(1).max(200),
});

/** DELETE — unsave. Identified by (source, source_id), scoped to the caller. */
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const parsed = DeleteSchema.safeParse({
    source: url.searchParams.get("source") ?? "",
    source_id: url.searchParams.get("source_id") ?? "",
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Missing source or source_id" }, { status: 422 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = createServiceClient() as any;
  const { error } = await supabase
    .from("saved_opportunities")
    .delete()
    .eq("user_id", session.user.id)
    .eq("source", parsed.data.source)
    .eq("source_id", parsed.data.source_id);

  if (error) {
    return NextResponse.json(
      { error: "Failed to remove opportunity", detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
