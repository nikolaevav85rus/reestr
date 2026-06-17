# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# Backend image: FastAPI (Python 3.12) + Alembic.
# Used by both the `backend` (uvicorn) and `scheduler` (APScheduler) services.
# OCR libraries (requirements-ocr.txt) are intentionally NOT installed — OCR
# runs against the remote evo-ai service over httpx, which is already in
# requirements.txt.
# ---------------------------------------------------------------------------
FROM python:3.12-slim

# - PYTHONUNBUFFERED: logs go straight to the container stdout (no buffering).
# - PYTHONDONTWRITEBYTECODE: no .pyc clutter on the read-only-ish layers.
# - TZ: matches APP_TIMEZONE so naive local-time logic and cron line up.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    TZ=Europe/Moscow

# tzdata  -> zoneinfo for APP_TIMEZONE=Europe/Moscow (gate cut-off, scheduler).
# curl    -> backend container healthcheck + entrypoint diagnostics.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first so the layer is cached across code changes.
COPY requirements.txt ./
RUN pip install -r requirements.txt

# Application code, migrations and seed scripts.
COPY app/ ./app/
COPY alembic/ ./alembic/
COPY alembic.ini ./
COPY scripts/ ./scripts/
COPY docker/backend-entrypoint.sh /usr/local/bin/backend-entrypoint.sh

# Non-root runtime user. Owns the writable dirs (uploads, app_settings.json, logs).
RUN chmod +x /usr/local/bin/backend-entrypoint.sh \
    && useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/storage /app/data /app/logs \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8080

# Entrypoint waits for the DB, optionally migrates/seeds, then execs CMD.
ENTRYPOINT ["/usr/local/bin/backend-entrypoint.sh"]
CMD ["python", "-m", "app.main"]
