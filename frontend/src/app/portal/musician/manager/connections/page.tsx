/**
 * Connect a service — Server Component shell.
 *
 * Auth guard, then hands the OAuth callback's ?connected= / ?error= flash to
 * the client so the user gets a readable outcome instead of a bare redirect.
 */
export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Music2, Plug } from "lucide-react";

import { auth } from "@/lib/auth";
import ConnectionsClient from "./ConnectionsClient";

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/auth/signin?callbackUrl=/portal/musician/manager/connections");
  }

  const { connected, error } = await searchParams;

  return (
    <main className="min-h-screen bg-background">
      <header className="max-w-4xl mx-auto px-6 py-5 flex items-center justify-between">
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

      <div className="max-w-4xl mx-auto px-6 pb-16 pt-4">
        <div className="mb-8 animate-fade-up">
          <div className="u-label text-muted-foreground mb-3 flex items-center gap-1.5">
            <Plug className="w-3 h-3" />
            Integrations
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-foreground">
            Connect a <span className="text-chimera-clay">service.</span>
          </h1>
          <p className="text-muted-foreground text-sm mt-3 max-w-lg leading-relaxed">
            Chimera pulls your calendars into one canonical timeline. Everything
            it imports becomes a real entity you can attach venues, bookings and
            costs to — not a read-only mirror.
          </p>
        </div>

        <ConnectionsClient flash={{ connected, error }} />
      </div>
    </main>
  );
}
