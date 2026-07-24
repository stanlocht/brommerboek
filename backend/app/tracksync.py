"""Sync the real ridden road per leg from Traccar's position history.

A leg is the ride between two consecutive stops. The stop pins are
hand-picked places (roughly "somewhere in that city"), so matching works in
two passes: the stops' *dates* bound the Traccar history window for the leg,
then the exact split points are the track points nearest to each pin — in
practice where the tracker sat still, i.e. where the rider actually stopped.
Pins are never moved; the road line simply passes close by them.
"""

import logging
import uuid
from datetime import UTC, datetime, time, timedelta
from typing import Any

from sqlmodel import Session, col, select

from app.api.routes import location
from app.core.config import settings
from app.core.db import engine
from app.geo import haversine_km
from app.models import LegTrack, LegTrackSyncResult, Stop

logger = logging.getLogger(__name__)

# Enough for road-level curves on a multi-day leg without bloating the JSON.
MAX_LEG_POINTS = 500


def leg_window(from_date: Any, to_date: Any) -> tuple[datetime, datetime]:
    """UTC history window for a leg: start of the from-day to end of the to-day.

    Stop dates are day-granular, so the window is inclusive on both sides;
    the nearest-to-pin refinement trims the surplus riding of those days.
    """
    start = datetime.combine(from_date, time.min, tzinfo=UTC)
    end = datetime.combine(to_date, time.min, tzinfo=UTC) + timedelta(days=1)
    return start, end


def nearest_index(coords: list[list[float]], lat: float, lng: float) -> int:
    """Index of the [lng, lat] coordinate closest to the given pin."""
    best = 0
    best_km = float("inf")
    for i, (plng, plat) in enumerate(coords):
        km = haversine_km((lat, lng), (plat, plng))
        if km < best_km:
            best_km = km
            best = i
    return best


def build_leg(
    history: Any, from_stop: Stop, to_stop: Stop
) -> list[list[float]] | None:
    """The leg polyline from a Traccar history payload; None when unusable.

    None covers legs that predate the tracker (no history), and windows where
    the track never runs origin→destination (e.g. the tracker was off).
    """
    if not isinstance(history, list):
        raise ValueError("history payload is not a list")
    entries = [
        (location._parse_time(pos.get("fixTime")), pos["latitude"], pos["longitude"])
        for pos in history
        if isinstance(pos, dict)
        and isinstance(pos.get("latitude"), int | float)
        and isinstance(pos.get("longitude"), int | float)
    ]
    floor = datetime.min.replace(tzinfo=UTC)
    entries.sort(key=lambda e: e[0] or floor)
    coords = [[lng, lat] for _, lat, lng in entries]
    if len(coords) < 2:
        return None
    i0 = nearest_index(coords, from_stop.lat, from_stop.lng)
    i1 = nearest_index(coords, to_stop.lat, to_stop.lng)
    if i1 <= i0:
        return None
    return location.decimate(coords[i0 : i1 + 1], MAX_LEG_POINTS)


def sync_leg(session: Session, from_stop: Stop, to_stop: Stop) -> bool:
    """Fetch, slice and upsert one leg's track. True when a track was stored."""
    device_id = location.resolve_device_id()
    start, end = leg_window(from_stop.date, to_stop.date)
    points = build_leg(location.fetch_history(device_id, start, end), from_stop, to_stop)
    if points is None:
        return False
    row = session.exec(
        select(LegTrack).where(LegTrack.to_stop_id == to_stop.id)
    ).first()
    if row is None:
        row = LegTrack(from_stop_id=from_stop.id, to_stop_id=to_stop.id, points=points)
    else:
        row.from_stop_id = from_stop.id
        row.points = points
    session.add(row)
    session.commit()
    return True


def _ordered_stops(session: Session) -> list[Stop]:
    return list(session.exec(select(Stop).order_by(col(Stop.order_index).asc())))


def sync_all(session: Session, only_missing: bool = True) -> LegTrackSyncResult:
    """Sync every leg (or only legs without a current track). Never raises —
    a leg that errors is counted and logged so one bad window can't stall
    the backfill."""
    existing = {
        row.to_stop_id: row for row in session.exec(select(LegTrack)).all()
    }
    synced = skipped = failed = 0
    stops = _ordered_stops(session)
    for prev, cur in zip(stops, stops[1:], strict=False):
        row = existing.get(cur.id)
        if only_missing and row is not None and row.from_stop_id == prev.id:
            skipped += 1
            continue
        try:
            if sync_leg(session, prev, cur):
                synced += 1
            else:
                skipped += 1
        except Exception:
            failed += 1
            logger.warning(
                "leg sync %s → %s failed", prev.place, cur.place, exc_info=True
            )
    return LegTrackSyncResult(synced=synced, skipped=skipped, failed=failed)


def sync_for_stop(stop_id: uuid.UUID) -> None:
    """Background task after a stop is created: sync the legs around it.

    A backdated stop slots mid-route and splits an existing leg, so both the
    incoming and the outgoing leg are (re)synced. Runs after the response on
    its own session; failures only log — posting a stop must never break on
    a GPS hiccup.
    """
    if not settings.traccar_enabled:
        return
    with Session(engine) as session:
        stops = _ordered_stops(session)
        idx = next((i for i, s in enumerate(stops) if s.id == stop_id), None)
        if idx is None:
            return
        pairs = []
        if idx > 0:
            pairs.append((stops[idx - 1], stops[idx]))
        if idx < len(stops) - 1:
            pairs.append((stops[idx], stops[idx + 1]))
        for a, b in pairs:
            try:
                sync_leg(session, a, b)
            except Exception:
                logger.warning(
                    "leg sync %s → %s failed", a.place, b.place, exc_info=True
                )
