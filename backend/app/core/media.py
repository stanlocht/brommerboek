"""File storage for stop media (photos + short videos).

Files land on a local disk directory that the app also serves via
`StaticFiles`. For a personal, single-rider trip logbook this is the
smallest thing that works — one extra Docker volume, no object store to
run, back-ups are `rsync -a media/`. If it ever outgrows the disk, swap
the two functions below for an S3 client without touching the domain.
"""

import logging
from pathlib import Path, PurePosixPath

from PIL import Image, ImageOps
from pillow_heif import register_heif_opener  # type: ignore[import-untyped]

logger = logging.getLogger(__name__)

# Teach Pillow to open HEIC/HEIF. The frontend re-encodes camera photos to
# JPEG before uploading, but anything that skips that path (an older client,
# a browser whose canvas couldn't decode the source) still arrives as HEIC —
# and without a thumbnail the gallery falls back to the original, which no
# browser will render.
register_heif_opener()

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

# What an upload may be, and the extension we store it under. Shared by stop
# media and comment attachments — a clip a visitor films is the same kind of
# file as one the rider films.
ALLOWED_MEDIA_TYPES = {
    "image/jpeg": ("image", "jpg"),
    "image/png": ("image", "png"),
    "image/webp": ("image", "webp"),
    "image/gif": ("image", "gif"),
    "image/heic": ("image", "heic"),
    # Android cameras label the same container either way; without heif the
    # upload came back 415 and the photo was silently dropped.
    "image/heif": ("image", "heic"),
    "video/mp4": ("video", "mp4"),
    "video/quicktime": ("video", "mov"),
    "video/webm": ("video", "webm"),
    # Budget Android phones still record 3GPP by default.
    "video/3gpp": ("video", "3gp"),
}

# Content types that say "I don't know", as opposed to naming something we
# don't accept. Only for these do we look at the filename — a client that
# declares a real type is taken at its word, so a .png-named shell script
# still gets turned away.
UNKNOWN_MEDIA_TYPES = {"", "application/octet-stream", "binary/octet-stream"}

# Last resort when the browser sends no usable content type — some Android
# pickers hand the page a File with an empty or generic `type`, and the
# multipart part then carries nothing better.
EXT_MEDIA_TYPES = {
    ".jpg": ("image", "jpg"),
    ".jpeg": ("image", "jpg"),
    ".png": ("image", "png"),
    ".webp": ("image", "webp"),
    ".gif": ("image", "gif"),
    ".heic": ("image", "heic"),
    ".heif": ("image", "heic"),
    ".mp4": ("video", "mp4"),
    ".m4v": ("video", "mp4"),
    ".mov": ("video", "mov"),
    ".webm": ("video", "webm"),
    ".3gp": ("video", "3gp"),
}


def resolve_media_type(
    content_type: str | None, filename: str | None
) -> tuple[str, str] | None:
    """(kind, extension) for an upload, or None if we don't accept it."""
    declared = (content_type or "").strip().lower()
    if declared in ALLOWED_MEDIA_TYPES:
        return ALLOWED_MEDIA_TYPES[declared]
    if declared not in UNKNOWN_MEDIA_TYPES:
        return None
    if filename:
        return EXT_MEDIA_TYPES.get(PurePosixPath(filename).suffix.lower())
    return None


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
