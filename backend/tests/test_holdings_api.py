from datetime import UTC, datetime, timedelta
from decimal import Decimal as D
from pathlib import Path

from sqlalchemy import update

from app.db import get_db
from app.main import app
from app.models import QuoteCache
from app.providers import ProviderError, Quote, get_quote_provider

SAMPLE = Path(__file__).resolve().parents[2] / "seed" / "sample"
RH = (SAMPLE / "robinhood_positions.csv").read_bytes()  # ORCL 40, INTC 100, DIS 25
M1 = (SAMPLE / "m1_positions.csv").read_bytes()  # VTI 30, SCHD 80, ORCL 10


class FakeProvider:
    def __init__(self, prices=None, error=None):
        self.prices, self.error, self.calls = prices or {}, error, []

    def get_quotes(self, symbols):
        self.calls.append(sorted(symbols))
        if self.error:
            raise self.error
        return {
            s: Quote(s, D(p), D(prev), None) for s, (p, prev) in self.prices.items() if s in symbols
        }


def use(provider):
    app.dependency_overrides[get_quote_provider] = lambda: provider
    return provider


def make(client, platform, nickname, csv):
    a = client.post("/api/accounts", json={"platform": platform, "nickname": nickname}).json()["id"]
    r = client.post(
        f"/api/accounts/{a}/imports",
        data={"connector": "snapshot"},
        files={"file": ("x.csv", csv, "text/csv")},
    )
    assert r.status_code == 201, r.text
    return a


def two_accounts(client):
    return make(client, "robinhood", "RH", RH), make(client, "m1", "M1", M1)


def by_symbol(body):
    return {h["symbol"]: h for h in body["holdings"]}


PRICES = {
    "ORCL": ("170.55", "169.00"),
    "INTC": ("26", "25"),
    "DIS": ("110", "110"),
    "VTI": ("280", "279"),
    "SCHD": ("81", "80"),
}


def test_all_accounts_by_default_merges_shared_symbols(alice):
    rh, m1 = two_accounts(alice)
    use(FakeProvider(PRICES))
    body = alice.get("/api/holdings").json()
    assert body["account_ids"] == [rh, m1]
    assert sorted(by_symbol(body)) == ["DIS", "INTC", "ORCL", "SCHD", "VTI"]
    orcl = by_symbol(body)["ORCL"]
    assert orcl["quantity"] == "50" and orcl["value"] == "8527.50" and orcl["source"] == "live"
    assert [(ln["account_nickname"], ln["quantity"]) for ln in orcl["lines"]] == [
        ("M1", "10"),
        ("RH", "40"),
    ]
    # 8527.50 ORCL + 2600 INTC + 2750 DIS + 8400 VTI + 6480 SCHD
    assert body["summary"]["total_value"] == "28757.50"
    assert body["warnings"] == [] and body["prices_as_of"] is not None


def test_checkbox_subset_changes_the_totals(alice):
    rh, m1 = two_accounts(alice)
    use(FakeProvider(PRICES))
    only_rh = alice.get(f"/api/holdings?account_ids={rh}").json()
    assert sorted(by_symbol(only_rh)) == ["DIS", "INTC", "ORCL"]
    assert by_symbol(only_rh)["ORCL"]["quantity"] == "40"
    assert only_rh["summary"]["total_value"] == "12172.00"  # 6822 + 2600 + 2750
    both = alice.get(f"/api/holdings?account_ids={rh},{m1}").json()
    assert both["summary"]["total_value"] == "28757.50"


def test_empty_account_ids_means_none_selected_not_all(alice):
    two_accounts(alice)
    prov = use(FakeProvider(PRICES))
    body = alice.get("/api/holdings?account_ids=").json()
    assert (
        body["holdings"] == []
        and body["account_ids"] == []
        and body["summary"]["total_value"] == "0"
    )
    assert prov.calls == []  # nothing selected -> no provider call


def test_only_requested_symbols_are_fetched(alice):
    rh, _ = two_accounts(alice)
    prov = use(FakeProvider(PRICES))
    alice.get(f"/api/holdings?account_ids={rh}")
    assert prov.calls == [["DIS", "INTC", "ORCL"]]


