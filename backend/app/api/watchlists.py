from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbDep
from app.api.symbols import SYMBOL_PATTERN
from app.models import Watchlist, WatchlistItem
from app.schemas import (
    WatchlistCreate,
    WatchlistDetail,
    WatchlistItemCreate,
    WatchlistItemOut,
    WatchlistOut,
    WatchlistUpdate,
)

router = APIRouter(prefix="/watchlists", tags=["watchlists"])

MAX_WATCHLISTS = 50
MAX_ITEMS = 100  # each row on the page costs a scorecard lookup


def _owned(db, user, watchlist_id: int) -> Watchlist:
    wl = db.get(Watchlist, watchlist_id)
    if wl is None or wl.user_id != user.id:  # someone else's list looks the same as a missing one
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Watchlist not found")
    return wl


def _conflict() -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, "You already have a watchlist with that name")


def _out(wl: Watchlist) -> WatchlistOut:
    return WatchlistOut(
        id=wl.id, name=wl.name, created_at=wl.created_at, symbols=[i.symbol for i in wl.items]
    )


def _detail(wl: Watchlist) -> WatchlistDetail:
    return WatchlistDetail(
        id=wl.id,
        name=wl.name,
        created_at=wl.created_at,
        items=[WatchlistItemOut.model_validate(i) for i in wl.items],
    )


@router.get("")
def list_watchlists(user: CurrentUser, db: DbDep) -> list[WatchlistOut]:
    rows = db.scalars(select(Watchlist).where(Watchlist.user_id == user.id).order_by(Watchlist.id))
    return [_out(wl) for wl in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_watchlist(body: WatchlistCreate, user: CurrentUser, db: DbDep) -> WatchlistDetail:
    count = db.scalar(select(func.count()).where(Watchlist.user_id == user.id))
    if count >= MAX_WATCHLISTS:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"You can have at most {MAX_WATCHLISTS} watchlists"
        )
    wl = Watchlist(user_id=user.id, name=body.name)
    db.add(wl)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict() from None
    return _detail(wl)


@router.get("/{watchlist_id}")
def get_watchlist(watchlist_id: int, user: CurrentUser, db: DbDep) -> WatchlistDetail:
    return _detail(_owned(db, user, watchlist_id))


@router.patch("/{watchlist_id}")
def rename_watchlist(
    watchlist_id: int, body: WatchlistUpdate, user: CurrentUser, db: DbDep
) -> WatchlistDetail:
    wl = _owned(db, user, watchlist_id)
    wl.name = body.name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict() from None
    return _detail(wl)


@router.delete("/{watchlist_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_watchlist(watchlist_id: int, user: CurrentUser, db: DbDep) -> None:
    db.delete(_owned(db, user, watchlist_id))
    db.commit()


@router.post("/{watchlist_id}/items", status_code=status.HTTP_201_CREATED)
def add_item(
    watchlist_id: int, body: WatchlistItemCreate, user: CurrentUser, db: DbDep
) -> WatchlistDetail:
    """Idempotent: adding a symbol that is already on the list changes nothing."""
    wl = _owned(db, user, watchlist_id)
    symbol = body.symbol.upper()
    if any(i.symbol == symbol for i in wl.items):
        return _detail(wl)
    if len(wl.items) >= MAX_ITEMS:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"A watchlist holds at most {MAX_ITEMS} symbols"
        )
    wl.items.append(WatchlistItem(symbol=symbol))
    try:
        db.commit()
    except IntegrityError:  # a concurrent add of the same symbol won
        db.rollback()
    db.refresh(wl)
    return _detail(wl)


@router.delete("/{watchlist_id}/items/{symbol}", status_code=status.HTTP_204_NO_CONTENT)
def remove_item(
    watchlist_id: int,
    symbol: Annotated[str, Path(pattern=SYMBOL_PATTERN)],
    user: CurrentUser,
    db: DbDep,
) -> None:
    wl = _owned(db, user, watchlist_id)
    item = next((i for i in wl.items if i.symbol == symbol.upper()), None)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{symbol.upper()} is not on this watchlist")
    wl.items.remove(item)
    db.commit()
