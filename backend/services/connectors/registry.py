"""
Connector registry.

The one place that knows which adapters exist. Mirrors get_llm_service() in
services/llm.py: callers ask for a key and get an interface, never a concrete
class, so registering a new provider is a single line here plus its adapter file.

Instances are stateless (all per-user state arrives in a SyncContext), so one
shared instance per provider is safe and avoids rebuilding them per request.
"""
from __future__ import annotations

import logging

from services.connectors.base import Connector
from services.connectors.caldav import CalDavConnector
from services.connectors.demo import DemoConnector
from services.connectors.google_calendar import GoogleCalendarConnector

logger = logging.getLogger(__name__)

_REGISTRY: dict[str, Connector] = {}


def _register(connector: Connector) -> None:
    _REGISTRY[connector.key] = connector


_register(GoogleCalendarConnector())
_register(CalDavConnector())
_register(DemoConnector())


def get_connector(provider: str) -> Connector:
    """Look up an adapter. Raises KeyError for an unknown provider."""
    connector = _REGISTRY.get(provider)
    if connector is None:
        raise KeyError(f"Unknown connector provider: {provider!r}")
    return connector


def has_connector(provider: str) -> bool:
    return provider in _REGISTRY


def all_connectors() -> list[Connector]:
    return list(_REGISTRY.values())


def describe_all() -> list[dict]:
    """
    Catalogue for the "Connect a service" UI.

    Includes adapters that are NOT configured, along with the env vars they
    need — showing a greyed card that explains what is missing beats hiding the
    integration and leaving the user wondering whether it exists.
    """
    catalogue = []
    for connector in all_connectors():
        capabilities = connector.capabilities
        catalogue.append(
            {
                "provider": connector.key,
                "label": connector.label,
                "description": connector.description,
                "icon": connector.icon,
                "configured": connector.is_configured(),
                "missing_env": connector.missing_env(),
                "capabilities": {
                    "pull": capabilities.pull,
                    "push": capabilities.push,
                    "oauth": capabilities.oauth,
                    "demo": capabilities.demo,
                },
            }
        )
    return catalogue
