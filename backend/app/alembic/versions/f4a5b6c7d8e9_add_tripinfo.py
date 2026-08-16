"""Add tripinfo table (editable home-screen title), seeded with the default

Revision ID: f4a5b6c7d8e9
Revises: e3f4a5b6c7d8
Create Date: 2026-08-16 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f4a5b6c7d8e9'
down_revision = 'e3f4a5b6c7d8'
branch_labels = None
depends_on = None


def upgrade():
    tripinfo = op.create_table(
        'tripinfo',
        sa.Column('id', sa.String(length=16), nullable=False),
        sa.Column('title', sa.String(length=60), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    # Seed the title the header has carried so far; admins can rewrite it.
    op.bulk_insert(
        tripinfo,
        [{'id': 'trip', 'title': 'Van Mokum naar Marokko'}],
    )


def downgrade():
    op.drop_table('tripinfo')
