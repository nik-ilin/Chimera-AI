"""
Connection management  (Block 0)

  GET    /api/connections/catalogue      — every adapter + configuration state
  GET    /api/connections?user_id=…      — this user's connections + health
  POST   /api/connections/connect        — begin a connection (OAuth or direct)
  GET    /api/connections/oauth/callback — OAuth redirect target
  POST   /api/connections/{id}/sync      — force a sync now
  DELETE /api/connections/{id}           — disconnect and forget tokens
  POST   /api/connections/sync-due       — scheduler tick

Service-token guarded like every other backend route. `user_id` is supplied by
the Next.js Route Handler from the verified session — the browser never reaches
FastAPI directly, so this stays a server-to-server contract (CONVENTIONS.md §1).

NOTE: no `from __future__ import annotations` — see routes/classify.py for why
it breaks the slowapi decorator.
"""
import asyncio
import hmac
import json
import secrets
import time
from hashlib import sha256
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from config import settings
from dependencies.auth import verify_service_token
from limiter import limiter
from services.connectors import describe_all, get_connector, has_connector
from services.connectors.vault import encrypt, vault_available
from services.supabase import get_supabase
from services.sync import get_sync_engine

logger = structlog.get_logger()

# The OAuth callback is hit by the USER'S BROWSER after Google redirects, so it
# cannot carry the service token. It lives on its own router without the guard;
# its authenticity comes from the signed `state` parameter instead.
router = APIRouter(tags=["connections"], dependencies=[Depends(verify_service_token)])
public_router = APIRouter(tags=["connections"])

# Signed state TTL. Long enough to consent, short enough that a leaked URL from
# a browser history is useless.
_STATE_TTL_SECONDS = 600


def _sign_state(user_id: str, provider: str) -> str:
    """
    Build a tamper-proof OAuth `state`.

    state is the CSRF defence for the whole flow: it is the only thing tying the
    callback back to the user who started it. We HMAC it with the service token
    so a forged callback cannot bind an attacker's Google account to someone
    else's Chimera account.
    """
    issued = str(int(time.time()))
    nonce = secrets.token_urlsafe(8)
    payload = f"{user_id}|{provider}|{issued}|{nonce}"
    signature = hmac.new(
        settings.chimera_service_token.encode(), payload.encode(), sha256
    ).hexdigest()[:32]
    # Hex-encoded so the value is URL-safe without extra escaping.
    return json.dumps({"p": payload, "s": signature}).encode().hex()


def _verify_state(state: str) -> tuple[str, str]:
    """Validate a state string. Returns (user_id, provider) or raises 400."""
    try:
        decoded = json.loads(bytes.fromhex(state).decode())
        payload = decoded["p"]
        signature = decoded["s"]
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Malformed OAuth state.")

    expected = hmac.new(
        settings.chimera_service_token.encode(), payload.encode(), sha256
    ).hexdigest()[:32]
    # compare_digest, not ==, so a forged signature cannot be found byte by byte.
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=400, detail="Invalid OAuth state signature.")

    user_id, provider, issued, _nonce = payload.split("|")
    if int(time.time()) - int(issued) > _STATE_TTL_SECONDS:
        raise HTTPException(status_code=400, detail="OAuth state expired; try again.")
    return user_id, provider


# ─── Catalogue ────────────────────────────────────────────────────────────────


@router.get("/connections/catalogue")
async def catalogue() -> dict[str, Any]:
    """Every adapter, whether or not it is configured. Drives the connect UI."""
    return {"connectors": describe_all(), "vault_ready": vault_available()}


# ─── List ─────────────────────────────────────────────────────────────────────


@router.get("/connections")
@limiter.limit("60/minute")
async def list_connections(request: Request, user_id: str) -> dict[str, Any]:
    db = get_supabase()
    result = await asyncio.to_thread(
        lambda: db.table("connections")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=False)
        .execute()
    )
    rows = result.data or []
    # Never return tokens — they live in a separate table this query cannot see,
    # which is the point of that split (migration 007).
    return {"connections": rows}


# ─── Connect ──────────────────────────────────────────────────────────────────


