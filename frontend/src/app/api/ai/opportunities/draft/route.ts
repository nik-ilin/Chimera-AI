/**
 * POST /api/ai/opportunities/draft
 *
 * Generates a booking-enquiry draft for one opportunity. The message is
 * returned to the USER to review, edit and send themselves — Chimera never
 * transmits it. There is deliberately no "send" endpoint anywhere in this app.
 *
 * Security: session-guarded, service token attached server-side, creator
 * context read from the caller's own profile rather than the request body.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * The opportunity is echoed back from the finder response rather than re-fetched
 * server-side. It is fully validated here, and it only ever feeds a prompt —
 * nothing is trusted for authorisation.
 */
const OpportunitySchema = z.object({
  source: z.string().max(40),
  source_id: z.string().max(200),
  name: z.string().max(300),
  kind: z.enum(["venue", "promoter", "festival", "agency"]).default("venue"),
  city: z.string().max(100).default(""),
  country: z.string().max(100).default(""),
  capacity: z.number().int().nullable().default(null),
  genres: z.array(z.string().max(80)).max(20).default([]),
  evidence: z.array(z.string().max(500)).max(10).default([]),
  upcoming_events: z.number().int().min(0).default(0),
  url: z.string().max(500).default(""),
  contact_hint: z.string().max(300).default(""),
});

const RequestSchema = z.object({
  opportunity: OpportunitySchema,
  notes: z.string().trim().max(500).default(""),
});

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

  const parsed = RequestSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", detail: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const fastapiUrl = process.env.FASTAPI_INTERNAL_URL;
  const serviceToken = process.env.CHIMERA_SERVICE_TOKEN;
  if (!fastapiUrl || !serviceToken) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: profile } = await supabase
    .from("user_profile")
    .select("artist_name, genre, city, brand_vibe, instagram_handle, tiktok_handle")
    .eq("user_id", session.user.id)
    .maybeSingle();

  let resp: Response;
  try {
    resp = await fetch(`${fastapiUrl}/api/opportunities/draft`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({
        creator_context: {
          artist_name: profile?.artist_name ?? "",
          genre: profile?.genre ?? "",
          city: profile?.city ?? "",
          brand_vibe: profile?.brand_vibe ?? "",
          instagram_handle: profile?.instagram_handle ?? null,
          tiktok_handle: profile?.tiktok_handle ?? null,
          recent_outputs: [],
        },
        opportunity: parsed.data.opportunity,
        notes: parsed.data.notes,
      }),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Could not reach AI service", detail: String(err) },
      { status: 502 }
    );
  }

  if (!resp.ok) {
    const errText = await resp.text();
    return NextResponse.json(
      { error: "AI service error", detail: errText },
      { status: resp.status }
    );
  }

  return NextResponse.json(await resp.json());
}
