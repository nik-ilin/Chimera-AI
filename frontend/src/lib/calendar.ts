/**
 * Date helpers for the Personal Manager calendar.
 *
 * The whole module rests on one rule: the DATABASE stores UTC instants, the UI
 * works in the viewer's LOCAL zone. Every conversion between the two happens
 * here, so a component never has to think about it.
 *
 * Why this matters: a gig at 21:00 in Madrid is 19:00Z. If the grid bucketed
 * events by their UTC date it would land on the wrong day for anyone west of
 * UTC after ~19:00 local — the classic "my evening event shows up tomorrow"
 * bug. Bucketing is therefore always done on local Y/M/D.
 *
 * No date library: these are ~60 lines of arithmetic and the native Date +
 * Intl APIs cover formatting, so pulling in date-fns would be pure weight.
 */

/** Days rendered per month view: 6 weeks × 7, so the grid never reflows. */
export const GRID_DAYS = 42;

/** Monday-first week, matching European convention (the artist is in Spain). */
export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Local midnight of the given date. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** First instant of the following month — an exclusive upper bound. */
export function startOfNextMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

export function addMonths(d: Date, delta: number): Date {
  // Anchor on day 1 before shifting: new Date(2026, 0, 31) + 1 month would
  // otherwise overflow to March 3rd rather than landing in February.
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

/**
 * Stable local-date key, "YYYY-MM-DD".
 *
 * Deliberately NOT toISOString().slice(0,10) — that converts to UTC first and
 * reintroduces the off-by-one-day bug this module exists to prevent.
 */
export function dateKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Local-date key for a UTC ISO instant, i.e. which cell an event belongs in. */
export function dateKeyFromIso(iso: string): string {
  return dateKey(new Date(iso));
}

export function isSameDay(a: Date, b: Date): boolean {
  return dateKey(a) === dateKey(b);
}

export function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

/**
 * The 42 cells of a month view, starting on the Monday on or before the 1st.
 * Always returns exactly GRID_DAYS entries so the grid height is constant and
 * navigating months doesn't make the page jump.
 */
export function buildMonthGrid(month: Date): Date[] {
  const first = startOfMonth(month);
  // getDay(): 0=Sun … 6=Sat. Remap so Monday is 0.
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);

  return Array.from(
    { length: GRID_DAYS },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
  );
}

// ─── <input type="datetime-local"> / <input type="date"> bridging ─────────────

/**
 * UTC ISO instant → the "YYYY-MM-DDTHH:mm" string a datetime-local input wants.
 * The input has no timezone concept, so we hand it local wall-clock time.
 */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** UTC ISO instant → "YYYY-MM-DD" for a date input. */
export function toDateInput(iso: string): string {
  return dateKey(new Date(iso));
}

/**
 * datetime-local / date input value → UTC ISO instant.
 *
 * `new Date("2026-08-01T20:00")` (no zone suffix) is parsed as LOCAL time by
 * every current engine, which is exactly what we want. A bare "2026-08-01",
 * however, is parsed as UTC midnight — so all-day values get "T00:00" appended
 * to force local interpretation and keep the day from sliding backwards.
 */
export function fromLocalInput(value: string): string {
  const normalized = value.includes("T") ? value : `${value}T00:00`;
  return new Date(normalized).toISOString();
}

// ─── Formatting ───────────────────────────────────────────────────────────────

const monthTitle = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});
const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});
const dayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
});
const fullDayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function formatMonthTitle(d: Date): string {
  return monthTitle.format(d);
}

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function formatDay(iso: string): string {
  return dayFmt.format(new Date(iso));
}

export function formatFullDay(d: Date): string {
  return fullDayFmt.format(d);
}

/** "Mon 4 Aug · 21:00", or just the day for all-day events. */
export function formatEventWhen(iso: string, allDay: boolean): string {
  return allDay ? formatDay(iso) : `${formatDay(iso)} · ${formatTime(iso)}`;
}

/**
 * A sensible default start time for an event created by clicking a day cell:
 * that day at 20:00 local — most gigs and rehearsals are evening events, so it
 * beats defaulting to midnight.
 */
export function defaultStartForDay(day: Date): string {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    20,
    0,
    0,
    0
  ).toISOString();
}
