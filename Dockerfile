# Pinned for reproducible builds (tag + digest). Dependabot bumps both; CI reads the uv version from this line.
FROM ghcr.io/astral-sh/uv:0.12.23@sha256:61d393e44e249f2e4b526b6c7ddcecce245946826e608e11c93ad4f5bba55b21 AS uv

FROM node:22-slim AS ui
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npx ng build --configuration production

FROM python:3.12-slim AS deps
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

FROM python:3.12-slim AS app
LABEL org.opencontainers.image.source=https://github.com/pkhanpara/cinnamon
WORKDIR /app
COPY --from=deps /app/.venv ./.venv
COPY backend/ ./
COPY --from=ui /ui/dist/frontend/browser ./static
RUN useradd --system --uid 10001 cinnamon && mkdir -p /app/data && chown cinnamon /app/data
USER cinnamon
ENV PATH="/app/.venv/bin:$PATH" \
    DATABASE_URL=sqlite:////app/data/cinnamon.db
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request as u; u.urlopen('http://localhost:8000/api/health')"
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
