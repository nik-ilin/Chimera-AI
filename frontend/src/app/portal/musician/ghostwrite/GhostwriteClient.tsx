"use client";
/**
 * Ghostwriting — chat-style Client Component.
 *
 * Multi-turn lyric assistant. Stage B restyled presentation only — the SSE
 * streaming, session_id handling, progress states, and all wiring are
 * unchanged from Stage A/A.5.
 *
 * UI states: idle | sending | streaming | error  (CONVENTIONS.md §2)
 */
import { useState, useRef, useEffect } from "react";
import { Plus, SendHorizonal } from "lucide-react";
import ImagePlaceholder from "@/components/ImagePlaceholder";

// ─── Types (mirror backend WriteLyricsOutput) ─────────────────────────────────

interface LyricLine {
  text: string;
  rhyme_label: string;
  syllable_count: number;
}

interface LyricSection {
  type: "verse" | "chorus" | "bridge" | "outro" | "intro" | "hook";
  lines: LyricLine[];
}

interface LyricsResult {
  sections: LyricSection[];
  assistant_message: string;
}

interface ChatTurn {
  role: "user" | "assistant";
  content: string;
  result?: LyricsResult;
}

const SECTIONS = ["verse", "chorus", "bridge", "intro", "outro", "hook"] as const;
type SectionType = (typeof SECTIONS)[number];

// ─── Component ────────────────────────────────────────────────────────────────

interface GhostwriteClientProps {
  profileContext: Record<string, unknown>;
  defaultGenre: string;
}

