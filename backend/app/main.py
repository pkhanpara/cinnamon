from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import db as app_db
from app.api import accounts, auth, health, holdings, imports, llm, portfolio, symbols, users
from app.bootstrap import ensure_default_admin
from app.config import get_settings

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    if settings.auto_migrate:
        app_db.upgrade_schema(settings.database_url)
        # Only here: the schema is known to exist, and test fixtures that build their own
        # in-memory schema run with auto_migrate off and must not touch a real database.
        with app_db.SessionLocal() as db:
            ensure_default_admin(
                db, settings.default_admin_username, settings.default_admin_password
            )
    yield


app = FastAPI(title="Cinnamon", version="0.1.0", lifespan=lifespan)
for r in (
    health.router,
    auth.router,
    users.router,
    accounts.router,
    imports.router,
    holdings.router,
    symbols.router,
    llm.router,
    portfolio.router,
):
    app.include_router(r, prefix="/api")

if STATIC_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="static-files")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(status_code=404)
        candidate = (STATIC_DIR / path).resolve()
        if path and candidate.is_file() and STATIC_DIR in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(STATIC_DIR / "index.html")
