"""
POST /api/visual-brief

Expands a rough artist brief into a detailed Stable Diffusion prompt.
Uses the Granite build_image_brief task (temp=0.4, max_tokens=512).
Service-token guarded. Rate-limited: 3/minute (image gen is expensive).

CONVENTIONS.md §4: build_image_brief task.
"""
from __future__ import annotations

import uuid
from typing import Literal

import structlog
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from dependencies.auth import verify_service_token
from models.creator_context import CreatorContext
from services.output_schemas import BuildImageBriefOutput
from services.task_executor import get_executor
from limiter import limiter

logger = structlog.get_logger()
router = APIRouter(tags=["ai"], dependencies=[Depends(verify_service_token)])


class VisualBriefRequest(BaseModel):
    user_brief: str = Field(
        min_length=1,
        max_length=2000,
        description="Artist's rough description of the desired image.",
    )
    variant: Literal["promo", "album_cover"] = "promo"
    creator_context: CreatorContext = Field(default_factory=CreatorContext)


class VisualBriefResponse(BaseModel):
    request_id: str
    result: BuildImageBriefOutput


@router.post("/visual-brief", response_model=VisualBriefResponse)
@limiter.limit("3/minute")
async def visual_brief(
    request: Request,
    body: VisualBriefRequest,
) -> VisualBriefResponse:
    rid = str(uuid.uuid4())
    logger.info("visual_brief_request", request_id=rid, variant=body.variant)

    result = await get_executor().build_image_brief(
        ctx=body.creator_context,
        user_brief=body.user_brief,
        variant=body.variant,
        request_id=rid,
    )
    return VisualBriefResponse(request_id=rid, result=result)
