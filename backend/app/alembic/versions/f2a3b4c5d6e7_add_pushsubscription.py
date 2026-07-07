"""Add pushsubscription table for Web Push ("volg de reis")

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-07-07 12:00:00.000000

One row per browser push endpoint. `user_id` is nullable: anonymous
followers subscribe without an account; when set it cascades with the user.

"""
import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op

# revision identifiers, used by Alembic.
revision = 'f2a3b4c5d6e7'
down_revision = 'e1f2a3b4c5d6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'pushsubscription',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column(
            'endpoint', sqlmodel.sql.sqltypes.AutoString(length=1024), nullable=False
        ),
        sa.Column(
            'p256dh', sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False
        ),
        sa.Column(
            'auth', sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False
        ),
        sa.Column('user_id', sa.Uuid(), nullable=True),
        sa.Column('wants_reactions', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_pushsubscription_endpoint'),
        'pushsubscription',
        ['endpoint'],
        unique=True,
    )


def downgrade():
    op.drop_index(op.f('ix_pushsubscription_endpoint'), table_name='pushsubscription')
    op.drop_table('pushsubscription')
