/**
 * GET /api/profile
 *
 * Returns the authenticated user's creator profile (user_profile row).
 * Creates a default profile row if one doesn't exist yet.
 *
 * Security (CONVENTIONS.md §1):
 * - Session validated server-side before any Supabase access.
 * - Supabase query runs as the authenticated user (anon key + session cookie).
 * - RLS ensures the user can only see their own row.
 */
import { NextResponse } from "next/server";

// This route reads auth sessions and Supabase — must be dynamic.
export const dynamic = "force-dynamic";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/supabase";

type UserProfileRow = Database["public"]["Tables"]["user_profile"]["Row"];
type UserProfileInsert = Database["public"]["Tables"]["user_profile"]["Insert"];

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createClient() as any;

  const { data, error } = await supabase
    .from("user_profile")
    .select("*")
    .eq("user_id", session.user.id)
    .single();

  if (error && error.code === "PGRST116") {
    // Row doesn't exist — create a default one
    const newProfile: UserProfileInsert = {
      user_id: session.user.id,
      artist_name: session.user.name ?? "",
      genre: "",
      city: "",
      brand_vibe: "",
      instagram_handle: null,
      tiktok_handle: null,
      recent_outputs: [],
      creator_type: null,
    };

    const { data: created, error: insertError } = await supabase
      .from("user_profile")
      .insert(newProfile)
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { error: "Failed to create profile", detail: insertError.message },
        { status: 500 }
      );
    }
    return NextResponse.json(created as UserProfileRow);
  }

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch profile", detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data as UserProfileRow);
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

const UpdateProfileSchema = z.object({
  artist_name: z.string().max(200).optional(),
  genre: z.string().max(100).optional(),
  city: z.string().max(100).optional(),
  brand_vibe: z.string().max(500).optional(),
  instagram_handle: z.string().max(100).nullable().optional(),
  tiktok_handle: z.string().max(100).nullable().optional(),
  creator_type: z
    .enum(["musician", "influencer", "video_creator"])
    .nullable()
    .optional(),
});

/**
 * PATCH /api/profile
 * Updates the authenticated user's creator profile.
 */
export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = UpdateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", detail: parsed.error.flatten() },
      { status: 422 }
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = await createClient() as any;

  const { data, error } = await supabase
    .from("user_profile")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("user_id", session.user.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Failed to update profile", detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data as UserProfileRow);
}
