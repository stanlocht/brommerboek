import logging
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.config import settings
from app.core.ratelimit import rate_limit
from app.models import LiveLocation, LiveTrail, LiveTrailPoint

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/location", tags=["location"])

LOCATION_RATE_LIMIT = 60
LOCATION_RATE_WINDOW_SECONDS = 60

UPSTREAM_TIMEOUT_SECONDS = 5.0
# Every viewer polls; one Traccar call per interval serves them all.
CACHE_TTL_SECONDS = 30.0
KNOTS_TO_KMH = 1.852

# The breadcrumb trail: how far back it reaches, how often it refreshes and
# how many points survive decimation. A day of riding at trail resolution is
# plenty for "waar reed de brommer vandaag?"; the 5-minute cache keeps the
# heavier history query rare.
TRAIL_DEFAULT_HOURS = 24
TRAIL_MAX_HOURS = 48
TRAIL_CACHE_TTL_SECONDS = 300.0
TRAIL_MAX_POINTS = 400

# Injectable clocks so tests can control the cache TTLs and the trail window.
now: Callable[[], float] = time.monotonic
utcnow: Callable[[], datetime] = lambda: datetime.now(UTC)

_lock = threading.Lock()
# (fetched_at, location). Kept past its TTL: when Traccar is unreachable the
# last known fix is still the most useful answer a GPS endpoint can give.
_cache: tuple[float, LiveLocation] | None = None
# Per-hours-window trail cache, same keep-past-TTL fallback rationale.
_trail_cache: dict[int, tuple[float, LiveTrail]] = {}


def clear_cache() -> None:
    global _cache
    with _lock:
        _cache = None
        _trail_cache.clear()


def traccar_url() -> str:
    """Full positions URL; tolerates a base configured without a scheme."""
    base = settings.TRACCAR_BASE_URL.strip().rstrip("/")
    if not base.startswith(("http://", "https://")):
        base = f"https://{base}"
    return f"{base}/api/positions"


def fetch_positions() -> Any:
    """Latest known position per device from the Traccar REST API."""
    # Kept as a seam: tests monkeypatch this instead of hitting the network.
    response = httpx.get(
        traccar_url(),
        headers={"Authorization": f"Bearer {settings.TRACCAR_TOKEN}"},
        timeout=UPSTREAM_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()


def fetch_history(device_id: int, start: datetime, end: datetime) -> Any:
    """Stored positions for one device over [start, end] from Traccar."""
    # Kept as a seam: tests monkeypatch this instead of hitting the network.
    response = httpx.get(
        traccar_url(),
        params={
            "deviceId": device_id,
            "from": start.isoformat().replace("+00:00", "Z"),
            "to": end.isoformat().replace("+00:00", "Z"),
        },
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


def to_trail_point(pos: dict[str, Any]) -> LiveTrailPoint | None:
    """A breadcrumb from a stored position; None for junk entries."""
    lat = pos.get("latitude")
    lng = pos.get("longitude")
    if not isinstance(lat, int | float) or not isinstance(lng, int | float):
        return None
    return LiveTrailPoint(lat=lat, lng=lng, fix_time=_parse_time(pos.get("fixTime")))


def decimate(points: list[LiveTrailPoint], max_points: int) -> list[LiveTrailPoint]:
    """Thin an ordered trail to at most ~max_points, always keeping the ends."""
    if len(points) <= max_points:
        return points
    stride = -(-len(points) // max_points)
    sampled = points[::stride]
    if sampled[-1] is not points[-1]:
        sampled.append(points[-1])
    return sampled


def resolve_device_id() -> int:
    """The tracked device's id, from config or the latest-positions payload."""
    if settings.TRACCAR_DEVICE_ID is not None:
        return settings.TRACCAR_DEVICE_ID
    pos = pick_position(fetch_positions())
    if pos is None:
        raise HTTPException(status_code=404, detail="no position yet")
    device_id = pos.get("deviceId")
    if not isinstance(device_id, int):
        raise ValueError("position carries no usable deviceId")
    return device_id


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
    except (httpx.HTTPError, ValueError, LookupError, TypeError) as exc:
        # The 503 hides the cause from the public; the log keeps it. A
        # status error also notes the upstream body's start — Traccar 401s
        # and login-page HTML both identify themselves there.
        detail = ""
        if isinstance(exc, httpx.HTTPStatusError):
            detail = f" body: {exc.response.text[:200]!r}"
        logger.warning("traccar fetch failed: %r%s", exc, detail)
        if cached:
            return cached[1]
        raise HTTPException(status_code=503, detail="gps service unavailable")
    with _lock:
        _cache = (current, location)
    return location


@router.get(
    "/trail",
    response_model=LiveTrail,
    dependencies=[
        Depends(
            rate_limit(
                "location", LOCATION_RATE_LIMIT, LOCATION_RATE_WINDOW_SECONDS
            )
        )
    ],
)
def live_trail(
    hours: int = Query(default=TRAIL_DEFAULT_HOURS, ge=1, le=TRAIL_MAX_HOURS),
) -> Any:
    """
    Recent GPS breadcrumbs of the Cub: the stored Traccar positions of the
    last `hours` hours, thinned to a drawable trail. Public and read-only,
    same error contract as /live — 404 unconfigured or no fix yet, 503 when
    Traccar is down and no earlier trail was cached for this window.
    """
    if not settings.traccar_enabled:
        raise HTTPException(status_code=404, detail="live location not configured")
    current = now()
    with _lock:
        cached = _trail_cache.get(hours)
    if cached and current - cached[0] < TRAIL_CACHE_TTL_SECONDS:
        return cached[1]
    try:
        device_id = resolve_device_id()
        end = utcnow()
        raw = fetch_history(device_id, end - timedelta(hours=hours), end)
        if not isinstance(raw, list):
            raise ValueError("history payload is not a list")
        points = [
            point
            for entry in raw
            if isinstance(entry, dict)
            for point in [to_trail_point(entry)]
            if point is not None
        ]
        floor = datetime.min.replace(tzinfo=UTC)
        points.sort(key=lambda p: p.fix_time or floor)
        trail = LiveTrail(points=decimate(points, TRAIL_MAX_POINTS))
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError, LookupError, TypeError) as exc:
        detail = ""
        if isinstance(exc, httpx.HTTPStatusError):
            detail = f" body: {exc.response.text[:200]!r}"
        logger.warning("traccar history fetch failed: %r%s", exc, detail)
        if cached:
            return cached[1]
        raise HTTPException(status_code=503, detail="gps service unavailable")
    with _lock:
        _trail_cache[hours] = (current, trail)
    return trail
