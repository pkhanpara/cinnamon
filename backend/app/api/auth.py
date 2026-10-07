from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import delete, select

from app.api.deps import DbDep, SessionUser
from app.config import get_settings
from app.models import AuthSession, User, utcnow
from app.schemas import ChangePassword, Credentials, UserOut
from app.security import (
    DUMMY_HASH,
    hash_password,
    hash_token,
    new_session_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _start_session(db, user: User, response: Response) -> None:
    s = get_settings()
    token = new_session_token()
    db.add(
        AuthSession(
            token_hash=hash_token(token),
            user_id=user.id,
            expires_at=utcnow() + timedelta(days=s.session_days),
        )
    )
    db.commit()
    response.set_cookie(
        s.session_cookie_name,
        token,
        max_age=s.session_days * 86400,
        httponly=True,
        samesite="lax",
        secure=s.cookie_secure,
        path="/",
    )


@router.post("/login")
def login(body: Credentials, db: DbDep, response: Response) -> UserOut:
    user = db.scalar(select(User).where(User.username == body.username.strip().lower()))
    ok = verify_password(user.password_hash if user else DUMMY_HASH, body.password)
    if not (user and ok and user.is_active):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid username or password")
    _start_session(db, user, response)
    return UserOut.model_validate(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, db: DbDep, response: Response) -> None:
    s = get_settings()
    token = request.cookies.get(s.session_cookie_name)
    if token:
        db.execute(delete(AuthSession).where(AuthSession.token_hash == hash_token(token)))
        db.commit()
    response.delete_cookie(s.session_cookie_name, path="/")


@router.get("/me")
def me(user: SessionUser) -> UserOut:
    return UserOut.model_validate(user)


@router.post("/change-password")
def change_password(
    body: ChangePassword, request: Request, user: SessionUser, db: DbDep
) -> UserOut:
    """Allowed while a password change is pending. Other sessions of this user are signed out."""
    s = get_settings()
    if not verify_password(user.password_hash, body.current_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    if body.new_password == body.current_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New password must be different")
    if body.new_password == s.default_admin_password:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Choose a different password than the default"
        )
    user.password_hash = hash_password(body.new_password)
    user.must_change_password = False
    keep = hash_token(request.cookies.get(s.session_cookie_name, ""))
    db.execute(
        delete(AuthSession).where(AuthSession.user_id == user.id, AuthSession.token_hash != keep)
    )
    db.commit()
    return UserOut.model_validate(user)
