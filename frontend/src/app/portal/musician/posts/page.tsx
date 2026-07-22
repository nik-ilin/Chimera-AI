/**
 * Post Writing — Server Component wrapper.
 *
 * Auth-guards the route, loads the user's creator profile (CreatorContext)
 * from Supabase under RLS, and renders the client form. All AI calls happen
 * in the client via the /api/ai/captions Route Handler (server-side token).
 *
 * CONVENTIONS.md §2: data reads in Server Components using the user session.
 */
export const dynamic = "force-dynamic";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import PostWritingClient from "./PostWritingClient";

export default async function PostWritingPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin?callbackUrl=/portal/musician/posts");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: profile } = await supabase
    .from("user_profile")
    .select("*")
    .eq("user_id", session.user.id)
    .single();

  // Shape must match the creator_context Zod schema in /api/ai/captions.
  const profileContext = {
    artist_name: profile?.artist_name ?? "",
    genre: profile?.genre ?? "",
    city: profile?.city ?? "",
    brand_vibe: profile?.brand_vibe ?? "",
    instagram_handle: profile?.instagram_handle ?? null,
    tiktok_handle: profile?.tiktok_handle ?? null,
    recent_outputs: profile?.recent_outputs ?? [],
  };

  return (
    <main className="min-h-screen bg-background">
      <header className="max-w-3xl mx-auto px-6 py-5 flex items-center gap-3">
        <Link
          href="/portal/musician"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-pill border border-border px-3 py-1.5 hover:bg-card"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Portal
        </Link>
        <span className="u-label text-chimera-clay">Post Writing</span>
      </header>
      <PostWritingClient profileContext={profileContext} />
    </main>
  );
}