class ConnectRequest(BaseModel):
    user_id: str
    provider: str
    # Non-secret adapter settings: caldav_url, ics_url, username, calendar_id…
    config: dict[str, Any] = Field(default_factory=dict)
    # CalDAV password. Encrypted immediately; never persisted in plaintext,
    # never logged, never returned.
    secret: str = ""
    # Where to bounce the browser after an OAuth round trip.
    return_url: str = ""


@router.post("/connections/connect")
@limiter.limit("20/minute")
async def connect(request: Request, body: ConnectRequest) -> dict[str, Any]:
    """
    Begin a connection.

    OAuth adapters return an authorize_url for the browser to follow. Everything
    else is connected immediately and synced once, so the user sees data rather
    than an empty "connected" card.
    """
    if not has_connector(body.provider):
        raise HTTPException(status_code=404, detail=f"Unknown provider {body.provider!r}")

    connector = get_connector(body.provider)
    if not connector.is_configured():
        raise HTTPException(
            status_code=400,
            detail=(
                f"{connector.label} is not configured on the server. "
                f"Missing: {', '.join(connector.missing_env())}"
            ),
        )

    # Refuse before sending the user to a consent screen we cannot honour.
    if connector.capabilities.oauth and not vault_available():
        raise HTTPException(
            status_code=400,
            detail=(
                "OAUTH_TOKEN_ENCRYPTION_KEY is not set, so OAuth tokens cannot be "
                "stored securely. Generate one with: openssl rand -hex 32"
            ),
        )

    db = get_supabase()
    existing = await asyncio.to_thread(
        lambda: db.table("connections")
        .select("*")
        .eq("user_id", body.user_id)
        .eq("provider", body.provider)
        .maybe_single()
        .execute()
    )
    connection = existing.data if existing and existing.data else None

    if connection is None:
        created = await asyncio.to_thread(
            lambda: db.table("connections")
            .insert(
                {
                    "user_id": body.user_id,
                    "provider": body.provider,
                    "status": "disconnected",
                    "config": body.config,
                    "scopes": [],
                }
            )
            .execute()
        )
        connection = created.data[0]
    else:
        await asyncio.to_thread(
            lambda: db.table("connections")
            .update({"config": body.config})
            .eq("id", connection["id"])
            .execute()
        )

    if connector.capabilities.oauth:
        state = _sign_state(body.user_id, body.provider)
        return {
            "mode": "oauth",
            "authorize_url": connector.authorize_url(state, settings.google_redirect_uri),
            "connection_id": connection["id"],
        }

    # Direct credentials (CalDAV) or no credentials (demo).
    if body.secret:
        await asyncio.to_thread(
            lambda: db.table("connection_secrets")
            .upsert(
                {
                    "connection_id": connection["id"],
                    "access_token_enc": encrypt(body.secret),
                    "refresh_token_enc": "",
                },
                on_conflict="connection_id",
            )
            .execute()
        )

    await asyncio.to_thread(
        lambda: db.table("connections")
        .update({"status": "connected", "last_error": "", "consecutive_failures": 0})
        .eq("id", connection["id"])
        .execute()
    )

    # Sync immediately: a card that says "connected" but shows nothing feels
    # broken even when it isn't.
    result = await get_sync_engine().sync_connection(connection["id"])
    return {"mode": "direct", "connection_id": connection["id"], "sync": result}


# ─── OAuth callback (browser-facing, no service token) ────────────────────────


