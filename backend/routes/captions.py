"""
POST /api/captions

Generates 3 caption variants for Instagram or TikTok using Granite.
Runs 3 independent generations concurrently via asyncio.gather.
Service-token guarded. Rate-limited: 10/minute per user.

CONVENTIONS.md §4: write_captions task, temp=0.8, max_tokens=512.

NOTE: do NOT add `from __future__ import annotations` here — the slowapi
@limiter.limit decorator swaps __globals__, breaking string-annotation
resolution of the request body (FastAPI mis-binds it as a Query param).
"""
import uuid
from typing import Literal

import structlog
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from dependencies.auth import verify_service_token
from models.creator_context import CreatorContext
from services.output_schemas import WriteCaptionsOutput
from services.task_executor import get_executor
from limiter import limiter

logger = structlog.get_logger()
router = APIRouter(tags=["ai"], dependencies=[Depends(verify_service_token)])


class CaptionsRequest(BaseModel):
    context: str = Field(
        min_length=1,
        max_length=2000,
        description="Context for the caption: event, release, mood, etc.",
    )
    platform: Literal["instagram", "tiktok"] = "instagram"
    n_variants: int = Field(default=3, ge=1, le=5)
    creator_context: CreatorContext = Field(default_factory=CreatorContext)


class CaptionsResponse(BaseModel):
    request_id: str
    result: WriteCaptionsOutput


@router.post("/captions", response_model=CaptionsResponse)
@limiter.limit("10/minute")
async def write_captions(
    request: Request,
    body: CaptionsRequest,
) -> CaptionsResponse:
    rid = str(uuid.uuid4())
    logger.info("captions_request", request_id=rid, platform=body.platform)

    result = await get_executor().write_captions_concurrent(
        ctx=body.creator_context,
        context=body.context,
        platform=body.platform,
        n_variants=body.n_variants,
        request_id=rid,
    )
    return CaptionsResponse(request_id=rid, result=result)
