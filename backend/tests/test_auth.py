from datetime import timedelta

from sqlalchemy import update

from app.db import get_db
from app.main import app
from app.models import AuthSession, utcnow
from tests.conftest import ADMIN, ALICE, login


def test_cookie_flags_and_me(admin):
    r = admin.post("/api/auth/login", json=ADMIN)
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert admin.get("/api/auth/me").json()["username"] == "admin"


def test_username_case_insensitive(admin):
    r = admin.post("/api/auth/login", json={**ADMIN, "username": "  ADMIN "})
    assert r.status_code == 200


def test_bad_credentials_same_error(admin):
    wrong = admin.post("/api/auth/login", json={**ADMIN, "password": "nope-nope-nope"})
    unknown = admin.post("/api/auth/login", json={"username": "ghost", "password": "x"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def test_unauthenticated_is_401(client):
    for path in ("/api/auth/me", "/api/accounts", "/api/users"):
        assert client.get(path).status_code == 401


def test_logout_invalidates_session(admin):
    admin.post("/api/auth/logout")
    assert admin.get("/api/auth/me").status_code == 401


def test_expired_session_rejected(admin):
    gen = app.dependency_overrides[get_db]()
    db = next(gen)
    db.execute(update(AuthSession).values(expires_at=utcnow() - timedelta(seconds=1)))
    db.commit()
    assert admin.get("/api/auth/me").status_code == 401


def test_non_admin_cannot_manage_users(alice):
    assert alice.get("/api/users").status_code == 403
    assert alice.post("/api/users", json={**ALICE, "username": "bob"}).status_code == 403


def test_duplicate_username_conflict(admin, alice):
    assert admin.post("/api/users", json={**ALICE, "username": "Alice"}).status_code == 409


def test_deactivate_kills_sessions_and_blocks_login(admin, alice):
    uid = alice.get("/api/auth/me").json()["id"]
    assert admin.patch(f"/api/users/{uid}", json={"is_active": False}).status_code == 200
    assert alice.get("/api/auth/me").status_code == 401
    assert admin.post("/api/auth/login", json=ALICE).status_code == 401


def test_password_reset_kills_sessions(admin, alice):
    uid = alice.get("/api/auth/me").json()["id"]
    new = {**ALICE, "password": "brand-new-password"}
    admin.patch(f"/api/users/{uid}", json={"password": new["password"]})
    assert alice.get("/api/auth/me").status_code == 401
    assert login(admin, new).get("/api/auth/me").status_code == 200


def test_admin_cannot_lock_self_out(admin):
    me = admin.get("/api/auth/me").json()["id"]
    assert admin.patch(f"/api/users/{me}", json={"is_active": False}).status_code == 400
    assert admin.patch(f"/api/users/{me}", json={"is_admin": False}).status_code == 400
