"""
Demo connector — a rich, realistic touring calendar with no credentials.

This exists because the product must FEEL live in a portfolio demo. Rather than
an empty portal with "connect a service to begin", one click populates a
believable working month: a European run with real venues, soundchecks the same
afternoon as each show, travel days between cities, a release date, rehearsals,
and a press deadline.

Two properties make it convincing:

  * DATE-RELATIVE. Everything is generated as an offset from today, so the
    calendar is never stale and "what's next" always has something in it.
  * DETERMINISTIC. Ids are derived from the offset, so re-syncing updates the
    same rows instead of duplicating them — the demo exercises the real
    idempotency path rather than bypassing it.

It is honest about itself: capabilities.demo is True, so the UI labels the
connection as demo data.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from models.canonical import CanonicalEvent, ExternalRef
from services.connectors.base import (
    Capabilities,
    Connector,
    PullResult,
    PushResult,
    SyncContext,
)

# A plausible European indie routing: geographically sensible, dates ordered so
# the routing engine in Block 3 has something real to reason about.
_TOUR: list[dict[str, Any]] = [
    {
        "offset": 6, "hour": 21,
        "title": "Sala Apolo — headline",
        "city": "Barcelona", "country": "Spain",
        "venue": "Sala Apolo", "address": "Carrer Nou de la Rambla 113, Barcelona",
        "lat": 41.3743, "lon": 2.1690, "capacity": 1200,
        "fee_cents": 90000, "promoter": "Marta Ruiz",
        "notes": "Load-in 18:00. 45 min set. House backline available.",
    },
    {
        "offset": 9, "hour": 20,
        "title": "Wurlitzer Ballroom",
        "city": "Madrid", "country": "Spain",
        "venue": "Wurlitzer Ballroom", "address": "Calle Tres Cruces 12, Madrid",
        "lat": 40.4189, "lon": -3.7016, "capacity": 200,
        "fee_cents": 40000, "promoter": "Ochoymedio",
        "notes": "Support slot. 30 min. Bring own DI boxes.",
    },
    {
        "offset": 13, "hour": 21,
        "title": "Kafe Antzokia",
        "city": "Bilbao", "country": "Spain",
        "venue": "Kafe Antzokia", "address": "Kale Nagusia 21-23, Bilbao",
        "lat": 43.2604, "lon": -2.9281, "capacity": 700,
        "fee_cents": 65000, "promoter": "Ander Etxeberria",
        "notes": "Co-headline. Hotel included in deal.",
    },
    {
        "offset": 17, "hour": 20,
        "title": "La Bellevilloise",
        "city": "Paris", "country": "France",
        "venue": "La Bellevilloise", "address": "19-21 Rue Boyer, 75020 Paris",
        "lat": 48.8683, "lon": 2.3897, "capacity": 900,
        "fee_cents": 110000, "promoter": "Camille Perrin",
        "notes": "First Paris show. Press attending — 2 photo passes.",
    },
    {
        "offset": 20, "hour": 21,
        "title": "Paradiso — Upstairs",
        "city": "Amsterdam", "country": "Netherlands",
        "venue": "Paradiso", "address": "Weteringschans 6-8, 1017 SG Amsterdam",
        "lat": 52.3622, "lon": 4.8836, "capacity": 600,
        "fee_cents": 120000, "promoter": "Sanne de Vries",
        "notes": "Kleine Zaal. Curfew 23:00 sharp.",
    },
]


class DemoConnector(Connector):
    key = "demo_tour"
    label = "Demo tour data"
    description = "Populate a realistic European run — no account needed."
    icon = "Sparkles"

    @property
    def capabilities(self) -> Capabilities:
        # push=True so the demo exercises the full two-way code path; pushes are
        # accepted and echoed rather than sent anywhere.
        return Capabilities(pull=True, push=True, oauth=False, demo=True)

    def is_configured(self) -> bool:
        return True

    def missing_env(self) -> list[str]:
        return []

    async def pull(self, ctx: SyncContext) -> PullResult:
        today = datetime.now(timezone.utc).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        events: list[CanonicalEvent] = []

        for stop in _TOUR:
            show_day = today + timedelta(days=stop["offset"])
            show_start = show_day.replace(hour=stop["hour"])

            # The gig itself.
            events.append(
                CanonicalEvent(
                    title=stop["title"],
                    event_type="gig",
                    starts_at=show_start,
                    ends_at=show_start + timedelta(hours=2),
                    location=f"{stop['venue']}, {stop['city']}",
                    notes=stop["notes"],
                    fee_cents=stop["fee_cents"],
                    currency="EUR",
                    gig_status="confirmed",
                    external=ExternalRef(
                        provider=self.key,
                        external_id=f"demo-gig-{stop['offset']}",
                    ),
                    # Carried so the sync engine can materialise a canonical
                    # Venue and promoter Contact and wire them to the gig —
                    # this is what makes the hub view immediately populated.
                    raw={
                        "venue": {
                            "name": stop["venue"],
                            "address": stop["address"],
                            "city": stop["city"],
                            "country": stop["country"],
                            "lat": stop["lat"],
                            "lon": stop["lon"],
                            "capacity": stop["capacity"],
                        },
                        "promoter": {"name": stop["promoter"], "role": "promoter"},
                    },
                )
            )

            # Soundcheck, same afternoon — gives the day view real texture.
            events.append(
                CanonicalEvent(
                    title=f"Soundcheck — {stop['venue']}",
                    event_type="rehearsal",
                    starts_at=show_day.replace(hour=16),
                    ends_at=show_day.replace(hour=17, minute=30),
                    location=f"{stop['venue']}, {stop['city']}",
                    notes="Line check, monitor mix, merch setup.",
                    external=ExternalRef(
                        provider=self.key, external_id=f"demo-sc-{stop['offset']}"
                    ),
                )
            )

        # Travel days between consecutive cities.
        for previous, nxt in zip(_TOUR, _TOUR[1:]):
            gap = nxt["offset"] - previous["offset"]
            if gap < 2:
                continue  # back-to-back; no dedicated travel day
            travel_day = today + timedelta(days=previous["offset"] + 1)
            events.append(
                CanonicalEvent(
                    title=f"Travel — {previous['city']} to {nxt['city']}",
                    event_type="other",
                    starts_at=travel_day.replace(hour=10),
                    ends_at=travel_day.replace(hour=18),
                    location=f"{previous['city']} → {nxt['city']}",
                    notes="Van + ferry/tolls. Budget fuel and one crew meal.",
                    external=ExternalRef(
                        provider=self.key,
                        external_id=f"demo-travel-{previous['offset']}",
                    ),
                )
            )

        # Non-gig commitments, so the timeline is not just shows.
        extras = [
            (2, 19, "rehearsal", "Full band rehearsal", "Rehearsal room, Poblenou",
             "Run the new set order twice."),
            (4, 11, "deadline", "Send press kit to Rockdelux", "",
             "Bio, 3 photos, streaming links. Deadline 12:00."),
            (11, 0, "release", "Single out — 'Neon Arcadia'", "",
             "All platforms. Schedule socials the night before."),
            (24, 10, "deadline", "Settle tour invoices", "",
             "Chase Paris and Amsterdam settlements."),
        ]
        for offset, hour, kind, title, location, note in extras:
            day = today + timedelta(days=offset)
            all_day = kind == "release"
            events.append(
                CanonicalEvent(
                    title=title,
                    event_type=kind,  # type: ignore[arg-type]
                    starts_at=day if all_day else day.replace(hour=hour),
                    ends_at=None if all_day else day.replace(hour=hour + 2),
                    all_day=all_day,
                    location=location,
                    notes=note,
                    external=ExternalRef(
                        provider=self.key, external_id=f"demo-extra-{offset}"
                    ),
                )
            )

        # cursor is a no-op marker: the demo set is fully regenerated each run,
        # and idempotent external_ids make that safe.
        return PullResult(events=events, cursor=datetime.now(timezone.utc).isoformat())

    async def push(self, ctx: SyncContext, event: CanonicalEvent) -> PushResult:
        """Accept and echo — exercises the push path without a remote system."""
        external_id = (
            event.external.external_id if event.external else f"demo-local-{event.id}"
        )
        return PushResult(external_id=external_id, etag="demo")

    async def delete(self, ctx: SyncContext, external_id: str) -> None:
        return None

    async def health(self, ctx: SyncContext) -> bool:
        return True
