import hashlib
from decimal import Decimal
from pathlib import Path

from sqlalchemy import func, select

from app.db import get_db
from app.main import app
from app.models import Import, Position

SAMPLE = Path(__file__).resolve().parents[2] / "seed" / "sample"
RH = (SAMPLE / "robinhood_positions.csv").read_bytes()
M1 = (SAMPLE / "m1_positions.csv").read_bytes()
M1_LOTS = (SAMPLE / "m1_open_tax_lots.csv").read_bytes()
M1_HOLDINGS = (SAMPLE / "m1_holdings.csv").read_bytes()
RH_ACTIVITY = (SAMPLE / "robinhood_activity.csv").read_bytes()


def upload(client, path, content: bytes, connector="snapshot", name="positions.csv"):
    return client.post(
        path, data={"connector": connector}, files={"file": (name, content, "text/csv")}
    )


def acct(client, platform="robinhood", nickname="Main") -> int:
    return client.post("/api/accounts", json={"platform": platform, "nickname": nickname}).json()[
        "id"
    ]


def db_count(model) -> int:
    db = next(app.dependency_overrides[get_db]())
    return db.scalar(select(func.count()).select_from(model))


def test_connectors_for_account(alice):
    a = acct(alice, platform="schwab")  # no platform-specific connector
    assert alice.get(f"/api/accounts/{a}/connectors").json() == [
        {
            "slug": "snapshot",
            "label": "Positions snapshot (CSV)",
            "description": "symbol, quantity, cost_basis; optional name, market_value, price_used, as_of",
        }
    ]


def test_robinhood_account_offers_the_activity_report_first(alice):
    a = acct(alice)
    slugs = [c["slug"] for c in alice.get(f"/api/accounts/{a}/connectors").json()]
    assert slugs == ["robinhood-activity", "robinhood-positions", "snapshot"]


def test_robinhood_tax_csv_preview_explains_itself(alice):
    a = acct(alice)
    body = b"1099-B,ACCOUNT NUMBER,TAX YEAR,DATE ACQUIRED\n1099-B,0,2025,01/02/2025\n"
    r = alice.post(
        f"/api/accounts/{a}/imports/preview",
        data={"connector": "robinhood-positions"},
        files={"file": ("tax.csv", body, "text/csv")},
    )
    assert r.status_code == 200
    assert "1099 tax CSV" in r.json()["errors"][0]["message"]


def test_m1_account_offers_m1_formats_first(alice):
    a = acct(alice, platform="m1")
    slugs = [c["slug"] for c in alice.get(f"/api/accounts/{a}/connectors").json()]
    assert slugs == ["m1-holdings", "m1-tax-lots", "snapshot"]


def test_m1_holdings_preview_and_commit(alice):
    a = acct(alice, platform="m1")
    body = upload(alice, f"/api/accounts/{a}/imports/preview", M1_HOLDINGS, "m1-holdings").json()
    assert body["errors"] == [] and len(body["rows"]) == 3
    assert body["total_cost_basis"] == "14400.00" and body["total_market_value"] == "16200.00"
    r = upload(alice, f"/api/accounts/{a}/imports", M1_HOLDINGS, "m1-holdings")
    assert r.status_code == 201 and r.json()["row_count"] == 3
    pos = {p["symbol"]: p for p in alice.get(f"/api/accounts/{a}/positions").json()}
    assert pos["VTI"]["name"] == "Vanguard Total Stock Market ETF"
    assert pos["SCHD"]["market_value"] == "6400.00"


def test_m1_holdings_not_offered_to_other_platforms(alice):
    a = acct(alice)
    r = upload(alice, f"/api/accounts/{a}/imports/preview", M1_HOLDINGS, "m1-holdings")
    assert r.status_code in (400, 422)


def test_m1_tax_lots_preview_and_commit(alice):
    a = acct(alice, platform="m1")
    body = upload(alice, f"/api/accounts/{a}/imports/preview", M1_LOTS, "m1-tax-lots").json()
    assert body["errors"] == [] and len(body["rows"]) == 3
    assert body["total_cost_basis"] == "14400.00" and body["total_market_value"] == "16200.00"
    r = upload(alice, f"/api/accounts/{a}/imports", M1_LOTS, "m1-tax-lots")
    assert r.status_code == 201 and r.json()["row_count"] == 3
    pos = {p["symbol"]: p for p in alice.get(f"/api/accounts/{a}/positions").json()}
    assert sorted(pos) == ["ORCL", "SCHD", "VTI"]
    assert Decimal(pos["SCHD"]["quantity"]) == 80 and pos["SCHD"]["market_value"] == "6400.00"