@public_router.get("/connections/oauth/callback")
async def oauth_callback(request: Request, code: str = "", state: str = "", error: str = ""):
    """
    Google redirects the user's browser here. Authenticity comes from the signed
    `state`, since a browser redirect cannot carry the service token.

    Always ends in a redirect back to the portal — the user should never see raw
    JSON. Failures carry an ?error= the UI renders as a readable message.
    """
    portal = settings.allowed_origins[0] if settings.allowed_origins else "http://localhost:3005"
    destination = f"{portal}/portal/musician/manager/connections"

    if error:
        return RedirectResponse(f"{destination}?error={error}", status_code=302)
    if not code or not state:
        return RedirectResponse(f"{destination}?error=missing_code", status_code=302)

    try:
        user_id, provider = _verify_state(state)
    except HTTPException as exc:
        return RedirectResponse(f"{destination}?error={exc.detail}", status_code=302)

    connector = get_connector(provider)
    try:
        tokens = await connector.exchange_code(code, settings.google_redirect_uri)
    except Exception as exc:  # noqa: BLE001
        logger.warning("oauth_exchange_failed", provider=provider, error=str(exc))
        return RedirectResponse(f"{destination}?error=exchange_failed", status_code=302)

    db = get_supabase()
    existing = await asyncio.to_thread(
        lambda: db.table("connections")
        .select("*")
        .eq("user_id", user_id)
        .eq("provider", provider)
        .maybe_single()
        .execute()
    )
    connection = existing.data if existing and existing.data else None
    if connection is None:
        created = await asyncio.to_thread(
            lambda: db.table("connections")
            .insert({"user_id": user_id, "provider": provider, "status": "disconnected"})
            .execute()
        )
        connection = created.data[0]

    label = ""
    if hasattr(connector, "account_email"):
        label = await connector.account_email(tokens.get("access_token", ""))

    await get_sync_engine()._store_tokens(connection["id"], tokens)
    await asyncio.to_thread(
        lambda: db.table("connections")
        .update(
            {
                "status": "connected",
                "account_label": label,
                "scopes": (tokens.get("scope") or "").split(),
                "last_error": "",
                "consecutive_failures": 0,
            }
        )
        .eq("id", connection["id"])
        .execute()
    )

    # First sync inline so the portal has data the moment the user lands back.
    await get_sync_engine().sync_connection(connection["id"])
    return RedirectResponse(f"{destination}?connected={provider}", status_code=302)


# ─── Sync / disconnect ────────────────────────────────────────────────────────


class SyncRequest(BaseModel):
    user_id: str


@router.post("/connections/{connection_id}/sync")
@limiter.limit("30/minute")
async def sync_now(request: Request, connection_id: str, body: SyncRequest) -> dict[str, Any]:
    db = get_supabase()
    owned = await asyncio.to_thread(
        lambda: db.table("connections")
        .select("id")
        .eq("id", connection_id)
        .eq("user_id", body.user_id)
        .maybe_single()
        .execute()
    )
    # Ownership is checked here because FastAPI uses the service-role key, which
    # bypasses RLS — the guarantee the Next.js layer gets for free does not
    # apply on this side of the wire.
    if not (owned and owned.data):
        raise HTTPException(status_code=404, detail="Connection not found.")

    # Two-way: pull first, then push local changes. Pull-before-push matters —
    # pushing first would resurrect events deleted on the user's phone.
    return await get_sync_engine().sync_two_way(connection_id)


@router.post("/connections/{connection_id}/push")
@limiter.limit("30/minute")
async def push_now(request: Request, connection_id: str, body: SyncRequest) -> dict[str, Any]:
    """Push local events upstream without pulling first."""
    db = get_supabase()
    owned = await asyncio.to_thread(
        lambda: db.table("connections")
        .select("id")
        .eq("id", connection_id)
        .eq("user_id", body.user_id)
        .maybe_single()
        .execute()
    )
    if not (owned and owned.data):
        raise HTTPException(status_code=404, detail="Connection not found.")

    return await get_sync_engine().push_pending(connection_id)


@router.delete("/connections/{connection_id}")
async def disconnect(connection_id: str, user_id: str) -> dict[str, Any]:
    """
    Disconnect and forget the tokens.

    Deleting the connection cascades to connection_secrets and external_refs.
    Events already imported are KEPT and simply lose their source link — the
    user's calendar should not empty out because they unplugged an integration.
    """
    db = get_supabase()
    owned = await asyncio.to_thread(
        lambda: db.table("connections")
        .select("id")
        .eq("id", connection_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not (owned and owned.data):
        raise HTTPException(status_code=404, detail="Connection not found.")

    await asyncio.to_thread(
        lambda: db.table("events")
        .update({"source_connection_id": None})
        .eq("source_connection_id", connection_id)
        .execute()
    )
    await asyncio.to_thread(
        lambda: db.table("connections").delete().eq("id", connection_id).execute()
    )
    return {"ok": True}


@router.post("/connections/sync-due")
async def sync_due(limit: int = 10) -> dict[str, Any]:
    """Scheduler tick: run every sync whose backoff has elapsed."""
    return await get_sync_engine().run_due_syncs(limit=limit)
