import threading
import time
from collections.abc import Callable
from datetime import datetime
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.core.config import settings
from app.core.ratelimit import rate_limit
from app.models import LiveLocation

router = APIRouter(prefix="/location", tags=["location"])

LOCATION_RATE_LIMIT = 60
LOCATION_RATE_WINDOW_SECONDS = 60

UPSTREAM_TIMEOUT_SECONDS = 5.0
# Every viewer polls; one Traccar call per interval serves them all.
CACHE_TTL_SECONDS = 30.0
KNOTS_TO_KMH = 1.852

# Injectable clock so tests can control the cache TTL.
now: Callable[[], float] = time.monotonic

_lock = threading.Lock()
# (fetched_at, location). Kept past its TTL: when Traccar is unreachable the
# last known fix is still the most useful answer a GPS endpoint can give.
_cache: tuple[float, LiveLocation] | None = None


def clear_cache() -> None:
    global _cache
    with _lock:
        _cache = None


def fetch_positions() -> Any:
    """Latest known position per device from the Traccar REST API."""
    # Kept as a seam: tests monkeypatch this instead of hitting the network.
    response = httpx.get(
        f"{settings.TRACCAR_BASE_URL.rstrip('/')}/api/positions",
        headers={"Authorization": f"Bearer {settings.TRACCAR_TOKEN}"},
        timeout=UPSTREAM_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()


def _parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def pick_position(positions: Any) -> dict[str, Any] | None:
    """The tracked device's entry from a Traccar /api/positions payload."""
    if not isinstance(positions, list):
        raise ValueError("positions payload is not a list")
    wanted = settings.TRACCAR_DEVICE_ID
    for pos in positions:
        if not isinstance(pos, dict):
            continue
        if wanted is None or pos.get("deviceId") == wanted:
            return pos
    return None


def to_live_location(pos: dict[str, Any]) -> LiveLocation:
    lat = pos["latitude"]
    lng = pos["longitude"]
    if not isinstance(lat, int | float) or not isinstance(lng, int | float):
        raise ValueError("position coordinates are not numeric")
    speed = pos.get("speed")  # Traccar reports knots
    attributes = pos.get("attributes")
    battery = (
        attributes.get("batteryLevel") if isinstance(attributes, dict) else None
    )
    return LiveLocation(
        lat=lat,
        lng=lng,
        speed_kmh=round(speed * KNOTS_TO_KMH, 1)
        if isinstance(speed, int | float)
        else None,
        course=pos.get("course")
        if isinstance(pos.get("course"), int | float)
        else None,
        battery=battery if isinstance(battery, int | float) else None,
        fix_time=_parse_time(pos.get("fixTime")),
    )


@router.get(
    "/live",
    response_model=LiveLocation,
    dependencies=[
        Depends(
            rate_limit(
                "location", LOCATION_RATE_LIMIT, LOCATION_RATE_WINDOW_SECONDS
            )
        )
    ],
)
def live_location() -> Any:
    """
    Last known position of the Cub, proxied from the Traccar server so its
    credentials stay on the backend. Public and read-only. Cached briefly so
    many viewers cost one upstream call; when Traccar is unreachable the last
    known fix is served instead. 404 when no tracker is configured or no fix
    exists yet, 503 when Traccar is down and nothing was ever cached.
    """
    global _cache
    if not settings.traccar_enabled:
        raise HTTPException(status_code=404, detail="live location not configured")
    current = now()
    with _lock:
        cached = _cache
    if cached and current - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]
    try:
        pos = pick_position(fetch_positions())
        if pos is None:
            raise HTTPException(status_code=404, detail="no position yet")
        location = to_live_location(pos)
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError, LookupError, TypeError):
        if cached:
            return cached[1]
        raise HTTPException(status_code=503, detail="gps service unavailable")
    with _lock:
        _cache = (current, location)
    return location
