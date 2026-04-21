"""contract_status_tristate

Revision ID: d1e2f3a4b5c6
Revises: c9cc1d687dc6
Create Date: 2026-04-11 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision: str = 'd1e2f3a4b5c6'
down_revision: str = 'c9cc1d687dc6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Делаем contract_status nullable: null=Необработано, true=Есть, false=Нет
    op.alter_column('payment_requests', 'contract_status',
        existing_type=sa.Boolean(),
        nullable=True,
        server_default=None,
    )
    # Существующие записи с false → null (Необработано), т.к. они были дефолтом, не осознанным выбором
    op.execute("UPDATE payment_requests SET contract_status = NULL WHERE contract_status = false")


def downgrade() -> None:
    op.execute("UPDATE payment_requests SET contract_status = false WHERE contract_status IS NULL")
    op.alter_column('payment_requests', 'contract_status',
        existing_type=sa.Boolean(),
        nullable=False,
        server_default=sa.text('false'),
    )
