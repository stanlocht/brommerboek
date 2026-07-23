"""Add mapflag table (start/finish flags), seeded Amsterdam -> Tanger

Revision ID: f8a9b0c1d2e3
Revises: e7f8a9b0c1d2
Create Date: 2026-07-23 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f8a9b0c1d2e3'
down_revision = 'e7f8a9b0c1d2'
branch_labels = None
depends_on = None


def upgrade():
    mapflag = op.create_table(
        'mapflag',
        sa.Column('kind', sa.String(length=16), nullable=False),
        sa.Column('lat', sa.Float(), nullable=False),
        sa.Column('lng', sa.Float(), nullable=False),
        sa.Column('label', sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint('kind'),
    )
    # Seed the trip's endpoints; admins can move them from the map later.
    op.bulk_insert(
        mapflag,
        [
            {'kind': 'start', 'lat': 52.3676, 'lng': 4.9041, 'label': 'Amsterdam'},
            {'kind': 'finish', 'lat': 35.7595, 'lng': -5.834, 'label': 'Tanger'},
        ],
    )


def downgrade():
    op.drop_table('mapflag')
