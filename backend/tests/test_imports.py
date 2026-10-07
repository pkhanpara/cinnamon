import hashlib
from pathlib import Path

from sqlalchemy import func, select

from app.db import get_db
from app.main import app
from app.models import Import, Position

SAMPLE = Path(__file__).resolve().parents[2] / "seed" / "sample"
RH = (SAMPLE / "robinhood_positions.csv").read_bytes()
M1 = (SAMPLE / "m1_positions.csv").read_bytes()


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
    a = acct(alice)
    assert alice.get(f"/api/accounts/{a}/connectors").json() == [
        {
            "slug": "snapshot",
            "label": "Positions snapshot (CSV)",
            "description": "symbol, quantity, cost_basis; optional name, market_value, price_used, as_of",
        }
    ]


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
