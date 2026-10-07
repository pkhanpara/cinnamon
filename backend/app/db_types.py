from decimal import Decimal

from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator


class DecimalText(TypeDecorator):
    """Exact decimals on SQLite, which has no decimal type (Numeric would silently go through float).

    Stored as TEXT. Do arithmetic in Python; SQL-side SUM()/ORDER BY would treat these as text.
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return None if value is None else str(Decimal(value))

    def process_result_value(self, value, dialect):
        return None if value is None else Decimal(value)
