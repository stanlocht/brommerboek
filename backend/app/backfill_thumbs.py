"""Backfill thumbnails for media uploaded before thumbnails existed.

Walks every stop's media array, generates a `thumb_<name>.webp` next to
each original image that has none yet, and stores its URL on the item.
Idempotent — items that already carry a thumb (and videos, which never
get one) are skipped, so it is safe to re-run.

Usage (production box): docker compose exec backend python app/backfill_thumbs.py
"""

import logging
from pathlib import Path

from sqlmodel import Session, select

from app.core.db import engine
from app.core.media import MEDIA_ROOT, MEDIA_URL_PREFIX, generate_thumbnail
from app.models import Stop

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def backfill_thumbs(session: Session, media_root: Path = MEDIA_ROOT) -> int:
    """Generate missing thumbnails; returns how many were created."""
    created = 0
    for stop in session.exec(select(Stop)).all():
        media_items = list(stop.media or [])
        changed = False
        for i, item in enumerate(media_items):
            if not isinstance(item, dict):
                continue
            if item.get("kind") != "image" or item.get("thumb"):
                continue
            url = item.get("url")
            if not url or not url.startswith(f"{MEDIA_URL_PREFIX}/"):
                continue
            original = media_root / url[len(MEDIA_URL_PREFIX) + 1 :]
            if not original.is_file():
                logger.warning("Original missing on disk, skipping: %s", url)
                continue
            thumb_path = generate_thumbnail(original)
            if thumb_path is None:
                continue
            # Fresh dict + fresh list: mutating in place would compare equal
            # to the loaded value and SQLAlchemy would skip the UPDATE.
            media_items[i] = {
                **item,
                "thumb": f"{url.rsplit('/', 1)[0]}/{thumb_path.name}",
            }
            changed = True
            created += 1
        if changed:
            stop.media = media_items
            session.add(stop)
    session.commit()
    return created


def main() -> None:
    logger.info("Backfilling media thumbnails")
    with Session(engine) as session:
        created = backfill_thumbs(session)
    logger.info("Backfill done: %d thumbnail(s) created", created)


if __name__ == "__main__":
    main()
