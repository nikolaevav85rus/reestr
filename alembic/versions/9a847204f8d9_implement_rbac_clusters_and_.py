"""Implement RBAC Clusters and Substitutions

Revision ID: 9a847204f8d9
Revises: 692b91ac18be
Create Date: 2026-04-10 13:20:00.000000

"""
from typing import Sequence, Optional

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '9a847204f8d9'
down_revision: Optional[str] = '692b91ac18be'
branch_labels: Optional[Sequence[str]] = None
depends_on: Optional[Sequence[str]] = None


def upgrade() -> None:
    # --- 1. Создание новых таблиц ---
    op.create_table('clusters',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('head_id', sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(['head_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name')
    )
    op.create_table('permissions',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('label', sa.String(), nullable=False),
        sa.Column('category', sa.String(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name')
    )
    op.create_table('substitutions',
        sa.Column('id', sa.UUID(), nullable=False),
        sa.Column('absent_user_id', sa.UUID(), nullable=False),
        sa.Column('substitute_user_id', sa.UUID(), nullable=False),
        sa.Column('start_date', sa.DateTime(), nullable=False),
        sa.Column('end_date', sa.DateTime(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['absent_user_id'], ['users.id'], ),
        sa.ForeignKeyConstraint(['substitute_user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table('role_permissions',
        sa.Column('role_id', sa.UUID(), nullable=False),
        sa.Column('permission_id', sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(['permission_id'], ['permissions.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('role_id', 'permission_id')
    )

    # --- 2. Обновление существующих таблиц ---
    
    # Добавляем колонку в роли
    op.add_column('roles', sa.Column('is_superadmin', sa.Boolean(), nullable=True))
    
    # ИСПРАВЛЕННЫЙ БЛОК: конвертация is_active из String в Boolean с явным указанием USING
    op.alter_column('users', 'is_active',
               existing_type=sa.VARCHAR(),
               type_=sa.Boolean(),
               existing_nullable=True,
               postgresql_using='is_active::boolean'
    )

    # Обновление организаций
    op.add_column('organizations', sa.Column('cluster_id', sa.UUID(), nullable=True))
    op.add_column('organizations', sa.Column('director_id', sa.UUID(), nullable=True))
    op.create_foreign_key(None, 'organizations', 'clusters', ['cluster_id'], ['id'])
    op.create_foreign_key(None, 'organizations', 'users', ['director_id'], ['id'])


def downgrade() -> None:
    # Откат изменений в обратном порядке
    op.drop_constraint(None, 'organizations', type_='foreignkey')
    op.drop_constraint(None, 'organizations', type_='foreignkey')
    op.drop_column('organizations', 'director_id')
    op.drop_column('organizations', 'cluster_id')
    
    op.alter_column('users', 'is_active',
               existing_type=sa.Boolean(),
               type_=sa.VARCHAR(),
               existing_nullable=True,
               postgresql_using='is_active::text'
    )
    
    op.drop_column('roles', 'is_superadmin')
    op.drop_table('role_permissions')
    op.drop_table('substitutions')
    op.drop_table('permissions')
    op.drop_table('clusters')