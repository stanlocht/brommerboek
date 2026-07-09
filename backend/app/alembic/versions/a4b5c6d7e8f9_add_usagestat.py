"""Add usagestat table for daily request counters

Revision ID: a4b5c6d7e8f9
Revises: f2a3b4c5d6e7
Create Date: 2026-07-09 12:00:00.000000

One row per (UTC day, bucket) — buckets are coarse ("stops:read",
"media:read", ...), so the table grows by a handful of rows per day.
Workers flush additively (count = count + n), see app/core/usage.py.

"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision = 'a4b5c6d7e8f9'
down_revision = 'f2a3b4c5d6e7'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'usagestat',
        sa.Column('day', sa.Date(), nullable=False),
        sa.Column(
            'bucket', sqlmodel.sql.sqltypes.AutoString(length=48), nullable=False
        ),
        sa.Column('count', sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint('day', 'bucket'),
    )


def downgrade():
    op.drop_table('usagestat')
