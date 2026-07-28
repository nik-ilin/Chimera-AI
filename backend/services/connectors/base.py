"""
Connector abstraction  (Block 0)

Deliberately mirrors services/llm.py: one abstract interface, many backends, a
registry that picks one, and callers that never import a concrete class. There
the swappable thing is a model provider; here it is an integration.

Contract for an adapter
-----------------------
    class MyConnector(Connector):
        key = "my_provider"
        ...
        async def pull(self, ctx) -> PullResult: ...

Adding a provider = writing one file and registering it. Nothing else in the
codebase changes, because everything downstream speaks canonical models.

Two rules every adapter must honour:

1. IDEMPOTENCE. pull() may run twice on the same window (retry, crash, manual
   re-sync). Every returned item carries an ExternalRef, and the sync engine
   upserts on (user, provider, entity_type, external_id) — so a replay updates
   rather than duplicates. An adapter that invents a fresh id per call breaks
   this and will spam the user's calendar.

2. CANONICAL OUTPUT. Convert to models/canonical.py before returning. No
   provider dicts past this boundary.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from models.canonical import CanonicalEvent

logger = logging.getLogger(__name__)


# ─── Capability flags ─────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Capabilities:
    """
    What an adapter can actually do. The UI reads these to decide which buttons
    to render, so a connector that cannot push never shows a "push" affordance.
    """

    pull: bool = True
    push: bool = False
    # OAuth (Google) vs. user-supplied credentials (CalDAV URL + password).
    oauth: bool = False
    # True when the adapter serves built-in demo data rather than a live API.
    # Surfaced in the UI so mocked results are never mistaken for live ones.
    demo: bool = False


# ─── Sync context + results ───────────────────────────────────────────────────


@dataclass
class SyncContext:
    """Everything an adapter needs for one sync run."""

    user_id: str
    connection_id: str
    # Adapter-defined incremental marker from the last successful run: a Google
    # syncToken, a CalDAV ctag, an ISO timestamp. Empty on first sync.
    cursor: str = ""
    access_token: str = ""
    refresh_token: str = ""
    # Non-secret adapter settings (CalDAV URL, chosen calendar id, …).
    config: dict[str, Any] = field(default_factory=dict)
    # Bounding window for a full sync. Adapters SHOULD respect it so a first
    # sync of a decade-old calendar doesn't pull 4000 events.
    window_start: datetime | None = None
    window_end: datetime | None = None


@dataclass
class PullResult:
    """Outcome of a pull. `events` are canonical and ready to upsert."""

    events: list[CanonicalEvent] = field(default_factory=list)
    # External ids deleted remotely, so the engine can tombstone them locally.
    deleted_external_ids: list[str] = field(default_factory=list)
    # New cursor to persist. Empty means "no incremental support, full sync
    # next time" — valid, just less efficient.
    cursor: str = ""
    # True when the provider says there is more to fetch; the engine schedules
    # an immediate follow-up run rather than waiting for the next tick.
    has_more: bool = False


@dataclass
class PushResult:
    """Outcome of pushing one local event upstream."""

    external_id: str = ""
    etag: str = ""


class ConnectorError(RuntimeError):
    """
    Adapter failure.

    `retryable` drives the sync engine's backoff decision: a 503 or a timeout is
    worth retrying, a 401 after refresh or a 400 on malformed data is not —
    retrying those just burns quota and keeps a broken connection looking busy
    instead of surfacing as an error the user can fix.
    """

    def __init__(self, message: str, *, retryable: bool = True) -> None:
        super().__init__(message)
        self.retryable = retryable


class NeedsReauth(ConnectorError):
    """Credentials are dead; only the user can fix it. Never retryable."""

    def __init__(self, message: str = "Re-authentication required.") -> None:
        super().__init__(message, retryable=False)


# ─── The interface ────────────────────────────────────────────────────────────


class Connector(ABC):
    """Single interface for all third-party integrations in Chimera."""

    #: Stable registry key, persisted in connections.provider. Never rename.
    key: str = ""
    #: Human label for the connect UI.
    label: str = ""
    #: One-line description shown on the connection card.
    description: str = ""
    #: Lucide icon name the frontend maps to a component.
    icon: str = "Plug"

    @property
    @abstractmethod
    def capabilities(self) -> Capabilities: ...

    @abstractmethod
    def is_configured(self) -> bool:
        """
        Whether the SERVER has what this adapter needs (client id/secret, etc.).
        False makes the UI show "needs configuration" with the missing env var
        named, rather than offering a button that dead-ends.
        """

    def missing_env(self) -> list[str]:
        """Env vars that must be set before this adapter can go live."""
        return []

    # ── OAuth (only meaningful when capabilities.oauth) ──

    def authorize_url(self, state: str, redirect_uri: str) -> str:
        raise NotImplementedError(f"{self.key} does not use OAuth.")

    async def exchange_code(self, code: str, redirect_uri: str) -> dict[str, Any]:
        """Trade an authorization code for tokens. Returns a token dict."""
        raise NotImplementedError(f"{self.key} does not use OAuth.")

    async def refresh(self, refresh_token: str) -> dict[str, Any]:
        """Mint a fresh access token. Raise NeedsReauth if the grant is dead."""
        raise NotImplementedError(f"{self.key} does not use OAuth.")

    # ── Sync ──

    @abstractmethod
    async def pull(self, ctx: SyncContext) -> PullResult:
        """Fetch remote changes as canonical events. Must be idempotent."""

    async def push(self, ctx: SyncContext, event: CanonicalEvent) -> PushResult:
        """Create or update one event upstream. Only called when capabilities.push."""
        raise NotImplementedError(f"{self.key} is read-only.")

    async def delete(self, ctx: SyncContext, external_id: str) -> None:
        """Remove an event upstream. Only called when capabilities.push."""
        raise NotImplementedError(f"{self.key} is read-only.")

    async def health(self, ctx: SyncContext) -> bool:
        """
        Cheap liveness probe for the connection card. Default: attempt a tiny
        pull. Adapters with a dedicated ping endpoint should override.
        """
        try:
            await self.pull(ctx)
            return True
        except ConnectorError:
            return False
