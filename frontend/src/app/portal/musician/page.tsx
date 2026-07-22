/**
 * Musician portal dashboard — Server Component.
 *
 * Protected (requires auth). Calm dashboard composition: profile widget +
 * module widgets + a getting-started rail. Presentation only — auth/data flow
 * unchanged from Stage A.
 */
export const dynamic = "force-dynamic";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Music2, Calendar, ImageIcon, PenLine, Mic2, ArrowUpRight, Lock } from "lucide-react";
import Link from "next/link";
import ImagePlaceholder from "@/components/ImagePlaceholder";

const modules = [
  {
    id: "posts",
    thumb: "module-posts",
    title: "Post Writing",
    description:
      "Viral Instagram and TikTok captions with hashtag sets. Powered by Granite.",
    icon: PenLine,
    href: "/portal/musician/posts",
    available: true, // Phase 3 ✓
  },
  {
    id: "ghostwrite",
    thumb: "module-ghostwrite",
    title: "Ghostwriting",
    description:
      "Lyric writing assistant with rhyme and meter guidance. Multi-turn sessions.",
    icon: Mic2,
    href: "/portal/musician/ghostwrite",
    available: true, // Phase 3 ✓
  },
  {
    id: "manager",
    thumb: "module-manager",
    title: "Personal Manager",
    description:
      "Calendar, Instagram outreach to promoters, and concert-opportunity finder.",
    icon: Calendar,
    href: "/portal/musician/manager",
    available: false, // Phase 4
  },
  {
    id: "visual",
    thumb: "module-visual",
    title: "Visual Design",
    description:
      "AI-generated promo images and album cover art from your brief.",
    icon: ImageIcon,
    href: "/portal/musician/visual",
    available: false, // Phase 4
  },
];

const gettingStarted = [
  { n: "01", label: "Set your creator profile", done: true },
  { n: "02", label: "Write your first captions", href: "/portal/musician/posts" },
  { n: "03", label: "Draft a verse with the ghostwriter", href: "/portal/musician/ghostwrite" },
];

