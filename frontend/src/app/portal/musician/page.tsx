/**
 * Musician portal dashboard — Server Component.
 *
 * Protected by middleware (requires auth). Shows the four module cards.
 * This is the Phase 1 scaffold; modules will be filled in later phases.
 */
export const dynamic = "force-dynamic";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Music2, Calendar, ImageIcon, PenLine, Mic2 } from "lucide-react";
import Link from "next/link";

const modules = [
  {
    id: "manager",
    title: "Personal Manager",
    description:
      "Calendar, Instagram outreach to promoters, and concert-opportunity finder.",
    icon: Calendar,
    href: "/portal/musician/manager",
    available: false, // Phase 4
  },
  {
    id: "visual",
    title: "Visual Design",
    description:
      "AI-generated promo images and album cover art from your brief.",
    icon: ImageIcon,
    href: "/portal/musician/visual",
    available: false, // Phase 4
  },
  {
    id: "posts",
    title: "Post Writing",
    description:
      "Viral Instagram and TikTok captions with hashtag sets. Powered by Granite.",
    icon: PenLine,
    href: "/portal/musician/posts",
    available: true, // Phase 3 ✓
  },
  {
    id: "ghostwrite",
    title: "Ghostwriting",
    description:
      "Lyric writing assistant with rhyme and meter guidance. Multi-turn sessions.",
    icon: Mic2,
    href: "/portal/musician/ghostwrite",
    available: true, // Phase 3 ✓
  },
];

export default async function MusicianPortalPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/signin");
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-chimera-purple flex items-center justify-center">
            <span className="text-white font-bold text-sm">C</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">Chimera</span>
            <span className="text-muted-foreground">/</span>
            <span className="flex items-center gap-1.5 text-sm text-chimera-purple font-medium">
              <Music2 className="w-3.5 h-3.5" />
              Musician
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {session.user.email}
          </span>
          <Link
            href="/api/auth/signout"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out
          </Link>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-1">
            Your Creator Portal
          </h1>
          <p className="text-muted-foreground text-sm">
            Select a module to get started. More modules will unlock as
            Chimera builds out.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {modules.map((mod) => {
            const Icon = mod.icon;
            const card = (
              <div
                className={[
                  "rounded-xl border p-6 flex flex-col gap-3",
                  mod.available
                    ? "border-chimera-purple/30 bg-chimera-purple-muted/20 hover:bg-chimera-purple-muted/40 cursor-pointer transition-colors"
                    : "border-border bg-muted/20 opacity-60 cursor-not-allowed",
                ].join(" ")}
              >
                <div className="w-10 h-10 rounded-lg bg-chimera-purple/10 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-chimera-purple" />
                </div>
                <div>
                  <h2 className="font-semibold text-foreground mb-0.5">
                    {mod.title}
                  </h2>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {mod.description}
                  </p>
                </div>
                <div className="mt-auto text-xs font-medium text-chimera-purple">
                  {mod.available ? "Open →" : "Coming in next phase"}
                </div>
              </div>
            );

            return mod.available ? (
              <Link key={mod.id} href={mod.href}>
                {card}
              </Link>
            ) : (
              <div key={mod.id}>{card}</div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
