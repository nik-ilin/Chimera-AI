"use client";
/**
 * Post Writing — Client Component.
 *
 * Form → calls /api/ai/captions (Route Handler, server-side token) →
 * reads SSE stream → renders 3 caption variants.
 *
 * UI states: idle | loading | success | error
 * Streaming: reads EventSource-style SSE from the Route Handler.
 * CONVENTIONS.md §2: AI calls go through Route Handlers; client is lean.
 */
import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

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

  function onSubmit(values: FormValues) {
    generate(values.context, values.platform, profileContext);
  }

  async function copyToClipboard(text: string, idx: number) {
    await navigator.clipboard.writeText(text);
    setCopied(idx);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold mb-1">Post Writing</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Describe what the post is about. Granite will write 3 caption variants.
      </p>

      {/* ── Form ── */}
      <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 mb-8">
        {/* Context textarea */}
        <div className="flex flex-col gap-1">
          <label htmlFor="context" className="text-sm font-medium">
            What's the post about?
          </label>
          <textarea
            id="context"
            rows={4}
            placeholder="e.g. New single 'Neon Rain' dropping Friday — recorded in Berlin, dark pop vibes, collab with DJ Lens."
            className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none focus:outline-none focus:ring-2 focus:ring-chimera-purple/40"
            {...register("context")}
          />
          <div className="flex justify-between">
            {errors.context ? (
              <span className="text-xs text-destructive">{errors.context.message}</span>
            ) : (
              <span />
            )}
            <span className="text-xs text-muted-foreground">{contextValue?.length ?? 0}/2000</span>
          </div>
        </div>

        {/* Platform toggle */}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium">Platform</label>
          <div className="flex gap-2">
            {(["instagram", "tiktok"] as const).map((p) => (
              <label
                key={p}
                className="flex items-center gap-1.5 text-sm cursor-pointer"
              >
                <input
                  type="radio"
                  value={p}
                  {...register("platform")}
                  className="accent-chimera-purple"
                />
                <span className="capitalize">{p}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={busy}
          className="self-start px-5 py-2 rounded-lg bg-chimera-purple text-white text-sm font-medium disabled:opacity-50"
        >
          {status === "sending"
            ? "Sending…"
            : status === "streaming"
              ? "Generating…"
              : "Generate captions"}
        </button>
      </form>

      {/* ── Progress + live stream (minimal, honest — no fake percentage) ── */}
      {busy && (
        <div
          className="border border-border rounded-lg p-4 mb-2"
          aria-live="polite"
          aria-label="Generating captions"
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-3">
            {/* Indeterminate animated indicator */}
            <span className="inline-flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-chimera-purple animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-chimera-purple animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-chimera-purple animate-bounce" />
            </span>
            <span>{status === "sending" ? "Sending…" : "Generating…"}</span>
            {status === "streaming" && (
              <span className="ml-auto tabular-nums text-xs">{tokenCount} tokens</span>
            )}
          </div>
          {liveText && (
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words max-h-48 overflow-y-auto font-mono">
              {liveText}
            </pre>
          )}
        </div>
      )}

      {/* ── Error state ── */}
      {status === "error" && error && (
        <div className="border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-3 text-sm text-destructive">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* ── Success: caption variants ── */}
      {status === "success" && result && (
        <div className="flex flex-col gap-4" aria-live="polite">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {result.variants.length} variants generated
          </h2>
          {result.variants.map((v, idx) => (
            <div key={idx} className="border border-border rounded-lg p-4 flex flex-col gap-3">
              {/* Caption text */}
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{v.text}</p>

              {/* Hashtags */}
              {v.hashtags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {v.hashtags.map((tag) => (
                    <span
                      key={tag}
                      className="text-xs bg-chimera-purple-muted text-chimera-purple px-2 py-0.5 rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Footer: char count + copy */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{v.char_count} chars</span>
                <button
                  onClick={() => copyToClipboard(v.text, idx)}
                  className="px-3 py-1 rounded border border-border hover:bg-muted transition-colors"
                >
                  {copied === idx ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {status === "idle" && (
        <p className="text-sm text-muted-foreground">
          Fill in the form above and click Generate.
        </p>
      )}
    </div>
  );
}
