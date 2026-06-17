#!/bin/sh
# ---------------------------------------------------------------------------
# Backend / scheduler container entrypoint.
#
#   1. Wait until PostgreSQL accepts connections (DATABASE_URL host).
#   2. Apply Alembic migrations          (RUN_MIGRATIONS=true, backend only).
#   3. Optionally run the idempotent seed (RUN_SEED=true, one-off).
#   4. exec the container command (uvicorn API, or `python -m app.scheduler`).
#
# The scheduler service sets RUN_MIGRATIONS=false so only ONE process migrates.
# MUST stay LF-only (see .gitattributes) or /bin/sh in the container breaks.
# ---------------------------------------------------------------------------
set -e

echo "[entrypoint] waiting for the database to accept connections ..."
# asyncpg is already installed; strip the SQLAlchemy "+asyncpg" driver tag so
# asyncpg.connect() accepts the DSN.
python - <<'PY'
import asyncio
import os
import sys
import time

import asyncpg

dsn = os.environ["DATABASE_URL"].replace("+asyncpg", "")

async def wait():
    last_err = None
    for attempt in range(1, 61):
        try:
            conn = await asyncpg.connect(dsn)
            await conn.close()
            print(f"[entrypoint] database is ready (attempt {attempt}).")
            return
        except Exception as exc:  # noqa: BLE001 - any connect error means "not ready yet"
            last_err = exc
            print(f"[entrypoint] database not ready (attempt {attempt}/60): {exc}")
            time.sleep(2)
    print(f"[entrypoint] database did not become ready in time: {last_err}", file=sys.stderr)
    sys.exit(1)

asyncio.run(wait())
PY

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
    echo "[entrypoint] applying migrations: alembic upgrade head"
    alembic upgrade head
else
    echo "[entrypoint] RUN_MIGRATIONS=${RUN_MIGRATIONS:-true}: skipping migrations."
fi

if [ "${RUN_SEED:-false}" = "true" ]; then
    echo "[entrypoint] seeding database: python scripts/seed.py"
    python scripts/seed.py
fi

echo "[entrypoint] starting: $*"
exec "$@"
