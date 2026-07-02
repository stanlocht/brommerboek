"""File storage for stop media (photos + short videos).

Files land on a local disk directory that the app also serves via
`StaticFiles`. For a personal, single-rider trip logbook this is the
smallest thing that works — one extra Docker volume, no object store to
run, back-ups are `rsync -a media/`. If it ever outgrows the disk, swap
the two functions below for an S3 client without touching the domain.
"""

from pathlib import Path

# Backend runs from `/app/backend/`; the media root lives at `/app/media`
# and is mounted as a Docker volume so uploads survive container rebuilds.
MEDIA_ROOT = Path(__file__).resolve().parents[2].parent / "media"
MEDIA_URL_PREFIX = "/media"

MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