export default function GhostwriteClient({
  profileContext,
  defaultGenre,
}: GhostwriteClientProps) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "sending" | "streaming" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [liveText, setLiveText] = useState("");
  const [tokenCount, setTokenCount] = useState(0);

  const busy = status === "sending" || status === "streaming";

  // Settings
  const [genre, setGenre] = useState(defaultGenre);
  const [theme, setTheme] = useState("");
  const [rhymeScheme, setRhymeScheme] = useState("ABAB");
  const [targetSection, setTargetSection] = useState<SectionType>("verse");

  const [message, setMessage] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, status]);

  function newSession() {
    setSessionId(null);
    setTurns([]);
    setStatus("idle");
    setError(null);
    setLiveText("");
    setTokenCount(0);
  }

  async function send() {
    const text = message.trim();
    if (!text || busy) return;
    if (text.length > 8000) {
      setError("Message too long (max 8000 characters).");
      setStatus("error");
      return;
    }

    setTurns((t) => [...t, { role: "user", content: text }]);
    setMessage("");
    setStatus("sending");
    setError(null);
    setLiveText("");
    setTokenCount(0);

    try {
      const resp = await fetch("/api/ai/ghostwrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          user_message: text,
          genre: genre || "pop",
          theme,
          rhyme_scheme: rhymeScheme || "ABAB",
          target_section: targetSection,
          creator_context: profileContext,
        }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errData.error ?? `HTTP ${resp.status}`);
      }

      // Read the SSE stream: {type:"session"|"token"|"result"|"error"}
      const reader = resp.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let acc = "";
      let tokens = 0;
      let handled = false;

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const event of events) {
          const line = event.replace(/^data:\s*/m, "").trim();
          if (!line) continue;
          let msg: {
            type?: string;
            session_id?: string;
            text?: string;
            result?: LyricsResult;
            error?: string;
          };
          try {
            msg = JSON.parse(line);
          } catch {
            continue; // partial chunk — wait for more
          }
          if (msg.type === "session" && msg.session_id) {
            setSessionId(msg.session_id);
          } else if (msg.type === "token") {
            acc += msg.text ?? "";
            tokens += 1;
            setLiveText(acc);
            setTokenCount(tokens);
            setStatus("streaming");
          } else if (msg.type === "result" && msg.result) {
            const result = msg.result;
            setTurns((t) => [
              ...t,
              { role: "assistant", content: result.assistant_message ?? "", result },
            ]);
            handled = true;
          } else if (msg.type === "error") {
            throw new Error(msg.error ?? "Generation failed.");
          }
        }
      }

      if (!handled) throw new Error("Empty AI response.");
      setStatus("idle");
      setLiveText("");
      setTokenCount(0);
    } catch (err: unknown) {
      setError((err as Error)?.message ?? "Something went wrong.");
      setStatus("error");
    }
  }

  const inputCls =
    "rounded-xl border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-chimera-clay/30 transition-shadow";

  return (
    <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-6 pb-6 min-h-0">
      {/* ── Settings bar ── */}
      <div className="widget p-3 flex flex-wrap items-end gap-2.5 animate-fade-up">
        <label className="flex flex-col gap-1 u-label text-muted-foreground">
          Genre
          <input value={genre} onChange={(e) => setGenre(e.target.value)} maxLength={100} className={`${inputCls} w-28`} />
        </label>
        <label className="flex flex-col gap-1 u-label text-muted-foreground">
          Theme
          <input value={theme} onChange={(e) => setTheme(e.target.value)} maxLength={500} placeholder="optional" className={`${inputCls} w-36`} />
        </label>
        <label className="flex flex-col gap-1 u-label text-muted-foreground">
          Rhyme
          <input value={rhymeScheme} onChange={(e) => setRhymeScheme(e.target.value)} maxLength={20} className={`${inputCls} w-20`} />
        </label>
        <label className="flex flex-col gap-1 u-label text-muted-foreground">
          Section
          <select
            value={targetSection}
            onChange={(e) => setTargetSection(e.target.value as SectionType)}
            className={`${inputCls} capitalize`}
          >
            {SECTIONS.map((s) => (
              <option key={s} value={s} className="capitalize">
                {s}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={newSession}
          className="ml-auto self-center inline-flex items-center gap-1.5 u-label px-3.5 py-2 rounded-pill border border-border hover:bg-secondary transition-colors"
          title="Start a fresh lyric session"
        >
          <Plus className="w-3.5 h-3.5" />
          New session
        </button>
      </div>

      {/* ── Thread ── */}
      <div className="flex-1 overflow-y-auto py-6 flex flex-col gap-5 min-h-0">
        {turns.length === 0 && !busy && (
          <div className="flex flex-col items-center text-center text-sm text-muted-foreground py-10 animate-fade-up">
            <ImagePlaceholder
              id="ghostwrite-empty"
              aspect="1/1"
              note="Blank lyric session mark"
              className="max-w-[150px] mb-5"
            />
            <p className="max-w-xs">
              Describe the song you want to write — mood, story, references.
              The assistant remembers the whole session.
            </p>
          </div>
        )}

        {turns.map((turn, idx) =>
          turn.role === "user" ? (
            <div key={idx} className="self-end max-w-[85%] animate-fade-up">
              <div className="bg-chimera-clay text-chimera-cream rounded-widget rounded-br-lg px-4 py-3 text-sm whitespace-pre-wrap shadow-soft">
                {turn.content}
              </div>
            </div>
          ) : (
            <div key={idx} className="self-start max-w-[94%] w-full animate-fade-up">
              <div className="widget px-5 py-4 flex flex-col gap-4">
                {turn.result?.sections.map((section, sIdx) => (
                  <div key={sIdx}>
                    <div className="u-label text-chimera-clay mb-2">{section.type}</div>
                    <div className="flex flex-col gap-1">
                      {section.lines.map((ln, lIdx) => (
                        <div key={lIdx} className="flex items-baseline gap-3 text-sm">
                          <span className="flex-1 whitespace-pre-wrap leading-relaxed">{ln.text}</span>
                          <span className="font-mono text-[10px] text-muted-foreground tabular-nums shrink-0 bg-secondary/70 rounded-md px-1.5 py-0.5">
                            {ln.rhyme_label} · {ln.syllable_count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {turn.content && (
                  <p className="text-xs text-muted-foreground border-t border-border/70 pt-3 leading-relaxed">
                    {turn.content}
                  </p>
                )}
              </div>
            </div>
          )
        )}

        {/* Live streaming bubble + progress */}
        {busy && (
          <div className="self-start max-w-[94%] w-full animate-scale-in" aria-live="polite" aria-label="Writing lyrics">
            <div className="widget px-5 py-4">
              <div className="flex items-center gap-2.5 text-xs text-muted-foreground mb-2.5">
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-chimera-clay animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-chimera-clay animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-chimera-clay animate-bounce" />
                </span>
                <span className="font-medium text-foreground">
                  {status === "sending" ? "Sending…" : "Generating…"}
                </span>
                {status === "streaming" && (
                  <span className="ml-auto font-mono tabular-nums">{tokenCount} tokens</span>
                )}
              </div>
              {liveText && (
                <pre className="stream-text text-xs text-muted-foreground max-h-52 overflow-y-auto rounded-2xl bg-secondary/50 p-3">
                  {liveText}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {status === "error" && error && (
          <div className="self-center rounded-widget border border-destructive/30 bg-destructive/5 px-5 py-3 text-sm text-destructive animate-scale-in">
            <strong>Error:</strong> {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Composer ── */}
      <div className="shrink-0">
        <div className="widget p-2 flex items-end gap-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            maxLength={8000}
            placeholder="Write me a verse about leaving home at night…  (Enter to send, Shift+Enter for newline)"
            className="flex-1 bg-transparent rounded-2xl px-3 py-2 text-sm resize-none focus:outline-none placeholder:text-muted-foreground/60"
          />
          <button
            onClick={send}
            disabled={busy || !message.trim()}
            className="p-3 rounded-2xl bg-chimera-clay text-chimera-cream shadow-clay-glow transition-all hover:brightness-105 active:scale-95 disabled:opacity-40"
            aria-label="Send"
          >
            <SendHorizonal className="w-4 h-4" />
          </button>
        </div>
        {sessionId && (
          <p className="font-mono text-[10px] text-muted-foreground mt-2 text-center">
            session {sessionId.slice(0, 8)}… · the assistant remembers previous turns
          </p>
        )}
      </div>
    </div>
  );
}
