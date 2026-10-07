from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import delete, func, select

from app.api.deps import CurrentUser, DbDep
from app.config import get_settings
from app.models import AuthSession, User, utcnow
from app.schemas import AuthStatus, Credentials, SetupRequest, UserOut
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


@router.get("/status")
def auth_status(db: DbDep) -> AuthStatus:
    return AuthStatus(setup_required=db.scalar(select(func.count(User.id))) == 0)


@router.post("/setup", status_code=status.HTTP_201_CREATED)
def setup(body: SetupRequest, db: DbDep, response: Response) -> UserOut:
    """Create the first admin. Only works while there are no users."""
    if db.scalar(select(func.count(User.id))) != 0:
        raise HTTPException(status.HTTP_409_CONFLICT, "Setup already completed")
    user = User(username=body.username, password_hash=hash_password(body.password), is_admin=True)
    db.add(user)
    db.commit()
    _start_session(db, user, response)
    return UserOut.model_validate(user)


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
def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)
