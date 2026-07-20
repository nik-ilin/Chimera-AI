"use client";
/**
 * Onboarding — Client Component.
 *
 * Flow:
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
import { Music2, Users, Video, Lock, Sparkles } from "lucide-react";

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
    <main className="min-h-screen bg-background flex flex-col items-center px-6 py-16">
      <div className="w-full max-w-2xl">
        {/* Heading */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-foreground mb-2">
            What is your profile?
          </h1>
          <p className="text-muted-foreground text-sm max-w-md mx-auto">
            Describe what you create and we&apos;ll match you to the right
            portal. Only the Musician portal is open right now.
          </p>
        </div>

        {/* Describe form */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-3 mb-10">
          <label htmlFor="description" className="text-sm font-medium">
            Tell us what you do
          </label>
          <textarea
            id="description"
            rows={3}
            placeholder="e.g. I produce lo-fi hip-hop beats and release a single every month on Spotify and TikTok."
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none focus:outline-none focus:ring-2 focus:ring-chimera-purple/40"
            {...register("description")}
          />
          <div className="flex justify-between">
            {errors.description ? (
              <span className="text-xs text-destructive">{errors.description.message}</span>
            ) : (
              <span />
            )}
            <span className="text-xs text-muted-foreground">
              {descriptionValue?.length ?? 0}/500
            </span>
          </div>
          <button
            type="submit"
            disabled={status === "loading"}
            className="self-start flex items-center gap-2 px-5 py-2 rounded-lg bg-chimera-purple text-white text-sm font-medium disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            {status === "loading" ? "Analysing…" : "Analyse my profile"}
          </button>
        </form>

        {/* Error state */}
        {status === "error" && error && (
          <div className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3 text-sm text-destructive mb-8">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* AI verdict */}
        {status === "success" && result && (
          <div
            className="border border-chimera-purple/30 bg-chimera-purple-muted/30 rounded-lg px-4 py-3 text-sm mb-8"
            aria-live="polite"
          >
            <p className="font-medium text-foreground mb-1">
              Our AI thinks you&apos;re a{" "}
              <span className="text-chimera-purple capitalize">
                {result.creator_type.replace("_", " ")}
              </span>{" "}
              ({Math.round(result.confidence * 100)}% confident)
            </p>
            <p className="text-muted-foreground">{result.reasoning}</p>
          </div>
        )}

        {/* Creator cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {CARDS.map((card) => {
            const Icon = card.icon;
            const isDetected = detected === card.type;
            return (
              <div
                key={card.type}
                className={[
                  "relative border rounded-xl p-5 text-left transition-colors",
                  card.active
                    ? "border-chimera-purple/30 bg-chimera-purple-muted/20"
                    : "border-border bg-muted/30 opacity-60 select-none",
                  isDetected ? "ring-2 ring-chimera-purple" : "",
                ].join(" ")}
              >
                {!card.active && (
                  <Lock className="absolute top-3 right-3 w-3.5 h-3.5 text-muted-foreground" />
                )}
                {isDetected && (
                  <span className="absolute -top-2.5 left-3 bg-chimera-purple text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
                    AI match
                  </span>
                )}
                <div className="w-9 h-9 rounded-lg bg-chimera-purple/10 flex items-center justify-center mb-3">
                  <Icon className="w-4.5 h-4.5 text-chimera-purple" />
                </div>
                <h3 className="font-semibold text-foreground text-sm mb-1">{card.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {card.description}
                </p>
                <div className="mt-3 text-xs font-medium">
                  {card.active ? (
                    <span className="text-chimera-purple">Open</span>
                  ) : (
                    <span className="text-muted-foreground">Coming soon</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Continue */}
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={continueAsMusician}
            disabled={saving}
            className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving…" : "Continue as Musician →"}
          </button>
          {detected && detected !== "musician" && (
            <p className="text-xs text-muted-foreground text-center max-w-sm">
              The {detected.replace("_", " ")} portal isn&apos;t open yet — you
              can still explore Chimera through the Musician portal.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
