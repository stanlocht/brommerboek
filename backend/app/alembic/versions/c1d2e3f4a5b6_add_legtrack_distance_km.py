"""Add legtrack.distance_km (GPS-measured kilometres per leg)

Revision ID: c1d2e3f4a5b6
Revises: b0c1d2e3f4a5
Create Date: 2026-07-28 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c1d2e3f4a5b6'
down_revision = 'b0c1d2e3f4a5'
branch_labels = None
depends_on = None


def upgrade():
    # Nullable on purpose: rows synced before this field existed keep NULL
    # until the next /location/sync-tracks run backfills the measurement.
    op.add_column('legtrack', sa.Column('distance_km', sa.Float(), nullable=True))


def downgrade():
    op.drop_column('legtrack', 'distance_km')
