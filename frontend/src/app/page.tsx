/**
 * Landing page — Server Component.
 *
 * Editorial vintage-magazine hero, art-directed parallax image spread, a
 * seamless marquee, and scroll-revealed creator cards. Auth check + links
 * unchanged from Stage A. Presentation/motion only.
 */
import Link from "next/link";
export const dynamic = "force-dynamic";

import { auth } from "@/lib/auth";
import { Music2, Users, Video, Lock, ArrowUpRight } from "lucide-react";
import ImagePlaceholder from "@/components/ImagePlaceholder";
import Reveal from "@/components/motion/Reveal";
import Parallax from "@/components/motion/Parallax";
import Magnetic from "@/components/motion/Magnetic";
import Marquee from "@/components/motion/Marquee";

export default async function LandingPage() {
  const session = await auth();

  return (
    <main className="min-h-screen">
      {/* ── Nav ── */}
      <nav className="max-w-6xl w-full mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-chimera-clay flex items-center justify-center">
            <span className="text-chimera-cream font-bold text-sm">C</span>
          </div>
          <span className="font-editorial text-xl tracking-tight text-foreground">Chimera</span>
        </div>
        <Magnetic strength={0.35}>
          <Link
            href={session?.user ? "/portal/musician" : "/auth/signin"}
            className="text-sm bg-foreground text-background px-4 py-2 rounded-pill hover:opacity-90 transition-opacity"
          >
            {session?.user ? "Go to Portal" : "Sign In"}
          </Link>
        </Magnetic>
      </nav>

      {/* ── Hero ── */}
      <section className="max-w-6xl w-full mx-auto px-6 pt-8 pb-14 grid lg:grid-cols-[1.1fr_0.9fr] gap-10 items-center">
        <div>
          <Reveal>
            <div className="u-label text-chimera-clay mb-6">(01) — an AI record label</div>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="font-editorial text-6xl sm:text-7xl xl:text-8xl leading-[0.92] tracking-tight text-foreground mb-6">
              Your AI-powered
              <br />
              <span className="italic font-light text-chimera-clay">record label.</span>
            </h1>
          </Reveal>
          <Reveal delay={160}>
            <p className="text-muted-foreground text-lg mb-8 max-w-md leading-relaxed">
              Every creator gets the tools of a major label — personal manager,
              visual design, copywriting, and ghostwriting.
            </p>
          </Reveal>
          <Reveal delay={220}>
            <Magnetic strength={0.3}>
              <Link
                href={session?.user ? "/onboarding" : "/auth/signin"}
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-pill bg-chimera-clay text-chimera-cream text-sm font-medium transition-all hover:brightness-110 active:scale-[0.98]"
              >
                {session?.user ? "Enter the studio" : "Get started"}
                <ArrowUpRight className="w-4 h-4" />
              </Link>
            </Magnetic>
          </Reveal>
          <Reveal delay={300}>
            <div className="flex flex-wrap gap-x-6 gap-y-2 mt-10 u-coord">
              <span>EST · MMXXVI</span>
              <span>COLLECTION — I</span>
              <span>POWERED BY IBM WATSONX</span>
            </div>
          </Reveal>
        </div>

        {/* Art-directed parallax spread */}
        <div className="relative h-[420px] sm:h-[520px] lg:h-[560px]">
          <Parallax speed={0.08} className="absolute right-0 top-2 w-[68%] z-10">
            <Reveal scale>
              <ImagePlaceholder
                id="landing-hero"
                aspect="4/5"
                note="Abstract editorial artwork — AI-native record label, chromatic ink bloom on warm paper"
                rounded="rounded-widget-lg"
                className="shadow-widget-lg rotate-[2deg]"
                src="/images/landing-hero.jpeg"
              />
            </Reveal>
          </Parallax>
          <Parallax speed={0.2} className="absolute left-0 bottom-4 w-[46%] z-20">
            <Reveal scale delay={140}>
              <ImagePlaceholder
                id="landing-detail"
                aspect="1/1"
                note="Close-up detail crop — grain, warm light, texture"
                rounded="rounded-widget"
                className="shadow-widget-lg -rotate-[3deg]"
                src="/images/landing-detail.jpeg"
              />
            </Reveal>
          </Parallax>
          <div className="absolute left-2 top-6 u-coord rotate-[-90deg] origin-left tracking-[0.3em] hidden lg:block">
            FIG. 01
          </div>
        </div>
      </section>

      {/* ── Marquee ── */}
      <div className="border-y border-border/60 py-5 my-4">
        <Marquee
          items={["Personal Manager", "Visual Design", "Post Writing", "Ghostwriting", "watsonx · Granite"]}
        />
      </div>

      {/* ── Creator-type cards ── */}
      <section className="max-w-6xl w-full mx-auto px-6 py-20">
        <Reveal>
          <div className="u-label text-muted-foreground mb-6">(02) — choose your lane</div>
        </Reveal>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Reveal delay={0}>
            <Link
              href={session?.user ? "/onboarding" : "/auth/signin"}
              className="group widget p-6 h-full block text-left transition-all duration-500 ease-smooth hover:shadow-widget-lg hover:-translate-y-1"
            >
              <div className="w-11 h-11 rounded-2xl bg-chimera-clay/10 flex items-center justify-center mb-4 transition-transform duration-500 ease-spring group-hover:scale-110 group-hover:rotate-6">
                <Music2 className="w-5 h-5 text-chimera-clay" />
              </div>
              <h3 className="font-editorial text-xl text-foreground mb-1">Musician</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Manager, visuals, captions, and lyric ghostwriting.
              </p>
              <div className="mt-4 inline-flex items-center gap-1.5 u-label text-chimera-clay">
                Available now
                <ArrowUpRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
            </Link>
          </Reveal>

          {[
            { icon: Users, title: "Influencer", desc: "Brand deals, content calendar, and trend analysis." },
            { icon: Video, title: "Video Creator", desc: "Script writing, thumbnail briefs, and channel strategy." },
          ].map((c, i) => {
            const Icon = c.icon;
            return (
              <Reveal key={c.title} delay={80 + i * 80}>
                <div className="relative rounded-widget border border-dashed border-border p-6 h-full bg-card/40 text-left">
                  <Lock className="absolute top-4 right-4 w-3.5 h-3.5 text-muted-foreground" />
                  <div className="w-11 h-11 rounded-2xl bg-muted flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <h3 className="font-editorial text-xl text-foreground mb-1">{c.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{c.desc}</p>
                  <div className="mt-4 u-label text-muted-foreground/60">Coming soon</div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* ── Footer band ── */}
      <footer className="max-w-6xl w-full mx-auto px-6 pb-12">
        <Reveal>
          <div className="relative overflow-hidden rounded-widget-lg">
            <ImagePlaceholder
              id="landing-texture"
              aspect="16/6"
              note="Soft grain/gradient texture strip, cream→clay tones"
              rounded="rounded-widget-lg"
              src="/images/landing-texture.jpeg"
            />
            <div className="absolute inset-0 flex items-end justify-between p-6">
              <span className="font-editorial text-2xl text-foreground/70">Chimera</span>
              <span className="u-coord">MMXXVI — WATSONX · GRANITE</span>
            </div>
          </div>
        </Reveal>
      </footer>
    </main>
  );
}
