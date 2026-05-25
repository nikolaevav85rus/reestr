"""add bank accounts and daily balances

Revision ID: 2da1d69e3db0
Revises: 3a5c7e9f1b20
Create Date: 2026-05-04 11:14:57.232124

"""
from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = '2da1d69e3db0'
down_revision: Union[str, None] = '3a5c7e9f1b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


PERMISSIONS = [
    {
        "name": "account_balance_view",
        "label": "Просмотр остатков на счетах",
        "category": "5. Видимость",
        "roles": ("CASHIER", "FEO"),
    },
    {
        "name": "account_balance_manage",
        "label": "Ввод и правка остатков на счетах",
        "category": "5. Видимость",
        "roles": ("CASHIER",),
    },
]


def _ensure_permission(conn, name: str, label: str, category: str) -> str:
    existing = conn.execute(
        sa.text("select id from permissions where name = :name"),
        {"name": name},
    ).scalar()
    if existing:
        conn.execute(
            sa.text(
                """
                update permissions
                set label = :label, category = :category
                where id = :id
                """
            ),
            {"id": existing, "label": label, "category": category},
        )
        return str(existing)

    permission_id = str(uuid.uuid4())
    conn.execute(
        sa.text(
            """
            insert into permissions (id, name, label, category)
            values (:id, :name, :label, :category)
            """
        ),
        {
            "id": permission_id,
            "name": name,
            "label": label,
            "category": category,
        },
    )
    return permission_id


def _assign_permission_to_role(conn, permission_id: str, role_name: str) -> None:
    role_id = conn.execute(
        sa.text("select id from roles where name = :name"),
        {"name": role_name},
    ).scalar()
    if not role_id:
        return

    exists = conn.execute(
        sa.text(
            """
            select 1
            from role_permissions
            where role_id = :role_id and permission_id = :permission_id
            """
        ),
        {"role_id": role_id, "permission_id": permission_id},
    ).first()
    if exists:
        return

    conn.execute(
        sa.text(
            """
            insert into role_permissions (role_id, permission_id)
            values (:role_id, :permission_id)
            """
        ),
        {"role_id": role_id, "permission_id": permission_id},
    )


def _add_permissions(conn) -> None:
    for permission in PERMISSIONS:
        permission_id = _ensure_permission(
            conn,
            permission["name"],
            permission["label"],
            permission["category"],
        )
        for role_name in permission["roles"]:
            _assign_permission_to_role(conn, permission_id, role_name)


def _remove_permissions(conn) -> None:
    for permission in PERMISSIONS:
        permission_id = conn.execute(
            sa.text("select id from permissions where name = :name"),
            {"name": permission["name"]},
        ).scalar()
        if not permission_id:
            continue

        conn.execute(
            sa.text("delete from role_permissions where permission_id = :permission_id"),
            {"permission_id": permission_id},
        )
        conn.execute(
            sa.text("delete from permissions where id = :permission_id"),
            {"permission_id": permission_id},
        )


def upgrade() -> None:
    op.create_table(
        "bank_accounts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("bank_name", sa.String(), nullable=False),
        sa.Column("account_number", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )
    op.create_index("ix_bank_accounts_organization_id", "bank_accounts", ["organization_id"])

    op.create_table(
        "daily_account_balances",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("balance_date", sa.Date(), nullable=False),
        sa.Column("organization_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("bank_account_id", UUID(as_uuid=True), sa.ForeignKey("bank_accounts.id"), nullable=False),
        sa.Column("amount", sa.Float(), nullable=False),
        sa.Column("created_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("updated_by_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("balance_date", "bank_account_id", name="uq_daily_account_balances_date_account"),
    )
    op.create_index("ix_daily_account_balances_date", "daily_account_balances", ["balance_date"])
    op.create_index("ix_daily_account_balances_org", "daily_account_balances", ["organization_id"])
    op.create_index("ix_daily_account_balances_bank_account_id", "daily_account_balances", ["bank_account_id"])

    conn = op.get_bind()
    _add_permissions(conn)


def downgrade() -> None:
    conn = op.get_bind()
    _remove_permissions(conn)

    op.drop_index("ix_daily_account_balances_bank_account_id", table_name="daily_account_balances")
    op.drop_index("ix_daily_account_balances_org", table_name="daily_account_balances")
    op.drop_index("ix_daily_account_balances_date", table_name="daily_account_balances")
    op.drop_table("daily_account_balances")

    op.drop_index("ix_bank_accounts_organization_id", table_name="bank_accounts")
    op.drop_table("bank_accounts")
