from datetime import datetime
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, BeforeValidator, ConfigDict, StringConstraints


def _normalize(v):
    # Runs before the pattern check (pydantic applies `pattern` before `to_lower`).
    return v.strip().lower() if isinstance(v, str) else v


Username = Annotated[
    str, BeforeValidator(_normalize), StringConstraints(pattern=r"^[a-z0-9_.-]{3,64}$")
]
Password = Annotated[str, StringConstraints(min_length=10, max_length=256)]
Platform = Annotated[
    str, BeforeValidator(_normalize), StringConstraints(pattern=r"^[a-z0-9_-]{2,32}$")
]
Nickname = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class Credentials(BaseModel):
    username: str
    password: str


class SetupRequest(BaseModel):
    username: Username
    password: Password


class UserCreate(SetupRequest):
    is_admin: bool = False


class UserUpdate(BaseModel):
    is_active: bool | None = None
    is_admin: bool | None = None
    password: Password | None = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    is_admin: bool
    is_active: bool


class AuthStatus(BaseModel):
    setup_required: bool


class AccountCreate(BaseModel):
    platform: Platform
    nickname: Nickname


class AccountUpdate(BaseModel):
    nickname: Nickname


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    platform: str
    nickname: str
    created_at: datetime
    position_count: int = 0
    last_import_at: datetime | None = None


class ConnectorOut(BaseModel):
    slug: str
    label: str
    description: str


class PositionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    symbol: str
    name: str | None
    quantity: Decimal
    cost_basis: Decimal
    market_value: Decimal | None
    price: Decimal | None
    as_of: datetime | None


class IssueOut(BaseModel):
    row: int
    message: str


class ImportPreview(BaseModel):
    connector: str
    filename: str
    rows: list[PositionOut]
    errors: list[IssueOut]
    warnings: list[str]
    current_position_count: int
    total_cost_basis: Decimal
    total_market_value: Decimal | None  # None unless every row has a market_value


class ImportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    connector: str
    filename: str
    row_count: int
    created_at: datetime


class HoldingLine(BaseModel):
    account_id: int
    account_nickname: str
    platform: str
    quantity: Decimal
    cost_basis: Decimal
    value: Decimal | None
    source: str


class HoldingOut(BaseModel):
    symbol: str
    name: str | None
    quantity: Decimal
    cost_basis: Decimal
    price: Decimal | None
    source: str  # live | stale | file | none
    value: Decimal | None
    gain: Decimal | None
    gain_pct: Decimal | None
    weight_pct: Decimal | None
    day_change: Decimal | None
    day_change_pct: Decimal | None
    lines: list[HoldingLine]


class HoldingsSummary(BaseModel):
    total_value: Decimal
    total_cost_basis: Decimal
    gain: Decimal
    gain_pct: Decimal | None
    day_change: Decimal | None
    day_change_pct: Decimal | None
    live_count: int
    stale_count: int
    file_count: int
    unpriced_count: int


class HoldingsOut(BaseModel):
    account_ids: list[int]
    summary: HoldingsSummary
    holdings: list[HoldingOut]
    warnings: list[str]
    prices_as_of: datetime | None
