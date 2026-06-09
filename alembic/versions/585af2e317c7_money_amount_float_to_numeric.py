"""convert money amounts from float to numeric(18, 2)

Switches the monetary `amount` columns on `payment_requests` and
`daily_account_balances` from double-precision FLOAT to NUMERIC(18, 2) to
eliminate binary floating-point rounding errors in financial calculations.

Revision ID: 585af2e317c7
Revises: 2da1d69e3db0
Create Date: 2026-06-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '585af2e317c7'
down_revision: Union[str, None] = '2da1d69e3db0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        'payment_requests',
        'amount',
        type_=sa.Numeric(18, 2),
        existing_type=sa.Float(),
        postgresql_using='amount::numeric(18,2)',
        existing_nullable=False,
    )
    op.alter_column(
        'daily_account_balances',
        'amount',
        type_=sa.Numeric(18, 2),
        existing_type=sa.Float(),
        postgresql_using='amount::numeric(18,2)',
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        'daily_account_balances',
        'amount',
        type_=sa.Float(),
        existing_type=sa.Numeric(18, 2),
        postgresql_using='amount::double precision',
        existing_nullable=False,
    )
    op.alter_column(
        'payment_requests',
        'amount',
        type_=sa.Float(),
        existing_type=sa.Numeric(18, 2),
        postgresql_using='amount::double precision',
        existing_nullable=False,
    )
