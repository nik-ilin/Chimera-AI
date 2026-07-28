"use client";
/**
 * Unified timeline — what's next, what needs attention, quick actions.
 *
 * The manager's home surface. Its job is to answer "what do I need to do?"
 * before the user has to think of the question, which is why "needs attention"
 * sits ABOVE the chronological list rather than being a filter you must find.
 *
 * Attention rules are computed client-side from data already loaded — no extra
 * round-trip, and they stay correct as the user edits things optimistically.
 */
import { useMemo } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  BedDouble,
  Building2,
  CalendarPlus,
  CircleDollarSign,
  Clock,
  MapPin,
  Plus,
  UserRound,
} from "lucide-react";

import { EVENT_TYPE_META } from "@/lib/events-schema";
import { GIG_STATUS_META } from "@/lib/events-schema";
import type { EventType, GigStatus } from "@/types/supabase";

export interface TimelineItem {
  id: string;
  title: string;
  event_type: EventType;
  starts_at: string;
  all_day: boolean;
  location: string;
  gig_status: GigStatus;
  fee_cents: number;
  currency: string;
  venue: { id: string; name: string; city: string; lat: number | null } | null;
  promoter: { id: string; name: string } | null;
  bookingCount: number;
}

interface Attention {
  id: string;
  eventId: string;
  severity: "high" | "medium";
  message: string;
  action: string;
}

/**
 * Things a manager would chase.
 *
 * Deliberately conservative — a nag screen that cries wolf gets ignored, so
 * each rule targets something with a real consequence (a show you cannot get
 * paid for, a night with nowhere to sleep).
 */
function findAttention(items: TimelineItem[]): Attention[] {
  const out: Attention[] = [];
  const now = Date.now();
  const DAY = 86_400_000;

  for (const item of items) {
    if (item.event_type !== "gig") continue;
    if (item.gig_status === "cancelled") continue;

    const daysAway = (Date.parse(item.starts_at) - now) / DAY;
    if (daysAway < 0) {
      // Past show with a fee and no settlement — that is unpaid work.
      if (item.gig_status === "confirmed" && item.fee_cents > 0 && daysAway > -60) {
        out.push({
          id: `${item.id}-settle`,
          eventId: item.id,
          severity: "high",
          message: `${item.title} has played but isn't settled`,
          action: "Mark settled",
        });
      }
      continue;
    }

    if (item.gig_status === "enquiry" && daysAway < 30) {
      out.push({
        id: `${item.id}-confirm`,
        eventId: item.id,
        severity: "high",
        message: `${item.title} is still an enquiry, ${Math.ceil(daysAway)} days out`,
        action: "Confirm or drop",
      });
    }
    if (!item.venue && daysAway < 21) {
      out.push({
        id: `${item.id}-venue`,
        eventId: item.id,
        severity: "medium",
        message: `${item.title} has no venue attached`,
        action: "Add venue",
      });
    }
    if (item.bookingCount === 0 && daysAway < 14 && item.venue) {
      out.push({
        id: `${item.id}-stay`,
        eventId: item.id,
        severity: "medium",
        message: `No accommodation booked for ${item.venue.city || item.title}`,
        action: "Add booking",
      });
    }
    if (item.fee_cents === 0 && item.gig_status === "confirmed" && daysAway < 30) {
      out.push({
        id: `${item.id}-fee`,
        eventId: item.id,
        severity: "medium",
        message: `${item.title} is confirmed with no fee recorded`,
        action: "Set fee",
      });
    }
  }

  // Highest severity first, capped — a wall of warnings is noise.
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1)).slice(0, 5);
}

