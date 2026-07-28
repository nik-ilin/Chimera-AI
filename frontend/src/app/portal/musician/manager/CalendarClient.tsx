"use client";
/**
 * Event Calendar — Client Component.
 *
 * Month grid + agenda list over /api/events. Data flow is deliberately simple:
 * the month in view drives a windowed fetch, and mutations patch local state
 * directly rather than refetching, so adding an event feels instant.
 *
 * Keyboard: ← / → change month, T jumps to today, N opens a new event, and the
 * grid itself is a roving-tabindex widget so a keyboard user reaches any day
 * without 42 tab stops.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  List,
  MapPin,
  Plus,
  Loader2,
  CalendarPlus,
} from "lucide-react";

import {
  addMonths,
  buildMonthGrid,
  dateKey,
  dateKeyFromIso,
  defaultStartForDay,
  formatEventWhen,
  formatFullDay,
  formatMonthTitle,
  formatTime,
  isToday,
  startOfMonth,
  startOfNextMonth,
  WEEKDAY_LABELS,
} from "@/lib/calendar";
import { EVENT_TYPE_META } from "@/lib/events-schema";
import type { EventRow } from "@/types/supabase";
import EventDialog from "./EventDialog";

type View = "month" | "list";

/** Dialog state: closed, creating on a given day, or editing an existing row. */
type DialogState =
  | { open: false }
  | { open: true; event: null; initialStart: string }
  | { open: true; event: EventRow; initialStart: string };

