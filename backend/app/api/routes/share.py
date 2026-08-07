"""Per-stop share pages with Open Graph tags.

WhatsApp/Slack/social crawlers don't execute JS, so the SPA can never give a
pasted link a photo preview. `GET /s/{stop_id}` serves a tiny server-rendered
HTML page carrying the OG tags and immediately bounces humans (whose browsers
do run JS) to `/?stop={id}`, which the SPA restores to the stop's sheet.

Absolute URLs (og:url, og:image) are built on `settings.FRONTEND_HOST`: in
production Caddy serves the SPA, `/api/*`, `/media/*` and `/s/*` from the one
public origin, and FRONTEND_HOST is that origin — the server host settings
only know the internal container address.
"""

import html
import textwrap
import uuid

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

from app.api.deps import SessionDep
from app.core.config import settings
from app.models import Stop, pick_cover

# Not part of the versioned JSON API (and hidden from the OpenAPI schema):
# this route exists for link-preview crawlers, mounted at the root just like
# the /media static files.
router = APIRouter(tags=["share"], include_in_schema=False)

DESCRIPTION_LENGTH = 160


def _origin() -> str:
    return settings.FRONTEND_HOST.rstrip("/")


def _description(stop: Stop) -> str:
    # First ~160 chars of the story, whitespace collapsed; a story-less stop
    # falls back to its place line.
    collapsed = " ".join(stop.story.split())
    if not collapsed:
        return f"{stop.place}, {stop.country}"
    return textwrap.shorten(collapsed, width=DESCRIPTION_LENGTH, placeholder="…")


def _image_url(stop: Stop) -> str | None:
    # The stop's cover picture (the item the rider flagged, else the first one
    # with a file): prefer its thumbnail when one exists, else the full-size
    # url. Tone-swatch placeholders have neither.
    item = pick_cover(stop.media or [])
    url = (item.get("thumb") or item.get("url")) if item else None
    if not url:
        return None
    return url if url.startswith(("http://", "https://")) else _origin() + url


def _render(stop: Stop) -> str:
    # Everything interpolated below is user-authored — escape for both text
    # and attribute contexts (html.escape quotes by default).
    origin = _origin()
    title = html.escape(stop.title or stop.place)
    description = html.escape(_description(stop))
    url = html.escape(f"{origin}/s/{stop.id}")
    image = _image_url(stop)
    image_tag = (
        f'<meta property="og:image" content="{html.escape(image)}">' if image else ""
    )
    target = html.escape(f"/?stop={stop.id}")
    return f"""<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — Brommerboek</title>
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:type" content="article">
<meta property="og:url" content="{url}">
{image_tag}
<meta name="twitter:card" content="summary_large_image">
</head>
<body>
<script>location.replace("{target}")</script>
<noscript><a href="{target}">bekijk deze stop in het brommerboek</a></noscript>
</body>
</html>
"""


@router.get("/s/{stop_id}", response_class=HTMLResponse)
def share_stop(session: SessionDep, stop_id: str) -> HTMLResponse:
    """
    Server-rendered share page for a stop. Public — reads already are.
    """
    # Parse by hand so a mangled share link 404s like an unknown one instead
    # of returning a 422 JSON blob to a crawler.
    try:
        stop_uuid = uuid.UUID(stop_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Stop not found")
    stop = session.get(Stop, stop_uuid)
    if not stop:
        raise HTTPException(status_code=404, detail="Stop not found")
    return HTMLResponse(content=_render(stop))
