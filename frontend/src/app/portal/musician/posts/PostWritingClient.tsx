"use client";
/**
 * Post Writing — Client Component.
 *
 * Form → calls /api/ai/captions (Route Handler, server-side token) →
 * reads SSE stream → renders caption variants.
 *
 * Stage B: presentation restyled only. The streaming hook, SSE parsing,
 * progress states, and all wiring are unchanged from Stage A/A.5.
 */
import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Sparkles, Copy, Check, Hash } from "lucide-react";
import ImagePlaceholder from "@/components/ImagePlaceholder";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CaptionVariant {
  text: string;
  char_count: number;
  hashtags: string[];
}

interface CaptionsResult {
  variants: CaptionVariant[];
}

// ─── Zod schema ───────────────────────────────────────────────────────────────

const FormSchema = z.object({
  context: z
    .string()
    .min(5, "Please write at least 5 characters about the post.")
    .max(2000, "Keep it under 2000 characters."),
  platform: z.enum(["instagram", "tiktok"]),
});

type FormValues = z.infer<typeof FormSchema>;

// ─── Hook: streaming captions fetch ──────────────────────────────────────────

type StreamStatus = "idle" | "sending" | "streaming" | "success" | "error";

function useCaptionsStream() {
  const [status, setStatus] = useState<StreamStatus>("idle");
  const [result, setResult] = useState<CaptionsResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");
  const [tokenCount, setTokenCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  async function generate(
    context: string,
    platform: "instagram" | "tiktok",
    creatorContext: Record<string, unknown>
  ) {
    // Cancel any in-flight request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setStatus("sending");
    setResult(null);
    setError(null);
    setLiveText("");
    setTokenCount(0);

    try {
      const response = await fetch("/api/ai/captions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context, platform, n_variants: 3, creator_context: creatorContext }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errData.error ?? `HTTP ${response.status}`);
      }

      // Read the SSE stream: {type:"token"|"result"|"error"}
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
      let tokens = 0;

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          const line = event.replace(/^data:\s*/m, "").trim();
          if (!line) continue;
          let msg: { type?: string; text?: string; result?: CaptionsResult; error?: string };
          try {
            msg = JSON.parse(line);
          } catch {
            continue; // partial chunk — wait for more
          }
          if (msg.type === "token") {
            acc += msg.text ?? "";
            tokens += 1;
            setLiveText(acc);
            setTokenCount(tokens);
            setStatus("streaming");
          } else if (msg.type === "result") {
            setResult({ variants: msg.result?.variants ?? [] });
            setStatus("success");
          } else if (msg.type === "error") {
            throw new Error(msg.error ?? "Generation failed.");
          }
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name === "AbortError") return;
      setError((err as Error)?.message ?? "Something went wrong.");
      setStatus("error");
    }
  }

  return { status, result, error, liveText, tokenCount, generate };
}

// ─── Component ────────────────────────────────────────────────────────────────

interface PostWritingClientProps {
  profileContext: Record<string, unknown>;
}

