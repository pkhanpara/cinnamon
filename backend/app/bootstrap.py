"""First-run seeding."""

import logging

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import User
from app.security import hash_password

log = logging.getLogger("cinnamon")


def ensure_default_admin(db: Session, username: str, password: str) -> bool:
    """Create the default admin when the database has no users at all. Returns True if created.

    Safe to call on every start and from several workers at once: a lost race trips the unique
    username constraint and is treated as "someone else already did it".
    """
    if db.scalar(select(func.count(User.id))):
        return False
    db.add(
        User(
            username=username.strip().lower(),
            password_hash=hash_password(password),
            is_admin=True,
            must_change_password=True,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return False
    log.warning(
        "Created default admin %r with the documented default password. "
        "Sign in and change it; nothing else works until you do.",
        username,
    )
    return True
