"""Regression: a fresh SQLite file (even in a missing directory) must work after plain startup.

Previously only the Docker CMD ran `alembic upgrade head`, so `uvicorn app.main:app` on a fresh
checkout answered every request with a plain-text 500 ("no such table: users"). Startup now also
seeds the default admin on a brand-new database (ADR 0004).
"""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import sessionmaker

import app.db as app_db
from app.config import Settings
from app.main import app
from app.models import User

DEFAULT = {"username": "admin", "password": "$admin123456"}
CHANGED = {"username": "admin", "password": "my-own-new-password"}


def _use_database(monkeypatch, url: str):
    """Point the real startup path and the real get_db at `url` (no dependency overrides)."""
    engine = create_engine(url, connect_args={"check_same_thread": False})
    monkeypatch.setattr(
        "app.main.get_settings", lambda: Settings(database_url=url, auto_migrate=True)
    )
    monkeypatch.setattr(app_db, "SessionLocal", sessionmaker(bind=engine, autoflush=False))
    return engine


def test_fresh_database_file_is_migrated_and_the_default_admin_seeded(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path / 'not-yet-created' / 'cinnamon.db'}"
    _use_database(monkeypatch, url)

    with TestClient(app) as c:
        r = c.post("/api/auth/login", json=DEFAULT)
        assert r.status_code == 200, r.text
        assert r.json()["is_admin"] is True and r.json()["must_change_password"] is True
        assert c.get("/api/accounts").status_code == 403  # blocked until the password changes

    assert "users" in inspect(create_engine(url)).get_table_names()


def test_restart_is_idempotent_and_never_resurrects_the_default_password(tmp_path, monkeypatch):
    engine = _use_database(monkeypatch, f"sqlite:///{tmp_path / 'cinnamon.db'}")

    with TestClient(app) as c:
        c.post("/api/auth/login", json=DEFAULT)
        r = c.post(
            "/api/auth/change-password",
            json={"current_password": DEFAULT["password"], "new_password": CHANGED["password"]},
        )
        assert r.status_code == 200

    with TestClient(app) as c:  # second start: migration is a no-op, nothing is re-seeded
        assert c.post("/api/auth/login", json=DEFAULT).status_code == 401
        r = c.post("/api/auth/login", json=CHANGED)
        assert r.status_code == 200 and r.json()["must_change_password"] is False
    with sessionmaker(bind=engine)() as db:
        assert len(db.scalars(select(User)).all()) == 1