def test_m1_connector_not_offered_to_other_platforms(alice):
    a = acct(alice)  # robinhood
    r = upload(alice, f"/api/accounts/{a}/imports/preview", M1_LOTS, "m1-tax-lots")
    assert r.status_code == 400


def test_preview_writes_nothing_and_summarizes(alice):
    a = acct(alice)
    r = upload(alice, f"/api/accounts/{a}/imports/preview", RH)
    assert r.status_code == 200
    body = r.json()
    assert len(body["rows"]) == 3 and body["errors"] == [] and body["warnings"] == []
    assert body["total_cost_basis"] == "10700.00" and body["total_market_value"] == "12050.00"
    assert body["rows"][0]["quantity"] == "40"  # exact decimal strings, not floats
    assert db_count(Position) == 0 and db_count(Import) == 0
    assert alice.get(f"/api/accounts/{a}/positions").json() == []


def test_commit_creates_positions_and_account_summary(alice):
    a = acct(alice)
    r = upload(alice, f"/api/accounts/{a}/imports", RH, name="C:\\fakepath\\rh.csv")
    assert r.status_code == 201 and r.json()["row_count"] == 3 and r.json()["filename"] == "rh.csv"
    pos = alice.get(f"/api/accounts/{a}/positions").json()
    assert [p["symbol"] for p in pos] == ["DIS", "INTC", "ORCL"]
    listed = alice.get("/api/accounts").json()[0]
    assert listed["position_count"] == 3 and listed["last_import_at"] is not None


def test_reimport_replaces_and_discards_old_positions(alice):
    a = acct(alice)
    upload(alice, f"/api/accounts/{a}/imports", RH)
    r = upload(alice, f"/api/accounts/{a}/imports/preview", M1)
    assert "replace this account's 3 current position(s)" in r.json()["warnings"][0]
    upload(alice, f"/api/accounts/{a}/imports", M1)
    symbols = [p["symbol"] for p in alice.get(f"/api/accounts/{a}/positions").json()]
    assert symbols == ["ORCL", "SCHD", "VTI"]  # INTC and DIS are gone
    assert db_count(Position) == 3
    assert db_count(Import) == 2  # audit rows are kept


def test_identical_reimport_is_flagged(alice):
    a = acct(alice)
    upload(alice, f"/api/accounts/{a}/imports", RH, name="first.csv")
    w = upload(alice, f"/api/accounts/{a}/imports/preview", RH).json()["warnings"]
    assert any("identical to the last import (first.csv" in x for x in w)


def test_commit_refuses_a_file_with_errors_and_keeps_old_data(alice):
    a = acct(alice)
    upload(alice, f"/api/accounts/{a}/imports", RH)
    bad = b"symbol,quantity,cost_basis\nKO,1,1\nBAD,x,1\n"
    prev = upload(alice, f"/api/accounts/{a}/imports/preview", bad).json()
    assert prev["errors"] == [{"row": 3, "message": "quantity is not a number: 'x'"}]
    r = upload(alice, f"/api/accounts/{a}/imports", bad)
    assert r.status_code == 422 and "nothing was imported" in r.json()["detail"]
    assert [p["symbol"] for p in alice.get(f"/api/accounts/{a}/positions").json()] == [
        "DIS",
        "INTC",
        "ORCL",
    ]
    assert db_count(Import) == 1


def test_database_failure_mid_import_keeps_old_positions(alice, monkeypatch):
    a = acct(alice)
    upload(alice, f"/api/accounts/{a}/imports", RH)
    import app.api.imports as mod

    def boom(*_a, **_k):
        raise RuntimeError("disk full")

    monkeypatch.setattr(mod.Position, "__init__", boom)
    try:
        upload(alice, f"/api/accounts/{a}/imports", M1)
    except RuntimeError:
        pass
    monkeypatch.undo()
    assert [p["symbol"] for p in alice.get(f"/api/accounts/{a}/positions").json()] == [
        "DIS",
        "INTC",
        "ORCL",
    ]


def test_unknown_connector_rejected(alice):
    a = acct(alice)
    r = upload(alice, f"/api/accounts/{a}/imports/preview", RH, connector="nope")
    assert r.status_code == 400


