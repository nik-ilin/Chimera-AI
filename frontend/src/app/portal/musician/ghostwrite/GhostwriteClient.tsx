"use client";
/**
 * Ghostwriting — chat-style Client Component.
 *
 * Multi-turn lyric assistant:
 * - Sends user messages to /api/ai/ghostwrite (Route Handler, server token).
 * - Carries session_id across turns so the backend threads the conversation
 *   (lyric_sessions table, windowed history + rolling summary).
 * - Renders structured lyric sections (verse/chorus/…, rhyme labels, syllables)
 *   plus the assistant's note.
 * - "New session" clears the thread and starts a fresh session server-side.
 *
 * UI states: idle | loading | success | error  (CONVENTIONS.md §2)
 * Streaming: reads the Route Handler's SSE wire format (single event for now).
 */
import { useState, useRef, useEffect } from "react";
import { Mic2, Plus, SendHorizonal } from "lucide-react";

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

  return (
    <div className="flex-1 flex flex-col max-w-3xl w-full mx-auto px-4">
      {/* ── Settings bar ── */}
      <div className="flex flex-wrap items-end gap-3 py-4 border-b border-border">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Genre
          <input
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            maxLength={100}
            className="border border-border rounded-md px-2 py-1.5 text-sm bg-background w-28 focus:outline-none focus:ring-2 focus:ring-chimera-purple/40"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Theme
          <input
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            maxLength={500}
            placeholder="optional"
            className="border border-border rounded-md px-2 py-1.5 text-sm bg-background w-36 focus:outline-none focus:ring-2 focus:ring-chimera-purple/40"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Rhyme
          <input
            value={rhymeScheme}
            onChange={(e) => setRhymeScheme(e.target.value)}
            maxLength={20}
            className="border border-border rounded-md px-2 py-1.5 text-sm bg-background w-20 focus:outline-none focus:ring-2 focus:ring-chimera-purple/40"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Section
          <select
            value={targetSection}
            onChange={(e) => setTargetSection(e.target.value as SectionType)}
            className="border border-border rounded-md px-2 py-1.5 text-sm bg-background capitalize focus:outline-none focus:ring-2 focus:ring-chimera-purple/40"
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
          className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors"
          title="Start a fresh lyric session"
        >
          <Plus className="w-3.5 h-3.5" />
          New session
        </button>
      </div>

      {/* ── Thread ── */}
      <div className="flex-1 overflow-y-auto py-6 flex flex-col gap-4">
        {turns.length === 0 && !busy && (
          <div className="text-center text-sm text-muted-foreground py-16">
            <Mic2 className="w-6 h-6 mx-auto mb-3 text-chimera-purple" />
            Describe the song you want to write — mood, story, references.
            <br />
            The assistant remembers the whole session.
          </div>
        )}

        {turns.map((turn, idx) =>
          turn.role === "user" ? (
            <div key={idx} className="self-end max-w-[85%]">
              <div className="bg-chimera-purple text-white rounded-2xl rounded-br-sm px-4 py-2.5 text-sm whitespace-pre-wrap">
                {turn.content}
              </div>
            </div>
          ) : (
            <div key={idx} className="self-start max-w-[92%] w-full">
              <div className="border border-border rounded-2xl rounded-bl-sm px-4 py-3 flex flex-col gap-3">
                {/* Lyric sections */}
                {turn.result?.sections.map((section, sIdx) => (
                  <div key={sIdx}>
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-chimera-purple mb-1.5">
                      {section.type}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {section.lines.map((ln, lIdx) => (
                        <div key={lIdx} className="flex items-baseline gap-2 text-sm">
                          <span className="flex-1 whitespace-pre-wrap">{ln.text}</span>
                          <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                            {ln.rhyme_label} · {ln.syllable_count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {/* Assistant note */}
                {turn.content && (
                  <p className="text-xs text-muted-foreground border-t border-border pt-2">
                    {turn.content}
                  </p>
                )}
              </div>
            </div>
          )
        )}

        {/* Live streaming bubble + progress (honest — no fake percentage) */}
        {busy && (
          <div className="self-start max-w-[92%] w-full" aria-live="polite" aria-label="Writing lyrics">
            <div className="border border-border rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                <span className="inline-flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-chimera-purple animate-bounce [animation-delay:-0.3s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-chimera-purple animate-bounce [animation-delay:-0.15s]" />
                  <span className="w-1.5 h-1.5 rounded-full bg-chimera-purple animate-bounce" />
                </span>
                <span>{status === "sending" ? "Sending…" : "Generating…"}</span>
                {status === "streaming" && (
                  <span className="ml-auto tabular-nums">{tokenCount} tokens</span>
                )}
              </div>
              {liveText && (
                <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-words max-h-48 overflow-y-auto font-mono">
                  {liveText}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {status === "error" && error && (
          <div className="self-center border border-destructive/40 bg-destructive/5 rounded-lg px-4 py-2.5 text-sm text-destructive">
            <strong>Error:</strong> {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Composer ── */}
      <div className="border-t border-border py-4">
        <div className="flex items-end gap-2">
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
            className="flex-1 border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none focus:outline-none focus:ring-2 focus:ring-chimera-purple/40"
          />
          <button
            onClick={send}
            disabled={busy || !message.trim()}
            className="p-2.5 rounded-lg bg-chimera-purple text-white disabled:opacity-50"
            aria-label="Send"
          >
            <SendHorizonal className="w-4 h-4" />
          </button>
        </div>
        {sessionId && (
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Session {sessionId.slice(0, 8)}… — the assistant remembers previous turns.
          </p>
        )}
      </div>
    </div>
  );
}
