/**
 * Ghostwriting — Server Component wrapper.
 *
 * Auth-guards the route, loads the creator profile (CreatorContext) under RLS,
 * and renders the chat client. AI calls go through /api/ai/ghostwrite
 * (Route Handler, server-side token). Multi-turn memory lives in the backend
 * lyric_sessions table, keyed by the session_id the client carries.
 */
export const dynamic = "force-dynamic";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import GhostwriteClient from "./GhostwriteClient";

export default async function GhostwritePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin?callbackUrl=/portal/musician/ghostwrite");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const { data: profile } = await supabase
    .from("user_profile")
    .select("*")
    .eq("user_id", session.user.id)
    .single();

  // Shape must match the creator_context Zod schema in /api/ai/ghostwrite.
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
    <main className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border px-6 py-4 flex items-center gap-3">
        <Link
          href="/portal/musician"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Portal
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm font-medium text-foreground">Ghostwriting</span>
      </header>
      <GhostwriteClient
        profileContext={profileContext}
        defaultGenre={profile?.genre || "pop"}
      />
    </main>
  );
}
