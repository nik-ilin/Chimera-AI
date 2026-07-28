"""
Opportunity data sources.

WHAT THIS IS: a pipeline that finds venues and promoters who actually book
artists like the user, from a legitimate, documented API.

WHAT THIS DELIBERATELY IS NOT: a scraper. No HTML parsing, no headless browser,
no automated messaging. Scraping venue and agency sites would breach their terms,
break constantly, and put the user's own accounts at risk. The trade-off is that
coverage is limited to what a real API exposes — which is the correct trade.

Sources
-------
1. Ticketmaster Discovery API (live when TICKETMASTER_API_KEY is set).
   Free tier, instant approval at developer.ticketmaster.com. We query upcoming
   EVENTS in the artist's city filtered by genre, then aggregate them by VENUE:
   a room that has booked six indie-rock shows this quarter is a far better lead
   than a room merely listed as existing, and the event count doubles as the
   evidence we show the user.

2. Typed mock dataset (fallback when no key is configured).
   Real Spanish/European venues with real booking URLs, so the pipeline, the
   ranking, and the UI are all fully exercisable without credentials. Every row
   is tagged source="mock" and the API reports `live: false`, so a mocked result
   can never be mistaken for a live one.
"""
from __future__ import annotations

import asyncio
from typing import Any

import httpx
import structlog

from config import settings
from models.creator_context import CreatorContext
from models.opportunity import Opportunity

logger = structlog.get_logger()

_TICKETMASTER_BASE = "https://app.ticketmaster.com/discovery/v2"
_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


def source_is_live() -> bool:
    """True when a real API key is configured, i.e. results are not mocked."""
    return bool(settings.ticketmaster_api_key)


# ─── Ticketmaster ─────────────────────────────────────────────────────────────


async def _fetch_ticketmaster(
    ctx: CreatorContext,
    city: str,
    size: int,
) -> list[Opportunity]:
    """
    Query upcoming events in `city`, then fold them into per-venue opportunities.

    Genre is passed as `classificationName`, which Ticketmaster treats as a free-
    text match against its own genre taxonomy. An artist's self-described genre
    ("dark pop", "lo-fi hip-hop") often will not match it, so a miss falls back
    to an unfiltered music-segment query rather than returning nothing — a
    slightly broader list beats an empty page.
    """
    params: dict[str, Any] = {
        "apikey": settings.ticketmaster_api_key,
        "city": city,
        "classificationName": ctx.genre or "music",
        "size": min(size * 4, 100),  # over-fetch: many events collapse per venue
        "sort": "date,asc",
    }

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        response = await client.get(f"{_TICKETMASTER_BASE}/events.json", params=params)

        # A genre with no taxonomy match returns 200 + zero events, not an error.
        if response.status_code == 200:
            events = response.json().get("_embedded", {}).get("events", [])
            if not events and ctx.genre:
                logger.info("ticketmaster_genre_miss_retrying", genre=ctx.genre)
                params["classificationName"] = "music"
                response = await client.get(
                    f"{_TICKETMASTER_BASE}/events.json", params=params
                )
                events = response.json().get("_embedded", {}).get("events", [])
        else:
            logger.warning(
                "ticketmaster_error",
                status=response.status_code,
                body=response.text[:200],
            )
            return []

    return _aggregate_events_by_venue(events, size)


