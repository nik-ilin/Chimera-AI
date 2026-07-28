"""
Connector layer — third-party integrations behind one interface.

Public surface:

    from services.connectors import get_connector, describe_all
    from services.connectors.base import SyncContext

Everything else (adapters, the vault, the ICS codec) is an implementation
detail. Import from here rather than reaching into submodules, so adapters can
be reorganised without touching call sites.
"""
from services.connectors.base import (
    Capabilities,
    Connector,
    ConnectorError,
    NeedsReauth,
    PullResult,
    PushResult,
    SyncContext,
)
from services.connectors.registry import (
    all_connectors,
    describe_all,
    get_connector,
    has_connector,
)

__all__ = [
    "Capabilities",
    "Connector",
    "ConnectorError",
    "NeedsReauth",
    "PullResult",
    "PushResult",
    "SyncContext",
    "all_connectors",
    "describe_all",
    "get_connector",
    "has_connector",
]
