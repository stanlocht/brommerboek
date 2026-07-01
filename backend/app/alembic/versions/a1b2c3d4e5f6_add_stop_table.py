"""Add stop table for Brommerboek trip logger

Revision ID: a1b2c3d4e5f6
Revises: fe56fa70289e
Create Date: 2026-07-01 09:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
import sqlmodel.sql.sqltypes


# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = 'fe56fa70289e'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'stop',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('place', sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column('country', sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column('flag', sqlmodel.sql.sqltypes.AutoString(length=16), nullable=False),
        sa.Column('code', sqlmodel.sql.sqltypes.AutoString(length=8), nullable=False),
        sa.Column('lat', sa.Float(), nullable=False),
        sa.Column('lng', sa.Float(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('title', sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column('km', sa.Integer(), nullable=False),
        sa.Column('weather', sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False),
        sa.Column('type', sqlmodel.sql.sqltypes.AutoString(length=16), nullable=False),
        sa.Column('story', sa.Text(), nullable=False),
        sa.Column('broke', sa.Text(), nullable=True),
        sa.Column('fixed', sa.Text(), nullable=True),
        sa.Column('order_index', sa.Integer(), nullable=False),
        sa.Column('media', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_stop_order_index'), 'stop', ['order_index'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_stop_order_index'), table_name='stop')
    op.drop_table('stop')
