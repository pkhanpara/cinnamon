from app.connectors.base import Connector, ParsedPosition, ParseResult, RowIssue
from app.connectors.m1 import M1TaxLotsConnector
from app.connectors.snapshot import SnapshotConnector

_REGISTRY: dict[str, Connector] = {}


def register(connector: Connector) -> None:
    if connector.slug in _REGISTRY:
        raise ValueError(f"Connector {connector.slug!r} is already registered")
    _REGISTRY[connector.slug] = connector


def get(slug: str) -> Connector | None:
    return _REGISTRY.get(slug)


def for_platform(platform: str) -> list[Connector]:
    """Connectors usable for an account: platform-specific ones first, then the generic ones."""
    specific = [c for c in _REGISTRY.values() if platform in c.platforms]
    generic = [c for c in _REGISTRY.values() if not c.platforms]
    return specific + generic


register(SnapshotConnector())
register(M1TaxLotsConnector())

__all__ = [
    "Connector",
    "ParseResult",
    "ParsedPosition",
    "RowIssue",
    "for_platform",
    "get",
    "register",
]
