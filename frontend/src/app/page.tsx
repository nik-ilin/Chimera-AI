/**
 * Landing page — Server Component.
 *
 * Shows the product hero + three creator-type cards.
 * Musician card links to /onboarding.
 * Influencer and Video Creator cards are visually stubbed (locked).
 *
 * Unauthenticated users see this page; the middleware allows it.
 */
import Link from "next/link";
export const dynamic = "force-dynamic";

import { auth } from "@/lib/auth";
import { Music2, Users, Video, Lock } from "lucide-react";

export default async function LandingPage() {
  const session = await auth();

  return (
    <main className="min-h-screen bg-background flex flex-col">
      {/* Nav */}
      <nav className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-chimera-purple flex items-center justify-center">
            <span className="text-white font-bold text-sm">C</span>
          </div>
          <span className="font-semibold text-foreground text-lg">Chimera</span>
        </div>
        <div>
          {session?.user ? (
            <Link
              href="/portal/musician"
              className="text-sm bg-primary text-primary-foreground px-4 py-2 rounded-md hover:opacity-90 transition-opacity"
            >
              Go to Portal
            </Link>
          ) : (
            <Link
              href="/auth/signin"
              className="text-sm bg-primary text-primary-foreground px-4 py-2 rounded-md hover:opacity-90 transition-opacity"
            >
              Sign In
            </Link>
          )}
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 py-24 text-center max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 bg-chimera-purple-muted text-chimera-purple text-xs font-medium px-3 py-1 rounded-full mb-6">
          IBM AI Builders Challenge
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold text-foreground tracking-tight mb-4">
          Your AI-powered{" "}
          <span className="text-chimera-purple">record label</span>
        </h1>
        <p className="text-muted-foreground text-lg mb-10 max-w-xl">
          Chimera gives every creator the tools of a major label — personal
          manager, visual design, copywriting, and ghostwriting — powered by IBM
          Granite.
        </p>

        {/* Creator-type cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl">
          {/* Musician — active */}
          <Link
            href={session?.user ? "/portal/musician" : "/auth/signin"}
            className="group border border-chimera-purple/30 rounded-xl p-6 bg-chimera-purple-muted/40 hover:bg-chimera-purple-muted transition-colors text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-chimera-purple/10 flex items-center justify-center mb-3 group-hover:bg-chimera-purple/20 transition-colors">
              <Music2 className="w-5 h-5 text-chimera-purple" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">Musician</h3>
            <p className="text-xs text-muted-foreground">
              Manager, visuals, captions, and lyric ghostwriting.
            </p>
            <div className="mt-3 text-xs font-medium text-chimera-purple">
              Available now →
            </div>
          </Link>

          {/* Influencer — stubbed */}
          <div className="relative border border-border rounded-xl p-6 bg-muted/30 text-left opacity-60 cursor-not-allowed select-none">
            <Lock className="absolute top-3 right-3 w-3.5 h-3.5 text-muted-foreground" />
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mb-3">
              <Users className="w-5 h-5 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">Influencer</h3>
            <p className="text-xs text-muted-foreground">
              Brand deals, content calendar, and trend analysis.
            </p>
            <div className="mt-3 text-xs text-muted-foreground">
              Coming soon
            </div>
          </div>

          {/* Video Creator — stubbed */}
          <div className="relative border border-border rounded-xl p-6 bg-muted/30 text-left opacity-60 cursor-not-allowed select-none">
            <Lock className="absolute top-3 right-3 w-3.5 h-3.5 text-muted-foreground" />
            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mb-3">
              <Video className="w-5 h-5 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">
              Video Creator
            </h3>
            <p className="text-xs text-muted-foreground">
              Script writing, thumbnail briefs, and channel strategy.
            </p>
            <div className="mt-3 text-xs text-muted-foreground">
              Coming soon
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
