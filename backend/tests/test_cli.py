import io

import pytest
from sqlalchemy import select

from app import cli
from app.cli import CliError, reset_password
from app.db import get_db
from app.main import app
from app.models import AuthSession, User
from app.security import verify_password
from tests.conftest import ADMIN, ALICE, login, seed_user

NEW = "brand-new-password-1"


@pytest.fixture
def db(client):
    return next(app.dependency_overrides[get_db]())


@pytest.fixture
def cli_db(client, monkeypatch):
    """Point the CLI's SessionLocal at the test database."""
    monkeypatch.setattr("app.db.SessionLocal", lambda: next(app.dependency_overrides[get_db]()))


def _stdin(monkeypatch, text, tty=False):
    f = io.StringIO(text)
    f.isatty = lambda: tty
    monkeypatch.setattr("sys.stdin", f)


def test_reset_sets_hash_flag_and_revokes_only_that_users_sessions(client, db):
    seed_user(client, ADMIN, is_admin=True)
    seed_user(client, ALICE)
    login(client, ADMIN)
    login(client, ALICE)
    admin = db.scalar(select(User).where(User.username == "admin"))
    alice = db.scalar(select(User).where(User.username == "alice"))

    reset_password(db, "  Admin ", NEW)

    db.refresh(admin)
    assert verify_password(admin.password_hash, NEW)
    assert admin.must_change_password is True
    left = {s.user_id for s in db.scalars(select(AuthSession))}
    assert left == {alice.id}


@pytest.mark.parametrize("password", ["", "short"])
def test_bad_password_rejected_and_nothing_changes(client, db, password):
    seed_user(client, ADMIN, is_admin=True)
    before = db.scalar(select(User)).password_hash
    with pytest.raises(CliError):
        reset_password(db, "admin", password)
    assert db.scalar(select(User)).password_hash == before


def test_unknown_user(client, db):
    with pytest.raises(CliError, match="No such user"):
        reset_password(db, "ghost", NEW)


def test_inactive_user_not_touched(client, db):
    seed_user(client, ALICE)
    alice = db.scalar(select(User))
    alice.is_active = False
    db.commit()
    before = alice.password_hash
    with pytest.raises(CliError, match="deactivated"):
        reset_password(db, "alice", NEW)
    db.refresh(alice)
    assert alice.password_hash == before and alice.is_active is False


def test_main_reads_password_from_stdin(client, cli_db, monkeypatch, capsys):
    seed_user(client, ADMIN, is_admin=True)
    _stdin(monkeypatch, NEW + "\n")
    assert cli.main(["reset-password", "admin"]) == 0
    out = capsys.readouterr()
    assert NEW not in out.out + out.err

    # The reset account can sign in, but is locked to the password change.
    c = login(client, {"username": "admin", "password": NEW})
    assert c.get("/api/auth/me").json()["must_change_password"] is True
    assert c.get("/api/accounts").status_code == 403


def test_main_old_session_is_signed_out(client, cli_db, monkeypatch):
    seed_user(client, ADMIN, is_admin=True)
    old = login(client, ADMIN)
    _stdin(monkeypatch, NEW)
    assert cli.main(["reset-password", "admin"]) == 0
    assert old.get("/api/auth/me").status_code == 401


def test_main_errors_go_to_stderr_with_exit_1(client, cli_db, monkeypatch, capsys):
    _stdin(monkeypatch, NEW)
    assert cli.main(["reset-password", "ghost"]) == 1
    assert "No such user" in capsys.readouterr().err
    _stdin(monkeypatch, "")  # empty stdin
    assert cli.main(["reset-password", "ghost"]) == 1
    assert "empty" in capsys.readouterr().err


def test_main_prompt_confirms_password(client, cli_db, monkeypatch, capsys):
    seed_user(client, ADMIN, is_admin=True)
    _stdin(monkeypatch, "", tty=True)
    answers = iter([NEW, "different-password"])
    monkeypatch.setattr("getpass.getpass", lambda prompt="": next(answers))
    assert cli.main(["reset-password", "admin"]) == 1
    assert "do not match" in capsys.readouterr().err
    answers = iter([NEW, NEW])
    assert cli.main(["reset-password", "admin"]) == 0
