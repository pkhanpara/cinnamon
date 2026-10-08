"""Operator commands, run against the configured DATABASE_URL: ``python -m app.cli --help``.

Offline by design: there is deliberately no API route for these, so shell access to the host (or
`docker compose exec`) is the trust boundary.
"""

import argparse
import getpass
import sys
from typing import TextIO

from sqlalchemy import delete, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.models import AuthSession, User
from app.schemas import MIN_PASSWORD_LENGTH
from app.security import hash_password


class CliError(Exception):
    """A user-facing failure; the message is printed to stderr without a traceback."""


def reset_password(db: Session, username: str, password: str) -> User:
    """Set a new password, force a change at next sign-in and sign the user out everywhere."""
    if not password:
        raise CliError("Password must not be empty.")
    if len(password) < MIN_PASSWORD_LENGTH:
        raise CliError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    name = username.strip().lower()
    user = db.scalar(select(User).where(User.username == name))
    if user is None:
        raise CliError(f"No such user: {name!r}.")
    if not user.is_active:
        raise CliError(
            f"User {name!r} is deactivated. Reactivate it under Settings -> Users first; "
            "a password reset does not re-enable accounts."
        )
    user.password_hash = hash_password(password)
    user.must_change_password = True
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    db.commit()
    return user


def _read_password(stdin: TextIO) -> str:
    if stdin.isatty():
        first = getpass.getpass("New password: ")
        if first != getpass.getpass("Repeat new password: "):
            raise CliError("Passwords do not match.")
        return first
    # Piped input: one line, only the line ending removed (spaces may be part of a password).
    return stdin.readline().rstrip("\r\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    rp = sub.add_parser(
        "reset-password",
        help="reset a user's password (read from a prompt or stdin, never from arguments)",
    )
    rp.add_argument("username")
    args = parser.parse_args(argv)

    try:
        password = _read_password(sys.stdin)
        from app.db import SessionLocal  # lazy: builds the engine for the configured database

        with SessionLocal() as db:
            name = reset_password(db, args.username, password).username
    except CliError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    except OperationalError:
        print(
            "error: could not use the database (is it initialised? start the app once so "
            "migrations run, and check DATABASE_URL).",
            file=sys.stderr,
        )
        return 1
    print(
        f"Password for {name!r} reset. They must choose a new one at next sign-in, "
        "and all their sessions were signed out."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
