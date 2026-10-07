from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.db_types import DecimalText


def utcnow() -> datetime:
    return datetime.now(UTC)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True)  # stored lowercase
    password_hash: Mapped[str] = mapped_column(String(255))
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    accounts: Mapped[list["Account"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class AuthSession(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)  # sha256 hex of the cookie
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (UniqueConstraint("user_id", "nickname"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    platform: Mapped[str] = mapped_column(String(32))  # connector slug, e.g. "robinhood"
    nickname: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped[User] = relationship(back_populates="accounts")


class Import(Base):
    """Audit record of one confirmed import. Positions are replaced on each import (ADR 0002)."""

    __tablename__ = "imports"

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    connector: Mapped[str] = mapped_column(String(32))
    filename: Mapped[str] = mapped_column(String(255))
    file_sha256: Mapped[str] = mapped_column(String(64))
    row_count: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Position(Base):
    __tablename__ = "positions"
    __table_args__ = (UniqueConstraint("account_id", "symbol"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    import_id: Mapped[int] = mapped_column(ForeignKey("imports.id"))
    symbol: Mapped[str] = mapped_column(String(16))
    name: Mapped[str | None] = mapped_column(String(200))
    quantity: Mapped[Decimal] = mapped_column(DecimalText)
    cost_basis: Mapped[Decimal] = mapped_column(DecimalText)
    market_value: Mapped[Decimal | None] = mapped_column(
        DecimalText
    )  # as of `as_of`, from the file
    price: Mapped[Decimal | None] = mapped_column(
        DecimalText
    )  # price the file's value was based on
    as_of: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class QuoteCache(Base):
    """Latest known quote per symbol. Market data is public, so this is shared across users."""

    __tablename__ = "quote_cache"

    symbol: Mapped[str] = mapped_column(String(16), primary_key=True)
    price: Mapped[Decimal] = mapped_column(DecimalText)
    prev_close: Mapped[Decimal | None] = mapped_column(DecimalText)
    quote_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # last trade time
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