def test_unknown_or_foreign_account_is_404(admin, alice):
    theirs = make(admin, "robinhood", "Admin acct", RH)
    use(FakeProvider(PRICES))
    assert alice.get(f"/api/holdings?account_ids={theirs}").status_code == 404
    assert alice.get("/api/holdings?account_ids=99999").status_code == 404
    mine = make(alice, "m1", "Mine", M1)
    assert alice.get(f"/api/holdings?account_ids={mine},{theirs}").status_code == 404


def test_other_users_data_never_leaks_into_all(admin, alice):
    make(admin, "robinhood", "Admin acct", RH)
    use(FakeProvider(PRICES))
    body = alice.get("/api/holdings").json()
    assert body["holdings"] == [] and body["account_ids"] == []


def test_malformed_account_ids_is_422(alice):
    assert alice.get("/api/holdings?account_ids=1,abc").status_code == 422
    assert alice.get("/api/holdings?account_ids=1;2").status_code == 422


def test_duplicate_ids_are_not_double_counted(alice):
    rh, _ = two_accounts(alice)
    use(FakeProvider(PRICES))
    body = alice.get(f"/api/holdings?account_ids={rh},{rh}").json()
    assert body["account_ids"] == [rh] and by_symbol(body)["ORCL"]["quantity"] == "40"


def test_no_api_key_falls_back_to_imported_values_with_a_warning(alice):
    two_accounts(alice)  # conftest default: provider is None
    body = alice.get("/api/holdings").json()
    assert any("FINNHUB_API_KEY is not set" in w for w in body["warnings"])
    orcl = by_symbol(body)["ORCL"]
    assert orcl["source"] == "file" and orcl["value"] == "8500.00"  # 6800 + 1700 from the files
    assert body["summary"]["file_count"] == 5 and body["summary"]["day_change"] is None
    assert body["prices_as_of"] is None


def test_provider_outage_falls_back_to_file_values_and_warns(alice):
    two_accounts(alice)
    use(FakeProvider(error=ProviderError("Finnhub rate limit reached")))
    body = alice.get("/api/holdings").json()
    assert any("rate limit" in w for w in body["warnings"])
    assert by_symbol(body)["ORCL"]["source"] == "file"


def test_outage_after_a_good_fetch_serves_stale_prices(alice):
    two_accounts(alice)
    use(FakeProvider(PRICES))
    assert by_symbol(alice.get("/api/holdings").json())["ORCL"]["source"] == "live"
    db = next(app.dependency_overrides[get_db]())
    db.execute(update(QuoteCache).values(fetched_at=datetime.now(UTC) - timedelta(hours=2)))
    db.commit()
    use(FakeProvider(error=ProviderError("down")))
    body = alice.get("/api/holdings").json()
    orcl = by_symbol(body)["ORCL"]
    assert orcl["source"] == "stale" and orcl["value"] == "8527.50" and orcl["day_change"] is None
    assert body["summary"]["stale_count"] == 5


def test_second_request_inside_the_ttl_uses_the_cache(alice):
    two_accounts(alice)
    prov = use(FakeProvider(PRICES))
    alice.get("/api/holdings")
    alice.get("/api/holdings")
    assert len(prov.calls) == 1


def test_symbol_the_provider_does_not_know_uses_the_file_value(alice):
    two_accounts(alice)
    partial = dict(PRICES)
    del partial["INTC"]
    use(FakeProvider(partial))
    body = alice.get("/api/holdings").json()
    intc = by_symbol(body)["INTC"]
    assert intc["source"] == "file" and intc["value"] == "2500.00"
    assert by_symbol(body)["ORCL"]["source"] == "live"


def test_day_change_and_weights(alice):
    two_accounts(alice)
    use(FakeProvider(PRICES))
    body = alice.get("/api/holdings").json()
    # ORCL +77.50, INTC +100, DIS 0, VTI +30, SCHD +80
    assert body["summary"]["day_change"] == "287.50"
    weights = [D(h["weight_pct"]) for h in body["holdings"]]
    assert abs(sum(weights) - 100) < D("0.01")
    assert body["holdings"][0]["symbol"] == "ORCL"  # largest first


def test_response_numbers_are_exact_strings(alice):
    two_accounts(alice)
    use(FakeProvider(PRICES))
    h = by_symbol(alice.get("/api/holdings").json())["ORCL"]
    assert all(
        isinstance(h[k], str)
        for k in ("quantity", "cost_basis", "price", "value", "gain", "gain_pct")
    )


def test_requires_login(client):
    assert client.get("/api/holdings").status_code == 401