export default function Timeline({
  items,
  onCreate,
}: {
  items: TimelineItem[];
  onCreate: () => void;
}) {
  const now = Date.now();

  const upcoming = useMemo(
    () =>
      items
        .filter((i) => Date.parse(i.starts_at) >= now - 3_600_000)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [items, now]
  );
  const attention = useMemo(() => findAttention(items), [items]);
  const next = upcoming[0];

  if (items.length === 0) {
    return (
      <div className="widget p-10 flex flex-col items-center text-center animate-scale-in">
        <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center mb-5">
          <CalendarPlus className="w-5 h-5 text-muted-foreground" />
        </div>
        <h3 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Your timeline is empty
        </h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm leading-relaxed">
          Add a gig by hand, or connect a calendar and Chimera will pull it in —
          venues, promoters and costs attach to whatever it imports.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex items-center gap-1.5 rounded-pill px-5 py-2.5 text-sm font-medium bg-chimera-clay text-chimera-cream shadow-clay-glow transition-all hover:brightness-105 active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            Add an event
          </button>
          <Link
            href="/portal/musician/manager/connections"
            className="inline-flex items-center gap-1.5 rounded-pill border border-border px-5 py-2.5 text-sm font-medium hover:bg-card transition-colors"
          >
            Connect a calendar
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* ── Next up ── */}
      {next && (
        <Link href={`/portal/musician/manager/gig/${next.id}`} className="group block">
          <div className="widget-ink p-6 animate-fade-up transition-transform duration-500 ease-smooth group-hover:-translate-y-0.5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="u-label text-chimera-cream/50 mb-2">Next up</div>
                <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-chimera-cream truncate">
                  {next.title}
                </h2>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-sm text-chimera-cream/70">
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    {formatWhen(next.starts_at, next.all_day)}
                  </span>
                  {next.venue && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" />
                      {next.venue.name}
                      {next.venue.city ? `, ${next.venue.city}` : ""}
                    </span>
                  )}
                  {next.fee_cents > 0 && (
                    <span className="inline-flex items-center gap-1.5 tabular-nums">
                      <CircleDollarSign className="w-3.5 h-3.5" />
                      {money(next.fee_cents, next.currency)}
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-display text-3xl font-semibold text-chimera-cream tabular-nums">
                  {countdown(next.starts_at)}
                </div>
                <ArrowUpRight className="w-4 h-4 text-chimera-cream/40 ml-auto mt-2 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
            </div>
          </div>
        </Link>
      )}

      {/* ── Needs attention ── */}
      {attention.length > 0 && (
        <div className="widget p-5 animate-fade-up" style={{ animationDelay: "60ms" }}>
          <div className="u-label text-muted-foreground mb-3 flex items-center gap-1.5">
            <AlertCircle className="w-3 h-3" />
            Needs attention
          </div>
          <ul className="flex flex-col gap-1">
            {attention.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={`/portal/musician/manager/gig/${entry.eventId}`}
                  className="flex items-center gap-3 rounded-2xl px-3 py-2.5 -mx-3 transition-colors hover:bg-secondary/60 group"
                >
                  <span
                    className={[
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      entry.severity === "high" ? "bg-destructive" : "bg-chimera-gold",
                    ].join(" ")}
                  />
                  <span className="text-sm text-foreground flex-1 min-w-0 truncate">
                    {entry.message}
                  </span>
                  <span className="u-label text-chimera-clay shrink-0 hidden sm:inline">
                    {entry.action}
                  </span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-chimera-clay transition-colors shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Chronological list ── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="u-label text-muted-foreground">Coming up</div>
          <button
            type="button"
            onClick={onCreate}
            className="inline-flex items-center gap-1.5 rounded-pill px-3.5 py-1.5 text-xs font-medium border border-border hover:bg-card transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </div>

        {upcoming.length === 0 ? (
          <div className="widget p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Nothing scheduled ahead.{" "}
              <button
                type="button"
                onClick={onCreate}
                className="text-chimera-clay font-medium hover:underline underline-offset-4"
              >
                Add something
              </button>
              .
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {upcoming.slice(1, 25).map((item, i) => {
              const meta = EVENT_TYPE_META[item.event_type];
              const statusMeta = GIG_STATUS_META[item.gig_status];
              return (
                <li key={item.id}>
                  <Link
                    href={`/portal/musician/manager/gig/${item.id}`}
                    style={{ animationDelay: `${Math.min(i * 40, 320)}ms` }}
                    className="group widget p-4 flex items-start gap-4 animate-fade-up transition-all duration-300 ease-smooth hover:shadow-widget-lg hover:-translate-y-0.5"
                  >
                    {/* Date block */}
                    <div className="shrink-0 w-12 text-center">
                      <div className="u-label text-muted-foreground">
                        {new Date(item.starts_at).toLocaleDateString(undefined, {
                          month: "short",
                        })}
                      </div>
                      <div className="font-display text-2xl font-semibold text-foreground tabular-nums leading-tight">
                        {new Date(item.starts_at).getDate()}
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                        <span className="font-semibold text-foreground tracking-tight truncate">
                          {item.title}
                        </span>
                        {item.event_type === "gig" && item.gig_status !== "confirmed" && (
                          <span className={`u-label rounded-pill px-2 py-0.5 ${statusMeta.chip}`}>
                            {statusMeta.label}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="tabular-nums">
                          {formatWhen(item.starts_at, item.all_day)}
                        </span>
                        {item.venue && (
                          <span className="inline-flex items-center gap-1">
                            <Building2 className="w-3 h-3" />
                            {item.venue.name}
                          </span>
                        )}
                        {item.promoter && (
                          <span className="inline-flex items-center gap-1">
                            <UserRound className="w-3 h-3" />
                            {item.promoter.name}
                          </span>
                        )}
                        {item.bookingCount > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <BedDouble className="w-3 h-3" />
                            {item.bookingCount}
                          </span>
                        )}
                      </div>
                    </div>

                    {item.fee_cents > 0 && (
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold text-foreground tabular-nums">
                          {money(item.fee_cents, item.currency)}
                        </div>
                      </div>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

// ─── formatting ───────────────────────────────────────────────────────────────

function formatWhen(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  if (allDay) return day;
  return `${day} · ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "EUR",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** Compact countdown for the hero card: "3d", "6h", "now". */
function countdown(iso: string): string {
  const diff = Date.parse(iso) - Date.now();
  if (diff <= 0) return "now";
  const days = Math.floor(diff / 86_400_000);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 1) return `${hours}h`;
  return `${Math.max(1, Math.floor(diff / 60_000))}m`;
}
