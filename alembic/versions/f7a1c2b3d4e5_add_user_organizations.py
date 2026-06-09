"""add user_organizations mapping

Creates the explicit Many-to-Many mapping between users and organizations.
Used to scope morning-balances access: a non-superadmin user can view/manage
account balances only for the organizations assigned to them here. Superadmin
bypasses the scoping entirely.

Composite primary key (user_id, organization_id). Both FKs cascade on delete,
so removing a user or an organization automatically cleans up its assignments.

Revision ID: f7a1c2b3d4e5
Revises: dc3b84f8d913
Create Date: 2026-06-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = 'f7a1c2b3d4e5'
down_revision: Union[str, None] = 'dc3b84f8d913'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_organizations",
        sa.Column(
            "user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "organization_id",
            UUID(as_uuid=True),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            primary_key=True,
            nullable=False,
        ),
    )
    op.create_index(
        "ix_user_organizations_organization_id",
        "user_organizations",
        ["organization_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_user_organizations_organization_id",
        table_name="user_organizations",
    )
    op.drop_table("user_organizations")
