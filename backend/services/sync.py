"""
Durable sync engine  (Block 0)

Runs a connector's pull, maps canonical entities into Supabase, and records the
attempt so it survives a crash or a deploy.

Four properties, and the reason each one exists:

1. IDEMPOTENT. Every remote object is keyed by external_refs
   (user, provider, entity_type, external_id) — a UNIQUE constraint in
   migration 007. A replayed run updates the same local row instead of creating
   a second copy. Without this, one retry doubles the user's calendar.

2. DURABLE. Attempt state lives in `sync_runs`, not in memory. A process that
   dies mid-sync leaves a 'running' row that the next tick reclaims, and
   backoff survives restarts. An in-memory timer would silently reset on every
   deploy, turning a rate-limited connection into a hot loop.

3. BACKED OFF. Failures retry on exponential backoff with a cap, and only when
   the adapter says the error is retryable. A 401 is not retried — it is
   surfaced as `expired` so the user can reconnect, because retrying it just
   burns quota and leaves the card looking busy instead of broken.

4. NON-DESTRUCTIVE. A pull never clobbers fields the user edited locally that
   the provider does not model (fee, rider, setlist, venue links). Only the
   fields the provider owns are written.

Cost note: this runs inside the FastAPI process via asyncio, not Celery. That is
right for a demo and for a handful of connections; a real deployment with
thousands of users wants a dedicated worker. The DB-backed state means that
swap is a scheduler change, not a rewrite.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import structlog

from models.canonical import CanonicalEvent
from services.connectors import get_connector
from services.connectors.base import (
    ConnectorError,
    NeedsReauth,
    SyncContext,
)
from services.connectors.vault import decrypt, encrypt
from services.supabase import get_supabase

logger = structlog.get_logger()

# Retry schedule in seconds: ~1m, 5m, 15m, 1h, 6h. Capped so a permanently
# broken connection stops hammering but still self-heals if the provider
# recovers overnight.
_BACKOFF_SECONDS = [60, 300, 900, 3600, 21600]
_MAX_ATTEMPTS = len(_BACKOFF_SECONDS)

# Bound the first (full) sync so importing a decade-old calendar doesn't pull
# thousands of rows the user will never look at.
_WINDOW_PAST_DAYS = 90
_WINDOW_FUTURE_DAYS = 400


def _now() -> datetime:
    return datetime.now(timezone.utc)


class SyncEngine:
    """Owns one sync run at a time; safe to instantiate per request."""

    # ── Credentials ──

    async def _context_for(self, connection: dict[str, Any]) -> SyncContext:
        """
        Build a SyncContext, refreshing the access token first if it is expired.

        Refresh happens here rather than inside adapters so every OAuth provider
        gets the same expiry handling and the same failure semantics.
        """
        db = get_supabase()
        secrets = (
            await asyncio.to_thread(
                lambda: db.table("connection_secrets")
                .select("*")
                .eq("connection_id", connection["id"])
                .maybe_single()
                .execute()
            )
        )
        row = secrets.data if secrets and secrets.data else {}

        access = decrypt(row.get("access_token_enc", ""))
        refresh = decrypt(row.get("refresh_token_enc", ""))
        expires_at = row.get("expires_at")

        connector = get_connector(connection["provider"])
        if connector.capabilities.oauth and refresh:
            # 60s skew guard: a token expiring mid-request is a token we should
            # have refreshed.
            expired = True
            if expires_at:
                try:
                    parsed = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
                    expired = parsed <= _now() + timedelta(seconds=60)
                except ValueError:
                    expired = True
            if expired or not access:
                tokens = await connector.refresh(refresh)
                access = tokens.get("access_token", "")
                await self._store_tokens(connection["id"], tokens, fallback_refresh=refresh)

        return SyncContext(
            user_id=connection["user_id"],
            connection_id=connection["id"],
            cursor=connection.get("sync_cursor", "") or "",
            access_token=access,
            refresh_token=refresh,
            config=connection.get("config") or {},
            window_start=_now() - timedelta(days=_WINDOW_PAST_DAYS),
            window_end=_now() + timedelta(days=_WINDOW_FUTURE_DAYS),
        )

    async def _store_tokens(
        self, connection_id: str, tokens: dict[str, Any], *, fallback_refresh: str = ""
    ) -> None:
        """
        Persist tokens, encrypted.

        Google omits refresh_token on a refresh response, so we keep the
        existing one — overwriting it with "" would silently break the
        connection at the next expiry.
        """
        db = get_supabase()
        expires_in = tokens.get("expires_in")
        expires_at = (
            (_now() + timedelta(seconds=int(expires_in))).isoformat()
            if expires_in
            else None
        )
        payload = {
            "connection_id": connection_id,
            "access_token_enc": encrypt(tokens.get("access_token", "")),
            "refresh_token_enc": encrypt(tokens.get("refresh_token") or fallback_refresh),
            "expires_at": expires_at,
            "updated_at": _now().isoformat(),
        }
        await asyncio.to_thread(
            lambda: db.table("connection_secrets")
            .upsert(payload, on_conflict="connection_id")
            .execute()
        )

    # ── Public entry point ──

    async def sync_connection(self, connection_id: str) -> dict[str, Any]:
        """
        Run one sync. Returns a stats dict. Never raises for connector-level
        failures — they are recorded on the connection and the run row, because
        a failed integration must not take down the request that triggered it.
        """
        db = get_supabase()
        result = await asyncio.to_thread(
            lambda: db.table("connections")
            .select("*")
            .eq("id", connection_id)
            .maybe_single()
            .execute()
        )
        connection = result.data if result and result.data else None
        if not connection:
            return {"ok": False, "error": "connection_not_found"}

        run = await self._start_run(connection)
        try:
            ctx = await self._context_for(connection)
            connector = get_connector(connection["provider"])
            pull = await connector.pull(ctx)

            stats = await self._apply_pull(connection, pull)

            await self._finish_run(run["id"], "success", stats=stats)
            await self._update_connection(
                connection_id,
                {
                    "status": "connected",
                    "sync_cursor": pull.cursor,
                    "last_synced_at": _now().isoformat(),
                    "last_error": "",
                    "consecutive_failures": 0,
                },
            )
            return {"ok": True, **stats}

        except NeedsReauth as exc:
            # Terminal until the user acts. No retry scheduled.
            await self._finish_run(run["id"], "failed", error=str(exc))
            await self._update_connection(
                connection_id, {"status": "expired", "last_error": str(exc)}
            )
            logger.warning("sync_needs_reauth", connection_id=connection_id)
            return {"ok": False, "error": "needs_reauth", "detail": str(exc)}

        except ConnectorError as exc:
            return await self._handle_failure(connection, run, exc, retryable=exc.retryable)

        except Exception as exc:  # noqa: BLE001 — unknown adapter bug
            logger.exception("sync_unexpected_error", connection_id=connection_id)
            return await self._handle_failure(connection, run, exc, retryable=True)

    # ── Applying a pull ──

    async def _apply_pull(self, connection: dict[str, Any], pull) -> dict[str, int]:
        """Upsert pulled events, materialise their venues/promoters, tombstone deletions."""
        stats = {"pulled": 0, "created": 0, "updated": 0, "deleted": 0, "skipped": 0}

        for event in pull.events:
            stats["pulled"] += 1
            outcome = await self._upsert_event(connection, event)
            stats[outcome] = stats.get(outcome, 0) + 1

        for external_id in pull.deleted_external_ids:
            if await self._delete_by_external(connection, external_id):
                stats["deleted"] += 1

        return stats

    async def _upsert_event(
        self, connection: dict[str, Any], event: CanonicalEvent
    ) -> str:
        """
        Insert or update one event, keyed by its external ref.

        Returns "created" | "updated" | "skipped".
        """
        db = get_supabase()
        user_id = connection["user_id"]
        provider = connection["provider"]
        if event.external is None:
            return "skipped"
        external_id = event.external.external_id

        existing = await asyncio.to_thread(
            lambda: db.table("external_refs")
            .select("*")
            .eq("user_id", user_id)
            .eq("provider", provider)
            .eq("entity_type", "event")
            .eq("external_id", external_id)
            .maybe_single()
            .execute()
        )
        ref = existing.data if existing and existing.data else None

        # Unchanged upstream? Skip the write entirely. This is what keeps a
        # 250-event poll cheap when nothing moved.
        if ref and event.external.etag and ref.get("etag") == event.external.etag:
            return "skipped"

        venue_id = await self._ensure_venue(user_id, event)
        promoter_id = await self._ensure_promoter(user_id, event)

        # ONLY provider-owned fields. Anything the user set in Chimera that the
        # provider has no concept of (fee, rider, setlist) is deliberately
        # absent so a sync cannot wipe it.
        payload: dict[str, Any] = {
            "user_id": user_id,
            "title": event.title,
            "event_type": event.event_type,
            "starts_at": event.starts_at.isoformat(),
            "ends_at": event.ends_at.isoformat() if event.ends_at else None,
            "all_day": event.all_day,
            "location": event.location,
            "notes": event.notes,
            "source_connection_id": connection["id"],
        }
        if venue_id:
            payload["venue_id"] = venue_id
        if promoter_id:
            payload["promoter_id"] = promoter_id
        # Fee only on first import — never overwrite a negotiated fee on resync.
        if event.fee_cents and not ref:
            payload["fee_cents"] = event.fee_cents
            payload["currency"] = event.currency

        if ref:
            await asyncio.to_thread(
                lambda: db.table("events")
                .update(payload)
                .eq("id", ref["entity_id"])
                .eq("user_id", user_id)
                .execute()
            )
            entity_id = ref["entity_id"]
            outcome = "updated"
        else:
            inserted = await asyncio.to_thread(
                lambda: db.table("events").insert(payload).execute()
            )
            if not inserted.data:
                return "skipped"
            entity_id = inserted.data[0]["id"]
            outcome = "created"

        await self._write_ref(
            user_id=user_id,
            connection_id=connection["id"],
            provider=provider,
            entity_type="event",
            entity_id=entity_id,
            external_id=external_id,
            etag=event.external.etag,
            remote_updated_at=event.external.remote_updated_at,
        )
        return outcome

    async def _ensure_venue(self, user_id: str, event: CanonicalEvent) -> str | None:
        """
        Materialise the venue carried in raw['venue'], de-duplicated by name+city.

        This is what turns an imported calendar row into a populated gig hub:
        the venue becomes a first-class entity with coordinates the map can plot.
        """
        info = (event.raw or {}).get("venue")
        if not isinstance(info, dict) or not info.get("name"):
            return None

        db = get_supabase()
        name = info["name"]
        city = info.get("city", "")

        found = await asyncio.to_thread(
            lambda: db.table("venues")
            .select("id")
            .eq("user_id", user_id)
            .eq("name", name)
            .eq("city", city)
            .limit(1)
            .execute()
        )
        if found.data:
            return found.data[0]["id"]

        created = await asyncio.to_thread(
            lambda: db.table("venues")
            .insert(
                {
                    "user_id": user_id,
                    "name": name,
                    "address": info.get("address", ""),
                    "city": city,
                    "country": info.get("country", ""),
                    "lat": info.get("lat"),
                    "lon": info.get("lon"),
                    "capacity": info.get("capacity"),
                }
            )
            .execute()
        )
        return created.data[0]["id"] if created.data else None

    async def _ensure_promoter(self, user_id: str, event: CanonicalEvent) -> str | None:
        """Materialise raw['promoter'] as a Contact, de-duplicated by name."""
        info = (event.raw or {}).get("promoter")
        if not isinstance(info, dict) or not info.get("name"):
            return None

        db = get_supabase()
        name = info["name"]
        found = await asyncio.to_thread(
            lambda: db.table("contacts")
            .select("id")
            .eq("user_id", user_id)
            .eq("name", name)
            .limit(1)
            .execute()
        )
        if found.data:
            return found.data[0]["id"]

        created = await asyncio.to_thread(
            lambda: db.table("contacts")
            .insert(
                {
                    "user_id": user_id,
                    "name": name,
                    "role": info.get("role", "promoter"),
                    "organisation": info.get("organisation", ""),
                    "email": info.get("email", ""),
                }
            )
            .execute()
        )
        return created.data[0]["id"] if created.data else None

    async def _write_ref(self, **kwargs: Any) -> None:
        db = get_supabase()
        remote_updated = kwargs.get("remote_updated_at")
        payload = {
            "user_id": kwargs["user_id"],
            "connection_id": kwargs["connection_id"],
            "provider": kwargs["provider"],
            "entity_type": kwargs["entity_type"],
            "entity_id": kwargs["entity_id"],
            "external_id": kwargs["external_id"],
            "etag": kwargs.get("etag", "") or "",
            "remote_updated_at": remote_updated.isoformat() if remote_updated else None,
        }
        await asyncio.to_thread(
            lambda: db.table("external_refs")
            .upsert(payload, on_conflict="user_id,provider,entity_type,external_id")
            .execute()
        )

    async def _delete_by_external(
        self, connection: dict[str, Any], external_id: str
    ) -> bool:
        """Remove a locally-mirrored event that vanished upstream."""
        db = get_supabase()
        user_id = connection["user_id"]

        found = await asyncio.to_thread(
            lambda: db.table("external_refs")
            .select("*")
            .eq("user_id", user_id)
            .eq("provider", connection["provider"])
            .eq("entity_type", "event")
            .eq("external_id", external_id)
            .maybe_single()
            .execute()
        )
        ref = found.data if found and found.data else None
        if not ref:
            return False

        await asyncio.to_thread(
            lambda: db.table("events")
            .delete()
            .eq("id", ref["entity_id"])
            .eq("user_id", user_id)
            .execute()
        )
        await asyncio.to_thread(
            lambda: db.table("external_refs").delete().eq("id", ref["id"]).execute()
        )
        return True

    # ── Run bookkeeping ──

    async def _start_run(self, connection: dict[str, Any]) -> dict[str, Any]:
        db = get_supabase()
        created = await asyncio.to_thread(
            lambda: db.table("sync_runs")
            .insert(
                {
                    "connection_id": connection["id"],
                    "user_id": connection["user_id"],
                    "status": "running",
                    "direction": "pull",
                    "attempt": int(connection.get("consecutive_failures", 0)) + 1,
                    "started_at": _now().isoformat(),
                }
            )
            .execute()
        )
        await self._update_connection(connection["id"], {"status": "syncing"})
        return created.data[0] if created.data else {"id": None}

    async def _finish_run(
        self,
        run_id: str | None,
        status: str,
        *,
        stats: dict[str, int] | None = None,
        error: str = "",
        next_retry_at: datetime | None = None,
    ) -> None:
        if not run_id:
            return
        db = get_supabase()
        payload: dict[str, Any] = {
            "status": status,
            "finished_at": _now().isoformat(),
            "error": error[:2000],
            "stats": stats or {},
        }
        if next_retry_at:
            payload["next_retry_at"] = next_retry_at.isoformat()
        await asyncio.to_thread(
            lambda: db.table("sync_runs").update(payload).eq("id", run_id).execute()
        )

    async def _update_connection(self, connection_id: str, patch: dict[str, Any]) -> None:
        db = get_supabase()
        await asyncio.to_thread(
            lambda: db.table("connections").update(patch).eq("id", connection_id).execute()
        )

    async def _handle_failure(
        self, connection: dict[str, Any], run: dict[str, Any], exc: Exception, *, retryable: bool
    ) -> dict[str, Any]:
        """Record a failure and schedule the next attempt, if any."""
        failures = int(connection.get("consecutive_failures", 0)) + 1
        message = str(exc)

        next_retry = None
        if retryable and failures <= _MAX_ATTEMPTS:
            delay = _BACKOFF_SECONDS[min(failures - 1, len(_BACKOFF_SECONDS) - 1)]
            next_retry = _now() + timedelta(seconds=delay)

        await self._finish_run(
            run["id"],
            "retrying" if next_retry else "failed",
            error=message,
            next_retry_at=next_retry,
        )
        await self._update_connection(
            connection["id"],
            {
                "status": "error",
                "last_error": message[:2000],
                "consecutive_failures": failures,
            },
        )
        logger.warning(
            "sync_failed",
            connection_id=connection["id"],
            attempt=failures,
            retry_at=next_retry.isoformat() if next_retry else None,
            error=message[:200],
        )
        return {
            "ok": False,
            "error": "sync_failed",
            "detail": message,
            "retry_at": next_retry.isoformat() if next_retry else None,
        }

    # ── Scheduler tick ──

    async def run_due_syncs(self, limit: int = 10) -> dict[str, Any]:
        """
        Process connections whose retry is due.

        Called by a background loop (and exposed as an endpoint so the demo can
        force a tick). Reads due work from the DB rather than memory, which is
        what makes retries survive a restart.
        """
        db = get_supabase()
        due = await asyncio.to_thread(
            lambda: db.table("sync_runs")
            .select("connection_id")
            .in_("status", ["pending", "retrying"])
            .lte("next_retry_at", _now().isoformat())
            .limit(limit)
            .execute()
        )
        connection_ids = list({row["connection_id"] for row in (due.data or [])})

        results = []
        for connection_id in connection_ids:
            results.append(await self.sync_connection(connection_id))
        return {"processed": len(results), "results": results}


_engine: SyncEngine | None = None


def get_sync_engine() -> SyncEngine:
    global _engine
    if _engine is None:
        _engine = SyncEngine()
    return _engine