export default async function MusicianPortalPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/signin");
  }

  const name = session.user.name ?? "Creator";
  const liveCount = modules.filter((m) => m.available).length;

  return (
    <main className="min-h-screen bg-background">
      {/* ── Top bar ── */}
      <header className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-chimera-clay flex items-center justify-center shadow-clay-glow">
            <span className="text-chimera-cream font-bold text-sm">C</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground tracking-tight">Chimera</span>
            <span className="text-foreground/25">/</span>
            <span className="u-label text-chimera-clay flex items-center gap-1.5">
              <Music2 className="w-3 h-3" />
              Musician
            </span>
          </div>
        </div>
        <Link
          href="/api/auth/signout"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors rounded-pill border border-border px-3.5 py-1.5 hover:bg-card"
        >
          Sign out
        </Link>
      </header>

      {/* ── Content ── */}
      <div className="max-w-6xl mx-auto px-6 pb-16 pt-4">
        {/* Intro */}
        <div className="mb-8 animate-fade-up">
          <div className="u-label text-muted-foreground mb-3">Creator portal</div>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-foreground">
            Welcome back,
            <br />
            <span className="text-chimera-clay">{name.split(" ")[0]}.</span>
          </h1>
        </div>

        <div className="grid lg:grid-cols-3 gap-5">
          {/* ── Left: profile + getting started ── */}
          <aside className="lg:col-span-1 flex flex-col gap-5">
            {/* Profile widget (dark contrast) */}
            <div
              className="widget-ink p-6 animate-fade-up"
              style={{ animationDelay: "60ms" }}
            >
              <div className="flex items-center gap-4">
                <ImagePlaceholder
                  id="portal-avatar"
                  aspect="1/1"
                  note="Avatar"
                  rounded="rounded-2xl"
                  className="w-14 shrink-0 border-chimera-cream/10 bg-chimera-cream/5"
                />
                <div className="min-w-0">
                  <div className="font-semibold text-chimera-cream truncate">{name}</div>
                  <div className="text-xs text-chimera-cream/50 truncate">
                    {session.user.email}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-6">
                <div className="rounded-2xl bg-chimera-cream/5 px-4 py-3">
                  <div className="text-2xl font-semibold text-chimera-cream tabular-nums">
                    {liveCount}
                  </div>
                  <div className="u-label text-chimera-cream/40 mt-1">Modules live</div>
                </div>
                <div className="rounded-2xl bg-chimera-cream/5 px-4 py-3">
                  <div className="text-2xl font-semibold text-chimera-cream">♪</div>
                  <div className="u-label text-chimera-cream/40 mt-1">Musician</div>
                </div>
              </div>
            </div>

            {/* Getting started rail */}
            <div
              className="widget p-6 animate-fade-up"
              style={{ animationDelay: "120ms" }}
            >
              <div className="u-label text-muted-foreground mb-4">Getting started</div>
              <ol className="flex flex-col gap-1">
                {gettingStarted.map((step) => {
                  const inner = (
                    <div className="flex items-center gap-3 rounded-2xl px-3 py-2.5 -mx-3 transition-colors hover:bg-secondary/60 group">
                      <span
                        className={[
                          "font-mono text-xs w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
                          step.done
                            ? "bg-chimera-clay text-chimera-cream"
                            : "bg-secondary text-muted-foreground",
                        ].join(" ")}
                      >
                        {step.done ? "✓" : step.n}
                      </span>
                      <span
                        className={[
                          "text-sm flex-1",
                          step.done ? "text-muted-foreground line-through" : "text-foreground",
                        ].join(" ")}
                      >
                        {step.label}
                      </span>
                      {step.href && !step.done && (
                        <ArrowUpRight className="w-4 h-4 text-muted-foreground group-hover:text-chimera-clay transition-colors" />
                      )}
                    </div>
                  );
                  return step.href && !step.done ? (
                    <Link key={step.n} href={step.href}>
                      {inner}
                    </Link>
                  ) : (
                    <div key={step.n}>{inner}</div>
                  );
                })}
              </ol>
            </div>
          </aside>

          {/* ── Right: module widgets ── */}
          <section className="lg:col-span-2 grid sm:grid-cols-2 gap-5">
            {modules.map((mod, i) => {
              const Icon = mod.icon;
              const card = (
                <div
                  className={[
                    "group h-full flex flex-col overflow-hidden animate-fade-up transition-all duration-500 ease-smooth",
                    mod.available
                      ? "widget hover:shadow-widget-lg hover:-translate-y-0.5 cursor-pointer"
                      : "rounded-widget border border-dashed border-border bg-card/40",
                  ].join(" ")}
                  style={{ animationDelay: `${140 + i * 70}ms` }}
                >
                  {/* Thumbnail */}
                  <div className="p-2.5 pb-0">
                    <div className="relative">
                      <ImagePlaceholder
                        id={mod.thumb}
                        aspect="4/3"
                        note={mod.title}
                        className={mod.available ? "" : "opacity-50"}
                      />
                      <div className="absolute top-3 left-3 w-9 h-9 rounded-xl bg-card/90 backdrop-blur flex items-center justify-center shadow-soft">
                        <Icon className="w-4 h-4 text-chimera-clay" />
                      </div>
                      {!mod.available && (
                        <div className="absolute top-3 right-3 w-7 h-7 rounded-lg bg-card/90 flex items-center justify-center">
                          <Lock className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Body */}
                  <div className="p-5 flex flex-col flex-1">
                    <h2 className="font-semibold text-foreground mb-1 tracking-tight">
                      {mod.title}
                    </h2>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {mod.description}
                    </p>
                    <div className="mt-4 pt-1">
                      {mod.available ? (
                        <span className="inline-flex items-center gap-1.5 u-label text-chimera-clay">
                          Open
                          <ArrowUpRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                        </span>
                      ) : (
                        <span className="u-label text-muted-foreground/60">Coming soon</span>
                      )}
                    </div>
                  </div>
                </div>
              );
              return mod.available ? (
                <Link key={mod.id} href={mod.href} className="h-full">
                  {card}
                </Link>
              ) : (
                <div key={mod.id} className="h-full">
                  {card}
                </div>
              );
            })}
          </section>
        </div>
      </div>
    </main>
  );
}
