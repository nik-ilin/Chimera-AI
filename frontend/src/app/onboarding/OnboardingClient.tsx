"use client";
/**
 * Onboarding — Client Component.
 *
 * Flow (unchanged from Stage A — presentation only was restyled):
 * 1. User describes what they do (free text).
 * 2. POST /api/ai/classify → { creator_type, confidence, reasoning }.
 * 3. The three creator cards light up with the AI's pick highlighted.
 * 4. "Continue as Musician" persists creator_type via PATCH /api/profile and
 *    routes to /portal/musician. Influencer / Video Creator stay locked.
 *
 * UI states: idle | loading | success | error  (CONVENTIONS.md §2)
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Music2, Users, Video, Lock, Sparkles, ArrowRight } from "lucide-react";
import ImagePlaceholder from "@/components/ImagePlaceholder";

// ─── Types ────────────────────────────────────────────────────────────────────

type CreatorType = "musician" | "influencer" | "video_creator";

interface ClassifyResult {
  creator_type: CreatorType;
  confidence: number;
  reasoning: string;
}

// ─── Zod schema ───────────────────────────────────────────────────────────────

const FormSchema = z.object({
  description: z
    .string()
    .min(10, "Tell us a bit more — at least 10 characters.")
    .max(500, "Keep it under 500 characters."),
});

type FormValues = z.infer<typeof FormSchema>;

// ─── Card definitions ─────────────────────────────────────────────────────────

const CARDS: {
  type: CreatorType;
  title: string;
  description: string;
  icon: typeof Music2;
  active: boolean;
}[] = [
  {
    type: "musician",
    title: "Musician",
    description: "Manager, visuals, captions, and lyric ghostwriting.",
    icon: Music2,
    active: true,
  },
  {
    type: "influencer",
    title: "Influencer",
    description: "Brand deals, content calendar, and trend analysis.",
    icon: Users,
    active: false,
  },
  {
    type: "video_creator",
    title: "Video Creator",
    description: "Script writing, thumbnail briefs, and channel strategy.",
    icon: Video,
    active: false,
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardingClient() {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [result, setResult] = useState<ClassifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { description: "" },
  });

  const descriptionValue = watch("description");

  async function onSubmit(values: FormValues) {
    setStatus("loading");
    setResult(null);
    setError(null);
    try {
      const resp = await fetch("/api/ai/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: values.description }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errData.error ?? `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      // Backend shape: { request_id, result: { creator_type, confidence, reasoning } }
      const r: ClassifyResult | undefined = data?.result;
      if (!r?.creator_type) throw new Error("Unexpected AI response shape.");
      setResult(r);
      setStatus("success");
    } catch (err: unknown) {
      setError((err as Error)?.message ?? "Something went wrong.");
      setStatus("error");
    }
  }

  async function continueAsMusician() {
    setSaving(true);
    setError(null);
    try {
      // GET first: creates the default profile row if it doesn't exist yet.
      await fetch("/api/profile");
      const resp = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creator_type: "musician" }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errData.error ?? `HTTP ${resp.status}`);
      }
      router.push("/portal/musician");
    } catch (err: unknown) {
      setError((err as Error)?.message ?? "Could not save your profile.");
      setSaving(false);
    }
  }

  const detected = result?.creator_type ?? null;

  return (
    <main className="min-h-screen bg-background flex flex-col lg:flex-row">
      {/* ── Aside (editorial art) ── */}
      <aside className="lg:w-[38%] lg:min-h-screen p-6 lg:p-8">
        <div className="widget-ink h-full min-h-[220px] p-8 flex flex-col justify-between animate-fade-up overflow-hidden relative">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-chimera-clay flex items-center justify-center">
              <span className="text-chimera-cream font-bold text-xs">C</span>
            </div>
            <span className="u-label text-chimera-cream/60">Chimera · onboarding</span>
          </div>
          <div className="my-8 lg:my-0">
            <ImagePlaceholder
              id="onboarding-aside"
              aspect="3/4"
              note="Editorial creator portrait"
              rounded="rounded-2xl"
              className="border-chimera-cream/10 bg-chimera-cream/5 max-w-[240px]"
            />
          </div>
          <p className="font-display text-2xl leading-snug text-chimera-cream/90 max-w-[24ch]">
            Every creator gets the tools of a major label.
          </p>
        </div>
      </aside>

      {/* ── Form column ── */}
      <div className="flex-1 flex flex-col justify-center px-6 lg:px-12 py-12">
        <div className="w-full max-w-xl mx-auto lg:mx-0">
          <div className="u-label text-muted-foreground mb-3 animate-fade-up">Step 01 — profile</div>
          <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-foreground mb-3 animate-fade-up" style={{ animationDelay: "40ms" }}>
            What is your <span className="text-chimera-clay">profile?</span>
          </h1>
          <p className="text-muted-foreground text-sm mb-8 max-w-md animate-fade-up" style={{ animationDelay: "80ms" }}>
            Describe what you create and we&apos;ll match you to the right portal.
            Only the Musician portal is open right now.
          </p>

          {/* Describe form */}
          <form onSubmit={handleSubmit(onSubmit)} className="animate-fade-up" style={{ animationDelay: "120ms" }}>
            <div className="widget p-2">
              <textarea
                id="description"
                rows={3}
                placeholder="e.g. I produce lo-fi hip-hop beats and release a single every month on Spotify and TikTok."
                className="w-full bg-transparent rounded-2xl px-4 py-3 text-sm resize-none focus:outline-none placeholder:text-muted-foreground/60"
                {...register("description")}
              />
              <div className="flex items-center justify-between px-3 pb-1.5">
                <span className="text-xs text-destructive">{errors.description?.message ?? ""}</span>
                <span className="font-mono text-[11px] text-muted-foreground/70">
                  {descriptionValue?.length ?? 0}/500
                </span>
              </div>
            </div>
            <button
              type="submit"
              disabled={status === "loading"}
              className="mt-4 inline-flex items-center gap-2 px-5 py-3 rounded-pill bg-chimera-clay text-chimera-cream text-sm font-medium shadow-clay-glow transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />
              {status === "loading" ? "Analysing…" : "Analyse my profile"}
            </button>
          </form>

          {/* Error state */}
          {status === "error" && error && (
            <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive animate-scale-in">
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* AI verdict */}
          {status === "success" && result && (
            <div
              className="mt-6 rounded-widget border border-chimera-clay/25 bg-chimera-clay-muted/50 px-5 py-4 animate-scale-in"
              aria-live="polite"
            >
              <div className="u-label text-chimera-clay mb-1.5">AI verdict</div>
              <p className="text-sm font-medium text-foreground mb-1">
                You read as a{" "}
                <span className="text-chimera-clay capitalize">
                  {result.creator_type.replace("_", " ")}
                </span>{" "}
                <span className="font-mono text-xs text-muted-foreground">
                  ({Math.round(result.confidence * 100)}% confident)
                </span>
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">{result.reasoning}</p>
            </div>
          )}

          {/* Creator cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-8">
            {CARDS.map((card, i) => {
              const Icon = card.icon;
              const isDetected = detected === card.type;
              return (
                <div
                  key={card.type}
                  className={[
                    "relative rounded-2xl p-4 text-left transition-all duration-500 ease-smooth animate-fade-up",
                    card.active
                      ? "bg-card border border-border shadow-soft"
                      : "bg-card/40 border border-dashed border-border opacity-70",
                    isDetected ? "ring-2 ring-chimera-clay shadow-widget -translate-y-0.5" : "",
                  ].join(" ")}
                  style={{ animationDelay: `${160 + i * 60}ms` }}
                >
                  {!card.active && (
                    <Lock className="absolute top-3.5 right-3.5 w-3.5 h-3.5 text-muted-foreground" />
                  )}
                  {isDetected && (
                    <span className="absolute -top-2.5 left-3 u-label bg-chimera-clay text-chimera-cream px-2 py-1 rounded-pill">
                      AI match
                    </span>
                  )}
                  <div className="w-9 h-9 rounded-xl bg-chimera-clay/10 flex items-center justify-center mb-3">
                    <Icon className="w-4 h-4 text-chimera-clay" />
                  </div>
                  <h3 className="font-semibold text-foreground text-sm mb-1 tracking-tight">{card.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{card.description}</p>
                  <div className="mt-3 u-label text-muted-foreground/70">
                    {card.active ? "Open" : "Soon"}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Continue */}
          <div className="flex flex-col items-start gap-2 mt-8 animate-fade-up" style={{ animationDelay: "360ms" }}>
            <button
              onClick={continueAsMusician}
              disabled={saving}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-pill bg-foreground text-background text-sm font-medium transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            >
              {saving ? "Saving…" : "Continue as Musician"}
              <ArrowRight className="w-4 h-4" />
            </button>
            {detected && detected !== "musician" && (
              <p className="text-xs text-muted-foreground max-w-sm">
                The {detected.replace("_", " ")} portal isn&apos;t open yet — you can
                still explore Chimera through the Musician portal.
              </p>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