def test_oversized_upload_rejected(alice):
    a = acct(alice)
    big = b"symbol,quantity,cost_basis\n" + b"A,1,1\n" * 400_000
    assert len(big) > 2 * 1024 * 1024
    assert upload(alice, f"/api/accounts/{a}/imports/preview", big).status_code == 413


def test_other_users_account_is_404_for_every_import_endpoint(admin, alice):
    mine = acct(admin, nickname="Admin acct")
    base = f"/api/accounts/{mine}"
    assert alice.get(f"{base}/connectors").status_code == 404
    assert alice.get(f"{base}/positions").status_code == 404
    assert upload(alice, f"{base}/imports/preview", RH).status_code == 404
    assert upload(alice, f"{base}/imports", RH).status_code == 404
    assert db_count(Position) == 0


def test_unauthenticated_is_401(client):
    assert client.get("/api/accounts/1/positions").status_code == 401
    assert upload(client, "/api/accounts/1/imports", RH).status_code == 401


def test_same_symbol_in_two_accounts_is_independent(alice):
    rh, m1 = acct(alice, "robinhood", "RH"), acct(alice, "m1", "M1")
    upload(alice, f"/api/accounts/{rh}/imports", RH)
    upload(alice, f"/api/accounts/{m1}/imports", M1)
    assert db_count(Position) == 6  # ORCL appears in both accounts
    upload(alice, f"/api/accounts/{rh}/imports", RH)
    assert len(alice.get(f"/api/accounts/{m1}/positions").json()) == 3


def test_deleting_an_account_deletes_its_positions_and_imports(alice):
    a = acct(alice)
    upload(alice, f"/api/accounts/{a}/imports", RH)
    assert alice.delete(f"/api/accounts/{a}").status_code == 204
    assert db_count(Position) == 0 and db_count(Import) == 0


def test_stored_hash_matches_file(alice):
    a = acct(alice)
    upload(alice, f"/api/accounts/{a}/imports", RH)
    db = next(app.dependency_overrides[get_db]())
    assert db.scalar(select(Import.file_sha256)) == hashlib.sha256(RH).hexdigest()


def activity(client, path, costs: str | None = None):
    data = {"connector": "robinhood-activity"}
    if costs is not None:
        data["average_costs"] = costs
    return client.post(path, data=data, files={"file": ("activity.csv", RH_ACTIVITY, "text/csv")})


def test_activity_report_asks_for_transferred_costs_then_imports(alice):
    a = acct(alice)
    upload(alice, f"/api/accounts/{a}/imports", RH)  # 3 positions to replace
    preview = f"/api/accounts/{a}/imports/preview"

    first = activity(alice, preview).json()
    assert first["needs_average_cost"] == ["DIS"]
    assert [r["symbol"] for r in first["rows"]] == ["INTC", "ORCL"]
    assert "DIS: shares were transferred in" in first["errors"][0]["message"]
    assert first["warnings"] == []  # a file with errors can't replace anything
    assert activity(alice, f"/api/accounts/{a}/imports").status_code == 422

    second = activity(alice, preview, '{"dis": "$96.00"}').json()
    assert second["errors"] == [] and second["total_cost_basis"] == "10620.00"
    assert "replace this account's 3 current position(s)" in second["warnings"][0]

    r = activity(alice, f"/api/accounts/{a}/imports", '{"DIS": 96}')
    assert r.status_code == 201 and r.json()["row_count"] == 3
    rows = {p["symbol"]: p for p in alice.get(f"/api/accounts/{a}/positions").json()}
    assert rows["DIS"]["cost_basis"] == "2400.00" and rows["ORCL"]["cost_basis"] == "5120.00"


def test_average_costs_must_be_valid(alice):
    a = acct(alice)
    preview = f"/api/accounts/{a}/imports/preview"
    for bad in ("not json", "[1]", '{"DIS": 0}', '{"DIS": "abc"}', '{"$$": 1}', '{"DIS": null}'):
        r = activity(alice, preview, bad)
        assert r.status_code == 422, bad
        assert "average_costs" in r.json()["detail"]
    assert activity(alice, preview, "").status_code == 200  # empty = none


def test_average_costs_refused_by_connectors_that_dont_take_them(alice):
    a = acct(alice)
    r = alice.post(
        f"/api/accounts/{a}/imports/preview",
        data={"connector": "snapshot", "average_costs": '{"KO": 1}'},
        files={"file": ("p.csv", RH, "text/csv")},
    )
    assert r.status_code == 400 and "does not take average costs" in r.json()["detail"]
