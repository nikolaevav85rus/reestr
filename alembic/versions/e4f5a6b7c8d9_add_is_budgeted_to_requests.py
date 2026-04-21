"""add_is_budgeted_to_requests

Revision ID: e4f5a6b7c8d9
Revises: d1e2f3a4b5c6
Create Date: 2026-04-11 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision: str = 'e4f5a6b7c8d9'
down_revision: str = 'd1e2f3a4b5c6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('payment_requests',
        sa.Column('is_budgeted', sa.Boolean(), nullable=True, server_default=None)
    )


def downgrade() -> None:
    op.drop_column('payment_requests', 'is_budgeted')
