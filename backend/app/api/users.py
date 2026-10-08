from fastapi import APIRouter, HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import AdminUser, DbDep
from app.models import AuthSession, User
from app.schemas import UserCreate, UserOut, UserUpdate
from app.security import hash_password

router = APIRouter(prefix="/users", tags=["users"])


@router.get("")
def list_users(_: AdminUser, db: DbDep) -> list[UserOut]:
    return [UserOut.model_validate(u) for u in db.scalars(select(User).order_by(User.id))]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_user(body: UserCreate, _: AdminUser, db: DbDep) -> UserOut:
    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        is_admin=body.is_admin,
        must_change_password=True,  # the admin chose it, so it is only a temporary password
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already exists") from None
    return UserOut.model_validate(user)


@router.patch("/{user_id}")
def update_user(user_id: int, body: UserUpdate, admin: AdminUser, db: DbDep) -> UserOut:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user.id == admin.id and (body.is_active is False or body.is_admin is False):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot deactivate or demote yourself")
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.is_admin is not None:
        user.is_admin = body.is_admin
    if body.password is not None:
        user.password_hash = hash_password(body.password)
        user.must_change_password = True
    if body.is_active is False or body.password is not None:
        db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    db.commit()
    return UserOut.model_validate(user)
