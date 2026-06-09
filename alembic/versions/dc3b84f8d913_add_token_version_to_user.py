"""add token_version to user

Adds an integer `token_version` column to `users` for server-side JWT
revocation. Incrementing this value invalidates every previously issued
token for that user (logout, role change, password change).

Existing rows get 0 via server_default so all currently active tokens
(which carry no/`ver`=0 claim path) stay consistent with token_version=0.

Revision ID: dc3b84f8d913
Revises: 585af2e317c7
Create Date: 2026-06-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dc3b84f8d913'
down_revision: Union[str, None] = '585af2e317c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column(
            'token_version',
            sa.Integer(),
            nullable=False,
            server_default='0',
        ),
    )


def downgrade() -> None:
    op.drop_column('users', 'token_version')
