"""Delete duplicate stops left by double-submitted add flows

The add flow's submit button used to stay active while a create was in
flight, so extra taps created identical copies of a stop (same place, date,
coordinates and title, differing only in how many media uploads finished).
Per duplicate group, keep the copy with the most media — ties broken by
most reactions, then by earliest creation (order_index) — and delete the
rest. Comments and honks on deleted copies cascade away (FK ON DELETE
CASCADE); their media files on disk are NOT touched here (prestart has no
media volume) and simply become orphans.

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-07-22 19:00:00.000000

"""
import json

import sqlalchemy as sa
from alembic import op


# revision identifiers, used by Alembic.
revision = 'c4d5e6f7a8b9'
down_revision = 'b3c4d5e6f7a8'
branch_labels = None
depends_on = None


def _media_count(media) -> int:
    if isinstance(media, str):
        media = json.loads(media)
    return len(media or [])


def upgrade():
    conn = op.get_bind()
    rows = conn.execute(
        sa.text(
            "SELECT id, place, date, lat, lng, title, media, order_index "
            "FROM stop"
        )
    ).mappings().all()
    reactions: dict = {}
    for table in ("comment", "hornhonk"):
        counts = conn.execute(
            sa.text(f"SELECT stop_id, count(*) AS n FROM {table} GROUP BY stop_id")  # noqa: S608
        ).mappings()
        for r in counts:
            reactions[r["stop_id"]] = reactions.get(r["stop_id"], 0) + r["n"]

    groups: dict = {}
    for r in rows:
        key = (r["place"], str(r["date"]), r["lat"], r["lng"], r["title"])
        groups.setdefault(key, []).append(r)

    doomed = []
    for members in groups.values():
        if len(members) < 2:
            continue
        # order_index is date-ordered with creation order as tiebreaker
        # (see b3c4d5e6f7a8), so within a duplicate group it is creation
        # order — the lowest is the earliest upload.
        members.sort(
            key=lambda r: (
                -_media_count(r["media"]),
                -reactions.get(r["id"], 0),
                r["order_index"],
            )
        )
        doomed.extend(r["id"] for r in members[1:])

    for stop_id in doomed:
        conn.execute(sa.text("DELETE FROM stop WHERE id = :id"), {"id": stop_id})

    if doomed:
        # Close the order_index gaps the deletions left.
        conn.execute(
            sa.text(
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
        )


def downgrade():
    # Deleted rows are gone — there is nothing to restore.
    pass
