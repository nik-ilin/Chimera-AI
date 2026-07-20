"""
POST /api/ghostwrite — streaming, multi-turn lyric writing.

- Accepts an optional session_id; null = new session.
- Requires the authenticated user_id (injected by the Next Route Handler from
  the NextAuth session) — this is the real next_auth.users id the
  lyric_sessions.user_id FK references.
- Streams the model output token-by-token as SSE, then emits the parsed lyric
  sections. Persists the turn history to lyric_sessions after generation.
- Service-token guarded. Rate-limited: 10/minute.

SSE event shapes (one JSON object per `data:` line):
    {"type": "session", "session_id": "..."}
    {"type": "token",   "text": "<delta>"}
    {"type": "result",  "session_id": "...", "request_id": "...", "result": {...}}
    {"type": "error",   "error": "<message>"}

CONVENTIONS.md §2/§4: write_lyrics task, multi-turn memory, temp=0.8; streaming.

NOTE: do NOT add `from __future__ import annotations` here — the slowapi
@limiter.limit decorator swaps __globals__, breaking string-annotation
resolution of the request body (FastAPI mis-binds it as a Query param).
"""
import asyncio
import json
import uuid
from typing import Literal

import structlog
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from dependencies.auth import verify_service_token
from models.creator_context import CreatorContext
from services.output_schemas import WriteLyricsOutput
from services.prompts import build_lyrics_prompt
from services.supabase import get_supabase
from services.task_executor import get_executor
from limiter import limiter

logger = structlog.get_logger()
router = APIRouter(tags=["ai"], dependencies=[Depends(verify_service_token)])

# Max turns kept in the sliding window fed to the model
WINDOW_SIZE = 6


class GhostwriteRequest(BaseModel):
    # Authenticated next_auth.users id, injected server-side by the Route
    # Handler. This is the real id the lyric_sessions.user_id FK references.
    user_id: str = Field(min_length=1, description="Authenticated user id.")
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


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


@router.post("/ghostwrite")
@limiter.limit("10/minute")
async def ghostwrite(request: Request, body: GhostwriteRequest):
    """Stream lyric generation with multi-turn session memory."""
    rid = str(uuid.uuid4())
    logger.info("ghostwrite_request", request_id=rid, session_id=body.session_id)
    supabase = get_supabase()

    async def event_stream():
        try:
            # ── Load or create the session (DB calls offloaded off the loop) ──
            if body.session_id:
                resp = await asyncio.to_thread(
                    lambda: supabase.table("lyric_sessions")
                    .select("*")
                    .eq("id", body.session_id)
                    .single()
                    .execute()
                )
                if not resp.data:
                    yield _sse({"type": "error", "error": "Session not found."})
                    return
                session_row = resp.data
                turn_history: list[dict] = session_row.get("turn_history") or []
                history_summary: str = session_row.get("history_summary") or ""
                session_id = session_row["id"]
            else:
                session_id = str(uuid.uuid4())
                turn_history = []
                history_summary = ""
                await asyncio.to_thread(
                    lambda: supabase.table("lyric_sessions")
                    .insert(
                        {
                            "id": session_id,
                            # Real authenticated user id — satisfies the FK to
                            # next_auth.users and the owner-only RLS policy.
                            "user_id": body.user_id,
                            "title": (body.theme or "Untitled Session")[:200],
                            "genre": body.genre,
                            "theme": body.theme,
                            "rhyme_scheme": body.rhyme_scheme,
                        }
                    )
                    .execute()
                )

            yield _sse({"type": "session", "session_id": session_id})

            # ── Build windowed context ────────────────────────────────────────
            window = turn_history[-WINDOW_SIZE:]
            window_text = "\n".join(
                f"[{t['role'].upper()}] {t['content']}" for t in window
            )
            combined_summary = (
                f"{history_summary}\n\nRecent turns:\n{window_text}".strip()
                if history_summary or window_text
                else ""
            )

            prompt = build_lyrics_prompt(
                body.creator_context,
                body.user_message,
                body.genre,
                body.theme,
                body.rhyme_scheme,
                body.target_section,
                combined_summary,
            )

            # ── Stream generation ─────────────────────────────────────────────
            result_dict = None
            async for kind, data in get_executor().stream_task(
                "write_lyrics", prompt, WriteLyricsOutput, rid
            ):
                if kind == "token":
                    yield _sse({"type": "token", "text": data})
                elif kind == "result":
                    result_dict = data
                    yield _sse(
                        {
                            "type": "result",
                            "session_id": session_id,
                            "request_id": rid,
                            "result": data,
                        }
                    )

            # ── Persist the new turns ─────────────────────────────────────────
            if result_dict is not None:
                assistant_message = result_dict.get("assistant_message", "")
                updated_history = turn_history + [
                    {"role": "user", "content": body.user_message},
                    {"role": "assistant", "content": assistant_message},
                ]
                await asyncio.to_thread(
                    lambda: supabase.table("lyric_sessions")
                    .update(
                        {"turn_history": updated_history, "last_output": result_dict}
                    )
                    .eq("id", session_id)
                    .execute()
                )
        except Exception as exc:  # noqa: BLE001 — surface any failure to the client
            logger.error("ghostwrite_stream_error", request_id=rid, error=str(exc))
            yield _sse({"type": "error", "error": str(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
