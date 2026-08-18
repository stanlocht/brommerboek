"""Add upload_id to comment (idempotency key for retried posts)

Revision ID: a5b6c7d8e9f0
Revises: f4a5b6c7d8e9
Create Date: 2026-08-18 10:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "a5b6c7d8e9f0"
down_revision = "f4a5b6c7d8e9"
branch_labels = None
depends_on = None


def upgrade():
    # Nullable on purpose: every comment posted before retrying existed has
    # no key, and NULL never matches the dedupe lookup — so old rows can't
    # accidentally swallow a new post. Indexed because that lookup runs on
    # every comment POST that carries a key.
    op.add_column(
        "comment", sa.Column("upload_id", sa.String(length=64), nullable=True)
    )
    op.create_index("ix_comment_upload_id", "comment", ["upload_id"])


def downgrade():
    op.drop_index("ix_comment_upload_id", table_name="comment")
    op.drop_column("comment", "upload_id")
