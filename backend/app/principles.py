"""The investing principles a ticker is scored against (ADR 0012).

Computed principles get a value and a pass/fail/warn status from `fundamentals.py`; manual ones only carry
the user's own verdict. Any principle can be given a verdict, which then overrides the computed status.
Thresholds live here so the scorecard, the peer comparison and the UI all agree.
"""

from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum


class Kind(StrEnum):
    COMPUTED = "computed"
    MANUAL = "manual"


class Unit(StrEnum):
    PCT = "pct"  # already multiplied by 100
    RATIO = "ratio"  # e.g. P/E 14.2
    USD = "usd"


class Better(StrEnum):
    LOWER = "lower"
    HIGHER = "higher"


@dataclass(frozen=True)
class Principle:
    key: str
    label: str
    description: str  # the user's own wording of the principle
    kind: Kind
    rule: str  # short human-readable threshold, empty for manual / informational ones
    unit: Unit | None = None
    better: Better | None = None  # which direction beats the peers; None = no ranking
    threshold: Decimal | None = None


INSTITUTIONAL_MAX = Decimal(60)
PB_MAX = Decimal("1.5")
PE_MAX = Decimal(15)
EPS_GROWTH_MIN = Decimal(33)
CURRENT_RATIO_MIN = Decimal(2)
MARKET_CAP_MIN = Decimal(2_000_000_000)
LTD_TO_CAPITAL_MAX = Decimal(50)
OWNER_EARNINGS_CAGR_MIN = Decimal(6)
BUYBACK_AT_HIGHS_MAX = Decimal(50)  # % of buyback dollars spent near the 5-year high
NEAR_HIGH = Decimal("0.9")  # "near the high" = average price within 10% of it
ACQUISITIONS_MAX = Decimal(50)  # % of operating cash flow spent on acquisitions over 5 years

PRINCIPLES: tuple[Principle, ...] = (
    Principle(
        "institutional_pct",
        "Institutional holding",
        "Institutional holding < 60% (less popular, so price might not be right)",
        Kind.COMPUTED,
        "< 60%",
        Unit.PCT,
        Better.LOWER,
        INSTITUTIONAL_MAX,
    ),
    Principle(
        "pb",
        "Price / book",
        "Price/Book ratio < 1.5",
        Kind.COMPUTED,
        "< 1.5",
        Unit.RATIO,
        Better.LOWER,
        PB_MAX,
    ),
    Principle(
        "pe",
        "Price / earnings",
        "Price/Earnings < 15",
        Kind.COMPUTED,
        "< 15",
        Unit.RATIO,
        Better.LOWER,
        PE_MAX,
    ),
    Principle(
        "eps_growth_10y",
        "EPS growth, 10 years",
        "Cumulative earnings growth of 33% over a decade (~3% avg)",
        Kind.COMPUTED,
        ">= 33% (3-year averages)",
        Unit.PCT,
        Better.HIGHER,
        EPS_GROWTH_MIN,
    ),
    Principle(
        "current_ratio",
        "Current ratio",
        "Current ratio (current assets / current liabilities) > 2",
        Kind.COMPUTED,
        "> 2",
        Unit.RATIO,
        Better.HIGHER,
        CURRENT_RATIO_MIN,
    ),
    Principle(
        "market_cap",
        "Market value",
        "Market value > $2 billion",
        Kind.COMPUTED,
        "> $2B",
        Unit.USD,
        None,
        MARKET_CAP_MIN,
    ),
    Principle(
        "ltd_to_capital",
        "Long-term debt / capital",
        "Long-term debt < 50% of total capital",
        Kind.COMPUTED,
        "< 50%",
        Unit.PCT,
        Better.LOWER,
        LTD_TO_CAPITAL_MAX,
    ),
    Principle(
        "owner_earnings_cagr",
        "Owner earnings growth",
        "Marathon runner, not a sprinter: 6-7% YoY growth in Owner Earnings over a decade "
        "(net income + depreciation + amortization - capex - non-recurring items)",
        Kind.COMPUTED,
        ">= 6% a year",
        Unit.PCT,
        Better.HIGHER,
        OWNER_EARNINGS_CAGR_MIN,
    ),
    Principle(
        "opm",
        "Financing vs operating cash",
        "Not an OPM (other people's money) addict: financing cash flow shouldn't exceed "
        "operating cash flow",
        Kind.COMPUTED,
        "financing <= operating",
        Unit.RATIO,
        Better.LOWER,
    ),
    Principle(
        "rd_pct_sales",
        "R&D / sales",
        "Look at R&D spend (e.g., JNJ spends ~10% of net sales on research)",
        Kind.COMPUTED,
        "",
        Unit.PCT,
        None,
    ),
    Principle(
        "buybacks_at_highs",
        "Buybacks near highs",
        "No share buybacks at record highs (good if they buy back when cheap)",
        Kind.COMPUTED,
        "<= 50% of buybacks near the 5-year high",
        Unit.PCT,
        Better.LOWER,
        BUYBACK_AT_HIGHS_MAX,
    ),
    Principle(
        "acquisitions",
        "Acquisition spend",
        "Not a serial acquirer: can't grow without buying = bad business",
        Kind.COMPUTED,
        "<= 50% of operating cash, 5 years",
        Unit.PCT,
        Better.LOWER,
        ACQUISITIONS_MAX,
    ),
    Principle(
        "temporary_bad_news",
        "Temporary bad news",
        "Buy when there is temporary bad news or recoverable bankruptcy about the company",
        Kind.MANUAL,
        "",
    ),
    Principle(
        "split_hype",
        "Stock-split hype",
        "If a company hypes a stock split, run the other way",
        Kind.MANUAL,
        "",
    ),
    Principle(
        "ceo_hype",
        "Management",
        "CEOs shouldn't be lining their pockets or creating hype",
        Kind.MANUAL,
        "",
    ),
    Principle(
        "insider_trades",
        "Insider trades (Form 4)",
        "Check Form 4 for insider trades of senior executives",
        Kind.MANUAL,
        "",
    ),
    Principle(
        "wide_moat",
        "Wide moat",
        "Wide moat / competitive advantage",
        Kind.MANUAL,
        "",
    ),
    Principle(
        "single_customer",
        "Customer concentration",
        "Avoid companies reliant on one customer",
        Kind.MANUAL,
        "",
    ),
    Principle(
        "serial_acquirer",
        "Serial acquirer (10-K)",
        "Check the 10-K for recent acquisitions",
        Kind.MANUAL,
        "",
    ),
)

BY_KEY = {p.key: p for p in PRINCIPLES}
