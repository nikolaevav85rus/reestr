"""add excel export permission

Revision ID: 2f4b7c8d9e10
Revises: 1a84d220a035
Create Date: 2026-04-22 00:00:00.000000
"""

from typing import Sequence, Union
import uuid

from alembic import op
import sqlalchemy as sa


revision: str = "2f4b7c8d9e10"
down_revision: Union[str, None] = "1a84d220a035"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


PERMISSION_NAME = "req_export_excel"


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
            "label": "Выгрузка реестров в Excel",
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
