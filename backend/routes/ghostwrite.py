"""
POST /api/ghostwrite

Multi-turn lyric writing assistant.
- Accepts an optional session_id; null = new session.
- Persists turn history to Supabase lyric_sessions table (service-role).
- Feeds a windowed context (last WINDOW_SIZE turns) + rolling summary.
- Service-token guarded. Rate-limited: 10/minute.

CONVENTIONS.md §4: write_lyrics task, multi-turn memory, temp=0.8.

NOTE: do NOT add `from __future__ import annotations` here — the slowapi
@limiter.limit decorator swaps __globals__, breaking string-annotation
resolution of the request body (FastAPI mis-binds it as a Query param).
"""
import json
import uuid
from typing import Literal

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from dependencies.auth import verify_service_token
from models.creator_context import CreatorContext
from services.output_schemas import WriteLyricsOutput
from services.supabase import get_supabase
from services.task_executor import get_executor
from limiter import limiter

logger = structlog.get_logger()
router = APIRouter(tags=["ai"], dependencies=[Depends(verify_service_token)])

# Max turns kept in the sliding window fed to the model
WINDOW_SIZE = 6


class GhostwriteRequest(BaseModel):
    session_id: str | None = Field(
        default=None,
        description="Existing session UUID, or null to start a new session.",
    )
    user_message: str = Field(min_length=1, max_length=8000)
    genre: str = Field(default="pop", max_length=100)
    theme: str = Field(default="", max_length=500)
    rhyme_scheme: str = Field(default="ABAB", max_length=20)
    target_section: Literal["verse", "chorus", "bridge", "intro", "outro", "hook"] = "verse"
    creator_context: CreatorContext = Field(default_factory=CreatorContext)


class GhostwriteResponse(BaseModel):
    session_id: str
    request_id: str
    result: WriteLyricsOutput


@router.post("/ghostwrite", response_model=GhostwriteResponse)
@limiter.limit("10/minute")
async def ghostwrite(
    request: Request,
    body: GhostwriteRequest,
) -> GhostwriteResponse:
    rid = str(uuid.uuid4())
    logger.info("ghostwrite_request", request_id=rid, session_id=body.session_id)

    supabase = get_supabase()

    # ── Load or create session ──────────────────────────────────────────────
    if body.session_id:
        resp = supabase.table("lyric_sessions") \
            .select("*") \
            .eq("id", body.session_id) \
            .single() \
            .execute()
        if not resp.data:
            raise HTTPException(status_code=404, detail="Session not found.")
        session = resp.data
        turn_history: list[dict] = session.get("turn_history", [])
        history_summary: str = session.get("history_summary", "")
    else:
        session_id = str(uuid.uuid4())
        insert_resp = supabase.table("lyric_sessions").insert({
            "id": session_id,
            # NOTE: user_id is required by RLS but the service-role key bypasses it.
            # The caller (Next.js Route Handler) must pass the authenticated user_id
            # in the request body for Phase 3+. For Phase 2, we use a placeholder.
            "user_id": body.creator_context.artist_name or "00000000-0000-0000-0000-000000000000",
            "genre": body.genre,
            "theme": body.theme,
            "rhyme_scheme": body.rhyme_scheme,
        }).execute()
        session = {"id": session_id}
        turn_history = []
        history_summary = ""

    session_id = session["id"]

    # ── Build windowed context ──────────────────────────────────────────────
    window = turn_history[-WINDOW_SIZE:]
    window_text = "\n".join(
        f"[{t['role'].upper()}] {t['content']}" for t in window
    )
    combined_summary = (
        f"{history_summary}\n\nRecent turns:\n{window_text}".strip()
        if history_summary or window_text
        else ""
    )

    # ── Call the model ──────────────────────────────────────────────────────
    result = await get_executor().write_lyrics(
        ctx=body.creator_context,
        user_message=body.user_message,
        genre=body.genre,
        theme=body.theme,
        rhyme_scheme=body.rhyme_scheme,
        target_section=body.target_section,
        turn_history_summary=combined_summary,
        request_id=rid,
    )

    # ── Persist new turns ───────────────────────────────────────────────────
    new_turns = [
        {"role": "user", "content": body.user_message},
        {"role": "assistant", "content": result.assistant_message},
    ]
    updated_history = turn_history + new_turns

    supabase.table("lyric_sessions").update({
        "turn_history": updated_history,
        "last_output": json.loads(result.model_dump_json()),
    }).eq("id", session_id).execute()

    return GhostwriteResponse(
        session_id=session_id,
        request_id=rid,
        result=result,
    )
