/**
 * Geography helpers for the tour map and routing.
 *
 * No map library and no tile server. A Leaflet/Mapbox dependency would add a
 * runtime API key, a network round-trip per tile, and a visual language that
 * fights the beige editorial identity. Instead we project coordinates ourselves
 * and draw an SVG — deterministic, offline, themable with the existing tokens,
 * and it renders identically in a screenshot or a PDF later.
 *
 * The projection is Web Mercator (EPSG:3857), the same one every slippy map
 * uses, so if a raster basemap is ever added the markers will line up without
 * re-projection.
 */

/** Earth radius in kilometres (mean). */
const EARTH_RADIUS_KM = 6371;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Point {
  x: number;
  y: number;
}

// ─── Projection ───────────────────────────────────────────────────────────────

/**
 * Web Mercator forward projection, normalised to a 0..1 unit square.
 *
 * Latitude is clamped to ±85.05° — the Mercator y term diverges at the poles,
 * and an unclamped value produces an Infinity that silently corrupts the whole
 * bounding box. No touring band plays Svalbard, but a bad coordinate from a
 * geocoder shouldn't blank the map.
 */
export function project({ lat, lon }: LatLon): Point {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const x = (lon + 180) / 360;
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  const y = 0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI);
  return { x, y };
}

export interface Viewport {
  width: number;
  height: number;
  padding: number;
}

/**
 * Build a projector that fits `points` inside a viewport.
 *
 * A single point (or several in the same city) yields a zero-size extent, which
 * would divide by zero and place everything at NaN. We floor the span to a small
 * value so one gig renders centred at a sensible zoom instead of vanishing.
 */
export function fitProjection(points: LatLon[], viewport: Viewport) {
  const projected = points.map(project);

  const xs = projected.map((p) => p.x);
  const ys = projected.map((p) => p.y);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 1;
  const minY = ys.length ? Math.min(...ys) : 0;
  const maxY = ys.length ? Math.max(...ys) : 1;

  const MIN_SPAN = 0.012; // ≈ a few hundred km at European latitudes
  const spanX = Math.max(maxX - minX, MIN_SPAN);
  const spanY = Math.max(maxY - minY, MIN_SPAN);

  const innerWidth = viewport.width - viewport.padding * 2;
  const innerHeight = viewport.height - viewport.padding * 2;

  // One scale for both axes so the map is not stretched — anamorphic maps read
  // as broken even when the topology is right.
  const scale = Math.min(innerWidth / spanX, innerHeight / spanY);

  const centreX = (minX + maxX) / 2;
  const centreY = (minY + maxY) / 2;

  return function toScreen(coord: LatLon): Point {
    const p = project(coord);
    return {
      x: viewport.width / 2 + (p.x - centreX) * scale,
      y: viewport.height / 2 + (p.y - centreY) * scale,
    };
  };
}

// ─── Distance ─────────────────────────────────────────────────────────────────

/**
 * Great-circle distance in kilometres (haversine).
 *
 * Used for travel legs and to flag impossible routing. Haversine is the right
 * tool: exact enough at touring scale, and it has none of the edge cases a
 * flat-earth approximation hits across the anti-meridian.
 */
export function distanceKm(a: LatLon, b: LatLon): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Rough driving time. Real road distance runs ~25% over great-circle in
 * Europe, and a van averages ~80 km/h including stops.
 *
 * Deliberately an estimate, and labelled as one in the UI — a fake-precise
 * "7h 14m" from a routing API we don't have would be worse than an honest "~7h".
 */
export function estimateDriveHours(km: number): number {
  return (km * 1.25) / 80;
}

// ─── Route drawing ────────────────────────────────────────────────────────────

/**
 * A quadratic Bézier between two screen points, bowed perpendicular to the leg.
 *
 * Straight lines between cities read as a scribble once legs cross; a
 * consistent arc makes direction legible and gives the draw-on animation
 * something graceful to follow. The control point is offset perpendicular to
 * the midpoint, scaled to leg length so short hops stay nearly straight.
 */
export function arcPath(from: Point, to: Point, curvature = 0.18): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;

  // Perpendicular vector, normalised then scaled by leg length.
  const length = Math.hypot(dx, dy) || 1;
  const offsetX = (-dy / length) * length * curvature;
  const offsetY = (dx / length) * length * curvature;

  return `M ${from.x.toFixed(2)} ${from.y.toFixed(2)} Q ${(midX + offsetX).toFixed(2)} ${(
    midY + offsetY
  ).toFixed(2)} ${to.x.toFixed(2)} ${to.y.toFixed(2)}`;
}

// ─── Routing sanity ───────────────────────────────────────────────────────────

export type LegFeasibility = "easy" | "tight" | "impossible";

/**
 * Judge whether a leg is physically playable.
 *
 * Thresholds are deliberately generous — this flags genuinely broken routing
 * (Barcelona to Berlin overnight by van), not merely demanding schedules that
 * touring bands do all the time.
 */
export function assessLeg(km: number, hoursAvailable: number): LegFeasibility {
  const driveHours = estimateDriveHours(km);
  // Beyond ~1500 km a van is off the table; assume a flight day instead.
  const needed = km > 1500 ? 6 : driveHours + 2; // +2h for load-out and load-in

  if (hoursAvailable < needed) return "impossible";
  if (hoursAvailable < needed * 1.5) return "tight";
  return "easy";
}

export function formatDistance(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return minutes === 0 ? `${whole}h` : `${whole}h ${minutes}m`;
}
