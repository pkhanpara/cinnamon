import pytest

from app.api import watchlists as wl_api


def make(client, name="Value ideas"):
    r = client.post("/api/watchlists", json={"name": name})
    assert r.status_code == 201, r.text
    return r.json()


def test_create_list_rename_delete(alice):
    created = make(alice)
    assert created["name"] == "Value ideas" and created["items"] == []
    assert [w["name"] for w in alice.get("/api/watchlists").json()] == ["Value ideas"]

    r = alice.patch(f"/api/watchlists/{created['id']}", json={"name": "  Deep value  "})
    assert r.status_code == 200 and r.json()["name"] == "Deep value"

    assert alice.delete(f"/api/watchlists/{created['id']}").status_code == 204
    assert alice.get("/api/watchlists").json() == []


def test_names_are_unique_per_user_and_not_blank(alice):
    make(alice, "A")
    assert alice.post("/api/watchlists", json={"name": "A"}).status_code == 409
    assert alice.post("/api/watchlists", json={"name": "   "}).status_code == 422
    b = make(alice, "B")
    assert alice.patch(f"/api/watchlists/{b['id']}", json={"name": "A"}).status_code == 409


def test_items_are_uppercased_idempotent_and_kept_in_order(alice):
    wl = make(alice)
    url = f"/api/watchlists/{wl['id']}/items"
    for s in ["jnj", "MSFT", "JNJ", "brk.b"]:
        assert alice.post(url, json={"symbol": s}).status_code == 201
    detail = alice.get(f"/api/watchlists/{wl['id']}").json()
    assert [i["symbol"] for i in detail["items"]] == ["JNJ", "MSFT", "BRK.B"]
    assert alice.get("/api/watchlists").json()[0]["symbols"] == ["JNJ", "MSFT", "BRK.B"]

    assert alice.delete(f"{url}/msft").status_code == 204
    assert alice.delete(f"{url}/MSFT").status_code == 404
    assert [i["symbol"] for i in alice.get(f"/api/watchlists/{wl['id']}").json()["items"]] == [
        "JNJ",
        "BRK.B",
    ]


@pytest.mark.parametrize("bad", ["", "-X", "A" * 16, "A B", "<s>"])
def test_bad_symbols_are_rejected(alice, bad):
    wl = make(alice)
    assert alice.post(f"/api/watchlists/{wl['id']}/items", json={"symbol": bad}).status_code == 422


def test_other_users_watchlists_are_invisible(admin, alice):
    wl = make(alice)
    assert admin.get("/api/watchlists").json() == []
    for method, url, body in [
        ("get", f"/api/watchlists/{wl['id']}", None),
        ("patch", f"/api/watchlists/{wl['id']}", {"name": "mine"}),
        ("delete", f"/api/watchlists/{wl['id']}", None),
        ("post", f"/api/watchlists/{wl['id']}/items", {"symbol": "X"}),
        ("delete", f"/api/watchlists/{wl['id']}/items/JNJ", None),
    ]:
        r = admin.request(method, url, json=body)
        assert r.status_code == 404, (method, url)
    assert alice.get(f"/api/watchlists/{wl['id']}").status_code == 200


def test_same_name_is_fine_for_different_users(admin, alice):
    make(alice, "Ideas")
    make(admin, "Ideas")


def test_item_cap(alice, monkeypatch):
    monkeypatch.setattr(wl_api, "MAX_ITEMS", 2)
    wl = make(alice)
    url = f"/api/watchlists/{wl['id']}/items"
    assert alice.post(url, json={"symbol": "A"}).status_code == 201
    assert alice.post(url, json={"symbol": "B"}).status_code == 201
    assert alice.post(url, json={"symbol": "C"}).status_code == 409
    assert alice.post(url, json={"symbol": "A"}).status_code == 201  # already there: no-op


def test_watchlist_cap(alice, monkeypatch):
    monkeypatch.setattr(wl_api, "MAX_WATCHLISTS", 1)
    make(alice, "one")
    assert alice.post("/api/watchlists", json={"name": "two"}).status_code == 409


def test_needs_sign_in(client):
    assert client.get("/api/watchlists").status_code == 401
