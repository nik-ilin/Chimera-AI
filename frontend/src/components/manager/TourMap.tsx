"use client";
/**
 * Tour map — gigs plotted with travel legs drawn between them.
 *
 * Pure SVG over a self-computed Web Mercator projection (lib/geo.ts). No tile
 * server, no API key, no map library: it renders offline, matches the editorial
 * palette exactly, and animates the way the rest of the system does.
 *
 * The route draws itself on mount via stroke-dashoffset, which is the single
 * most effective bit of motion in the module — it turns a static scatter of
 * pins into a tour you can read left to right.
 *
 * Accessibility: the SVG is decorative-but-informative, so it carries a role
 * and a label, and every datum it shows is also present in the legend list
 * below it. A screen-reader user is never asked to interpret a picture.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { MapPin, TriangleAlert } from "lucide-react";

import {
  arcPath,
  assessLeg,
  distanceKm,
  estimateDriveHours,
  fitProjection,
  formatDistance,
  formatDuration,
  type LatLon,
} from "@/lib/geo";

export interface MapStop {
  id: string;
  title: string;
  city: string;
  lat: number;
  lon: number;
  startsAt: string;
  capacity?: number | null;
}

const VIEW = { width: 760, height: 420, padding: 56 };

export default function TourMap({
  stops,
  onSelect,
}: {
  stops: MapStop[];
  onSelect?: (id: string) => void;
}) {
  const [drawn, setDrawn] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const pathRefs = useRef<Map<string, SVGPathElement>>(new Map());

  // Chronological order is what makes the route meaningful; the caller may pass
  // them in any order.
  const ordered = useMemo(
    () => [...stops].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [stops]
  );

  const toScreen = useMemo(
    () => fitProjection(ordered.map(({ lat, lon }): LatLon => ({ lat, lon })), VIEW),
    [ordered]
  );

  const legs = useMemo(() => {
    return ordered.slice(0, -1).map((from, i) => {
      const to = ordered[i + 1];
      const km = distanceKm(from, to);
      const hoursAvailable =
        (Date.parse(to.startsAt) - Date.parse(from.startsAt)) / 3_600_000;
      return {
        key: `${from.id}-${to.id}`,
        from,
        to,
        km,
        driveHours: estimateDriveHours(km),
        feasibility: assessLeg(km, hoursAvailable),
        path: arcPath(toScreen(from), toScreen(to)),
      };
    });
  }, [ordered, toScreen]);

  // Trigger the draw-on after mount. rAF (not a timeout) so the browser has
  // committed the initial dashoffset before we transition away from it —
  // otherwise the animation is skipped entirely.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, [ordered.length]);

  if (ordered.length === 0) {
    return (
      <div className="widget p-10 flex flex-col items-center text-center">
        <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center mb-5">
          <MapPin className="w-5 h-5 text-muted-foreground" />
        </div>
        <h3 className="font-display text-xl font-semibold tracking-tight text-foreground">
          No mapped shows yet
        </h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-xs leading-relaxed">
          Gigs appear here once they have a venue with coordinates. Connect the
          demo tour or add a venue to a gig to see the routing.
        </p>
      </div>
    );
  }

  const impossibleCount = legs.filter((l) => l.feasibility === "impossible").length;
  const totalKm = legs.reduce((sum, l) => sum + l.km, 0);

  return (
    <div className="widget overflow-hidden">
      {/* ── Map ── */}
      <div className="relative bg-gradient-to-b from-secondary/40 to-card">
        <svg
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          className="w-full h-auto block"
          role="img"
          aria-label={`Tour route across ${ordered.length} cities, ${Math.round(totalKm)} kilometres total`}
        >
          <defs>
            {/* Subtle graticule — gives the projection a sense of place without
                a basemap competing with the palette. */}
            <pattern id="graticule" width="48" height="48" patternUnits="userSpaceOnUse">
              <path
                d="M 48 0 L 0 0 0 48"
                fill="none"
                stroke="hsl(var(--border))"
                strokeWidth="0.5"
                opacity="0.5"
              />
            </pattern>
            <radialGradient id="stopGlow">
              <stop offset="0%" stopColor="hsl(var(--chimera-clay))" stopOpacity="0.35" />
              <stop offset="100%" stopColor="hsl(var(--chimera-clay))" stopOpacity="0" />
            </radialGradient>
          </defs>

          <rect width={VIEW.width} height={VIEW.height} fill="url(#graticule)" />

          {/* ── Legs ── */}
          {legs.map((leg, i) => {
            const isProblem = leg.feasibility === "impossible";
            const isTight = leg.feasibility === "tight";
            const stroke = isProblem
              ? "hsl(var(--destructive))"
              : isTight
                ? "hsl(var(--chimera-gold))"
                : "hsl(var(--chimera-clay))";

            return (
              <g key={leg.key}>
                <path
                  ref={(el) => {
                    if (el) pathRefs.current.set(leg.key, el);
                  }}
                  d={leg.path}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={isProblem ? 2.5 : 1.75}
                  strokeLinecap="round"
                  strokeDasharray={isProblem ? "6 5" : "1000"}
                  strokeDashoffset={drawn || isProblem ? 0 : 1000}
                  opacity={hovered && hovered !== leg.from.id && hovered !== leg.to.id ? 0.25 : 0.9}
                  style={{
                    transition: `stroke-dashoffset 1.1s cubic-bezier(0.22,1,0.36,1) ${
                      160 + i * 180
                    }ms, opacity 0.3s ease`,
                  }}
                />
              </g>
            );
          })}

          {/* ── Stops ── */}
          {ordered.map((stop, i) => {
            const { x, y } = toScreen(stop);
            const isHovered = hovered === stop.id;
            // Marker size hints at room size — a visual cue that a 200-cap club
            // and a 2000-cap hall are different propositions.
            const radius = stop.capacity
              ? Math.max(5, Math.min(11, 4 + Math.log10(stop.capacity) * 2))
              : 6;

            return (
              <g
                key={stop.id}
                transform={`translate(${x} ${y})`}
                className="cursor-pointer"
                onMouseEnter={() => setHovered(stop.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelect?.(stop.id)}
                style={{
                  opacity: drawn ? 1 : 0,
                  transition: `opacity 0.5s ease ${200 + i * 180}ms`,
                }}
              >
                <circle r={26} fill="url(#stopGlow)" />
                <circle
                  r={radius + (isHovered ? 3 : 0)}
                  fill="hsl(var(--chimera-clay))"
                  stroke="hsl(var(--card))"
                  strokeWidth="2.5"
                  style={{ transition: "r 0.3s cubic-bezier(0.34,1.4,0.5,1)" }}
                />
                <text
                  y={-radius - 10}
                  textAnchor="middle"
                  className="font-mono"
                  fontSize="11"
                  fill="hsl(var(--foreground))"
                  fontWeight={600}
                >
                  {stop.city}
                </text>
                <text
                  y={radius + 15}
                  textAnchor="middle"
                  className="font-mono"
                  fontSize="9"
                  fill="hsl(var(--muted-foreground))"
                >
                  {new Date(stop.startsAt).toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                  })}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Routing warning overlay */}
        {impossibleCount > 0 && (
          <div className="absolute top-4 left-4 flex items-center gap-2 rounded-pill bg-destructive/10 border border-destructive/30 px-3 py-1.5 backdrop-blur animate-scale-in">
            <TriangleAlert className="w-3.5 h-3.5 text-destructive" />
            <span className="text-xs font-medium text-destructive">
              {impossibleCount} leg{impossibleCount > 1 ? "s" : ""} not physically possible
            </span>
          </div>
        )}
      </div>

      {/* ── Legend / leg list: the same data, readable without the picture ── */}
      <div className="border-t border-border p-5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4">
          <div className="u-label text-muted-foreground">
            {ordered.length} shows · {formatDistance(totalKm)} total
          </div>
          <div className="flex items-center gap-3 text-[0.6875rem] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded bg-chimera-clay" /> comfortable
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded bg-chimera-gold" /> tight
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded bg-destructive" /> impossible
            </span>
          </div>
        </div>

        <ul className="flex flex-col gap-1.5">
          {legs.map((leg) => (
            <li
              key={leg.key}
              onMouseEnter={() => setHovered(leg.from.id)}
              onMouseLeave={() => setHovered(null)}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs rounded-xl px-2.5 py-1.5 -mx-2.5 transition-colors hover:bg-secondary/60"
            >
              <span className="text-foreground font-medium">
                {leg.from.city} → {leg.to.city}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {formatDistance(leg.km)}
              </span>
              <span className="text-muted-foreground/70 tabular-nums">
                ~{formatDuration(leg.driveHours)} drive
              </span>
              {leg.feasibility !== "easy" && (
                <span
                  className={[
                    "u-label rounded-pill px-2 py-0.5",
                    leg.feasibility === "impossible"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-chimera-gold/15 text-chimera-gold",
                  ].join(" ")}
                >
                  {leg.feasibility}
                </span>
              )}
            </li>
          ))}
        </ul>

        <p className="u-label text-muted-foreground/50 mt-4 normal-case tracking-normal leading-relaxed">
          Distances are great-circle; drive times estimate road distance at
          ~80 km/h. Not a routing service.
        </p>
      </div>
    </div>
  );
}
