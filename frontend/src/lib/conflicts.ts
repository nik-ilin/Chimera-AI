/**
 * Calendar conflict detection.
 *
 * Two genuinely different failure modes, and conflating them would make both
 * useless:
 *
 *  1. OVERLAP — two events occupying the same clock time. Cheap, certain.
 *  2. TRAVEL — consecutive gigs in cities too far apart for the gap between
 *     them. Not visible on a calendar grid at all, and by far the more
 *     expensive mistake: you find out when you're on the motorway.
 *
 * Pure functions over data the client already has, so the calendar can flag a
 * drag-and-drop reschedule the instant it happens rather than after a round
 * trip.
 */
import { assessLeg, distanceKm, estimateDriveHours, type LatLon } from "@/lib/geo";

export interface ConflictEvent {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  all_day: boolean;
  event_type: string;
  venue?: { city: string; lat: number | null; lon: number | null } | null;
}

export type ConflictKind = "overlap" | "travel";

export interface Conflict {
  kind: ConflictKind;
  severity: "warning" | "error";
  /** Ids of the events involved — the calendar highlights both. */
  eventIds: [string, string];
  message: string;
}

/**
 * Effective end of an event.
 *
 * An event with no end is treated as 2 hours for a gig and 1 hour otherwise —
 * a show plus load-out genuinely blocks an evening, whereas a deadline does
 * not. Treating a missing end as zero-length would hide every real clash.
 */
function endOf(event: ConflictEvent): number {
  const start = Date.parse(event.starts_at);
  if (event.ends_at) return Date.parse(event.ends_at);
  if (event.all_day) return start + 86_400_000;
  return start + (event.event_type === "gig" ? 2 : 1) * 3_600_000;
}

function hasCoords(
  event: ConflictEvent
): event is ConflictEvent & { venue: { city: string; lat: number; lon: number } } {
  return (
    event.venue != null &&
    typeof event.venue.lat === "number" &&
    typeof event.venue.lon === "number"
  );
}

/**
 * Find every conflict in a set of events.
 *
 * O(n log n) via a single sort plus a forward scan — the naive all-pairs
 * comparison is fine at 20 events and quadratic at 2000.
 */
export function detectConflicts(events: ConflictEvent[]): Conflict[] {
  const sorted = [...events]
    .filter((e) => !Number.isNaN(Date.parse(e.starts_at)))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));

  const conflicts: Conflict[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const currentEnd = endOf(current);

    for (let j = i + 1; j < sorted.length; j++) {
      const next = sorted[j];
      const nextStart = Date.parse(next.starts_at);

      // Sorted by start, so once the next event begins after this one ends
      // there is nothing further to compare against `current`.
      if (nextStart >= currentEnd) {
        // Still worth ONE travel check against the immediate successor.
        if (j === i + 1) {
          const travel = checkTravel(current, next);
          if (travel) conflicts.push(travel);
        }
        break;
      }

      // All-day events are containers, not commitments — a release date does
      // not clash with the rehearsal that day.
      if (current.all_day || next.all_day) continue;

      conflicts.push({
        kind: "overlap",
        severity: "error",
        eventIds: [current.id, next.id],
        message: `“${current.title}” overlaps “${next.title}”`,
      });
    }
  }

  return conflicts;
}

/**
 * Is there time to physically get from one gig to the next?
 *
 * Only meaningful when both ends have coordinates and both are gigs; a rehearsal
 * and a deadline in different cities is not a routing problem.
 */
function checkTravel(from: ConflictEvent, to: ConflictEvent): Conflict | null {
  if (from.event_type !== "gig" || to.event_type !== "gig") return null;
  if (!hasCoords(from) || !hasCoords(to)) return null;

  const a: LatLon = { lat: from.venue.lat, lon: from.venue.lon };
  const b: LatLon = { lat: to.venue.lat, lon: to.venue.lon };
  const km = distanceKm(a, b);

  // Same city — nothing to warn about.
  if (km < 25) return null;

  // Measure from the END of the first show, not its start: what matters is the
  // time actually available to travel.
  const hoursAvailable = (Date.parse(to.starts_at) - endOf(from)) / 3_600_000;
  const verdict = assessLeg(km, hoursAvailable);
  if (verdict === "easy") return null;

  const drive = estimateDriveHours(km);
  return {
    kind: "travel",
    severity: verdict === "impossible" ? "error" : "warning",
    eventIds: [from.id, to.id],
    message:
      verdict === "impossible"
        ? `${from.venue.city} → ${to.venue.city} is ${Math.round(km)} km (~${Math.round(
            drive
          )}h) with only ${Math.max(0, Math.round(hoursAvailable))}h between shows`
        : `Tight run: ${from.venue.city} → ${to.venue.city}, ${Math.round(km)} km in ${Math.round(
            hoursAvailable
          )}h`,
  };
}

/** Index conflicts by event id so a calendar cell can look itself up in O(1). */
export function conflictsByEvent(conflicts: Conflict[]): Map<string, Conflict[]> {
  const map = new Map<string, Conflict[]>();
  for (const conflict of conflicts) {
    for (const id of conflict.eventIds) {
      const existing = map.get(id);
      if (existing) existing.push(conflict);
      else map.set(id, [conflict]);
    }
  }
  return map;
}
