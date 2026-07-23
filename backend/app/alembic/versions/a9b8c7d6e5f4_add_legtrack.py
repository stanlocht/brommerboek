"""Add legtrack table (real ridden road per leg, synced from Traccar)

Revision ID: a9b8c7d6e5f4
Revises: f8a9b0c1d2e3
Create Date: 2026-07-23 22:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a9b8c7d6e5f4'
down_revision = 'f8a9b0c1d2e3'
branch_labels = None
depends_on = None


def upgrade():
    # Stop ids are deliberately not foreign keys: a track whose stops were
    # reordered or deleted is ignored at read time and replaced by the next
    # sync, instead of blocking the stop mutation.
    op.create_table(
        'legtrack',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('from_stop_id', sa.Uuid(), nullable=False),
        sa.Column('to_stop_id', sa.Uuid(), nullable=False),
        sa.Column('points', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_legtrack_from_stop_id'), 'legtrack', ['from_stop_id'], unique=False
    )
    op.create_index(
        op.f('ix_legtrack_to_stop_id'), 'legtrack', ['to_stop_id'], unique=True
    )


def downgrade():
    op.drop_index(op.f('ix_legtrack_to_stop_id'), table_name='legtrack')
    op.drop_index(op.f('ix_legtrack_from_stop_id'), table_name='legtrack')
    op.drop_table('legtrack')
