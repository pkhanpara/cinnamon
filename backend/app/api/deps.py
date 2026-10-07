from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import Account, AuthSession, User
from app.security import hash_token

DbDep = Annotated[Session, Depends(get_db)]

PASSWORD_CHANGE_REQUIRED = "Password change required"


def session_user(request: Request, db: DbDep) -> User:
    """The signed-in user, even while a password change is pending (for /auth/me, change-password)."""
    token = request.cookies.get(get_settings().session_cookie_name)
    if token:
        row = db.execute(
            select(AuthSession, User)
            .join(User, User.id == AuthSession.user_id)
            .where(AuthSession.token_hash == hash_token(token))
        ).first()
        if row:
            sess, user = row
            expires = sess.expires_at
            if expires.tzinfo is None:  # SQLite drops tzinfo
                expires = expires.replace(tzinfo=UTC)
            if expires > datetime.now(UTC) and user.is_active:
                return user
    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")


def current_user(user: Annotated[User, Depends(session_user)]) -> User:
    """For everything else: a user who still has the default password gets nothing until it is changed."""
    if user.must_change_password:
        raise HTTPException(status.HTTP_403_FORBIDDEN, PASSWORD_CHANGE_REQUIRED)
    return user


def require_admin(user: Annotated[User, Depends(current_user)]) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    return user


SessionUser = Annotated[User, Depends(session_user)]
CurrentUser = Annotated[User, Depends(current_user)]
AdminUser = Annotated[User, Depends(require_admin)]


def get_owned_account(db: Session, user: User, account_id: int) -> Account:
    """404 (not 403) for other users' accounts so ids can't be probed."""
    acct = db.scalar(select(Account).where(Account.id == account_id, Account.user_id == user.id))
    if not acct:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    return acct
