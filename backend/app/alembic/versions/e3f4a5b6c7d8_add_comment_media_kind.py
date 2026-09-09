"""Add media_kind column to comment (photo or video attachments)

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-08-12 10:00:00.000000

"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "e3f4a5b6c7d8"
down_revision = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None


def upgrade():
    # Every attachment that predates video comments is a photo, so backfill
    # with the server default and then drop it — the model supplies the
    # value from here on.
    op.add_column(
        "comment",
        sa.Column(
            "media_kind",
            sa.String(length=16),
            nullable=False,
            server_default="image",
        ),
    )
    op.alter_column("comment", "media_kind", server_default=None)


def downgrade():
    op.drop_column("comment", "media_kind")
