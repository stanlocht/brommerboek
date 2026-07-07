"""Add index on comment.user_id

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-07-07 09:00:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'd0e1f2a3b4c5'
down_revision = 'c9d0e1f2a3b4'
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(op.f('ix_comment_user_id'), 'comment', ['user_id'], unique=False)


def downgrade():
    op.drop_index(op.f('ix_comment_user_id'), table_name='comment')
