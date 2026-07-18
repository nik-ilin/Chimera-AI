"""
POST /api/classify

Classifies a creator by type using the Granite classify_creator task.
Service-token guarded. Rate-limited per user (client IP).

CONVENTIONS.md §4: classify_creator task, temp=0.2, max_tokens=256.

NOTE: do NOT add `from __future__ import annotations` here. The slowapi
@limiter.limit decorator replaces the endpoint's __globals__ with slowapi's
module, so string annotations (PEP 563) can no longer resolve the request
model — FastAPI then mis-binds the body as a Query param and OpenAPI 500s.
Real (non-stringized) annotations resolve correctly via __wrapped__.
"""
import uuid

import structlog
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from dependencies.auth import verify_service_token
from services.output_schemas import ClassifyCreatorOutput
from services.task_executor import get_executor
from models.creator_context import CreatorContext
from limiter import limiter

logger = structlog.get_logger()
router = APIRouter(tags=["ai"], dependencies=[Depends(verify_service_token)])


class ClassifyRequest(BaseModel):
    description: str = Field(min_length=1, max_length=500)
    creator_context: CreatorContext = Field(default_factory=CreatorContext)


class ClassifyResponse(BaseModel):
    request_id: str
    result: ClassifyCreatorOutput


@router.post("/classify", response_model=ClassifyResponse)
@limiter.limit("20/minute")
async def classify_creator(
    request: Request,
    body: ClassifyRequest,
) -> ClassifyResponse:
    rid = str(uuid.uuid4())
    logger.info("classify_request", request_id=rid)

    result = await get_executor().classify_creator(
        ctx=body.creator_context,
        user_description=body.description,
        request_id=rid,
    )
    return ClassifyResponse(request_id=rid, result=result)
