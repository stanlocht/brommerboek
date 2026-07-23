"""Resequence stop.order_index by date

Stops used to get their order_index from upload order, so a backdated stop
landed at the end of the route. Renumber existing rows by date (keeping the
old order_index as tiebreaker, so same-day stops keep their upload order).

Revision ID: b3c4d5e6f7a8
Revises: c5d6e7f8a9b0
Create Date: 2026-07-22 09:00:00.000000

"""
from alembic import op


# revision identifiers, used by Alembic.
revision = 'b3c4d5e6f7a8'
down_revision = 'c5d6e7f8a9b0'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        """
        WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER (ORDER BY date ASC, order_index ASC) - 1
                       AS new_index
            FROM stop
        )
        UPDATE stop
        SET order_index = ranked.new_index
        FROM ranked
        WHERE stop.id = ranked.id
        """
    )


def downgrade():
    # The pre-migration upload order approximates created_at; restore that.
    op.execute(
        """
        WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER (ORDER BY created_at ASC, order_index ASC) - 1
                       AS new_index
            FROM stop
        )
        UPDATE stop
        SET order_index = ranked.new_index
        FROM ranked
        WHERE stop.id = ranked.id
        """
    )
