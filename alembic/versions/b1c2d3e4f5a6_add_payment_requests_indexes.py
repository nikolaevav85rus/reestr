"""add indexes for hot payment_requests queries

Adds indexes covering the hot access patterns of get_all_requests:
  - created_at        : always used for ORDER BY ... DESC
  - organization_id   : explicit filter + RLS (cluster / org scoping)
  - direction_id      : explicit filter + RLS (dept scoping)
  - creator_id        : RLS (req_view_own scoping)
  - payment_date      : reporting / calendar filtering
  - (approval_status, payment_status) : composite, filtered together

Index names match SQLAlchemy's default ``ix_<table>_<column>`` convention so
they line up with the ``index=True`` / ``Index(...)`` declarations in
``app/models/request.py``. CREATE/DROP use IF (NOT) EXISTS so the migration is
idempotent against a DB that may already have some indexes.

Revision ID: b1c2d3e4f5a6
Revises: f7a1c2b3d4e5
Create Date: 2026-06-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, None] = 'f7a1c2b3d4e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_payment_requests_created_at "
        "ON payment_requests (created_at)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_payment_requests_organization_id "
        "ON payment_requests (organization_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_payment_requests_direction_id "
        "ON payment_requests (direction_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_payment_requests_creator_id "
        "ON payment_requests (creator_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_payment_requests_payment_date "
        "ON payment_requests (payment_date)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_payment_requests_approval_payment_status "
        "ON payment_requests (approval_status, payment_status)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_payment_requests_approval_payment_status")
    op.execute("DROP INDEX IF EXISTS ix_payment_requests_payment_date")
    op.execute("DROP INDEX IF EXISTS ix_payment_requests_creator_id")
    op.execute("DROP INDEX IF EXISTS ix_payment_requests_direction_id")
    op.execute("DROP INDEX IF EXISTS ix_payment_requests_organization_id")
    op.execute("DROP INDEX IF EXISTS ix_payment_requests_created_at")
