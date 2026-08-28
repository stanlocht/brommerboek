"""Add stop.ferry (the leg into this stop was a boat crossing)

Revision ID: a3b4c5d6e7f8
Revises: f4a5b6c7d8e9
Create Date: 2026-08-17 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a3b4c5d6e7f8'
down_revision = 'f4a5b6c7d8e9'
branch_labels = None
depends_on = None


def upgrade():
    # Every existing leg was ridden, so the server default backfills false;
    # it stays on the column so an INSERT that predates the field still works.
    op.add_column(
        'stop',
        sa.Column('ferry', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column('stop', 'ferry')
