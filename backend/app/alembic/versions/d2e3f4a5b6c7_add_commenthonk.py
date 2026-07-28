"""Add commenthonk table

Revision ID: d2e3f4a5b6c7
Revises: c1d2e3f4a5b6
Create Date: 2026-07-28 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'd2e3f4a5b6c7'
down_revision = 'c1d2e3f4a5b6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'commenthonk',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('comment_id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['comment_id'], ['comment.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('comment_id', 'user_id', name='uq_honk_comment_user'),
    )
    op.create_index(
        op.f('ix_commenthonk_comment_id'), 'commenthonk', ['comment_id'], unique=False
    )
    op.create_index(
        op.f('ix_commenthonk_user_id'), 'commenthonk', ['user_id'], unique=False
    )


def downgrade():
    op.drop_index(op.f('ix_commenthonk_user_id'), table_name='commenthonk')
    op.drop_index(op.f('ix_commenthonk_comment_id'), table_name='commenthonk')
    op.drop_table('commenthonk')
