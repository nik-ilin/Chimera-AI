"""
Google Calendar connector — two-way sync.

Uses the REST API directly over httpx rather than google-api-python-client: we
need four endpoints, and the official SDK is a large synchronous dependency that
would have to be wrapped in asyncio.to_thread anyway (the same problem
services/llm.py solves for ChatWatsonx).

Incremental sync uses Google's syncToken. The first run does a bounded full
sync and stores the returned token; later runs pass it back and receive only
what changed. A 410 GONE means the token expired — the adapter clears it and
signals a full resync rather than failing, which is exactly what Google's docs
prescribe.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import httpx

from config import settings
from models.canonical import CanonicalEvent, ExternalRef
from services.connectors.base import (
    Capabilities,
    Connector,
    ConnectorError,
    NeedsReauth,
    PullResult,
    PushResult,
    SyncContext,
)

logger = logging.getLogger(__name__)

_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_TOKEN_URL = "https://oauth2.googleapis.com/token"
_API = "https://www.googleapis.com/calendar/v3"
_SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    "openid",
    "email",
]
_TIMEOUT = httpx.Timeout(20.0, connect=8.0)


class GoogleCalendarConnector(Connector):
    key = "google_calendar"
    label = "Google Calendar"
    description = "Two-way sync for gigs, rehearsals and deadlines."
    icon = "CalendarDays"

    @property
    def capabilities(self) -> Capabilities:
        return Capabilities(pull=True, push=True, oauth=True, demo=False)

    def is_configured(self) -> bool:
        return bool(settings.google_client_id and settings.google_client_secret)

    def missing_env(self) -> list[str]:
        missing = []
        if not settings.google_client_id:
            missing.append("GOOGLE_CLIENT_ID")
        if not settings.google_client_secret:
            missing.append("GOOGLE_CLIENT_SECRET")
        return missing

    # ── OAuth ──

    def authorize_url(self, state: str, redirect_uri: str) -> str:
        params = {
            "client_id": settings.google_client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": " ".join(_SCOPES),
            # offline + consent are both required to reliably receive a refresh
            # token. Without prompt=consent Google omits it on re-authorisation,
            # and the connection silently dies when the access token expires.
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
            "state": state,
        }
        return f"{_AUTH_URL}?{urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: str) -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.post(
                _TOKEN_URL,
                data={
                    "code": code,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
        if response.status_code != 200:
            raise ConnectorError(
                f"Google token exchange failed: {response.text[:200]}", retryable=False
            )
        return response.json()

    async def refresh(self, refresh_token: str) -> dict[str, Any]:
        if not refresh_token:
            raise NeedsReauth("No refresh token stored.")
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.post(
                _TOKEN_URL,
                data={
                    "refresh_token": refresh_token,
                    "client_id": settings.google_client_id,
                    "client_secret": settings.google_client_secret,
                    "grant_type": "refresh_token",
                },
            )
        if response.status_code == 400:
            # invalid_grant: revoked, expired, or the user changed their
            # password. Unrecoverable without the user, so never retry.
            raise NeedsReauth("Google refused the refresh token.")
        if response.status_code != 200:
            raise ConnectorError(f"Google refresh failed: {response.text[:200]}")
        return response.json()

    async def account_email(self, access_token: str) -> str:
        """Label the connection card with the account the user actually picked."""
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                response = await client.get(
                    "https://www.googleapis.com/oauth2/v2/userinfo",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
            return response.json().get("email", "") if response.status_code == 200 else ""
        except httpx.HTTPError:
            return ""

    # ── Sync ──

    def _calendar_id(self, ctx: SyncContext) -> str:
        return ctx.config.get("calendar_id") or "primary"

    async def pull(self, ctx: SyncContext) -> PullResult:
        if not ctx.access_token:
            raise NeedsReauth("No access token.")

        params: dict[str, Any] = {
            "maxResults": 250,
            "singleEvents": "true",   # expand recurrence server-side
            "showDeleted": "true",    # so we can tombstone locally
        }
        if ctx.cursor:
            params["syncToken"] = ctx.cursor
        else:
            # First sync: bound the window so a decade-old calendar doesn't
            # import 4000 rows. orderBy is only legal without a syncToken.
            params["orderBy"] = "startTime"
            if ctx.window_start:
                params["timeMin"] = ctx.window_start.astimezone(timezone.utc).isoformat()
            if ctx.window_end:
                params["timeMax"] = ctx.window_end.astimezone(timezone.utc).isoformat()

        url = f"{_API}/calendars/{self._calendar_id(ctx)}/events"
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.get(
                url, params=params, headers={"Authorization": f"Bearer {ctx.access_token}"}
            )

        if response.status_code == 401:
            raise NeedsReauth("Google rejected the access token.")
        if response.status_code == 410:
            # Sync token expired. Returning an empty cursor makes the next run a
            # full sync — the documented recovery, not an error.
            logger.info("google_sync_token_expired", extra={"connection": ctx.connection_id})
            return PullResult(cursor="", has_more=True)
        if response.status_code == 403:
            raise ConnectorError("Google rate limit or insufficient scope.", retryable=True)
        if response.status_code != 200:
            raise ConnectorError(f"Google pull failed: {response.text[:200]}")

        body = response.json()
        events: list[CanonicalEvent] = []
        deleted: list[str] = []

        for item in body.get("items", []):
            external_id = item.get("id")
            if not external_id:
                continue
            if item.get("status") == "cancelled":
                deleted.append(external_id)
                continue
            mapped = self._to_canonical(item)
            if mapped is not None:
                events.append(mapped)

        return PullResult(
            events=events,
            deleted_external_ids=deleted,
            cursor=body.get("nextSyncToken", ""),
            has_more=bool(body.get("nextPageToken")),
        )

    def _to_canonical(self, item: dict[str, Any]) -> CanonicalEvent | None:
        """Map a Google event. Returns None for anything we cannot place in time."""
        start_raw = item.get("start") or {}
        end_raw = item.get("end") or {}

        all_day = "date" in start_raw
        start = _parse_google_dt(start_raw)
        if start is None:
            return None
        end = _parse_google_dt(end_raw)

        summary = item.get("summary") or "(untitled)"
        return CanonicalEvent(
            title=summary,
            # Google has no notion of a "gig". Guess from the title so imported
            # shows land in the right bucket, and default to 'other' rather than
            # mislabelling every calendar entry as a gig.
            event_type=_guess_type(summary),
            starts_at=start,
            ends_at=end,
            all_day=all_day,
            location=item.get("location") or "",
            notes=item.get("description") or "",
            external=ExternalRef(
                provider=GoogleCalendarConnector.key,
                external_id=item["id"],
                etag=item.get("etag", ""),
                remote_updated_at=_parse_iso(item.get("updated")),
            ),
            raw={"html_link": item.get("htmlLink", "")},
        )

    async def push(self, ctx: SyncContext, event: CanonicalEvent) -> PushResult:
        if not ctx.access_token:
            raise NeedsReauth("No access token.")

        body: dict[str, Any] = {
            "summary": event.title,
            "location": event.location,
            "description": event.notes,
        }
        if event.all_day:
            body["start"] = {"date": event.starts_at.astimezone(timezone.utc).date().isoformat()}
            end_date = (event.ends_at or event.starts_at).astimezone(timezone.utc).date()
            body["end"] = {"date": end_date.isoformat()}
        else:
            body["start"] = {"dateTime": event.starts_at.astimezone(timezone.utc).isoformat()}
            end = event.ends_at or event.starts_at
            body["end"] = {"dateTime": end.astimezone(timezone.utc).isoformat()}

        calendar_id = self._calendar_id(ctx)
        existing_id = event.external.external_id if event.external else ""
        headers = {"Authorization": f"Bearer {ctx.access_token}"}

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            if existing_id:
                response = await client.patch(
                    f"{_API}/calendars/{calendar_id}/events/{existing_id}",
                    json=body,
                    headers=headers,
                )
                # Deleted upstream while we held a ref — recreate rather than fail.
                if response.status_code in (404, 410):
                    response = await client.post(
                        f"{_API}/calendars/{calendar_id}/events", json=body, headers=headers
                    )
            else:
                response = await client.post(
                    f"{_API}/calendars/{calendar_id}/events", json=body, headers=headers
                )

        if response.status_code == 401:
            raise NeedsReauth("Google rejected the access token.")
        if response.status_code not in (200, 201):
            raise ConnectorError(f"Google push failed: {response.text[:200]}")

        created = response.json()
        return PushResult(external_id=created.get("id", ""), etag=created.get("etag", ""))

    async def delete(self, ctx: SyncContext, external_id: str) -> None:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            response = await client.delete(
                f"{_API}/calendars/{self._calendar_id(ctx)}/events/{external_id}",
                headers={"Authorization": f"Bearer {ctx.access_token}"},
            )
        # 404/410 mean it is already gone, which is the desired end state.
        if response.status_code not in (200, 204, 404, 410):
            raise ConnectorError(f"Google delete failed: {response.text[:200]}")


# ─── helpers ──────────────────────────────────────────────────────────────────


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _parse_google_dt(node: dict[str, Any]) -> datetime | None:
    """Google sends either {"date": "..."} (all-day) or {"dateTime": "..."}."""
    if "dateTime" in node:
        return _parse_iso(node["dateTime"])
    if "date" in node:
        try:
            return datetime.strptime(node["date"], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


_GIG_WORDS = ("gig", "show", "concert", "live", "set ", "festival", "tour", "@")
_REHEARSAL_WORDS = ("rehearsal", "rehearse", "practice", "soundcheck")
_RELEASE_WORDS = ("release", "drop", "single", "album", "ep ")


def _guess_type(title: str) -> str:
    """Best-effort bucketing of an imported calendar entry."""
    lowered = title.lower()
    if any(word in lowered for word in _REHEARSAL_WORDS):
        return "rehearsal"
    if any(word in lowered for word in _RELEASE_WORDS):
        return "release"
    if any(word in lowered for word in _GIG_WORDS):
        return "gig"
    return "other"
