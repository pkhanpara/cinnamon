import hashlib
import json
import re
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from sqlalchemy import delete, desc, func, select

from app import connectors
from app.api.deps import CurrentUser, DbDep, get_owned_account
from app.connectors import ParseResult
from app.connectors._csv import SYMBOL_RE, parse_decimal
from app.models import Account, Import, Position
from app.schemas import ConnectorOut, ImportOut, ImportPreview, IssueOut, PositionOut

router = APIRouter(prefix="/accounts/{account_id}", tags=["imports"])

MAX_UPLOAD_BYTES = 2 * 1024 * 1024

FileDep = Annotated[UploadFile, File()]
ConnectorForm = Annotated[str, Form()]
# JSON object {"SYMBOL": "123.45"}: the user's average cost for symbols a connector listed in
# `needs_average_cost` (e.g. Robinhood shares transferred in without a cost).
AverageCostsForm = Annotated[str | None, Form()]


def _read_upload(file: UploadFile) -> bytes:
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status.HTTP_413_CONTENT_TOO_LARGE,
            f"File is larger than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB",
        )
    return data


def _safe_filename(name: str | None) -> str:
    base = (name or "upload.csv").replace("\\", "/").rsplit("/", 1)[-1]
    return re.sub(r"[\x00-\x1f\x7f]", "", base)[:255] or "upload.csv"


def _connector_for(account: Account, slug: str):
    connector = connectors.get(slug)
    if connector is None or connector not in connectors.for_platform(account.platform):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Connector {slug!r} is not available for a {account.platform} account",
        )
    return connector


def _average_costs(raw: str | None) -> dict[str, Decimal]:
    if not raw or not raw.strip():
        return {}
    bad = HTTPException(
        status.HTTP_422_UNPROCESSABLE_CONTENT,
        "average_costs must be a JSON object of symbol to a positive number",
    )
    try:
        parsed = json.loads(raw)
    except ValueError:
        raise bad from None
    if not isinstance(parsed, dict) or len(parsed) > 500:
        raise bad
    costs: dict[str, Decimal] = {}
    for symbol, value in parsed.items():
        symbol = symbol.strip().upper()
        if not SYMBOL_RE.match(symbol) or not isinstance(value, str | int | float):
            raise bad
        try:
            cost = parse_decimal(str(value), "Average cost")
        except ValueError:
            raise bad from None
        if cost <= 0:
            raise bad
        costs[symbol] = cost
    return costs


def _parse(
    account: Account, slug: str, file: UploadFile, average_costs: str | None
) -> tuple[ParseResult, bytes, str]:
    connector = _connector_for(account, slug)
    costs = _average_costs(average_costs)
    data = _read_upload(file)
    if getattr(connector, "accepts_average_costs", False):
        result = connector.parse(data, average_costs=costs)
    elif costs:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Connector {slug!r} does not take average costs"
        )
    else:
        result = connector.parse(data)
    return result, data, _safe_filename(file.filename)


@router.get("/connectors")
def list_connectors(account_id: int, user: CurrentUser, db: DbDep) -> list[ConnectorOut]:
    account = get_owned_account(db, user, account_id)
    return [
        ConnectorOut(slug=c.slug, label=c.label, description=c.description)
        for c in connectors.for_platform(account.platform)
    ]


@router.get("/positions")
def list_positions(account_id: int, user: CurrentUser, db: DbDep) -> list[PositionOut]:
    get_owned_account(db, user, account_id)
    rows = db.scalars(
        select(Position).where(Position.account_id == account_id).order_by(Position.symbol)
    )
    return [PositionOut.model_validate(p) for p in rows]


@router.post("/imports/preview")
def preview_import(
    account_id: int,
    connector: ConnectorForm,
    file: FileDep,
    user: CurrentUser,
    db: DbDep,
    average_costs: AverageCostsForm = None,
) -> ImportPreview:
    """Parse and validate only. Writes nothing."""
    account = get_owned_account(db, user, account_id)
    result, data, filename = _parse(account, connector, file, average_costs)

    current = db.scalar(select(func.count(Position.id)).where(Position.account_id == account_id))
    warnings: list[str] = []
    if current and not result.errors:  # a file with errors can't replace anything
        warnings.append(f"Importing will replace this account's {current} current position(s).")
    last = db.scalar(
        select(Import).where(Import.account_id == account_id).order_by(desc(Import.id)).limit(1)
    )
    if last and last.file_sha256 == hashlib.sha256(data).hexdigest():
        warnings.append(
            f"This file is identical to the last import ({last.filename}, "
            f"{last.created_at:%Y-%m-%d %H:%M} UTC)."
        )

    values = [p.market_value for p in result.positions]
    return ImportPreview(
        connector=connector,
        filename=filename,
        rows=[PositionOut.model_validate(p, from_attributes=True) for p in result.positions],
        errors=[IssueOut(row=e.row, message=e.message) for e in result.errors],
        warnings=warnings,
        needs_average_cost=result.needs_average_cost,
        current_position_count=current or 0,
        total_cost_basis=sum((p.cost_basis for p in result.positions), start=0),
        total_market_value=sum(values, start=0) if values and None not in values else None,
    )


@router.post("/imports", status_code=status.HTTP_201_CREATED)
def commit_import(
    account_id: int,
    connector: ConnectorForm,
    file: FileDep,
    user: CurrentUser,
    db: DbDep,
    average_costs: AverageCostsForm = None,
) -> ImportOut:
    """Re-parses the uploaded file (nothing is trusted from the preview) and replaces the
    account's positions atomically. Refuses files with any error."""
    account = get_owned_account(db, user, account_id)
    result, data, filename = _parse(account, connector, file, average_costs)
    if result.errors:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"File has {len(result.errors)} error(s); nothing was imported. Preview it to see them.",
        )

    record = Import(
        account_id=account_id,
        connector=connector,
        filename=filename,
        file_sha256=hashlib.sha256(data).hexdigest(),
        row_count=len(result.positions),
    )
    db.add(record)
    db.flush()  # need record.id for the positions
    db.execute(delete(Position).where(Position.account_id == account_id))
    db.add_all(
        Position(
            account_id=account_id,
            import_id=record.id,
            symbol=p.symbol,
            name=p.name,
            quantity=p.quantity,
            cost_basis=p.cost_basis,
            market_value=p.market_value,
            price=p.price,
            as_of=p.as_of,
        )
        for p in result.positions
    )
    db.commit()  # one transaction: a failure above leaves the old positions untouched
    return ImportOut.model_validate(record)
