"""Add comment and horn_honk tables

Revision ID: b7c8d9e0f1a2
Revises: a1b2c3d4e5f6
Create Date: 2026-07-01 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b7c8d9e0f1a2'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'comment',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('stop_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['stop_id'], ['stop.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_comment_stop_id'), 'comment', ['stop_id'], unique=False)

    op.create_table(
        'hornhonk',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('stop_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['stop_id'], ['stop.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('stop_id', 'user_id', name='uq_honk_stop_user'),
    )
    op.create_index(op.f('ix_hornhonk_stop_id'), 'hornhonk', ['stop_id'], unique=False)
    op.create_index(op.f('ix_hornhonk_user_id'), 'hornhonk', ['user_id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_hornhonk_user_id'), table_name='hornhonk')
    op.drop_index(op.f('ix_hornhonk_stop_id'), table_name='hornhonk')
    op.drop_table('hornhonk')
    op.drop_index(op.f('ix_comment_stop_id'), table_name='comment')
    op.drop_table('comment')
