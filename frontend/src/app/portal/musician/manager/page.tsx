/**
 * Personal Manager — Server Component shell.
 *
 * Loads two windows server-side so the first paint is real data rather than a
 * spinner:
 *   * a broad timeline window (recent past → next year) for the timeline, the
 *     map and the command palette;
 *   * the current month for the calendar view.
 *
 * Both reads run as the authenticated user, so the owner-only RLS policies from
 * migrations 006/007 are what actually enforce isolation.
 */
export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Compass, Music2 } from "lucide-react";

import { auth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadTimeline } from "@/lib/manager-data";
import { startOfMonth, startOfNextMonth } from "@/lib/calendar";
import type { EventRow } from "@/types/supabase";
import type { TimelineItem } from "@/components/manager/Timeline";
import ManagerShell from "./ManagerShell";

/** Recent past stays visible so unsettled shows can still be chased. */
const TIMELINE_PAST_DAYS = 45;
const TIMELINE_FUTURE_DAYS = 365;

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

  if (error) {
    console.error("[manager] initial month load failed:", error.message);
    return [];
  }
  return (data ?? []) as EventRow[];
}

export default async function ManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin?callbackUrl=/portal/musician/manager");
  }

  const { new: openNew } = await searchParams;

  const now = Date.now();
  const from = new Date(now - TIMELINE_PAST_DAYS * 86_400_000).toISOString();
  const to = new Date(now + TIMELINE_FUTURE_DAYS * 86_400_000).toISOString();

  const [timeline, monthEvents] = await Promise.all([
    loadTimeline(session.user.id, { from, to, limit: 300 }),
    loadCurrentMonth(session.user.id),
  ]);

  return (
    <main className="min-h-screen bg-background">
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
          <span className="hidden sm:inline">Opportunities</span>
        </Link>
      </header>

      <div className="max-w-6xl mx-auto px-6 pb-16 pt-4">
        <div className="mb-7 animate-fade-up">
          <div className="u-label text-muted-foreground mb-3">Personal manager</div>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-foreground">
            Everything, <span className="text-chimera-clay">in one place.</span>
          </h1>
        </div>

        <ManagerShell
          initialTimeline={timeline as unknown as TimelineItem[]}
          initialMonthEvents={monthEvents}
          openNew={openNew === "1"}
        />
      </div>
    </main>
  );
}
