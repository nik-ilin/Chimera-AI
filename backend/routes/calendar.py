"""
Calendar export  (Block 2)

  GET /api/calendar/export?user_id=… — the user's events as an RFC 5545 .ics

Why this lives in FastAPI rather than being built in the Next.js layer: the ICS
serialiser (services/connectors/ics.py) is already written, already handles
folding/escaping/VALARM, and is exercised by the CalDAV adapter. Reimplementing
RFC 5545 in TypeScript for export would mean two codecs that must agree — the
kind of duplication that drifts silently until someone's calendar rejects a feed.

Service-token guarded. The Next.js Route Handler supplies user_id from the
verified session and streams the result back as a download.

NOTE: no `from __future__ import annotations` — see routes/classify.py.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import structlog
from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response

from dependencies.auth import verify_service_token
from limiter import limiter
from services.connectors import ics
from services.supabase import get_supabase

logger = structlog.get_logger()
router = APIRouter(tags=["calendar"], dependencies=[Depends(verify_service_token)])

# Export a useful slice rather than all history: a feed subscribed in Apple
# Calendar re-downloads in full on every poll, so an unbounded export gets
# slower forever.
_PAST_DAYS = 365
_FUTURE_DAYS = 730


@router.get("/calendar/export")
@limiter.limit("20/minute")
async def export_ics(request: Request, user_id: str) -> Response:
    db = get_supabase()
    now = datetime.now(timezone.utc)

    result = await asyncio.to_thread(
        lambda: db.table("events")
        .select("*")
        .eq("user_id", user_id)
        .gte("starts_at", (now - timedelta(days=_PAST_DAYS)).isoformat())
        .lte("starts_at", (now + timedelta(days=_FUTURE_DAYS)).isoformat())
        .order("starts_at", desc=False)
        .execute()
    )
    rows = result.data or []

    events = []
    for row in rows:
        start = _parse(row.get("starts_at"))
        if start is None:
            continue  # an event with no valid start cannot be serialised
        events.append(
            {
                # A STABLE uid is what lets a re-subscribed feed update events
                # instead of duplicating them. The row id is exactly that.
                "uid": f"{row['id']}@chimera",
                "summary": row.get("title") or "(untitled)",
                "start": start,
                "end": _parse(row.get("ends_at")),
                "all_day": bool(row.get("all_day")),
                "location": row.get("location") or "",
                "description": row.get("notes") or "",
                "reminder_minutes": row.get("reminder_minutes"),
            }
        )

    body = ics.build_calendar(events, cal_name="Chimera — Manager")
    logger.info("calendar_exported", user_id=user_id, count=len(events))

    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": 'attachment; filename="chimera-calendar.ics"',
            # Never cache: the export reflects live data.
            "Cache-Control": "no-store",
        },
    )


def _parse(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
