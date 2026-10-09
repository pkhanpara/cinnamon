"""Connector plugin interface: turn a broker's export file into normalized positions.

A connector only parses; it never touches the database or the network. Adding a platform means
adding a module that defines a Connector and registering it in `app.connectors`.
"""

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Protocol


@dataclass(frozen=True)
class ParsedPosition:
    symbol: str
    name: str | None
    quantity: Decimal
    cost_basis: Decimal
    market_value: Decimal | None = None
    price: Decimal | None = None
    as_of: datetime | None = None


@dataclass(frozen=True)
class RowIssue:
    """`row` is the 1-based line number in the file (header = line 1); 0 means the whole file."""

    row: int
    message: str


@dataclass
class ParseResult:
    positions: list[ParsedPosition] = field(default_factory=list)
    errors: list[RowIssue] = field(default_factory=list)
    # Symbols the file holds without a cost (e.g. shares transferred in); the user supplies their
    # average cost and the file is parsed again with `average_costs`.
    needs_average_cost: list[str] = field(default_factory=list)


class Connector(Protocol):
    slug: str
    label: str
    description: str
    # Platform slugs this connector is specific to. Empty = usable with any platform.
    platforms: frozenset[str]

    def parse(self, data: bytes) -> ParseResult: ...


# A connector that sets `accepts_average_costs = True` also takes
#     parse(data, average_costs: Mapping[str, Decimal] | None)
# with the user's average cost per symbol, for the symbols it listed in `needs_average_cost`.
