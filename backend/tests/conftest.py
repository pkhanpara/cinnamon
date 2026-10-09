import os

os.environ["AUTO_MIGRATE"] = "false"  # tests build their own in-memory schema; set before import

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, update
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.cache import clear_all_caches
from app.db import Base, get_db
from app.main import app
from app.models import User
from app.providers import (
    get_company_provider,
    get_fundamentals_provider,
    get_history_provider,
    get_ownership_provider,
    get_quote_provider,
)
from app.providers.llm import get_llm_provider
from app.security import hash_password


class _no_network_history:
    """Default history provider in tests: any call is a bug (it would reach Yahoo)."""

    def get_history(self, symbol, range_):
        raise AssertionError(
            "test reached the real history provider; override get_history_provider"
        )


class _no_network_ownership:
    """Default ownership provider in tests: any call is a bug (it would reach Yahoo)."""

    def get_ownership(self, symbol):
        raise AssertionError("test reached the real ownership provider; override it")

    def get_splits(self, symbol):
        raise AssertionError("test reached the real ownership provider; override it")


ADMIN = {"username": "admin", "password": "correct-horse-battery"}
ALICE = {"username": "alice", "password": "alice-password-123"}


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def _fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False)

    def override():
        with Session() as s:
            yield s

    app.dependency_overrides[get_db] = override
    # Never reach the real Finnhub (the dev .env has a key). Tests that need prices override this.
    app.dependency_overrides[get_quote_provider] = lambda: None
    app.dependency_overrides[get_company_provider] = lambda: None
    app.dependency_overrides[get_history_provider] = _no_network_history
    app.dependency_overrides[get_fundamentals_provider] = lambda: None
    app.dependency_overrides[get_ownership_provider] = _no_network_ownership
    app.dependency_overrides[get_llm_provider] = lambda: None  # the dev .env may name a real model
    clear_all_caches()
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def login(client: TestClient, creds: dict) -> TestClient:
    """Return a fresh client (own cookie jar) logged in as creds."""
    c = TestClient(client.app)
    r = c.post("/api/auth/login", json=creds)
    assert r.status_code == 200, r.text
    return c


def seed_user(client, creds: dict, *, is_admin=False, must_change=False) -> None:
    """Insert a user straight into the test DB (there is no public sign-up)."""
    db = next(app.dependency_overrides[get_db]())
    db.add(
        User(
            username=creds["username"],
            password_hash=hash_password(creds["password"]),
            is_admin=is_admin,
            must_change_password=must_change,
        )
    )
    db.commit()


def clear_forced_change(creds: dict) -> None:
    """Admin-created users must change their password first; most tests are about something else."""
    db = next(app.dependency_overrides[get_db]())
    db.execute(
        update(User).where(User.username == creds["username"]).values(must_change_password=False)
    )
    db.commit()


@pytest.fixture
def admin(client):
    seed_user(client, ADMIN, is_admin=True)
    assert client.post("/api/auth/login", json=ADMIN).status_code == 200
    return client


@pytest.fixture
def alice(admin):
    assert admin.post("/api/users", json=ALICE).status_code == 201
    clear_forced_change(ALICE)
    return login(admin, ALICE)
