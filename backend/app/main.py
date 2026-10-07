from fastapi import FastAPI

from app.api import health

app = FastAPI(title="Cinnamon", version="0.1.0")
app.include_router(health.router, prefix="/api")
