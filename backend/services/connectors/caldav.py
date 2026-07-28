"""
CalDAV / iCalendar connector — open-standard calendar sync.

Covers everything that is not Google: Fastmail, Nextcloud, Apple iCloud,
Radicale, and any published .ics URL.

Two modes, chosen by what the user supplies:

  * CALDAV (RFC 4791) — username + password against a collection URL. Supports
    pull AND push, using PROPFIND for change detection (ctag/etag) and PUT/
    DELETE for writes.
  * ICS SUBSCRIPTION — a plain https URL to a .ics file. Read-only by nature,
    which the adapter reports honestly via capabilities so the UI never offers
    a push button that cannot work.

Credentials are Basic auth, stored in the same encrypted vault as OAuth tokens
(the password goes in access_token_enc). CalDAV predates OAuth; there is no
better option, which is exactly why encryption at rest matters here.

Change detection: CalDAV servers expose a `getctag` on the collection that
changes whenever anything inside does. We store it as the sync cursor, so a
poll where nothing changed costs one cheap PROPFIND instead of downloading
every event.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from models.canonical import CanonicalEvent, ExternalRef
from services.connectors import ics
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

_TIMEOUT = httpx.Timeout(25.0, connect=8.0)

_PROPFIND_CTAG = """<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/">
  <d:prop><d:displayname/><cs:getctag/></d:prop>
</d:propfind>"""

_REPORT_ALL_EVENTS = """<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR">
    <c:comp-filter name="VEVENT"/>
  </c:comp-filter></c:filter>
