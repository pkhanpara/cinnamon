"""Pure scorecard math for the investing principles (ADR 0012). Decimal only, no I/O.

`core_from` trims provider data into a small, JSON-serialisable `CoreData` (what the DB cache stores);
`score` turns it into one `Result` per computed principle; `peer_stats` summarises peers.
"""

import statistics
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from app import principles as P
from app.providers.base import AnnualReport, Bar, BasicFinancials, InsiderTrade, Ownership

HUNDRED = Decimal(100)

# Standard concept names tried in order; filers switch names over the years (JNJ revenue moved from
# SalesRevenueGoodsNet to RevenueFromContract... in 2018, banks use DepreciationAmortizationAndAccretionNet).
CONCEPTS: dict[str, tuple[str, ...]] = {
    "net_income": (
        "NetIncomeLoss",
        "ProfitLoss",
        "NetIncomeLossAvailableToCommonStockholdersBasic",
    ),
    "dna": (
        "DepreciationDepletionAndAmortization",
        "DepreciationAndAmortization",
        "DepreciationAmortizationAndAccretionNet",
    ),
    "capex": (
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "PaymentsToAcquireProductiveAssets",
        "PaymentsForCapitalImprovements",
    ),
    "cfo": (
        "NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ),
    "cff": (
        "NetCashProvidedByUsedInFinancingActivities",
        "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations",
    ),
    "buybacks": ("PaymentsForRepurchaseOfCommonStock",),
    "acquisitions": (
        "PaymentsToAcquireBusinessesNetOfCashAcquired",
        "PaymentsToAcquireBusinessesGross",
        "PaymentsToAcquireBusinessesAndInterestInAffiliates",
    ),
    "revenue": (
        "Revenues",
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "SalesRevenueNet",
        "SalesRevenueGoodsNet",
    ),
    # JNJ tags its $14.7B R&D as ...ExcludingAcquiredInProcessCost and uses the plain concept for a
    # $109M in-process charge, so the narrower concept wins when both exist.
    "rnd": (
        "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost",
        "ResearchAndDevelopmentExpense",
    ),
}

EPS_CONCEPTS = (
    "EarningsPerShareDiluted",
    "EarningsPerShareBasic",
    "IncomeLossFromContinuingOperationsPerDilutedShare",
)

FUND_TYPES = {"ETF", "MUTUALFUND", "INDEX", "MONEYMARKET"}


@dataclass(frozen=True)
class YearFacts:
    year: int
    net_income: Decimal | None = None
    dna: Decimal | None = None
    capex: Decimal | None = None  # positive = cash spent
    cfo: Decimal | None = None
    cff: Decimal | None = None
    buybacks: Decimal | None = None  # positive = cash spent
    acquisitions: Decimal | None = None  # positive = cash spent
    revenue: Decimal | None = None
    rnd: Decimal | None = None

    @property
    def owner_earnings(self) -> Decimal | None:
        """Net income + D&A - capex. Non-recurring/pension adjustments are not applied (ADR 0012)."""
        if self.net_income is None or self.dna is None or self.capex is None:
            return None
        return self.net_income + self.dna - self.capex


@dataclass(frozen=True)
class CoreData:
    """Everything the scorecard and the peer comparison need for one symbol."""

    symbol: str
    name: str | None = None
    sector: str | None = None
    industry: str | None = None
    quote_type: str | None = None
    institutional_pct: Decimal | None = None  # 0..100
    pe: Decimal | None = None
    pb: Decimal | None = None
    market_cap: Decimal | None = None  # USD
    current_ratio: Decimal | None = None
    ltd_to_capital: Decimal | None = None  # 0..100
    eps: tuple[tuple[int, Decimal], ...] = ()  # (fiscal year, EPS), newest first
    eps_as_reported: bool = False  # from the 10-Ks, not split-adjusted (no Finnhub EPS series)
    years: tuple[YearFacts, ...] = ()  # newest first
    warnings: tuple[str, ...] = ()

    @property
    def is_fund(self) -> bool:
        if self.quote_type in FUND_TYPES:
            return True
        return not self.eps and not self.years and self.pe is None

    def to_json(self) -> dict:
        d = asdict(self)
        return _jsonable(d)

    @classmethod
    def from_json(cls, d: dict) -> "CoreData":
        dec = _dec_or_none
        return cls(
            symbol=d["symbol"],
            name=d.get("name"),
            sector=d.get("sector"),
            industry=d.get("industry"),
            quote_type=d.get("quote_type"),
            institutional_pct=dec(d.get("institutional_pct")),
            pe=dec(d.get("pe")),
            pb=dec(d.get("pb")),
            market_cap=dec(d.get("market_cap")),
            current_ratio=dec(d.get("current_ratio")),
            ltd_to_capital=dec(d.get("ltd_to_capital")),
            eps=tuple((int(y), Decimal(v)) for y, v in d.get("eps", [])),
            eps_as_reported=bool(d.get("eps_as_reported", False)),
            years=tuple(
                YearFacts(**{k: (v if k == "year" else dec(v)) for k, v in y.items()})
                for y in d.get("years", [])
            ),
            warnings=tuple(d.get("warnings", [])),
        )


def _jsonable(x):
    if isinstance(x, Decimal):
        return str(x)
    if isinstance(x, dict):
        return {k: _jsonable(v) for k, v in x.items()}
    if isinstance(x, list | tuple):
        return [_jsonable(v) for v in x]
    return x


def _dec_or_none(v) -> Decimal | None:
    return None if v is None else Decimal(v)


def fiscal_year(period_end: date) -> int:
    return (period_end - timedelta(days=7)).year


def _first(values: dict[str, Decimal], names: Iterable[str]) -> Decimal | None:
    for n in names:
        if n in values:
            return values[n]
    return None


def _latest(fin: BasicFinancials | None, series: str) -> Decimal | None:
    if fin is None:
        return None
    points = fin.annual.get(series)
    return points[0].value if points else None


def _metric(fin: BasicFinancials | None, *names: str) -> Decimal | None:
    if fin is None:
        return None
    return _first(fin.metric, names)


def year_facts(report: AnnualReport) -> YearFacts:
    v = report.values
    facts = {key: _first(v, names) for key, names in CONCEPTS.items()}
    if facts["dna"] is None and "Depreciation" in v:  # some filers split D and A
        facts["dna"] = v["Depreciation"] + v.get("AmortizationOfIntangibleAssets", Decimal(0))
    for spent in ("capex", "buybacks", "acquisitions"):  # payments are reported positive; be sure
        if facts[spent] is not None:
            facts[spent] = abs(facts[spent])
    return YearFacts(year=report.year, **facts)


def core_from(
    symbol: str,
    fin: BasicFinancials | None,
    reports: Sequence[AnnualReport],
    ownership: Ownership | None,
    warnings: Sequence[str] = (),
) -> CoreData:
    eps_points = fin.annual.get("eps", []) if fin else []
    # One EPS per fiscal year, newest first. Periods are fiscal year ends; 52/53-week years can end
    # in the first days of January (JNJ: 2023-01-01 is fiscal 2022), hence the week's shift.
    eps: dict[int, Decimal] = {}
    for p in eps_points:
        eps.setdefault(fiscal_year(p.period), p.value)
    eps_as_reported = False
    if not eps:  # Finnhub has no EPS series for some companies (JPM); the 10-Ks still carry it
        for r in reports:
            v = _first(r.values, EPS_CONCEPTS)
            if v is not None:
                eps.setdefault(r.year, v)
        eps_as_reported = bool(eps)
    ltd = _latest(fin, "longtermDebtTotalCapital")
    cap_millions = _metric(fin, "marketCapitalization")
    return CoreData(
        symbol=symbol,
        name=ownership.name if ownership else None,
        sector=ownership.sector if ownership else None,
        industry=ownership.industry if ownership else None,
        quote_type=ownership.quote_type if ownership else None,
        institutional_pct=(
            _q(ownership.institutional_pct * HUNDRED)
            if ownership and ownership.institutional_pct is not None
            else None
        ),
        pe=_metric(fin, "peTTM", "peExclExtraTTM", "peBasicExclExtraTTM"),
        pb=_metric(fin, "pb", "pbQuarterly", "pbAnnual"),
        market_cap=None if cap_millions is None else cap_millions * Decimal(1_000_000),
        current_ratio=_metric(fin, "currentRatioQuarterly", "currentRatioAnnual"),
        ltd_to_capital=None if ltd is None else _q(ltd * HUNDRED),
        eps=tuple(sorted(eps.items(), reverse=True)),
        eps_as_reported=eps_as_reported,
        years=tuple(year_facts(r) for r in sorted(reports, key=lambda r: r.year, reverse=True)),
        warnings=tuple(warnings),
    )


# --- scoring ---

PASS, FAIL, WARN, INFO, NA = "pass", "fail", "warn", "info", "na"


@dataclass(frozen=True)
class Result:
    key: str
    value: Decimal | None
    status: str
    note: str = ""
    years: int | None = None  # how many years of data the value is based on


def _q(x: Decimal, places: str = "0.01") -> Decimal:
    return x.quantize(Decimal(places), rounding=ROUND_HALF_UP)


def _below(key: str, value: Decimal | None, limit: Decimal, missing: str) -> Result:
    if value is None:
        return Result(key, None, NA, missing)
    return Result(key, _q(value), PASS if value < limit else FAIL)


def _above(key: str, value: Decimal | None, limit: Decimal, missing: str) -> Result:
    if value is None:
        return Result(key, None, NA, missing)
    return Result(key, _q(value), PASS if value > limit else FAIL)


def _avg(xs: Sequence[Decimal]) -> Decimal:
    return sum(xs, Decimal(0)) / len(xs)


def pe_result(c: CoreData) -> Result:
    if c.pe is not None and c.pe > 0:
        return Result("pe", _q(c.pe), PASS if c.pe < P.PE_MAX else FAIL)
    if (c.pe is not None and c.pe <= 0) or (c.eps and c.eps[0][1] <= 0):
        return Result("pe", None, FAIL, "No earnings over the last 12 months / latest year.")
    return Result("pe", None, NA, "No P/E reported.")


def pb_result(c: CoreData) -> Result:
    if c.pb is not None and c.pb <= 0:
        return Result("pb", _q(c.pb), FAIL, "Negative book value.")
    return _below("pb", c.pb, P.PB_MAX, "No price/book reported.")


def eps_growth_result(c: CoreData) -> Result:
    """Graham: average EPS of the last 3 years vs the 3 years a decade earlier."""
    key = "eps_growth_10y"
    if len(c.eps) < 6:
        return Result(key, None, NA, "Fewer than 6 years of EPS.", len(c.eps))
    latest_year = c.eps[0][0]
    window = [(y, v) for y, v in c.eps if y >= latest_year - 11]  # the last 12 fiscal years
    if len(window) < 6:
        return Result(key, None, NA, "Fewer than 6 of the last 12 years have EPS.", len(window))
    recent, old = [v for _, v in window[:3]], window[-3:]
    span = latest_year - old[-1][0] + 1
    note = "" if span >= 10 else f"Only {span} years of EPS."
    if c.eps_as_reported:
        note = f"{note} EPS as reported in the 10-Ks, not adjusted for stock splits.".strip()
    base = _avg([v for _, v in old])
    if base <= 0:
        return Result(
            key, None, FAIL, f"{note} Earnings were not positive at the start.".strip(), span
        )
    growth = (_avg(recent) / base - 1) * HUNDRED
    return Result(key, _q(growth), PASS if growth >= P.EPS_GROWTH_MIN else FAIL, note, span)


def owner_earnings_result(c: CoreData) -> Result:
    """CAGR of owner earnings between 3-year averages at both ends of up to 11 fiscal years."""
    key = "owner_earnings_cagr"
    oe = [(y.year, y.owner_earnings) for y in c.years if y.owner_earnings is not None]
    oe = [(y, v) for y, v in oe if y > (oe[0][0] - 11 if oe else 0)]
    if len(oe) < 6:
        return Result(key, None, NA, "Not enough years of net income, D&A and capex.", len(oe))
    start, end = _avg([v for _, v in oe[-3:]]), _avg([v for _, v in oe[:3]])
    periods = oe[1][0] - oe[-2][0]  # between the middle years of the two windows
    span = oe[0][0] - oe[-1][0] + 1
    note = "Approximation: net income + D&A - capex."
    if start <= 0 or end <= 0:
        return Result(key, None, FAIL, note + " Owner earnings were not positive.", span)
    cagr = (float(end / start) ** (1 / periods) - 1) * 100
    value = _q(Decimal(str(cagr)))
    return Result(key, value, PASS if value >= P.OWNER_EARNINGS_CAGR_MIN else FAIL, note, span)


def is_financial(c: CoreData) -> bool:
    """Banks and insurers: deposits and float make their cash-flow statements unlike other firms'."""
    industry = (c.industry or "").lower()
    return industry.startswith("banks") or "insurance" in industry


_FINANCIAL_NOTE = "Not meaningful for banks and insurers."


def opm_result(c: CoreData) -> Result:
    key = "opm"
    flows = [y for y in c.years[:10] if y.cfo is not None and y.cff is not None]
    if not flows:
        return Result(key, None, NA, "No cash-flow statement.")
    latest = flows[0]
    bad = sum(1 for y in flows if y.cff > y.cfo)
    ratio = None if latest.cfo == 0 else _q(latest.cff / abs(latest.cfo))
    note = f"Financing above operating cash in {bad} of the last {len(flows)} years."
    if is_financial(c):
        return Result(key, ratio, NA, f"{_FINANCIAL_NOTE} {note}", len(flows))
    if latest.cff > latest.cfo:
        return Result(key, ratio, FAIL, note, len(flows))
    return Result(key, ratio, WARN if bad >= 3 else PASS, note, len(flows))


def rd_result(c: CoreData) -> Result:
    key = "rd_pct_sales"
    for y in c.years[:1]:
        if y.revenue and y.revenue > 0:
            if y.rnd is None:
                return Result(key, None, INFO, "No R&D line in the latest 10-K.", 1)
            return Result(key, _q(y.rnd / y.revenue * HUNDRED), INFO, f"Fiscal {y.year}.", 1)
    return Result(key, None, NA, "No revenue reported.")


def acquisitions_result(c: CoreData) -> Result:
    key = "acquisitions"
    recent = c.years[:5]
    cfo = sum((y.cfo for y in recent if y.cfo is not None), Decimal(0))
    spent = sum((y.acquisitions for y in recent if y.acquisitions is not None), Decimal(0))
    if not recent or cfo <= 0:
        return Result(key, None, NA, "No positive operating cash flow to compare with.")
    share = _q(spent / cfo * HUNDRED)
    if is_financial(c):
        return Result(key, share, NA, _FINANCIAL_NOTE, len(recent))
    return Result(
        key,
        share,
        WARN if share > P.ACQUISITIONS_MAX else PASS,
        f"Acquisitions over the last {len(recent)} fiscal years.",
        len(recent),
    )


@dataclass(frozen=True)
class BuybackYear:
    year: int
    amount: Decimal
    avg_price: Decimal | None
    high_5y: Decimal | None
    near_high: bool


def buyback_years(c: CoreData, bars: Sequence[Bar]) -> list[BuybackYear]:
    """Buybacks of the last 5 fiscal years against that calendar year's average weekly close
    and the highest weekly close of the 5 calendar years up to it."""
    out: list[BuybackYear] = []
    for y in c.years[:5]:
        if not y.buybacks:
            continue
        in_year = [b.close for b in bars if b.session_date.year == y.year]
        window = [b.close for b in bars if y.year - 4 <= b.session_date.year <= y.year]
        avg = _q(_avg(in_year)) if in_year else None
        high = max(window) if window else None
        near = avg is not None and high is not None and avg >= high * P.NEAR_HIGH
        out.append(BuybackYear(y.year, y.buybacks, avg, high, near))
    return out


def buybacks_result(c: CoreData, bars: Sequence[Bar] | None) -> Result:
    key = "buybacks_at_highs"
    if not c.years:
        return Result(key, None, NA, "No cash-flow statement.")
    if bars is None:
        return Result(key, None, NA, "Price history unavailable.")
    rows = buyback_years(c, bars)
    total = sum((r.amount for r in rows), Decimal(0))
    if total == 0:
        return Result(key, Decimal(0), PASS, "No buybacks in the last 5 fiscal years.")
    priced = [r for r in rows if r.avg_price is not None]
    if not priced:
        return Result(key, None, NA, "No price history for the buyback years.")
    share = _q(sum((r.amount for r in rows if r.near_high), Decimal(0)) / total * HUNDRED)
    return Result(
        key,
        share,
        WARN if share > P.BUYBACK_AT_HIGHS_MAX else PASS,
        "Share of 5-year buyback dollars spent when the year's average price was within 10% of "
        "the 5-year high.",
        len(rows),
    )


def score(c: CoreData, bars: Sequence[Bar] | None = None) -> list[Result]:
    """One result per computed principle, in registry order. `bars` (weekly closes, oldest first)
    feed the buyback timing; without them that principle is n/a (peers are scored without)."""
    by_key = {
        "institutional_pct": _below(
            "institutional_pct", c.institutional_pct, P.INSTITUTIONAL_MAX, "No ownership data."
        ),
        "pb": pb_result(c),
        "pe": pe_result(c),
        "eps_growth_10y": eps_growth_result(c),
        "current_ratio": _above(
            "current_ratio",
            c.current_ratio,
            P.CURRENT_RATIO_MIN,
            "Not reported (usual for banks and insurers).",
        ),
        "market_cap": (
            Result("market_cap", None, NA, "No market value reported.")
            if c.market_cap is None
            else Result(
                "market_cap",
                _q(c.market_cap, "1"),
                PASS if c.market_cap > P.MARKET_CAP_MIN else FAIL,
            )
        ),
        "ltd_to_capital": _below(
            "ltd_to_capital", c.ltd_to_capital, P.LTD_TO_CAPITAL_MAX, "No debt data."
        ),
        "owner_earnings_cagr": owner_earnings_result(c),
        "opm": opm_result(c),
        "rd_pct_sales": rd_result(c),
        "buybacks_at_highs": buybacks_result(c, bars),
        "acquisitions": acquisitions_result(c),
    }
    return [by_key[p.key] for p in P.PRINCIPLES if p.kind is P.Kind.COMPUTED]


# --- peers ---


@dataclass(frozen=True)
class PeerStat:
    key: str
    mean: Decimal | None
    median: Decimal | None
    n: int
    symbols: list[str] = field(default_factory=list)  # the peers that had a value


def peer_stats(scored: dict[str, list[Result]]) -> list[PeerStat]:
    """Mean and median per computed principle over the peers that have a value."""
    out: list[PeerStat] = []
    for p in P.PRINCIPLES:
        if p.kind is not P.Kind.COMPUTED:
            continue
        vals = [
            (sym, r.value)
            for sym, results in scored.items()
            for r in results
            if r.key == p.key and r.value is not None
        ]
        if not vals:
            out.append(PeerStat(p.key, None, None, 0))
            continue
        nums = [v for _, v in vals]
        out.append(
            PeerStat(
                p.key,
                _q(_avg(nums)),
                _q(Decimal(statistics.median(nums))),
                len(nums),
                [s for s, _ in vals],
            )
        )
    return out


# --- evidence ---

OPEN_MARKET = {"P", "S"}  # Form 4 codes for open-market purchases and sales


def recent_open_market(trades: Sequence[InsiderTrade], today: date) -> list[InsiderTrade]:
    since = today - timedelta(days=365)
    return [t for t in trades if t.code in OPEN_MARKET and t.transaction_date >= since]


def net_insider_value(trades: Sequence[InsiderTrade]) -> Decimal:
    return _q(sum((t.shares_change * t.price for t in trades if t.price), Decimal(0)))


INSIDER_TOP = 10


@dataclass(frozen=True)
class InsiderSide:
    """One insider's open-market sales (or buys): what they moved, for how much, and when."""

    name: str
    trades: int
    shares: int  # unsigned, including unpriced trades
    value: Decimal  # USD over priced trades only; sale proceeds, not profit (Form 4 has no basis)
    avg_price: Decimal | None  # value / priced shares
    first_date: date
    last_date: date
    unpriced: int  # trades without a price, left out of value and avg_price


def _side(name: str, trades: list[InsiderTrade]) -> InsiderSide:
    priced = [t for t in trades if t.price]
    priced_shares = sum(abs(t.shares_change) for t in priced)
    value = sum((abs(t.shares_change) * t.price for t in priced), Decimal(0))
    dates = [t.transaction_date for t in trades]
    return InsiderSide(
        name=name,
        trades=len(trades),
        shares=sum(abs(t.shares_change) for t in trades),
        value=_q(value),
        avg_price=_q(value / priced_shares) if priced_shares else None,
        first_date=min(dates),
        last_date=max(dates),
        unpriced=len(trades) - len(priced),
    )


def insider_summary(
    trades: Sequence[InsiderTrade], top: int = INSIDER_TOP
) -> tuple[list[InsiderSide], list[InsiderSide]]:
    """Top sellers and top buyers by dollar value, from already-filtered open-market trades."""

    def rank(code: str) -> list[InsiderSide]:
        by_name: dict[str, list[InsiderTrade]] = {}
        for t in trades:
            if t.code == code:
                by_name.setdefault(t.name, []).append(t)
        sides = [_side(n, ts) for n, ts in by_name.items()]
        sides.sort(key=lambda s: (-s.value, s.name))
        return sides[:top]

    return rank("S"), rank("P")