def _aggregate_events_by_venue(events: list[dict], size: int) -> list[Opportunity]:
    """
    Collapse an event list into venue opportunities.

    Aggregation is the whole point: 40 individual concert listings are noise to
    an artist looking for somewhere to play, whereas "these 8 rooms programme
    your genre, here's how often" is directly actionable.
    """
    venues: dict[str, dict[str, Any]] = {}

    for event in events:
        embedded = event.get("_embedded", {})
        venue_list = embedded.get("venues") or []
        if not venue_list:
            continue
        venue = venue_list[0]
        venue_id = venue.get("id")
        if not venue_id:
            continue

        entry = venues.setdefault(
            venue_id,
            {
                "name": venue.get("name", "Unknown venue"),
                "city": (venue.get("city") or {}).get("name", ""),
                "country": (venue.get("country") or {}).get("name", ""),
                "url": venue.get("url", ""),
                "capacity": None,
                "genres": set(),
                "count": 0,
                "examples": [],
            },
        )
        entry["count"] += 1

        for classification in event.get("classifications") or []:
            genre = (classification.get("genre") or {}).get("name")
            subgenre = (classification.get("subGenre") or {}).get("name")
            for value in (genre, subgenre):
                # Ticketmaster uses these as taxonomy placeholders; they carry
                # no information and would pollute the ranking prompt.
                if value and value not in ("Undefined", "Other"):
                    entry["genres"].add(value)

        if len(entry["examples"]) < 3 and event.get("name"):
            entry["examples"].append(event["name"])

    opportunities = [
        Opportunity(
            source="ticketmaster",
            source_id=venue_id,
            name=data["name"],
            kind="venue",
            city=data["city"],
            country=data["country"],
            capacity=data["capacity"],
            genres=sorted(data["genres"])[:6],
            evidence=[
                f"{data['count']} upcoming show{'s' if data['count'] != 1 else ''} "
                f"listed at this venue",
                *(
                    [f"Recent bookings: {', '.join(data['examples'])}"]
                    if data["examples"]
                    else []
                ),
            ],
            upcoming_events=data["count"],
            url=data["url"],
            contact_hint="Venue page on Ticketmaster — look for booking/contact details",
        )
        for venue_id, data in venues.items()
    ]

    # Most-active rooms first; the LLM re-ranks for fit, but this makes the
    # shortlist we hand it the useful one when we have to truncate.
    opportunities.sort(key=lambda o: o.upcoming_events, reverse=True)
    return opportunities[:size]


# ─── Mock dataset ─────────────────────────────────────────────────────────────

