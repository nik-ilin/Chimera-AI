"""
POST /api/opportunities        — find + rank booking opportunities
POST /api/opportunities/draft  — draft an outreach message for one of them

Service-token guarded, rate-limited per client IP.

Scope boundary (CONVENTIONS.md §1 risk register): these endpoints READ from a
documented third-party API and generate text. They never scrape, and they never
send a message on the user's behalf — /draft returns a draft for the musician to
review and send themselves.

NOTE: do NOT add `from __future__ import annotations` here — see the explanation
in routes/classify.py. The slowapi decorator breaks PEP 563 annotations.
"""
import uuid

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from dependencies.auth import verify_service_token
from limiter import limiter
from models.creator_context import CreatorContext
from models.opportunity import Opportunity, RankedOpportunity
from services.opportunities import fetch_opportunities, source_is_live
from services.output_schemas import DraftOutreachOutput
from services.task_executor import get_executor

logger = structlog.get_logger()
router = APIRouter(tags=["manager"], dependencies=[Depends(verify_service_token)])


class FindOpportunitiesRequest(BaseModel):
    creator_context: CreatorContext = Field(default_factory=CreatorContext)
    # Overrides creator_context.city — lets an artist scout a city they plan to
    # tour rather than only the one they live in.
    city: str | None = Field(default=None, max_length=100)
    career_level: str = Field(default="emerging", max_length=40)
    size: int = Field(default=8, ge=1, le=20)


class FindOpportunitiesResponse(BaseModel):
    request_id: str
    # False when the mock dataset was used. Surfaced in the UI so a demo result
    # is never mistaken for live data.
    live: bool
    source: str
    opportunities: list[RankedOpportunity]


@router.post("/opportunities", response_model=FindOpportunitiesResponse)
@limiter.limit("10/minute")
async def find_opportunities(
    request: Request,
    body: FindOpportunitiesRequest,
) -> FindOpportunitiesResponse:
    """
    Pipeline: read profile → query source → rank by fit → return cards.

    The LLM step is the slow one, so the source fetch is bounded independently
    inside services/opportunities.py; a slow Ticketmaster degrades to mock data
    rather than timing out the whole request.
    """
    rid = str(uuid.uuid4())
    logger.info("opportunities_request", request_id=rid, city=body.city)

    raw, live = await fetch_opportunities(
        ctx=body.creator_context,
        city=body.city,
        size=body.size,
    )

    ranked = await get_executor().rank_opportunities(
        ctx=body.creator_context,
        opportunities=raw,
        career_level=body.career_level,
        request_id=rid,
    )

    return FindOpportunitiesResponse(
        request_id=rid,
        live=live,
        source="ticketmaster" if live else "mock",
        opportunities=ranked,
    )


class DraftOutreachRequest(BaseModel):
    creator_context: CreatorContext = Field(default_factory=CreatorContext)
    opportunity: Opportunity
    # Anything the artist wants woven in — a date they're routing through, a
    # recent release. Treated as untrusted text by the prompt template.
    notes: str = Field(default="", max_length=500)


class DraftOutreachResponse(BaseModel):
    request_id: str
    draft: DraftOutreachOutput


@router.post("/opportunities/draft", response_model=DraftOutreachResponse)
@limiter.limit("15/minute")
async def draft_outreach(
    request: Request,
    body: DraftOutreachRequest,
) -> DraftOutreachResponse:
    rid = str(uuid.uuid4())
    logger.info("outreach_draft_request", request_id=rid, target=body.opportunity.name)

    try:
        draft = await get_executor().draft_outreach(
            ctx=body.creator_context,
            opportunity=body.opportunity,
            extra_notes=body.notes,
            request_id=rid,
        )
    except ValueError as exc:
        # The model failed to return usable JSON even after the repair retry.
        # 502 rather than 500: the fault is upstream, and it is retryable.
        logger.warning("outreach_draft_failed", request_id=rid, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not draft a message right now. Please try again.",
        ) from exc

    return DraftOutreachResponse(request_id=rid, draft=draft)


class SourceStatusResponse(BaseModel):
    live: bool
    source: str
    missing_env: list[str]


@router.get("/opportunities/status", response_model=SourceStatusResponse)
async def opportunities_status() -> SourceStatusResponse:
    """
    Report whether the opportunity finder is backed by live data, and what is
    missing if not. The UI reads this to show an honest "demo data" banner
    instead of silently presenting mock venues as real leads.
    """
    live = source_is_live()
    return SourceStatusResponse(
        live=live,
        source="ticketmaster" if live else "mock",
        missing_env=[] if live else ["TICKETMASTER_API_KEY"],
    )
