/**
 * Personal Manager — Server Component shell.
 *
 * Auth guard, then a server-side fetch of the CURRENT month's events so the
 * calendar paints with real data on first render instead of flashing an empty
 * grid. Subsequent months are fetched by the client as the user navigates.
 *
 * The Supabase query runs as the authenticated user (anon key + minted JWT), so
 * the owner-only RLS policies from migration 006 apply here exactly as they do
 * in the Route Handlers.
 */
export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Music2, Compass } from "lucide-react";

import { auth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { startOfMonth, startOfNextMonth } from "@/lib/calendar";
import type { EventRow } from "@/types/supabase";
import CalendarClient from "./CalendarClient";

async function loadCurrentMonth(userId: string): Promise<EventRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = (await createClient()) as any;
  const now = new Date();

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("user_id", userId)
    .gte("starts_at", startOfMonth(now).toISOString())
    .lt("starts_at", startOfNextMonth(now).toISOString())
    .order("starts_at", { ascending: true });

  // A read failure here must not blank the whole page — the client refetches on
  // the first month change and surfaces its own error state.
  if (error) {
    console.error("[manager] initial events load failed:", error.message);
    return [];
  }
  return (data ?? []) as EventRow[];
}

export default async function ManagerPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin?callbackUrl=/portal/musician/manager");
  }

  const events = await loadCurrentMonth(session.user.id);

  return (
    <main className="min-h-screen bg-background">
      {/* ── Top bar ── */}
      <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/portal/musician"
            aria-label="Back to portal"
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

        <Link
          href="/portal/musician/manager/opportunities"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-pill border border-border px-3.5 py-1.5 hover:bg-card"
        >
          <Compass className="w-3.5 h-3.5" />
          Opportunities
        </Link>
      </header>

      <div className="max-w-6xl mx-auto px-6 pb-16 pt-4">
        {/* Intro */}
        <div className="mb-8 animate-fade-up">
          <div className="u-label text-muted-foreground mb-3">Personal manager</div>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-foreground">
            Your <span className="text-chimera-clay">calendar.</span>
          </h1>
          <p className="text-muted-foreground text-sm mt-3 max-w-md leading-relaxed">
            Gigs, releases, rehearsals and deadlines in one place.
          </p>
        </div>

        <CalendarClient initialEvents={events} />
      </div>
    </main>
  );
}
