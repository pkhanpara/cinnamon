def test_account_crud(alice):
    r = alice.post("/api/accounts", json={"platform": "Robinhood", "nickname": " Main "})
    assert r.status_code == 201
    a = r.json()
    assert a["platform"] == "robinhood" and a["nickname"] == "Main"
    assert [x["id"] for x in alice.get("/api/accounts").json()] == [a["id"]]
    assert (
        alice.patch(f"/api/accounts/{a['id']}", json={"nickname": "Roth"}).json()["nickname"]
        == "Roth"
    )
    assert alice.delete(f"/api/accounts/{a['id']}").status_code == 204
    assert alice.get("/api/accounts").json() == []


def test_duplicate_nickname_per_user(alice):
    body = {"platform": "m1", "nickname": "Retirement"}
    assert alice.post("/api/accounts", json=body).status_code == 201
    assert alice.post("/api/accounts", json=body).status_code == 409


def test_invalid_platform_rejected(alice):
    assert (
        alice.post("/api/accounts", json={"platform": "bad platform!", "nickname": "x"}).status_code
        == 422
    )


def test_users_cannot_see_or_touch_each_others_accounts(admin, alice):
    mine = admin.post("/api/accounts", json={"platform": "m1", "nickname": "Admin acct"}).json()
    assert alice.get("/api/accounts").json() == []
    assert alice.patch(f"/api/accounts/{mine['id']}", json={"nickname": "pwned"}).status_code == 404
    assert alice.delete(f"/api/accounts/{mine['id']}").status_code == 404
    assert admin.get("/api/accounts").json()[0]["nickname"] == "Admin acct"


def test_same_nickname_allowed_for_different_users(admin, alice):
    body = {"platform": "m1", "nickname": "Main"}
    assert admin.post("/api/accounts", json=body).status_code == 201
    assert alice.post("/api/accounts", json=body).status_code == 201
