from tests.conftest import ALICE, login


def _uid(c):
    return c.get("/api/auth/me").json()["id"]


def test_created_user_must_change_password(admin):
    r = admin.post("/api/users", json=ALICE)
    assert r.status_code == 201 and r.json()["must_change_password"] is True
    listed = {u["username"]: u for u in admin.get("/api/users").json()}
    assert listed[ALICE["username"]]["must_change_password"] is True

    fresh = login(admin, ALICE)
    assert fresh.get("/api/auth/me").status_code == 200
    blocked = fresh.get("/api/accounts")
    assert blocked.status_code == 403 and blocked.json()["detail"] == "Password change required"
    assert fresh.get("/api/users").status_code == 403

    changed = fresh.post(
        "/api/auth/change-password",
        json={"current_password": ALICE["password"], "new_password": "my-own-new-password"},
    )
    assert changed.status_code == 200 and changed.json()["must_change_password"] is False
    assert fresh.get("/api/accounts").status_code == 200


def test_admin_reset_flags_user_and_revokes_sessions(admin, alice):
    uid = _uid(alice)
    assert alice.get("/api/accounts").status_code == 200
    r = admin.patch(f"/api/users/{uid}", json={"password": "temporary-password"})
    assert r.status_code == 200 and r.json()["must_change_password"] is True
    assert alice.get("/api/auth/me").status_code == 401
    again = login(admin, {**ALICE, "password": "temporary-password"})
    assert again.get("/api/accounts").status_code == 403


def test_patch_without_password_keeps_flag_unchanged(admin, alice):
    uid = _uid(alice)
    r = admin.patch(f"/api/users/{uid}", json={"is_admin": True})
    assert r.json()["must_change_password"] is False
    admin.patch(f"/api/users/{uid}", json={"password": "temporary-password"})
    r = admin.patch(f"/api/users/{uid}", json={"is_active": True})
    assert r.json()["must_change_password"] is True


def test_admin_self_reset_signs_out_and_flags(admin):
    me = _uid(admin)
    r = admin.patch(f"/api/users/{me}", json={"password": "temporary-password"})
    assert r.status_code == 200 and r.json()["must_change_password"] is True
    assert admin.get("/api/auth/me").status_code == 401
