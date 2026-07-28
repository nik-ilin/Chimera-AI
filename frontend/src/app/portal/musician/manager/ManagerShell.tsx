"use client";
/**
 * Manager shell — one surface, three lenses on the same data.
 *
 * Timeline / Calendar / Map are VIEWS, not separate pages: switching is instant
 * and keeps state, because they answer different questions about one dataset.
 * Routing between them would throw away context and make the module feel like a
 * menu of tools, which is exactly what it must not be.
 *
 * Owns the command palette and the create dialog so every view gets both for
 * free.
 */
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CalendarDays, List, Map as MapIcon, Plug, Plus } from "lucide-react";

import CalendarClient from "./CalendarClient";
import EventDialog from "./EventDialog";
import CommandPalette, { type PaletteItem } from "@/components/manager/CommandPalette";
import Timeline, { type TimelineItem } from "@/components/manager/Timeline";
import TourMap, { type MapStop } from "@/components/manager/TourMap";
import { defaultStartForDay } from "@/lib/calendar";
import type { EventRow } from "@/types/supabase";

type View = "timeline" | "calendar" | "map";

const VIEWS: { key: View; label: string; icon: typeof List }[] = [
  { key: "timeline", label: "Timeline", icon: List },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "map", label: "Map", icon: MapIcon },
];

export default function ManagerShell({
  initialTimeline,
  initialMonthEvents,
  openNew,
}: {
  initialTimeline: TimelineItem[];
  initialMonthEvents: EventRow[];
  /** ?new=1 — the palette's "create instead" escape hatch lands here. */
  openNew: boolean;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("timeline");
  const [timeline, setTimeline] = useState(initialTimeline);
  const [creating, setCreating] = useState(openNew);

  const openCreate = useCallback(() => setCreating(true), []);

  // Only gigs with real coordinates can be plotted; anything else would land at
  // (0,0) in the Gulf of Guinea and wreck the bounding box.
  const mapStops = useMemo<MapStop[]>(
    () =>
      timeline
        .filter(
          (item): item is TimelineItem & { venue: NonNullable<TimelineItem["venue"]> } =>
            item.event_type === "gig" &&
            item.gig_status !== "cancelled" &&
            item.venue !== null &&
            item.venue.lat !== null
        )
        .map((item) => ({
          id: item.id,
          title: item.title,
          city: item.venue.city || item.venue.name,
          lat: item.venue.lat as number,
          // lat is non-null by the filter; lon is stored alongside it.
          lon: (item.venue as unknown as { lon: number }).lon,
          startsAt: item.starts_at,
        }))
        .filter((stop) => typeof stop.lon === "number"),
    [timeline]
  );

  // ── Command palette contents ──
  const paletteItems = useMemo<PaletteItem[]>(() => {
    const actions: PaletteItem[] = [
      {
        id: "new-event",
        label: "Add an event",
        hint: "Gig, release, rehearsal or deadline",
        group: "Actions",
        icon: "plus",
        run: openCreate,
      },
      {
        id: "view-timeline",
        label: "Go to timeline",
        group: "Navigate",
        icon: "arrow",
        run: () => setView("timeline"),
      },
      {
        id: "view-calendar",
        label: "Go to calendar",
        group: "Navigate",
        icon: "calendar",
        run: () => setView("calendar"),
      },
      {
        id: "view-map",
        label: "Go to map",
        hint: "Tour routing",
        group: "Navigate",
        icon: "map",
        run: () => setView("map"),
      },
      {
        id: "connections",
        label: "Connect a service",
        hint: "Google Calendar, CalDAV, demo data",
        group: "Navigate",
        icon: "plug",
        run: () => router.push("/portal/musician/manager/connections"),
      },
      {
        id: "opportunities",
        label: "Find opportunities",
        hint: "Venues and promoters matched to your profile",
        group: "Navigate",
        icon: "compass",
        run: () => router.push("/portal/musician/manager/opportunities"),
      },
    ];

    const events: PaletteItem[] = timeline.map((item) => ({
      id: item.id,
      label: item.title,
      hint: new Date(item.starts_at).toLocaleDateString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
      }),
      group: "Gigs & events",
      icon: "calendar",
      // Venue and city are searchable but not shown — typing "apolo" or
      // "amsterdam" should find the show even if neither is in the title.
      keywords: `${item.venue?.name ?? ""} ${item.venue?.city ?? ""} ${item.location} ${item.promoter?.name ?? ""}`,
      run: () => router.push(`/portal/musician/manager/gig/${item.id}`),
    }));

    return [...actions, ...events];
  }, [timeline, openCreate, router]);

  /** After a save, refresh Server Components so every view sees the change. */
  function handleSaved(saved: EventRow) {
    setCreating(false);
    setTimeline((prev) =>
      prev.some((i) => i.id === saved.id)
        ? prev.map((i) => (i.id === saved.id ? { ...i, ...saved } : i))
        : [
            ...prev,
            {
              ...saved,
              venue: null,
              promoter: null,
              bookingCount: 0,
            } as TimelineItem,
          ]
    );
    router.refresh();
  }

  return (
    <>
      {/* ── View switcher + actions ── */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex p-1 rounded-pill bg-secondary/70" role="tablist">
          <span
            aria-hidden="true"
            className="absolute inset-y-1 rounded-pill bg-card shadow-soft transition-transform duration-500 ease-spring"
            style={{
              width: "calc(33.333% - 0.1667rem)",
              left: "0.25rem",
              transform: `translateX(${VIEWS.findIndex((v) => v.key === view) * 100}%)`,
            }}
          />
          {VIEWS.map((entry) => {
            const Icon = entry.icon;
            return (
              <button
                key={entry.key}
                type="button"
                role="tab"
                aria-selected={view === entry.key}
                onClick={() => setView(entry.key)}
                className={[
                  "relative z-10 inline-flex items-center gap-1.5 rounded-pill px-4 py-1.5 text-xs font-medium transition-colors",
                  view === entry.key ? "text-foreground" : "text-muted-foreground",
                ].join(" ")}
              >
                <Icon className="w-3.5 h-3.5" />
                {entry.label}
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        <CommandPalette items={paletteItems} />

        <Link
          href="/portal/musician/manager/connections"
          className="inline-flex items-center gap-1.5 rounded-pill border border-border px-3.5 py-2 text-xs text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
        >
          <Plug className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Connections</span>
        </Link>

        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 rounded-pill px-4 py-2 text-sm font-medium bg-chimera-clay text-chimera-cream shadow-clay-glow transition-all hover:brightness-105 active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New event</span>
        </button>
      </div>

      {/* ── Views ── */}
      {view === "timeline" && <Timeline items={timeline} onCreate={openCreate} />}

      {view === "calendar" && <CalendarClient initialEvents={initialMonthEvents} />}

      {view === "map" && (
        <TourMap
          stops={mapStops}
          onSelect={(id) => router.push(`/portal/musician/manager/gig/${id}`)}
        />
      )}

      {creating && (
        <EventDialog
          event={null}
          initialStart={defaultStartForDay(new Date())}
          onClose={() => setCreating(false)}
          onSaved={handleSaved}
          onDeleted={() => setCreating(false)}
        />
      )}
    </>
  );
}
