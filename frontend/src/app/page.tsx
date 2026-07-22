/**
 * Landing page — Server Component.
 *
 * Product hero + three creator-type cards. Musician card links to /onboarding.
 * Influencer and Video Creator are locked. Stage B: presentation restyled only;
 * auth check and links unchanged.
 */
import Link from "next/link";
export const dynamic = "force-dynamic";

import { auth } from "@/lib/auth";
import { Music2, Users, Video, Lock, ArrowUpRight } from "lucide-react";
import ImagePlaceholder from "@/components/ImagePlaceholder";

export default async function LandingPage() {
  const session = await auth();

  return (
    <main className="min-h-screen bg-background flex flex-col">
      {/* ── Nav ── */}
      <nav className="max-w-6xl w-full mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-chimera-clay flex items-center justify-center shadow-clay-glow">
            <span className="text-chimera-cream font-bold text-sm">C</span>
          </div>
          <span className="font-semibold text-foreground text-lg tracking-tight">Chimera</span>
        </div>
        <Link
          href={session?.user ? "/portal/musician" : "/auth/signin"}
          className="text-sm bg-foreground text-background px-4 py-2 rounded-pill hover:opacity-90 transition-opacity"
        >
          {session?.user ? "Go to Portal" : "Sign In"}
        </Link>
      </nav>

      {/* ── Hero ── */}
      <section className="max-w-6xl w-full mx-auto px-6 pt-10 pb-16 grid lg:grid-cols-2 gap-10 items-center">
        <div className="animate-fade-up">
          <div className="inline-flex items-center gap-2 u-label text-chimera-clay bg-chimera-clay-muted/60 px-3 py-1.5 rounded-pill mb-6">
            IBM AI Builders Challenge
          </div>
          <h1 className="font-display text-5xl sm:text-6xl font-semibold text-foreground tracking-tight leading-[0.98] mb-5">
            Your AI-powered
            <br />
            <span className="text-chimera-clay">record label.</span>
          </h1>
          <p className="text-muted-foreground text-lg mb-8 max-w-md leading-relaxed">
            Chimera gives every creator the tools of a major label — personal
            manager, visual design, copywriting, and ghostwriting.
          </p>
          <Link
            href={session?.user ? "/onboarding" : "/auth/signin"}
            className="inline-flex items-center gap-2 px-6 py-3.5 rounded-pill bg-chimera-clay text-chimera-cream text-sm font-medium shadow-clay-glow transition-all hover:brightness-105 active:scale-[0.98]"
          >
            {session?.user ? "Enter the studio" : "Get started"}
            <ArrowUpRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Hero art */}
        <div className="animate-fade-up" style={{ animationDelay: "100ms" }}>
          <ImagePlaceholder
            id="landing-hero"
            aspect="4/5"
            note="Abstract editorial artwork — AI-native record label, chromatic ink bloom on warm paper"
            rounded="rounded-widget-lg"
            className="shadow-widget-lg max-w-md ml-auto"
          />
        </div>
      </section>

      {/* ── Creator-type cards ── */}
      <section className="max-w-6xl w-full mx-auto px-6 pb-24">
        <div className="u-label text-muted-foreground mb-4">Choose your lane</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Musician — active */}
          <Link
            href={session?.user ? "/onboarding" : "/auth/signin"}
            className="group widget p-6 text-left transition-all duration-500 ease-smooth hover:shadow-widget-lg hover:-translate-y-0.5 animate-fade-up"
          >
            <div className="w-11 h-11 rounded-2xl bg-chimera-clay/10 flex items-center justify-center mb-4 group-hover:bg-chimera-clay/20 transition-colors">
              <Music2 className="w-5 h-5 text-chimera-clay" />
            </div>
            <h3 className="font-semibold text-foreground mb-1 tracking-tight">Musician</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Manager, visuals, captions, and lyric ghostwriting.
            </p>
            <div className="mt-4 inline-flex items-center gap-1.5 u-label text-chimera-clay">
              Available now
              <ArrowUpRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </div>
          </Link>

          {/* Influencer — stubbed */}
          <div className="relative rounded-widget border border-dashed border-border p-6 bg-card/40 text-left animate-fade-up" style={{ animationDelay: "70ms" }}>
            <Lock className="absolute top-4 right-4 w-3.5 h-3.5 text-muted-foreground" />
            <div className="w-11 h-11 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <Users className="w-5 h-5 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-foreground mb-1 tracking-tight">Influencer</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Brand deals, content calendar, and trend analysis.
            </p>
            <div className="mt-4 u-label text-muted-foreground/60">Coming soon</div>
          </div>

          {/* Video Creator — stubbed */}
          <div className="relative rounded-widget border border-dashed border-border p-6 bg-card/40 text-left animate-fade-up" style={{ animationDelay: "140ms" }}>
            <Lock className="absolute top-4 right-4 w-3.5 h-3.5 text-muted-foreground" />
            <div className="w-11 h-11 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <Video className="w-5 h-5 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-foreground mb-1 tracking-tight">Video Creator</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Script writing, thumbnail briefs, and channel strategy.
            </p>
            <div className="mt-4 u-label text-muted-foreground/60">Coming soon</div>
          </div>
        </div>
      </section>

      {/* ── Footer band ── */}
      <footer className="max-w-6xl w-full mx-auto px-6 pb-10">
        <div className="relative overflow-hidden rounded-widget-lg">
          <ImagePlaceholder
            id="landing-texture"
            aspect="16/6"
            note="Soft grain/gradient texture strip, cream→clay tones"
            rounded="rounded-widget-lg"
          />
          <div className="absolute inset-0 flex items-end p-6">
            <span className="u-label text-foreground/50">Chimera — powered by IBM watsonx</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
