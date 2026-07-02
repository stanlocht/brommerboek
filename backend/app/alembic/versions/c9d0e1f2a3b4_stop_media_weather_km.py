"""Stop: structured weather, nullable km, media URL/kind

Revision ID: c9d0e1f2a3b4
Revises: b7c8d9e0f1a2
Create Date: 2026-07-02 09:00:00.000000

Splits `stop.weather` (free text like "Zon, 17°") into `weather_temp:int|null`
plus `weather_condition:str`. Makes `stop.km` nullable so a rider can leave
it blank when they forgot to note it. Media items previously were placeholder
swatches — they gain `url` (path to the uploaded file) and `kind`
("image"/"video"); the old `video: bool` flag is folded into `kind`.

"""
import re

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op


# revision identifiers, used by Alembic.
revision = 'c9d0e1f2a3b4'
down_revision = 'b7c8d9e0f1a2'
branch_labels = None
depends_on = None


# Best-effort mapping from the Dutch free-text weather values used before
# this change onto the new condition codes.
_CONDITION_KEYWORDS = {
    "zon": "sunny",
    "helder": "sunny",
    "warm": "sunny",
    "halfbewolkt": "partly",
    "wolk": "cloudy",
    "bewolkt": "cloudy",
    "grijs": "cloudy",
    "regen": "rain",
    "bui": "rain",
    "onweer": "storm",
    "storm": "storm",
    "wind": "wind",
    "sneeuw": "snow",
    "mist": "fog",
    "koud": "cloudy",
}


def _parse_weather(text: str) -> tuple[int | None, str]:
    if not text:
        return None, ""
    lower = text.lower()
    condition = ""
    for keyword, code in _CONDITION_KEYWORDS.items():
        if keyword in lower:
            condition = code
            break
    match = re.search(r"-?\d+", text)
    temp = int(match.group()) if match else None
    return temp, condition


def upgrade():
    op.add_column("stop", sa.Column("weather_temp", sa.Integer(), nullable=True))
    op.add_column(
        "stop",
        sa.Column(
            "weather_condition",
            sqlmodel.sql.sqltypes.AutoString(length=16),
            nullable=False,
            server_default="",
        ),
    )

    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, weather FROM stop")).fetchall()
    for row in rows:
        temp, condition = _parse_weather(row.weather or "")
        bind.execute(
            sa.text(
                "UPDATE stop SET weather_temp = :temp, weather_condition = :cond "
                "WHERE id = :id"
            ),
            {"temp": temp, "cond": condition, "id": row.id},
        )

    op.drop_column("stop", "weather")
    op.alter_column("stop", "km", existing_type=sa.Integer(), nullable=True)

    # Rewrite each media item: fold the old `video: bool` into `kind`, add
    # a `url` slot (null until an upload lands).
    bind.execute(
        sa.text(
            """
            UPDATE stop
            SET media = COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'tone', COALESCE(item->>'tone', ''),
                            'cap', COALESCE(item->>'cap', ''),
                            'kind', CASE
                                WHEN (item->>'video')::boolean IS TRUE THEN 'video'
                                WHEN (item->>'kind') IS NOT NULL THEN item->>'kind'
                                ELSE 'image'
                            END,
                            'url', item->>'url'
                        )
                    )
                    FROM jsonb_array_elements(stop.media::jsonb) AS item
                ),
                '[]'::jsonb
            )::json
            """
        )
    )


def downgrade():
    bind = op.get_bind()
    op.add_column(
        "stop",
        sa.Column(
            "weather",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
            server_default="",
        ),
    )
    # Recompose a free-text label from the split fields so downgrade doesn't
    # silently lose the data.
    rows = bind.execute(
        sa.text("SELECT id, weather_temp, weather_condition FROM stop")
    ).fetchall()
    for row in rows:
        parts = []
        if row.weather_condition:
            parts.append(row.weather_condition)
        if row.weather_temp is not None:
            parts.append(f"{row.weather_temp}°")
        bind.execute(
            sa.text("UPDATE stop SET weather = :w WHERE id = :id"),
            {"w": ", ".join(parts), "id": row.id},
        )
    op.drop_column("stop", "weather_condition")
    op.drop_column("stop", "weather_temp")

    # Backfill km NULLs with 0 before making the column NOT NULL again.
    bind.execute(sa.text("UPDATE stop SET km = 0 WHERE km IS NULL"))
    op.alter_column("stop", "km", existing_type=sa.Integer(), nullable=False)

    # Restore the `video: bool` shape of media items.
    bind.execute(
        sa.text(
            """
            UPDATE stop
            SET media = COALESCE(
                (
                    SELECT jsonb_agg(
                        jsonb_build_object(
                            'tone', COALESCE(item->>'tone', ''),
                            'cap', COALESCE(item->>'cap', ''),
                            'video', (item->>'kind') = 'video'
                        )
                    )
                    FROM jsonb_array_elements(stop.media::jsonb) AS item
                ),
                '[]'::jsonb
            )::json
            """
        )
    )
