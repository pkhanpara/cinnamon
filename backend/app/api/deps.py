from datetime import UTC, datetime
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.models import AuthSession, User
from app.security import hash_token

DbDep = Annotated[Session, Depends(get_db)]


def current_user(request: Request, db: DbDep) -> User:
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


def require_admin(user: Annotated[User, Depends(current_user)]) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin only")
    return user


CurrentUser = Annotated[User, Depends(current_user)]
AdminUser = Annotated[User, Depends(require_admin)]
