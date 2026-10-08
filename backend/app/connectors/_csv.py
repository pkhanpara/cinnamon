"""Helpers shared by the CSV connectors."""

import re
from collections.abc import Iterable
from decimal import Decimal, InvalidOperation

MAX_ROWS = 5000
SYMBOL_RE = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,14}$")


def decode(data: bytes) -> str | None:
    """UTF-8 text with any BOM removed, or None if the bytes are not UTF-8."""
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return None


def parse_decimal(raw: str, label: str) -> Decimal:
    """Parse a number, tolerating "$", "," and accounting-style "(1.23)" for negatives."""
    cleaned = raw.strip().replace("$", "").replace(",", "")
    if cleaned.startswith("(") and cleaned.endswith(")"):
        cleaned = "-" + cleaned[1:-1].strip()
    try:
        value = Decimal(cleaned)
    except InvalidOperation:
        raise ValueError(f"{label} is not a number: {raw.strip()!r}") from None
    if not value.is_finite():
        raise ValueError(f"{label} must be a finite number")
    return value


def is_blank(values: Iterable[str | list[str] | None]) -> bool:
    """True for an empty CSV row. csv.DictReader puts surplus cells in a list; those are ignored."""
    return not any((v or "").strip() for v in values if not isinstance(v, list))
