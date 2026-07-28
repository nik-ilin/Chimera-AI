/**
 * Opportunity finder — Server Component shell.
 *
 * Auth guard, then reads the caller's city (to seed the search) and their
 * already-saved bookmarks (so the Save buttons render in the right state on
 * first paint instead of flickering).
 *
 * Both reads run as the authenticated user under RLS.
 */
export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Compass, Music2 } from "lucide-react";

import { auth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import OpportunitiesClient from "./OpportunitiesClient";

export default async function OpportunitiesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin?callbackUrl=/portal/musician/manager/opportunities");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;

  const [{ data: profile }, { data: savedRows }] = await Promise.all([
    supabase
      .from("user_profile")
      .select("city")
      .eq("user_id", session.user.id)
      .maybeSingle(),
    supabase
      .from("saved_opportunities")
      .select("source, source_id")
      .eq("user_id", session.user.id),
  ]);

  return (
    <main className="min-h-screen bg-background">
      <header className="max-w-4xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/portal/musician/manager"
            aria-label="Back to calendar"
            className="w-9 h-9 rounded-xl flex items-center justify-center border border-border text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground tracking-tight">Chimera</span>
            <span className="text-foreground/25">/</span>
            <span className="u-label text-chimera-clay flex items-center gap-1.5">
              <Music2 className="w-3 h-3" />
              Manager
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 pb-16 pt-4">
        <div className="mb-8 animate-fade-up">
          <div className="u-label text-muted-foreground mb-3 flex items-center gap-1.5">
            <Compass className="w-3 h-3" />
            Opportunities
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-foreground">
            Where to <span className="text-chimera-clay">play next.</span>
          </h1>
          <p className="text-muted-foreground text-sm mt-3 max-w-lg leading-relaxed">
            Venues, promoters and festivals matched to your genre, city and career stage —
            with a draft enquiry you review and send yourself.
          </p>
        </div>

        <OpportunitiesClient
          defaultCity={profile?.city ?? ""}
          savedKeys={savedRows ?? []}
        />
      </div>
    </main>
  );
}
