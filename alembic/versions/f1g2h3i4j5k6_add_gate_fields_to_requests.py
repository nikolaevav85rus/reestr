"""add_gate_fields_to_requests

Revision ID: f1g2h3i4j5k6
Revises: e4f5a6b7c8d9
Create Date: 2026-04-12 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = 'f1g2h3i4j5k6'
down_revision: str = 'e4f5a6b7c8d9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('payment_requests',
        sa.Column('gate_approved_by', UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='SET NULL'),
                  nullable=True)
    )
    op.add_column('payment_requests',
        sa.Column('gate_reason', sa.String(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('payment_requests', 'gate_reason')
    op.drop_column('payment_requests', 'gate_approved_by')
