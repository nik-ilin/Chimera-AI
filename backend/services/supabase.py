"""
Supabase service-role client for FastAPI.

Uses the service-role key (full DB access, bypasses RLS).
This client is NEVER exposed to the browser — FastAPI-only.

See CONVENTIONS.md §1: Supabase.
"""
from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

from config import settings

if TYPE_CHECKING:
    from supabase import Client


@lru_cache(maxsize=1)
def get_supabase() -> "Client":
    """
    Returns a singleton Supabase client initialised with the service-role key.

    The `supabase` package is imported LAZILY here, not at module load: its
    dependency tree (gotrue, postgrest, storage3, realtime, httpx, websockets…)
    is large and cold-importing it can take minutes on a slow disk, which would
    otherwise block `uvicorn main:app` startup. The first request that needs the
    DB pays the import once; it is cached thereafter.
    """
    from supabase import create_client  # noqa: PLC0415 — deferred on purpose

    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. "
            "The backend cannot access the database without them."
        )
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
