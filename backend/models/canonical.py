"""
Canonical entity models — Chimera's OWN shapes.  (Block 0)

Every connector adapter converts provider payloads INTO these models and never
the other way round. Nothing downstream — routes, the sync engine, the portal —
ever sees a Google event or a CalDAV VEVENT; it sees a CanonicalEvent.

The payoff: adding a provider is one adapter file. The cost: each adapter owns a
lossy mapping, so anything provider-specific that we still want to show is
carried in `raw` rather than smuggled into a typed field.

Mirrors the layering of services/llm.py — one interface, many backends.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

# ─── Shared ───────────────────────────────────────────────────────────────────

EntityType = Literal["event", "venue", "contact", "booking", "release", "opportunity"]


class ExternalRef(BaseModel):
    """
    Where a canonical entity came from. The ONLY place a provider id is allowed
    to live (see external_refs in migration 007).
    """

    provider: str
    external_id: str
    etag: str = ""
    remote_updated_at: datetime | None = None


# ─── Venue ────────────────────────────────────────────────────────────────────


class CanonicalVenue(BaseModel):
    id: str | None = None
    name: str
    address: str = ""
    city: str = ""
    country: str = ""
    # Drives the map view and the tour-routing distance maths.
    lat: float | None = None
    lon: float | None = None
    capacity: int | None = None
    website: str = ""
    notes: str = ""
    external: ExternalRef | None = None


# ─── Contact ──────────────────────────────────────────────────────────────────

ContactRole = Literal["promoter", "booker", "venue", "agency", "press", "crew", "other"]


class CanonicalContact(BaseModel):
    id: str | None = None
    name: str
    role: ContactRole = "other"
    organisation: str = ""
    email: str = ""
    phone: str = ""
    notes: str = ""
    external: ExternalRef | None = None


# ─── Event ────────────────────────────────────────────────────────────────────

EventType = Literal["gig", "release", "rehearsal", "deadline", "other"]
GigStatus = Literal["enquiry", "held", "confirmed", "settled", "cancelled"]


class CanonicalEvent(BaseModel):
    """
    The spine of the Manager module. A gig is not a calendar row — it is a hub
    that venue, promoter, bookings and expenses hang off, which is why this
    model carries their ids rather than living in a separate 'gig' table.
    """

    id: str | None = None
    title: str
    event_type: EventType = "gig"
    # Always an aware UTC instant. Adapters MUST convert floating/local times
    # (RFC 5545 allows both) before constructing this model.
    starts_at: datetime
    ends_at: datetime | None = None
    all_day: bool = False
    location: str = ""
    notes: str = ""

    # ── Gig-hub fields ──
    venue_id: str | None = None
    promoter_id: str | None = None
    fee_cents: int = 0
    currency: str = "EUR"
    gig_status: GigStatus = "confirmed"
    setlist: str = ""
    rider: str = ""
    tour_id: str | None = None

    external: ExternalRef | None = None
    # Provider fields we deliberately did not model. Kept so the UI can show
    # them without a migration, and so a push can round-trip unknown data.
    raw: dict[str, Any] = Field(default_factory=dict)


# ─── Booking ──────────────────────────────────────────────────────────────────

BookingKind = Literal["accommodation", "travel", "backline", "other"]
BookingStatus = Literal["option", "confirmed", "cancelled"]


class CanonicalBooking(BaseModel):
    """Accommodation or travel attached to a gig."""

    id: str | None = None
    event_id: str | None = None
    kind: BookingKind = "accommodation"
    status: BookingStatus = "option"
    name: str
    address: str = ""
    lat: float | None = None
    lon: float | None = None
    check_in: datetime | None = None
    check_out: datetime | None = None
    reference: str = ""
    cost_cents: int = 0
    currency: str = "EUR"
    url: str = ""
    notes: str = ""
    payload: dict[str, Any] = Field(default_factory=dict)
    external: ExternalRef | None = None


# ─── Release ──────────────────────────────────────────────────────────────────

ReleaseKind = Literal["single", "ep", "album", "video"]


class CanonicalRelease(BaseModel):
    id: str | None = None
    title: str
    kind: ReleaseKind = "single"
    release_date: date | None = None
    label: str = ""
    artwork_url: str = ""
    tracks: list[dict[str, Any]] = Field(default_factory=list)
    notes: str = ""
    external: ExternalRef | None = None


# ─── Expense ──────────────────────────────────────────────────────────────────

ExpenseKind = Literal[
    "fee_in", "travel", "accommodation", "crew", "gear", "marketing", "other"
]


class CanonicalExpense(BaseModel):
    id: str | None = None
    event_id: str | None = None
    booking_id: str | None = None
    kind: ExpenseKind = "other"
    description: str = ""
    # Signed minor units: positive = money in, negative = money out. Minor units
    # (not floats) because 0.1 + 0.2 must not decide an artist's settlement.
    amount_cents: int = 0
    currency: str = "EUR"
    incurred_on: date | None = None
