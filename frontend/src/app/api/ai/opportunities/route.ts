/**
 * POST /api/ai/opportunities
 *
 * Route Handler: validates the session, loads the caller's creator profile,
 * attaches the service token, and proxies to FastAPI /api/opportunities.
 *
 * Security: the browser never calls FastAPI directly and never sees
 * CHIMERA_SERVICE_TOKEN. The creator context is read SERVER-SIDE from the
 * user's own profile row rather than accepted from the request body — a client
 * that could supply arbitrary context could make the ranker reason about
 * someone else's profile.
 */
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const RequestSchema = z.object({
  // Optional city override so the artist can scout a city they plan to tour.
  city: z.string().trim().max(100).optional(),
  size: z.number().int().min(1).max(20).default(8),
});

/**
 * Rough career level from the profile. The ranker uses it to avoid pointing an
 * artist with no following at 2000-capacity rooms.
 *
 * This is a placeholder heuristic: user_profile has no follower or fame column
 * yet, so everyone is currently "emerging". Replace once such a field exists —
 * see the TODO in the final report.
 */
function careerLevel(): string {
  return "emerging";
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
    // An empty body is legitimate here — it means "use my profile defaults".
    raw = {};
  }

  const parsed = RequestSchema.safeParse(raw ?? {});
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

  // ── Load the caller's own creator context (RLS-scoped) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: profile } = await supabase
    .from("user_profile")
    .select("artist_name, genre, city, brand_vibe, instagram_handle, tiktok_handle")
    .eq("user_id", session.user.id)
    .maybeSingle();

  const creatorContext = {
    artist_name: profile?.artist_name ?? "",
    genre: profile?.genre ?? "",
    city: profile?.city ?? "",
    brand_vibe: profile?.brand_vibe ?? "",
    instagram_handle: profile?.instagram_handle ?? null,
    tiktok_handle: profile?.tiktok_handle ?? null,
    recent_outputs: [],
  };

  let resp: Response;
  try {
    resp = await fetch(`${fastapiUrl}/api/opportunities`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({
        creator_context: creatorContext,
        city: parsed.data.city || null,
        career_level: careerLevel(),
        size: parsed.data.size,
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
