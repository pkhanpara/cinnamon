from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbDep, get_owned_account
from app.models import Account, Import, Position
from app.schemas import AccountCreate, AccountOut, AccountUpdate

router = APIRouter(prefix="/accounts", tags=["accounts"])


def _conflict() -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, "You already have an account with that nickname")


def _out(db, accounts: list[Account]) -> list[AccountOut]:
    ids = [a.id for a in accounts]
    counts = dict(
        db.execute(
            select(Position.account_id, func.count())
            .where(Position.account_id.in_(ids))
            .group_by(Position.account_id)
        ).all()
    )
    last = dict(
        db.execute(
            select(Import.account_id, func.max(Import.created_at))
            .where(Import.account_id.in_(ids))
            .group_by(Import.account_id)
        ).all()
    )
    return [
        AccountOut.model_validate(a).model_copy(
            update={"position_count": counts.get(a.id, 0), "last_import_at": last.get(a.id)}
        )
        for a in accounts
    ]


@router.get("")
def list_accounts(user: CurrentUser, db: DbDep) -> list[AccountOut]:
    rows = db.scalars(select(Account).where(Account.user_id == user.id).order_by(Account.id))
    return _out(db, list(rows))


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
    acct = get_owned_account(db, user, account_id)
    acct.nickname = body.nickname
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict() from None
    return AccountOut.model_validate(acct)


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: int, user: CurrentUser, db: DbDep) -> None:
    db.delete(get_owned_account(db, user, account_id))
    db.commit()