# Real venues with real public booking pages. Kept factual so the pipeline is
# demoed against plausible data — but always labelled source="mock".
_MOCK_VENUES: list[dict[str, Any]] = [
    {
        "source_id": "mock-apolo-bcn",
        "name": "Sala Apolo",
        "kind": "venue",
        "city": "Barcelona",
        "country": "Spain",
        "capacity": 1200,
        "genres": ["Indie", "Electronic", "Alternative", "Pop"],
        "evidence": [
            "Programmes 15+ live shows a month across two rooms",
            "Nasty Mondays / Crappy Tuesdays club nights draw a young indie crowd",
        ],
        "upcoming_events": 18,
        "url": "https://www.sala-apolo.com",
        "contact_hint": "Booking form on sala-apolo.com — La [2] room takes emerging acts",
    },
    {
        "source_id": "mock-razzmatazz-bcn",
        "name": "Razzmatazz",
        "kind": "venue",
        "city": "Barcelona",
        "country": "Spain",
        "capacity": 2000,
        "genres": ["Rock", "Indie", "Electronic", "Pop"],
        "evidence": [
            "Five rooms; smaller rooms regularly host support and local acts",
            "Hosts 20+ international touring acts per month",
        ],
        "upcoming_events": 24,
        "url": "https://www.salarazzmatazz.com",
        "contact_hint": "Booking contact listed on salarazzmatazz.com",
    },
    {
        "source_id": "mock-sidecar-bcn",
        "name": "Sidecar Factory Club",
        "kind": "venue",
        "city": "Barcelona",
        "country": "Spain",
        "capacity": 300,
        "genres": ["Indie", "Rock", "Singer-songwriter"],
        "evidence": [
            "Small room with a long history of first-time-in-city bookings",
            "Actively programmes unsigned local artists",
        ],
        "upcoming_events": 12,
        "url": "https://sidecar.es",
        "contact_hint": "Booking email published on sidecar.es",
    },
    {
        "source_id": "mock-primavera-pro",
        "name": "Primavera Pro",
        "kind": "festival",
        "city": "Barcelona",
        "country": "Spain",
        "capacity": None,
        "genres": ["Indie", "Electronic", "Pop", "Experimental"],
        "evidence": [
            "Industry arm of Primavera Sound with an open artist application window",
            "Showcase slots specifically for emerging and unsigned artists",
        ],
        "upcoming_events": 1,
        "url": "https://www.primaverapro.net",
        "contact_hint": "Open call — submit through the Primavera Pro artist portal",
    },
    {
        "source_id": "mock-ochoymedio-mad",
        "name": "Ochoymedio Club",
        "kind": "promoter",
        "city": "Madrid",
        "country": "Spain",
        "capacity": 600,
        "genres": ["Indie", "Pop", "Alternative"],
        "evidence": [
            "Promoter and club night running across several Madrid venues",
            "Long track record of booking Spanish indie acts early in their career",
        ],
        "upcoming_events": 9,
        "url": "https://www.ochoymedio.info",
        "contact_hint": "Promoter contact form on ochoymedio.info",
    },
    {
        "source_id": "mock-wurlitzer-mad",
        "name": "Wurlitzer Ballroom",
        "kind": "venue",
        "city": "Madrid",
        "country": "Spain",
        "capacity": 200,
        "genres": ["Rock", "Garage", "Indie", "Punk"],
        "evidence": [
            "Central Madrid room built around small touring and local bills",
            "Frequently books artists with no agent",
        ],
        "upcoming_events": 14,
        "url": "https://wurlitzerballroom.com",
        "contact_hint": "Booking email on the venue's contact page",
    },
    {
        "source_id": "mock-lauba-vlc",
        "name": "La Rambleta",
        "kind": "venue",
        "city": "Valencia",
        "country": "Spain",
        "capacity": 800,
        "genres": ["Indie", "Pop", "Jazz", "Electronic"],
        "evidence": [
            "Cultural centre with a dedicated emerging-artist programme",
            "Public open call for local acts each season",
        ],
        "upcoming_events": 7,
        "url": "https://larambleta.com",
        "contact_hint": "Seasonal open call — application form on larambleta.com",
    },
    {
        "source_id": "mock-kafe-antzokia-bio",
        "name": "Kafe Antzokia",
        "kind": "venue",
        "city": "Bilbao",
        "country": "Spain",
        "capacity": 700,
        "genres": ["Rock", "Indie", "World", "Electronic"],
        "evidence": [
            "Bilbao institution programming both local and touring artists",
            "Runs its own promoter arm for northern Spain routing",
        ],
        "upcoming_events": 11,
        "url": "https://www.kafeantzokia.eus",
        "contact_hint": "Booking contact published on kafeantzokia.eus",
    },
]


def _fetch_mock(ctx: CreatorContext, city: str, size: int) -> list[Opportunity]:
    """
    Mock source. Filters by city when the artist's city matches a row, otherwise
    returns the full set — an artist in a city we have no data for should still
    see the pipeline work rather than an empty page.
    """
    rows = _MOCK_VENUES
    if city:
        matches = [r for r in rows if r["city"].lower() == city.lower()]
        if matches:
            rows = matches

    return [Opportunity(source="mock", **row) for row in rows[:size]]


# ─── Public API ───────────────────────────────────────────────────────────────


async def fetch_opportunities(
    ctx: CreatorContext,
    city: str | None = None,
    size: int = 8,
) -> tuple[list[Opportunity], bool]:
    """
    Fetch raw (unranked) opportunities for a creator.

    Returns (opportunities, live) where `live` is False when the mock dataset was
    used — the route passes that flag through so the UI can say so plainly.

    A Ticketmaster failure degrades to the mock set instead of erroring: a
    partial, clearly-labelled answer is more useful to the musician than a 502.
    """
    target_city = (city or ctx.city or "").strip()

    if source_is_live():
        try:
            results = await asyncio.wait_for(
                _fetch_ticketmaster(ctx, target_city or "Barcelona", size),
                timeout=15.0,
            )
            if results:
                return results, True
            logger.info("ticketmaster_empty_falling_back_to_mock", city=target_city)
        except (httpx.HTTPError, asyncio.TimeoutError) as exc:
            logger.warning("ticketmaster_unavailable", error=str(exc))

    return _fetch_mock(ctx, target_city, size), False