export default function CalendarClient({ initialEvents }: { initialEvents: EventRow[] }) {
  const [month, setMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [view, setView] = useState<View>("month");
  const [events, setEvents] = useState<EventRow[]>(initialEvents);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const [focusedDay, setFocusedDay] = useState<string>(() => dateKey(new Date()));

  const gridRef = useRef<HTMLDivElement>(null);
  // Guards against a slow response for month A landing after month B was
  // selected and overwriting it — the classic out-of-order fetch race.
  const requestSeq = useRef(0);

  const grid = useMemo(() => buildMonthGrid(month), [month]);

  /**
   * Events bucketed by LOCAL day key. Built once per change instead of
   * filtering the array inside all 42 cells, which would be O(42 × n).
   */
  const byDay = useMemo(() => {
    const map = new Map<string, EventRow[]>();
    for (const event of events) {
      const key = dateKeyFromIso(event.starts_at);
      const bucket = map.get(key);
      if (bucket) bucket.push(event);
      else map.set(key, [event]);
    }
    // Array.from rather than iterating the Map directly — tsconfig has no
    // `target`, so tsc defaults to ES5 and rejects Map iteration without
    // --downlevelIteration.
    for (const bucket of Array.from(map.values())) {
      bucket.sort((a: EventRow, b: EventRow) => a.starts_at.localeCompare(b.starts_at));
    }
    return map;
  }, [events]);

  /** Upcoming-first agenda: future events ascending, then past descending. */
  const listEvents = useMemo(() => {
    const now = Date.now();
    const upcoming = events
      .filter((e) => Date.parse(e.starts_at) >= now)
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const past = events
      .filter((e) => Date.parse(e.starts_at) < now)
      .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
    return { upcoming, past };
  }, [events]);

  // ── Fetch the visible month ──
  const loadMonth = useCallback(async (target: Date) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setLoadError(null);
    try {
      const from = startOfMonth(target).toISOString();
      const to = startOfNextMonth(target).toISOString();
      const response = await fetch(
        `/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );
      if (seq !== requestSeq.current) return; // superseded
      if (!response.ok) {
        setLoadError("Could not load your calendar.");
        return;
      }
      const data = await response.json();
      setEvents((data.events ?? []) as EventRow[]);
    } catch {
      if (seq === requestSeq.current) setLoadError("Could not reach the server.");
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  // Skip the fetch on first paint — the server component already handed us the
  // current month, and refetching it would flash the grid for no reason.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void loadMonth(month);
  }, [month, loadMonth]);

  // ── Global shortcuts ──
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (dialog.open) return;
      // Never hijack keys while the user is typing somewhere.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "ArrowLeft") {
        setMonth((m) => addMonths(m, -1));
      } else if (e.key === "ArrowRight") {
        setMonth((m) => addMonths(m, 1));
      } else if (e.key === "t" || e.key === "T") {
        const today = new Date();
        setMonth(startOfMonth(today));
        setFocusedDay(dateKey(today));
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        openCreate(new Date());
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialog.open]);

  function openCreate(day: Date) {
    setDialog({ open: true, event: null, initialStart: defaultStartForDay(day) });
  }

  function openEdit(event: EventRow) {
    setDialog({ open: true, event, initialStart: event.starts_at });
  }

  /**
   * Merge a created/updated row into local state without a refetch.
   * If it moved out of the visible month it is dropped from the grid — the
   * month fetch would not have returned it anyway.
   */
  function handleSaved(saved: EventRow) {
    setEvents((prev) => {
      const without = prev.filter((e) => e.id !== saved.id);
      const start = Date.parse(saved.starts_at);
      const inView =
        start >= startOfMonth(month).getTime() && start < startOfNextMonth(month).getTime();
      return inView ? [...without, saved] : without;
    });
    setDialog({ open: false });
  }

  function handleDeleted(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setDialog({ open: false });
  }

  // ── Roving focus inside the month grid ──
  function onGridKeyDown(e: React.KeyboardEvent) {
    const deltas: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const delta = deltas[e.key];
    if (delta === undefined) return;

    e.preventDefault();
    e.stopPropagation(); // don't also trigger the month-change shortcut

    const index = grid.findIndex((d) => dateKey(d) === focusedDay);
    const current = index >= 0 ? grid[index] : new Date();
    const next = new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate() + delta
    );
    setFocusedDay(dateKey(next));

    // Walking off either edge pulls the adjacent month into view.
    if (next < grid[0] || next > grid[grid.length - 1]) {
      setMonth(startOfMonth(next));
    }
    requestAnimationFrame(() => {
      gridRef.current
        ?.querySelector<HTMLElement>(`[data-day="${dateKey(next)}"]`)
        ?.focus();
    });
  }

  const monthIndex = month.getMonth();
  const totalThisMonth = events.length;

  return (
    <>
      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMonth((m) => addMonths(m, -1))}
            aria-label="Previous month"
            className="w-9 h-9 rounded-xl flex items-center justify-center border border-border text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setMonth((m) => addMonths(m, 1))}
            aria-label="Next month"
            className="w-9 h-9 rounded-xl flex items-center justify-center border border-border text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <h2
          className="font-display text-xl font-semibold tracking-tight text-foreground min-w-[10rem]"
          aria-live="polite"
        >
          {formatMonthTitle(month)}
        </h2>

        <button
          type="button"
          onClick={() => {
            const today = new Date();
            setMonth(startOfMonth(today));
            setFocusedDay(dateKey(today));
          }}
          className="u-label rounded-pill border border-border px-3.5 py-2 text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
        >
          Today
        </button>

        {loading && (
          <Loader2
            className="w-4 h-4 animate-spin text-chimera-clay"
            aria-label="Loading events"
          />
        )}

        <div className="flex-1" />

        {/* View switch */}
        <div className="relative flex p-1 rounded-pill bg-secondary/70" role="tablist">
          <span
            aria-hidden="true"
            className="absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-pill bg-card shadow-soft transition-transform duration-500 ease-spring"
            style={{ transform: view === "list" ? "translateX(100%)" : "translateX(0)" }}
          />
          {(["month", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={[
                "relative z-10 inline-flex items-center gap-1.5 rounded-pill px-3.5 py-1.5 text-xs font-medium capitalize transition-colors",
                view === v ? "text-foreground" : "text-muted-foreground",
              ].join(" ")}
            >
              {v === "month" ? (
                <CalendarDays className="w-3.5 h-3.5" />
              ) : (
                <List className="w-3.5 h-3.5" />
              )}
              {v}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => openCreate(new Date())}
          className="inline-flex items-center gap-1.5 rounded-pill px-4 py-2 text-sm font-medium bg-chimera-clay text-chimera-cream shadow-clay-glow transition-all hover:brightness-105 active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          New event
        </button>
      </div>

      {loadError && (
        <div
          role="alert"
          className="mb-5 rounded-widget border border-destructive/30 bg-destructive/5 px-5 py-4 text-sm text-destructive animate-scale-in"
        >
          {loadError}{" "}
          <button
            type="button"
            onClick={() => void loadMonth(month)}
            className="underline underline-offset-4 font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Month grid ── */}
      {view === "month" && (
        <div className="widget p-3 sm:p-5 animate-fade-up">
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5 mb-1.5">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="u-label text-muted-foreground/70 text-center py-2">
                <span className="hidden sm:inline">{label}</span>
                <span className="sm:hidden">{label[0]}</span>
              </div>
            ))}
          </div>

          <div
            ref={gridRef}
            className="grid grid-cols-7 gap-1 sm:gap-1.5"
            role="grid"
            aria-label={`${formatMonthTitle(month)} calendar`}
            onKeyDown={onGridKeyDown}
          >
            {grid.map((day) => {
              const key = dateKey(day);
              const dayEvents = byDay.get(key) ?? [];
              const outside = day.getMonth() !== monthIndex;
              const today = isToday(day);

              return (
                <div
                  key={key}
                  role="gridcell"
                  data-day={key}
                  // Roving tabindex: exactly one cell is tabbable, arrows move
                  // between them. 42 tab stops would be unusable otherwise.
                  tabIndex={focusedDay === key ? 0 : -1}
                  aria-label={`${formatFullDay(day)}, ${dayEvents.length} event${
                    dayEvents.length === 1 ? "" : "s"
                  }`}
                  onFocus={() => setFocusedDay(key)}
                  onClick={() => openCreate(day)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openCreate(day);
                    }
                  }}
                  className={[
                    "group relative min-h-[4.5rem] sm:min-h-[6.5rem] rounded-2xl p-1.5 sm:p-2 cursor-pointer",
                    "border transition-all duration-300 ease-smooth",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-chimera-clay/50",
                    outside
                      ? "border-transparent bg-transparent opacity-40"
                      : "border-border/60 bg-background/40 hover:bg-secondary/50 hover:border-border",
                    today ? "ring-1 ring-chimera-clay/40 bg-chimera-clay-muted/25" : "",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={[
                        "text-xs tabular-nums w-6 h-6 rounded-lg flex items-center justify-center",
                        today
                          ? "bg-chimera-clay text-chimera-cream font-semibold"
                          : "text-muted-foreground",
                      ].join(" ")}
                    >
                      {day.getDate()}
                    </span>
                    <Plus className="w-3.5 h-3.5 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
                  </div>

                  <div className="flex flex-col gap-0.5">
                    {/* Cap at 3 so a busy day can't blow out the row height. */}
                    {dayEvents.slice(0, 3).map((event) => {
                      const meta = EVENT_TYPE_META[event.event_type];
                      return (
                        <button
                          key={event.id}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation(); // don't also open "create"
                            openEdit(event);
                          }}
                          title={event.title}
                          className="flex items-center gap-1 rounded-md px-1 py-0.5 text-left hover:bg-card transition-colors"
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`}
                            aria-hidden="true"
                          />
                          <span className="text-[0.6875rem] leading-tight truncate text-foreground">
                            {!event.all_day && (
                              <span className="text-muted-foreground tabular-nums mr-1 hidden sm:inline">
                                {formatTime(event.starts_at)}
                              </span>
                            )}
                            {event.title}
                          </span>
                        </button>
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setView("list");
                        }}
                        className="text-[0.625rem] text-muted-foreground hover:text-chimera-clay px-1 text-left transition-colors"
                      >
                        +{dayEvents.length - 3} more
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="u-label text-muted-foreground/50 mt-4 text-center normal-case tracking-normal">
            ← → month · T today · N new event · click a day to add
          </p>
        </div>
      )}

      {/* ── List / agenda ── */}
      {view === "list" && (
        <div className="flex flex-col gap-5 animate-fade-up">
          {totalThisMonth === 0 ? (
            <EmptyState onCreate={() => openCreate(new Date())} month={month} />
          ) : (
            <>
              <EventGroup
                label="Upcoming"
                events={listEvents.upcoming}
                onSelect={openEdit}
                emptyNote="Nothing left this month."
              />
              {listEvents.past.length > 0 && (
                <EventGroup label="Earlier" events={listEvents.past} onSelect={openEdit} muted />
              )}
            </>
          )}
        </div>
      )}

      {/* Empty month in grid view */}
      {view === "month" && totalThisMonth === 0 && !loading && (
        <div className="mt-5">
          <EmptyState onCreate={() => openCreate(new Date())} month={month} />
        </div>
      )}

      {dialog.open && (
        <EventDialog
          event={dialog.event}
          initialStart={dialog.initialStart}
          onClose={() => setDialog({ open: false })}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function EventGroup({
  label,
  events,
  onSelect,
  muted = false,
  emptyNote,
}: {
  label: string;
  events: EventRow[];
  onSelect: (e: EventRow) => void;
  muted?: boolean;
  emptyNote?: string;
}) {
  return (
    <section>
      <div className="u-label text-muted-foreground mb-3">{label}</div>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground/70">{emptyNote}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((event, i) => {
            const meta = EVENT_TYPE_META[event.event_type];
            return (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => onSelect(event)}
                  style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }}
                  className={[
                    "group w-full text-left widget p-4 flex items-start gap-4 animate-fade-up",
                    "transition-all duration-300 ease-smooth hover:shadow-widget-lg hover:-translate-y-0.5",
                    muted ? "opacity-60 hover:opacity-100" : "",
                  ].join(" ")}
                >
                  <span
                    className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${meta.dot}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-semibold text-foreground tracking-tight truncate">
                        {event.title}
                      </span>
                      <span className={`u-label rounded-pill px-2 py-0.5 ${meta.chip}`}>
                        {meta.label}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {formatEventWhen(event.starts_at, event.all_day)}
                    </div>
                    {event.location && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1.5">
                        <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">{event.location}</span>
                      </div>
                    )}
                    {event.notes && (
                      <p className="text-xs text-muted-foreground/80 mt-2 line-clamp-2 leading-relaxed">
                        {event.notes}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function EmptyState({ onCreate, month }: { onCreate: () => void; month: Date }) {
  return (
    <div className="widget p-10 flex flex-col items-center text-center animate-scale-in">
      <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center mb-5">
        <CalendarPlus className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="font-display text-xl font-semibold tracking-tight text-foreground">
        Nothing in {formatMonthTitle(month)}
      </h3>
      <p className="text-sm text-muted-foreground mt-2 max-w-xs leading-relaxed">
        Add your gigs, release dates, rehearsals and deadlines so the rest of the portal can
        work around them.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-6 inline-flex items-center gap-1.5 rounded-pill px-5 py-2.5 text-sm font-medium bg-chimera-clay text-chimera-cream shadow-clay-glow transition-all hover:brightness-105 active:scale-[0.98]"
      >
        <Plus className="w-4 h-4" />
        Add your first event
      </button>
    </div>
  );
}
