"""File storage for stop media (photos + short videos).

Files land on a local disk directory that the app also serves via
`StaticFiles`. For a personal, single-rider trip logbook this is the
smallest thing that works — one extra Docker volume, no object store to
run, back-ups are `rsync -a media/`. If it ever outgrows the disk, swap
the two functions below for an S3 client without touching the domain.
"""

import logging
from pathlib import Path

from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

# Backend runs from `/app/backend/`; the media root lives at `/app/media`
# and is mounted as a Docker volume so uploads survive container rebuilds.
MEDIA_ROOT = Path(__file__).resolve().parents[2].parent / "media"
MEDIA_URL_PREFIX = "/media"

MEDIA_ROOT.mkdir(parents=True, exist_ok=True)

# Thumbnails are pre-generated WebP files saved next to the original, so
# 64px preview slots and 280px gallery tiles never pull multi-MB camera
# files. Served as plain static files through the same /media mount.
THUMB_MAX_DIM = 640
THUMB_QUALITY = 80


def thumb_filename(filename: str) -> str:
    """`abc123.png` → `thumb_abc123.webp` (always WebP, whatever the source)."""
    return f"thumb_{Path(filename).stem}.webp"


def generate_thumbnail(original: Path) -> Path | None:
    """Write a WebP thumbnail next to `original` and return its path.

    Never raises — a thumbnail is nice-to-have, so any Pillow hiccup
    (corrupt file, exotic format) logs and returns None, leaving the
    upload itself intact.
    """
    dest = original.parent / thumb_filename(original.name)
    try:
        with Image.open(original) as img:
            # Bake the EXIF orientation in; phone photos are often stored
            # rotated with an orientation tag the <img> tag won't honour
            # once we re-encode.
            img = ImageOps.exif_transpose(img)
            img.thumbnail((THUMB_MAX_DIM, THUMB_MAX_DIM))
            img.save(dest, format="WEBP", quality=THUMB_QUALITY)
    except Exception:
        logger.exception("Thumbnail generation failed for %s", original)
        dest.unlink(missing_ok=True)
        return None
    return dest
