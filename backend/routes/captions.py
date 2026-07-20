"""
POST /api/captions — streaming caption generation.

Streams the model output token-by-token as Server-Sent Events, then emits the
final parsed caption variants. Service-token guarded. Rate-limited: 10/minute.

SSE event shapes (one JSON object per `data:` line):
    {"type": "token",  "text": "<delta>"}
    {"type": "result", "request_id": "...", "result": {"variants": [...]}}
    {"type": "error",  "error": "<message>"}

CONVENTIONS.md §2/§4: write_captions task, temp=0.8; token-by-token streaming.

NOTE: do NOT add `from __future__ import annotations` here — the slowapi
@limiter.limit decorator swaps __globals__, breaking string-annotation
resolution of the request body (FastAPI mis-binds it as a Query param).
"""
import json
import uuid
from typing import Literal

import structlog
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from dependencies.auth import verify_service_token
from models.creator_context import CreatorContext
from services.output_schemas import WriteCaptionsOutput
from services.prompts import build_captions_prompt
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


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


@router.post("/captions")
@limiter.limit("10/minute")
async def write_captions(request: Request, body: CaptionsRequest):
    """Stream caption generation: live token deltas, then the parsed variants."""
    rid = str(uuid.uuid4())
    logger.info("captions_request", request_id=rid, platform=body.platform)

    prompt = build_captions_prompt(
        body.creator_context, body.context, body.platform, body.n_variants
    )

    async def event_stream():
        try:
            async for kind, data in get_executor().stream_task(
                "write_captions", prompt, WriteCaptionsOutput, rid
            ):
                if kind == "token":
                    yield _sse({"type": "token", "text": data})
                elif kind == "result":
                    yield _sse({"type": "result", "request_id": rid, "result": data})
        except Exception as exc:  # noqa: BLE001 — surface any failure to the client
            logger.error("captions_stream_error", request_id=rid, error=str(exc))
            yield _sse({"type": "error", "error": str(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
