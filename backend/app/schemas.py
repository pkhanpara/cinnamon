from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, StringConstraints


def _normalize(v):
    # Runs before the pattern check (pydantic applies `pattern` before `to_lower`).
    return v.strip().lower() if isinstance(v, str) else v


Username = Annotated[
    str, BeforeValidator(_normalize), StringConstraints(pattern=r"^[a-z0-9_.-]{3,64}$")
]
MIN_PASSWORD_LENGTH = 10
Password = Annotated[str, StringConstraints(min_length=MIN_PASSWORD_LENGTH, max_length=256)]
Platform = Annotated[
    str, BeforeValidator(_normalize), StringConstraints(pattern=r"^[a-z0-9_-]{2,32}$")
]
Nickname = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class Credentials(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    username: Username
    password: Password
    is_admin: bool = False


class ChangePassword(BaseModel):
    current_password: str
    new_password: Password


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
    must_change_password: bool = False


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


class SymbolQuote(BaseModel):
    price: Decimal
    prev_close: Decimal | None
    change: Decimal | None  # only for live quotes: a stale quote's "previous close" means nothing
    change_pct: Decimal | None
    as_of: datetime
    stale: bool


class SymbolProfile(BaseModel):
    name: str | None
    exchange: str | None
    industry: str | None
    country: str | None
    currency: str | None
    web_url: str | None
    market_cap: Decimal | None  # USD


class SymbolStats(BaseModel):
    week52_high: Decimal | None
    week52_low: Decimal | None
    avg_volume_10d: Decimal | None  # shares
    avg_volume_3m: Decimal | None


class SymbolOverview(BaseModel):
    symbol: str
    name: str | None
    quote: SymbolQuote | None
    profile: SymbolProfile | None
    stats: SymbolStats | None
    position: HoldingOut | None  # your holding across all your accounts, None if not held
    warnings: list[str]


class BarOut(BaseModel):
    t: int  # UTC epoch seconds (bar start)
    d: date  # trading date in the exchange's time zone
    o: Decimal
    h: Decimal
    l: Decimal
    c: Decimal
    v: int


class HistoryOut(BaseModel):
    symbol: str
    range: str
    intraday: bool
    bars: list[BarOut]
    stale: bool
    as_of: datetime


class NewsOut(BaseModel):
    headline: str
    summary: str
    source: str
    url: str
    published_at: datetime


class NewsListOut(BaseModel):
    items: list[NewsOut]
    stale: bool
    as_of: datetime  # when these items were fetched upstream (UTC)


class SearchHitOut(BaseModel):
    symbol: str
    description: str
    type: str


# --- watchlists and investing principles (ADR 0012) ---

WatchlistName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]
Verdict = Literal["pass", "fail", "unsure"]


class WatchlistCreate(BaseModel):
    name: WatchlistName


class WatchlistUpdate(BaseModel):
    name: WatchlistName


class WatchlistItemCreate(BaseModel):
    symbol: Annotated[
        str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,14}$")
    ]


class WatchlistItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    symbol: str
    added_at: datetime


class WatchlistOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    symbols: list[str]  # in the order they were added


class WatchlistDetail(BaseModel):
    id: int
    name: str
    created_at: datetime
    items: list[WatchlistItemOut]


class CheckIn(BaseModel):
    verdict: Verdict
    note: Annotated[str, StringConstraints(max_length=2000)] = ""


class CheckOut(BaseModel):
    verdict: Verdict
    note: str
    updated_at: datetime


class PrincipleOut(BaseModel):
    key: str
    label: str
    description: str
    kind: Literal["computed", "manual"]
    rule: str
    unit: str | None
    better: Literal["lower", "higher"] | None
    value: Decimal | None
    status: Literal["pass", "fail", "warn", "info", "na", "manual"]
    note: str
    years: int | None
    check: CheckOut | None  # the user's own verdict, which overrides `status` when set


class InsiderTradeOut(BaseModel):
    name: str
    shares_change: int
    price: Decimal | None
    code: str
    transaction_date: date
    filing_date: date | None


class InsiderSideOut(BaseModel):
    name: str
    trades: int
    shares: int
    value: Decimal  # USD, priced trades only; sale proceeds, not profit
    avg_price: Decimal | None
    first_date: date
    last_date: date
    unpriced: int


class InsiderSummaryOut(BaseModel):
    sellers: list[InsiderSideOut]  # top 10 by value
    buyers: list[InsiderSideOut]  # top 10 by value


class BuybackYearOut(BaseModel):
    year: int
    amount: Decimal
    avg_price: Decimal | None
    high_5y: Decimal | None
    near_high: bool


class CashYearOut(BaseModel):
    year: int
    net_income: Decimal | None
    owner_earnings: Decimal | None
    cfo: Decimal | None
    cff: Decimal | None
    acquisitions: Decimal | None
    buybacks: Decimal | None
    rnd: Decimal | None
    revenue: Decimal | None


class SplitOut(BaseModel):
    date: date
    ratio: Decimal


class EvidenceOut(BaseModel):
    insider_trades: list[InsiderTradeOut]  # open-market buys and sales, last 12 months
    insider_net_value: Decimal | None  # USD, positive = net buying
    insider_summary: InsiderSummaryOut
    buybacks: list[BuybackYearOut]
    years: list[CashYearOut]  # last 10 fiscal years, newest first
    splits: list[SplitOut]  # newest first


class ScorecardOut(BaseModel):
    symbol: str
    name: str | None
    sector: str | None
    industry: str | None
    applicable: bool  # False for funds: the principles are about companies
    principles: list[PrincipleOut]
    evidence: EvidenceOut | None
    warnings: list[str]
    as_of: datetime | None
    stale: bool


class PeerStatOut(BaseModel):
    key: str
    mean: Decimal | None
    median: Decimal | None
    n: int


class PeerOut(BaseModel):
    symbol: str
    name: str | None


class PeersOut(BaseModel):
    symbol: str
    peers: list[PeerOut]  # those with data
    failed: list[str]  # peers that could not be fetched
    stats: list[PeerStatOut]
    stale: bool
