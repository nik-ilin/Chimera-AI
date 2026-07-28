"use client";
/**
 * Command palette (Cmd/Ctrl+K).
 *
 * Navigation and actions without leaving the keyboard. Deliberately dependency
 * free — cmdk would bring its own focus and styling model to fight with the
 * design system, and the whole behaviour is ~200 lines.
 *
 * Matching is subsequence-based ("blna" finds "Barcelona"), which is what makes
 * a palette feel fast: users type the letters they remember, not a prefix.
 *
 * Accessibility: combobox/listbox roles, aria-activedescendant so the active
 * option is announced while focus stays in the input, and a focus trap for the
 * duration of the overlay.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CalendarDays,
  Compass,
  CornerDownLeft,
  Map as MapIcon,
  Plug,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";

export interface PaletteItem {
  id: string;
  label: string;
  /** Secondary line — a date, a city. */
  hint?: string;
  group: string;
  icon?: "calendar" | "map" | "plug" | "compass" | "plus" | "sparkles" | "arrow";
  /** Extra text matched against but not displayed (city, venue, notes). */
  keywords?: string;
  run: () => void;
}

const ICONS = {
  calendar: CalendarDays,
  map: MapIcon,
  plug: Plug,
  compass: Compass,
  plus: Plus,
  sparkles: Sparkles,
  arrow: ArrowRight,
};

/**
 * Subsequence match with a crude quality score.
 *
 * Consecutive hits and word-start hits score higher, so "apo" ranks
 * "Apolo" above "Amsterdam pre-orders". Returns null for no match.
 */
function score(haystack: string, needle: string): number | null {
  if (!needle) return 0;
  const target = haystack.toLowerCase();
  const query = needle.toLowerCase();

  let ti = 0;
  let points = 0;
  let streak = 0;

  for (const char of query) {
    const found = target.indexOf(char, ti);
    if (found === -1) return null;
    // Word boundary is a strong signal of intent.
    if (found === 0 || /[\s\-/,.]/.test(target[found - 1])) points += 12;
    streak = found === ti ? streak + 1 : 0;
    points += 6 + streak * 3;
    // Later matches are weaker — a hit at position 40 means little.
    points -= Math.min(found - ti, 10);
    ti = found + 1;
  }
  return points;
}

export default function CommandPalette({ items }: { items: PaletteItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // ── Open/close shortcut ──
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((wasOpen) => !wasOpen);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // ── Focus handling ──
  useEffect(() => {
    if (!open) {
      returnFocusRef.current?.focus?.();
      return;
    }
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const results = useMemo(() => {
    if (!query.trim()) return items.slice(0, 12);
    return items
      .map((item) => ({
        item,
        points: score(`${item.label} ${item.hint ?? ""} ${item.keywords ?? ""}`, query.trim()),
      }))
      .filter((r): r is { item: PaletteItem; points: number } => r.points !== null)
      .sort((a, b) => b.points - a.points)
      .slice(0, 12)
      .map((r) => r.item);
  }, [items, query]);

  // Clamp the cursor when the result set shrinks under it.
  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, results.length - 1)));
  }, [results.length]);

  const runItem = useCallback(
    (item: PaletteItem) => {
      setOpen(false);
      item.run();
    },
    []
  );

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % Math.max(results.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % Math.max(results.length, 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = results[active];
      if (item) runItem(item);
    }
  }

  // Keep the active row in view during keyboard traversal.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-pill border border-border px-3.5 py-2 text-xs text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
      >
        <Search className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden sm:inline font-mono text-[0.625rem] bg-secondary rounded px-1.5 py-0.5">
          ⌘K
        </kbd>
      </button>
    );
  }

  // Group while preserving relevance order: a group appears where its best
  // result ranks, so searching never reshuffles the list into fixed sections.
  const grouped: { group: string; items: PaletteItem[] }[] = [];
  for (const item of results) {
    const last = grouped[grouped.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else grouped.push({ group: item.group, items: [item] });
  }
  let flatIndex = -1;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4">
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-chimera-ink/40 backdrop-blur-sm animate-fade-in cursor-default"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-xl widget overflow-hidden animate-scale-in"
      >
        <div className="flex items-center gap-3 px-4 border-b border-border">
          <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search gigs, venues, actions…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[active] ? `palette-opt-${active}` : undefined}
            className="flex-1 bg-transparent py-4 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
          <kbd className="font-mono text-[0.625rem] text-muted-foreground bg-secondary rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>

        <div
          ref={listRef}
          id="palette-list"
          role="listbox"
          aria-label="Results"
          className="max-h-[52vh] overflow-y-auto p-2"
        >
          {results.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Nothing matches “{query}”.
              </p>
              {/* No dead ends: offer the next action instead of a bare miss. */}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push("/portal/musician/manager?new=1");
                }}
                className="mt-3 inline-flex items-center gap-1.5 rounded-pill px-4 py-2 text-xs font-medium bg-chimera-clay text-chimera-cream transition-all hover:brightness-105"
              >
                <Plus className="w-3.5 h-3.5" />
                Create an event instead
              </button>
            </div>
          ) : (
            grouped.map((section) => (
              <div key={section.group} className="mb-1">
                <div className="u-label text-muted-foreground/60 px-3 py-1.5">
                  {section.group}
                </div>
                {section.items.map((item) => {
                  flatIndex += 1;
                  const index = flatIndex;
                  const Icon = ICONS[item.icon ?? "arrow"];
                  const isActive = index === active;
                  return (
                    <div
                      key={item.id}
                      id={`palette-opt-${index}`}
                      data-index={index}
                      role="option"
                      aria-selected={isActive}
                      onMouseMove={() => setActive(index)}
                      onClick={() => runItem(item)}
                      className={[
                        "flex items-center gap-3 rounded-2xl px-3 py-2.5 cursor-pointer transition-colors",
                        isActive ? "bg-secondary" : "hover:bg-secondary/60",
                      ].join(" ")}
                    >
                      <Icon
                        className={[
                          "w-4 h-4 shrink-0",
                          isActive ? "text-chimera-clay" : "text-muted-foreground",
                        ].join(" ")}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-foreground truncate">{item.label}</div>
                        {item.hint && (
                          <div className="text-xs text-muted-foreground truncate">
                            {item.hint}
                          </div>
                        )}
                      </div>
                      {isActive && (
                        <CornerDownLeft className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border px-4 py-2.5 flex items-center gap-4">
          <span className="u-label text-muted-foreground/50 normal-case tracking-normal">
            ↑↓ navigate
          </span>
          <span className="u-label text-muted-foreground/50 normal-case tracking-normal">
            ↵ open
          </span>
          <span className="u-label text-muted-foreground/50 normal-case tracking-normal">
            ⌘K toggle
          </span>
        </div>
      </div>
    </div>
  );
}
