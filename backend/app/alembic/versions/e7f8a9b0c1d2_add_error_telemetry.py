"""Add error telemetry tables (errorgroup + errorevent)

Revision ID: e7f8a9b0c1d2
Revises: c4d5e6f7a8b9
Create Date: 2026-07-22 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e7f8a9b0c1d2'
down_revision = 'c4d5e6f7a8b9'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'errorgroup',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('fingerprint', sa.String(length=64), nullable=False),
        sa.Column('source', sa.String(length=16), nullable=False),
        sa.Column('title', sa.String(length=500), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('event_count', sa.Integer(), nullable=False),
        sa.Column('issue_url', sa.String(length=512), nullable=True),
        sa.Column('first_seen', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_seen', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_errorgroup_fingerprint'), 'errorgroup', ['fingerprint'], unique=True
    )
    op.create_index(op.f('ix_errorgroup_status'), 'errorgroup', ['status'], unique=False)
    op.create_table(
        'errorevent',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('group_id', sa.Uuid(), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('stack', sa.Text(), nullable=False),
        sa.Column('url', sa.String(length=1024), nullable=False),
        sa.Column('context', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['group_id'], ['errorgroup.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_errorevent_group_id'), 'errorevent', ['group_id'], unique=False
    )


def downgrade():
    op.drop_index(op.f('ix_errorevent_group_id'), table_name='errorevent')
    op.drop_table('errorevent')
    op.drop_index(op.f('ix_errorgroup_status'), table_name='errorgroup')
    op.drop_index(op.f('ix_errorgroup_fingerprint'), table_name='errorgroup')
    op.drop_table('errorgroup')
