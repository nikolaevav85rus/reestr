"""direction_categories: add table, add category_id to directions, drop parent_id

Revision ID: h3i4j5k6l7m8
Revises: 15e1677e6c50
Create Date: 2026-04-17
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = 'h3i4j5k6l7m8'
down_revision = '15e1677e6c50'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'direction_categories',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('name', sa.String(), nullable=False, unique=True),
    )
    op.drop_constraint('directions_parent_id_fkey', 'directions', type_='foreignkey')
    op.drop_column('directions', 'parent_id')
    op.add_column('directions',
        sa.Column('category_id', UUID(as_uuid=True),
                  sa.ForeignKey('direction_categories.id'), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('directions', 'category_id')
    op.add_column('directions',
        sa.Column('parent_id', UUID(as_uuid=True), nullable=True)
    )
    op.create_foreign_key('directions_parent_id_fkey', 'directions', 'directions', ['parent_id'], ['id'])
    op.drop_table('direction_categories')
