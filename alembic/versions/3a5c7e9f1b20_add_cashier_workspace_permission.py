"""add cashier workspace permission

Revision ID: 3a5c7e9f1b20
Revises: 2f4b7c8d9e10
Create Date: 2026-04-22 00:00:00.000000
"""

from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa


revision: str = "3a5c7e9f1b20"
down_revision: Union[str, None] = "2f4b7c8d9e10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


PERMISSION_NAME = "cashier_workspace_view"


def _permission_id(conn):
    row = conn.execute(
        sa.text("select id from permissions where name = :name"),
        {"name": PERMISSION_NAME},
    ).first()
    if row:
        return row[0]

    new_id = str(uuid.uuid4())
    conn.execute(
        sa.text(
            """
            insert into permissions (id, name, label, category)
            values (:id, :name, :label, :category)
            """
        ),
        {
            "id": new_id,
            "name": PERMISSION_NAME,
            "label": "Рабочее пространство казначея",
            "category": "5. Видимость",
        },
    )
    return new_id


def upgrade() -> None:
    conn = op.get_bind()
    permission_id = _permission_id(conn)
    roles = conn.execute(
        sa.text("select id from roles where name in ('CASHIER', 'FEO')")
    ).fetchall()

    for role in roles:
        exists = conn.execute(
            sa.text(
                """
                select 1 from role_permissions
                where role_id = :role_id and permission_id = :permission_id
                """
            ),
            {"role_id": role[0], "permission_id": permission_id},
        ).first()
        if not exists:
            conn.execute(
                sa.text(
                    """
                    insert into role_permissions (role_id, permission_id)
                    values (:role_id, :permission_id)
                    """
                ),
                {"role_id": role[0], "permission_id": permission_id},
            )


def downgrade() -> None:
    conn = op.get_bind()
    permission_id = conn.execute(
        sa.text("select id from permissions where name = :name"),
        {"name": PERMISSION_NAME},
    ).scalar()
    if not permission_id:
        return

    conn.execute(
        sa.text("delete from role_permissions where permission_id = :permission_id"),
        {"permission_id": permission_id},
    )
    conn.execute(
        sa.text("delete from permissions where id = :permission_id"),
        {"permission_id": permission_id},
    )