</c:calendar-query>"""


class CalDavConnector(Connector):
    key = "caldav"
    label = "CalDAV / iCalendar"
    description = "Fastmail, Nextcloud, iCloud, or any published .ics feed."
    icon = "Rss"

    @property
    def capabilities(self) -> Capabilities:
        # Declared as push-capable; a subscription-only connection degrades to
        # read-only at runtime and the route layer reports that per connection.
        return Capabilities(pull=True, push=True, oauth=False, demo=False)

    def is_configured(self) -> bool:
        # User-supplied credentials — nothing needed on the server side, so this
        # adapter is always available even with an empty backend .env.
        return True

    def missing_env(self) -> list[str]:
        return []

    # ── helpers ──

    @staticmethod
    def _mode(ctx: SyncContext) -> str:
        return "ics" if ctx.config.get("ics_url") else "caldav"

    @staticmethod
    def _auth(ctx: SyncContext) -> tuple[str, str] | None:
        username = ctx.config.get("username", "")
        password = ctx.access_token  # decrypted by the vault before we see it
        return (username, password) if username and password else None

    # ── Sync ──

    async def pull(self, ctx: SyncContext) -> PullResult:
        if self._mode(ctx) == "ics":
            return await self._pull_ics(ctx)
        return await self._pull_caldav(ctx)

    async def _pull_ics(self, ctx: SyncContext) -> PullResult:
        """Fetch and parse a published .ics feed."""
        url = ctx.config["ics_url"]
        headers = {}
        # Feeds are usually static; ETag/If-None-Match turns an unchanged poll
        # into a 304 with no body.
        if ctx.cursor:
            headers["If-None-Match"] = ctx.cursor

        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
            response = await client.get(url, headers=headers)

        if response.status_code == 304:
            return PullResult(cursor=ctx.cursor)
        if response.status_code in (401, 403):
            raise NeedsReauth("The calendar feed rejected our credentials.")
        if response.status_code != 200:
            raise ConnectorError(f"Feed fetch failed: HTTP {response.status_code}")

        events = [
            mapped
            for parsed in ics.parse_events(response.text)
            if (mapped := self._to_canonical(parsed, url)) is not None
        ]
        return PullResult(events=events, cursor=response.headers.get("ETag", ""))

    async def _pull_caldav(self, ctx: SyncContext) -> PullResult:
        """PROPFIND for the ctag, then REPORT for the event data if it moved."""
        url = ctx.config.get("caldav_url", "")
        if not url:
            raise ConnectorError("No CalDAV URL configured.", retryable=False)

        auth = self._auth(ctx)
        if auth is None:
            raise NeedsReauth("CalDAV username or password missing.")

        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
            probe = await client.request(
                "PROPFIND",
                url,
                content=_PROPFIND_CTAG,
                headers={"Depth": "0", "Content-Type": "application/xml; charset=utf-8"},
                auth=auth,
            )
            if probe.status_code in (401, 403):
                raise NeedsReauth("CalDAV server rejected the credentials.")
            if probe.status_code not in (207, 200):
                raise ConnectorError(f"CalDAV PROPFIND failed: HTTP {probe.status_code}")

            ctag = _extract_tag(probe.text, "getctag")
            # Nothing changed since last run — skip the expensive REPORT.
            if ctag and ctag == ctx.cursor:
                return PullResult(cursor=ctag)

            report = await client.request(
                "REPORT",
                url,
                content=_REPORT_ALL_EVENTS,
                headers={"Depth": "1", "Content-Type": "application/xml; charset=utf-8"},
                auth=auth,
            )
            if report.status_code not in (207, 200):
                raise ConnectorError(f"CalDAV REPORT failed: HTTP {report.status_code}")

        events = [
            mapped
            for parsed in ics.parse_events(report.text)
            if (mapped := self._to_canonical(parsed, url)) is not None
        ]
        return PullResult(events=events, cursor=ctag or "")

    def _to_canonical(self, parsed: dict[str, Any], source: str) -> CanonicalEvent | None:
        start = parsed.get("start")
        if start is None:
            return None  # an event with no DTSTART cannot be placed in time

        # UID is the RFC-mandated stable identifier. Some exporters omit it, so
        # fall back to a content hash — stable across syncs for unchanged
        # events, which is what idempotent upsert needs.
        uid = parsed.get("uid") or hashlib.sha256(
            f"{source}|{parsed.get('summary', '')}|{start.isoformat()}".encode()
        ).hexdigest()

        summary = parsed.get("summary") or "(untitled)"
        return CanonicalEvent(
            title=summary,
            event_type=_guess_type(summary),
            starts_at=start,
            ends_at=parsed.get("end"),
            all_day=bool(parsed.get("all_day")),
            location=parsed.get("location", ""),
            notes=parsed.get("description", ""),
            external=ExternalRef(
                provider=CalDavConnector.key,
                external_id=uid,
                etag=str(parsed.get("sequence", "")),
                remote_updated_at=parsed.get("last_modified"),
            ),
            raw=parsed.get("raw", {}),
        )

    async def push(self, ctx: SyncContext, event: CanonicalEvent) -> PushResult:
        if self._mode(ctx) == "ics":
            # A subscription feed is a file on someone else's server.
            raise ConnectorError(
                "This is a read-only .ics subscription; connect via CalDAV to push.",
                retryable=False,
            )

        base = ctx.config.get("caldav_url", "").rstrip("/")
        auth = self._auth(ctx)
        if not base or auth is None:
            raise NeedsReauth("CalDAV connection is not fully configured.")

        uid = (event.external.external_id if event.external else "") or (
            f"chimera-{event.id or hashlib.sha256(event.title.encode()).hexdigest()[:16]}"
        )
        body = ics.build_calendar(
            [
                {
                    "uid": uid,
                    "summary": event.title,
                    "start": event.starts_at,
                    "end": event.ends_at,
                    "all_day": event.all_day,
                    "location": event.location,
                    "description": event.notes,
                }
            ]
        )

        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
            response = await client.put(
                f"{base}/{uid}.ics",
                content=body.encode("utf-8"),
                headers={"Content-Type": "text/calendar; charset=utf-8"},
                auth=auth,
            )

        if response.status_code in (401, 403):
            raise NeedsReauth("CalDAV server rejected the credentials.")
        if response.status_code not in (200, 201, 204):
            raise ConnectorError(f"CalDAV PUT failed: HTTP {response.status_code}")

        return PushResult(external_id=uid, etag=response.headers.get("ETag", ""))

    async def delete(self, ctx: SyncContext, external_id: str) -> None:
        if self._mode(ctx) == "ics":
            return  # nothing to delete on a read-only feed

        base = ctx.config.get("caldav_url", "").rstrip("/")
        auth = self._auth(ctx)
        if not base or auth is None:
            return

        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
            response = await client.delete(f"{base}/{external_id}.ics", auth=auth)
        if response.status_code not in (200, 204, 404):
            raise ConnectorError(f"CalDAV DELETE failed: HTTP {response.status_code}")


def _extract_tag(xml: str, local_name: str) -> str:
    """
    Pull a single element's text out of a DAV multistatus response.

    Namespace prefixes vary by server (cs:, CS:, calendarserver:), so we match
    on the local name and ignore the prefix rather than pretending to do real
    XML namespace resolution for one field.
    """
    import re

    match = re.search(
        rf"<[^>]*\b{local_name}\b[^>]*>(.*?)</[^>]*\b{local_name}\b[^>]*>",
        xml,
        re.IGNORECASE | re.DOTALL,
    )
    return match.group(1).strip() if match else ""


_REHEARSAL_WORDS = ("rehearsal", "rehearse", "practice", "soundcheck")
_RELEASE_WORDS = ("release", "drop", "single", "album", "ep ")
_GIG_WORDS = ("gig", "show", "concert", "live", "festival", "tour", "@")


def _guess_type(title: str) -> str:
    lowered = title.lower()
    if any(word in lowered for word in _REHEARSAL_WORDS):
        return "rehearsal"
    if any(word in lowered for word in _RELEASE_WORDS):
        return "release"
    if any(word in lowered for word in _GIG_WORDS):
        return "gig"
    return "other"
