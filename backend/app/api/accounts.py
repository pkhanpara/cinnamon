from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbDep
from app.models import Account
from app.schemas import AccountCreate, AccountOut, AccountUpdate

router = APIRouter(prefix="/accounts", tags=["accounts"])


def _owned(db, user, account_id: int) -> Account:
    # 404 (not 403) for other users' accounts so ids can't be probed.
    acct = db.scalar(select(Account).where(Account.id == account_id, Account.user_id == user.id))
    if not acct:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")
    return acct


def _conflict() -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, "You already have an account with that nickname")


@router.get("")
def list_accounts(user: CurrentUser, db: DbDep) -> list[AccountOut]:
    rows = db.scalars(select(Account).where(Account.user_id == user.id).order_by(Account.id))
    return [AccountOut.model_validate(a) for a in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_account(body: AccountCreate, user: CurrentUser, db: DbDep) -> AccountOut:
    acct = Account(user_id=user.id, platform=body.platform, nickname=body.nickname)
    db.add(acct)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict() from None
    return AccountOut.model_validate(acct)


@router.patch("/{account_id}")
def rename_account(
    account_id: int, body: AccountUpdate, user: CurrentUser, db: DbDep
) -> AccountOut:
    acct = _owned(db, user, account_id)
    acct.nickname = body.nickname
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict() from None
    return AccountOut.model_validate(acct)


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: int, user: CurrentUser, db: DbDep) -> None:
    db.delete(_owned(db, user, account_id))
    db.commit()
