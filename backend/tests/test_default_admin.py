from decimal import Decimal  # noqa: F401

import pytest
from sqlalchemy import func, select

from app.bootstrap import ensure_default_admin
from app.db import get_db
from app.main import app
from app.models import AuthSession, User
from app.security import verify_password
from tests.conftest import ADMIN, login, seed_user

DEFAULT = {"username": "admin", "password": "$admin123456"}


def db():
    return next(app.dependency_overrides[get_db]())


def test_seeds_the_default_admin_on_an_empty_database(client):
    assert ensure_default_admin(db(), "admin", "$admin123456") is True
    u = db().scalar(select(User))
    assert (u.username, u.is_admin, u.is_active, u.must_change_password) == (
        "admin",
        True,
        True,
        True,
    )
    assert verify_password(u.password_hash, "$admin123456")
    assert u.password_hash != "$admin123456"  # stored hashed


def test_seeding_is_idempotent_and_never_touches_existing_users(client):
    assert ensure_default_admin(db(), "admin", "$admin123456") is True
    assert ensure_default_admin(db(), "admin", "$admin123456") is False
    assert db().scalar(select(func.count(User.id))) == 1


def test_seeding_is_skipped_when_any_user_exists(client):
    seed_user(client, ADMIN, is_admin=True)
    assert ensure_default_admin(db(), "admin", "$admin123456") is False
    assert [u.username for u in db().scalars(select(User))] == ["admin"] and db().scalar(
        select(User.must_change_password)
    ) is False  # the existing admin was not flagged or replaced


def test_username_is_normalised(client):
    ensure_default_admin(db(), "  Admin ", "$admin123456")
    assert db().scalar(select(User.username)) == "admin"


@pytest.fixture
def fresh(client):
    ensure_default_admin(db(), DEFAULT["username"], DEFAULT["password"])
    c = login(client, DEFAULT)
    return c


def test_default_admin_can_sign_in_and_is_told_to_change_the_password(fresh):
    me = fresh.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["must_change_password"] is True


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/api/accounts"),
        ("post", "/api/accounts"),
        ("get", "/api/users"),
        ("post", "/api/users"),
        ("get", "/api/holdings"),
        ("get", "/api/accounts/1/positions"),
        ("get", "/api/accounts/1/connectors"),
        ("patch", "/api/users/1"),
    ],
)
def test_everything_else_is_blocked_until_the_password_is_changed(fresh, method, path):
    r = getattr(fresh, method)(path, **({"json": {}} if method in ("post", "patch") else {}))
    assert r.status_code == 403 and r.json()["detail"] == "Password change required"


def test_logout_still_works_while_a_change_is_pending(fresh):
    assert fresh.post("/api/auth/logout").status_code == 204
    assert fresh.get("/api/auth/me").status_code == 401


NEW = "a-brand-new-password"


def change(c, current="$admin123456", new=NEW):
    return c.post(
        "/api/auth/change-password", json={"current_password": current, "new_password": new}
    )


def test_changing_the_password_unlocks_the_app_and_retires_the_default(fresh, client):
    r = change(fresh)
    assert r.status_code == 200 and r.json()["must_change_password"] is False
    assert fresh.get("/api/accounts").status_code == 200  # same session, now allowed
    assert client.post("/api/auth/login", json=DEFAULT).status_code == 401
    assert (
        login(client, {"username": "admin", "password": NEW}).get("/api/auth/me").status_code == 200
    )


@pytest.mark.parametrize(
    ("kwargs", "status", "fragment"),
    [
        ({"current": "wrong-password-1"}, 400, "Current password is incorrect"),
        ({"new": "$admin123456"}, 400, "different"),
        ({"new": "short"}, 422, None),
    ],
)
def test_change_password_rejections_leave_everything_as_it_was(fresh, kwargs, status, fragment):
    r = change(fresh, **kwargs)
    assert r.status_code == status
    if fragment:
        assert fragment in r.json()["detail"]
    assert fresh.get("/api/auth/me").json()["must_change_password"] is True


def test_default_password_cannot_be_chosen_as_the_new_one_by_another_user(admin):
    # an ordinary user must also not be able to set the well-known default as their password
    seed_user(admin, {"username": "bob", "password": "bobs-old-password"})
    bob = login(admin, {"username": "bob", "password": "bobs-old-password"})
    r = change(bob, current="bobs-old-password", new="$admin123456")
    assert r.status_code == 400 and "default" in r.json()["detail"]


def test_change_password_signs_out_the_users_other_sessions_but_not_this_one(admin):
    other = login(admin, ADMIN)  # a second device
    r = change(admin, current=ADMIN["password"])
    assert r.status_code == 200
    assert admin.get("/api/auth/me").status_code == 200
    assert other.get("/api/auth/me").status_code == 401
    assert db().scalar(select(func.count(AuthSession.id))) == 1


def test_change_password_requires_login(client):
    assert change(client).status_code == 401


def test_removed_setup_endpoints_are_gone(client):
    assert client.get("/api/auth/status").status_code in (404, 405)
    assert client.post("/api/auth/setup", json=ADMIN).status_code in (404, 405)
