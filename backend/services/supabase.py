"""
Supabase service-role client for FastAPI.

Uses the service-role key (full DB access, bypasses RLS).
This client is NEVER exposed to the browser — FastAPI-only.

See CONVENTIONS.md §1: Supabase.
"""
from __future__ import annotations

from functools import lru_cache

from supabase import create_client, Client

from config import settings


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    """
    Returns a singleton Supabase client initialised with the service-role key.
    Raises RuntimeError at startup if SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY
    are missing (fail-fast per CONVENTIONS.md §3).
    """
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. "
            "The backend cannot access the database without them."
        )
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
