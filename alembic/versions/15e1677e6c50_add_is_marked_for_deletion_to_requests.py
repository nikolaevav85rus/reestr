"""add_is_marked_for_deletion_to_requests

Revision ID: 15e1677e6c50
Revises: g2h3i4j5k6l7
Create Date: 2026-04-14 17:38:52.660841

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '15e1677e6c50'
down_revision: Union[str, None] = 'g2h3i4j5k6l7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('payment_requests',
        sa.Column('is_marked_for_deletion', sa.Boolean(), nullable=False, server_default='false')
    )


def downgrade() -> None:
    op.drop_column('payment_requests', 'is_marked_for_deletion')
