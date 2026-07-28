/**
 * Gig hub — Server Component shell.
 *
 * Loads the whole bundle (event + venue + promoter + bookings + expenses + P&L)
 * in one place so the page paints complete. notFound() covers both a missing id
 * and someone else's gig — loadGig filters by user_id, so there is no way to
 * probe for another user's rows.
 */
export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Clock, MapPin, Music2 } from "lucide-react";

import { auth } from "@/lib/auth";
import { loadGig } from "@/lib/manager-data";
import { EVENT_TYPE_META } from "@/lib/events-schema";
import GigHubClient from "./GigHubClient";

export default async function GigPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin?callbackUrl=/portal/musician/manager");
  }

  const { id } = await params;
  const bundle = await loadGig(session.user.id, id);
  if (!bundle) notFound();

  const { event } = bundle;
  const meta = EVENT_TYPE_META[event.event_type];
  const when = new Date(event.starts_at);

  return (
    <main className="min-h-screen bg-background">
      <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/portal/musician/manager"
            aria-label="Back to manager"
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

      <div className="max-w-6xl mx-auto px-6 pb-16 pt-4">
        <div className="mb-7 animate-fade-up">
          <div className="u-label text-muted-foreground mb-3 flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
            {meta.label}
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-foreground">
            {event.title}
          </h1>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {when.toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
              {!event.all_day &&
                ` · ${when.toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}`}
            </span>
            {event.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5" />
                {event.location}
              </span>
            )}
          </div>
        </div>

        <GigHubClient
          event={bundle.event}
          venue={bundle.venue}
          promoter={bundle.promoter}
          bookings={bundle.bookings}
          expenses={bundle.expenses}
          finance={bundle.finance}
        />
      </div>
    </main>
  );
}
