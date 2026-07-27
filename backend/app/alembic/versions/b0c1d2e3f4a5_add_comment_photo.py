"""Add photo + photo_thumb columns to comment (photo attachments)

Revision ID: b0c1d2e3f4a5
Revises: a9b8c7d6e5f4
Create Date: 2026-07-27 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b0c1d2e3f4a5'
down_revision = 'a9b8c7d6e5f4'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'comment', sa.Column('photo', sa.String(length=512), nullable=True)
    )
    op.add_column(
        'comment', sa.Column('photo_thumb', sa.String(length=512), nullable=True)
    )


def downgrade():
    op.drop_column('comment', 'photo_thumb')
    op.drop_column('comment', 'photo')