export default function PostWritingClient({ profileContext }: PostWritingClientProps) {
  const { status, result, error, liveText, tokenCount, generate } = useCaptionsStream();
  const [copied, setCopied] = useState<number | null>(null);

  // Mark this module as visited so the Getting Started rail can tick it off.
  useEffect(() => {
    localStorage.setItem("chimera:visited:posts", "1");
  }, []);

  const busy = status === "sending" || status === "streaming";

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: { platform: "instagram", context: "" },
  });

  const contextValue = watch("context");
  const platform = watch("platform");

  function onSubmit(values: FormValues) {
    generate(values.context, values.platform, profileContext);
  }

  async function copyToClipboard(text: string, idx: number) {
    await navigator.clipboard.writeText(text);
    setCopied(idx);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="max-w-3xl mx-auto px-6 pb-20 pt-2">
      {/* Heading */}
      <div className="mb-8 animate-fade-up">
        <div className="u-label text-muted-foreground mb-3">Caption studio</div>
        <h1 className="font-display text-4xl sm:text-5xl font-semibold tracking-tight text-foreground mb-2">
          Post <span className="text-chimera-clay">Writing</span>
        </h1>
        <p className="text-sm text-muted-foreground max-w-md">
          Describe the post — we&apos;ll write three platform-native caption variants,
          streaming as they&apos;re composed.
        </p>
      </div>

      {/* ── Form ── */}
      <form onSubmit={handleSubmit(onSubmit)} className="animate-fade-up" style={{ animationDelay: "60ms" }}>
        <div className="widget p-2">
          <textarea
            id="context"
            rows={4}
            placeholder="e.g. New single 'Neon Rain' dropping Friday — recorded in Berlin, dark pop vibes, collab with DJ Lens."
            className="w-full bg-transparent rounded-2xl px-4 py-3 text-sm resize-none focus:outline-none placeholder:text-muted-foreground/60"
            {...register("context")}
          />
          <div className="flex items-center justify-between gap-3 px-3 pb-2">
            {/* Platform toggle — morphing pill indicator slides between options */}
            <div className="relative flex p-1 rounded-pill bg-secondary/70">
              <span
                aria-hidden
                className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-pill bg-card shadow-soft transition-transform duration-500 ease-spring"
                style={{ transform: platform === "tiktok" ? "translateX(calc(100% + 0.5rem))" : "translateX(0)" }}
              />
              {(["instagram", "tiktok"] as const).map((p) => (
                <label
                  key={p}
                  className={[
                    "relative z-10 cursor-pointer rounded-pill px-3.5 py-1.5 text-xs font-medium capitalize transition-colors",
                    platform === p ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  <input type="radio" value={p} {...register("platform")} className="sr-only" />
                  {p}
                </label>
              ))}
            </div>
            <span className="font-mono text-[11px] text-muted-foreground/70 shrink-0">
              {contextValue?.length ?? 0}/2000
            </span>
          </div>
        </div>
        {errors.context && (
          <span className="block mt-2 text-xs text-destructive">{errors.context.message}</span>
        )}
        <button
          type="submit"
          disabled={busy}
          className="mt-4 inline-flex items-center gap-2 px-5 py-3 rounded-pill bg-chimera-clay text-chimera-cream text-sm font-medium shadow-clay-glow transition-all hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
        >
          <Sparkles className="w-4 h-4" />
          {status === "sending" ? "Sending…" : status === "streaming" ? "Generating…" : "Generate captions"}
        </button>
      </form>

      {/* ── Progress + live stream ── */}
      {busy && (
        <div className="mt-8 widget p-5 animate-scale-in" aria-live="polite" aria-label="Generating captions">
          <div className="flex items-center gap-2.5 text-sm text-muted-foreground mb-3">
            <span className="inline-flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-chimera-clay animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-chimera-clay animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-chimera-clay animate-bounce" />
            </span>
            <span className="font-medium text-foreground">
              {status === "sending" ? "Sending…" : "Generating…"}
            </span>
            {status === "streaming" && (
              <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
                {tokenCount} tokens
              </span>
            )}
          </div>
          {liveText && (
            <pre className="stream-text text-xs text-muted-foreground max-h-52 overflow-y-auto rounded-2xl bg-secondary/50 p-3">
              {liveText}
            </pre>
          )}
        </div>
      )}

      {/* ── Error state ── */}
      {status === "error" && error && (
        <div className="mt-8 rounded-widget border border-destructive/30 bg-destructive/5 px-5 py-4 text-sm text-destructive animate-scale-in">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* ── Success: caption variants ── */}
      {status === "success" && result && (
        <div className="mt-8 flex flex-col gap-4" aria-live="polite">
          <div className="u-label text-muted-foreground">
            {result.variants.length} variants · {platform}
          </div>
          {result.variants.map((v, idx) => (
            <div
              key={idx}
              className="widget p-5 flex flex-col gap-3.5 animate-fade-up"
              style={{ animationDelay: `${idx * 80}ms` }}
            >
              <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">{v.text}</p>

              {v.hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {v.hashtags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-0.5 text-xs bg-chimera-clay-muted text-chimera-clay px-2.5 py-1 rounded-pill font-medium"
                    >
                      <Hash className="w-2.5 h-2.5" />
                      {tag.replace(/^#/, "")}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between pt-1 border-t border-border/70">
                <span className="font-mono text-[11px] text-muted-foreground pt-3">
                  {v.char_count} chars
                </span>
                <button
                  onClick={() => copyToClipboard(v.text, idx)}
                  className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-pill border border-border text-xs hover:bg-secondary transition-colors"
                >
                  {copied === idx ? (
                    <>
                      <Check className="w-3 h-3 text-chimera-clay" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" /> Copy
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {status === "idle" && (
        <div className="mt-10 flex flex-col items-center text-center animate-fade-up" style={{ animationDelay: "140ms" }}>
          <ImagePlaceholder
            id="posts-empty"
            aspect="1/1"
            note="Caption studio empty-state mark"
            className="max-w-[160px]"
            src="/images/posts-empty.jpeg"
          />
          <p className="mt-4 text-sm text-muted-foreground max-w-xs">
            Fill in the brief above and hit generate — your captions appear here.
          </p>
        </div>
      )}
    </div>
  );
}
