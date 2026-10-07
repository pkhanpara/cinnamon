import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.providers import get_quote_provider

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
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def login(client: TestClient, creds: dict) -> TestClient:
    """Return a fresh client (own cookie jar) logged in as creds."""
    c = TestClient(client.app)
    r = c.post("/api/auth/login", json=creds)
    assert r.status_code == 200, r.text
    return c


@pytest.fixture
def admin(client):
    assert client.post("/api/auth/setup", json=ADMIN).status_code == 201
    return client


@pytest.fixture
def alice(admin):
    assert admin.post("/api/users", json=ALICE).status_code == 201
    return login(admin, ALICE)
