"""
Opportunity models — the normalised shape every data source is mapped into.

Design note (CONVENTIONS.md §1 risk register): Chimera does NOT scrape sites and
does NOT send outreach on the user's behalf. Opportunities come from a
documented, terms-compliant API (Ticketmaster Discovery) or from a typed mock
dataset, and the outreach message is a DRAFT the musician sends themselves.
Keeping this boundary in the type system — there is no `send()` anywhere in this
module — is deliberate.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

OpportunityKind = Literal["venue", "promoter", "festival", "agency"]


class Opportunity(BaseModel):
    """
    A single, actionable lead: a place or organisation that books artists like
    this one. Normalised across sources so the ranker and the UI never branch on
    where a row came from.
    """

    source: str = Field(
        description="Which data source produced this row: 'ticketmaster' or 'mock'."
    )
    source_id: str = Field(
        description="Stable id within that source. Used to de-duplicate saves."
    )
    name: str
    kind: OpportunityKind = "venue"

    city: str = ""
    country: str = ""
    # Nominal capacity. A useful career-level signal: a 3k-cap room is not
    # looking for an artist playing their fourth show.
    capacity: int | None = None

    genres: list[str] = Field(
        default_factory=list,
        description="Genres this venue/promoter actually programmes.",
    )
    evidence: list[str] = Field(
        default_factory=list,
        description=(
            "Concrete, checkable facts behind the match — e.g. 'Hosted 6 indie "
            "rock shows in the last 90 days'. Shown to the user so a "
            "recommendation is never an unexplained assertion."
        ),
    )
    upcoming_events: int = 0

    url: str = ""
    contact_hint: str = Field(
        default="",
        description=(
            "How to actually reach them (booking page, public email). Never a "
            "scraped personal address."
        ),
    )


class RankedOpportunity(Opportunity):
    """An Opportunity after Granite has scored it against the creator context."""

    fit_score: int = Field(default=0, ge=0, le=100)
    fit_reason: str = Field(default="", max_length=400)
    suggested_channel: str = Field(
        default="",
        max_length=120,
        description="Where the musician should reach out — e.g. 'Booking form'.",
    )
