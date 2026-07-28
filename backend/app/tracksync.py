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
from app.models import LegTrack, LegTrackSyncResult, RiddenSince, Stop

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


def parse_history(
    history: Any,
) -> list[tuple[datetime | None, float, float, float | None]]:
    """Usable (fix_time, lat, lng, total_distance_m) entries, oldest first.

    `total_distance_m` is Traccar's cumulative odometer attribute when the
    position carries one — the most accurate GPS distance source available.
    """
    if not isinstance(history, list):
        raise ValueError("history payload is not a list")
    entries = []
    for pos in history:
        if not isinstance(pos, dict):
            continue
        lat = pos.get("latitude")
        lng = pos.get("longitude")
        if not isinstance(lat, int | float) or not isinstance(lng, int | float):
            continue
        attrs = pos.get("attributes")
        total = attrs.get("totalDistance") if isinstance(attrs, dict) else None
        if not isinstance(total, int | float):
            total = None
        entries.append((location._parse_time(pos.get("fixTime")), lat, lng, total))
    floor = datetime.min.replace(tzinfo=UTC)
    entries.sort(key=lambda e: e[0] or floor)
    return entries


def slice_km(
    entries: list[tuple[datetime | None, float, float, float | None]],
    i0: int,
    i1: int,
) -> float:
    """Kilometres ridden over entries[i0..i1].

    Prefers the delta of Traccar's cumulative `totalDistance`: it counts the
    road even through gaps in the stored points. Falls back to summing the
    haversine hops between points when either end lacks the attribute — or
    when the delta is negative (tracker odometer reset mid-window).
    """
    d0 = entries[i0][3]
    d1 = entries[i1][3]
    if d0 is not None and d1 is not None and d1 >= d0:
        return (d1 - d0) / 1000.0
    total = 0.0
    for j in range(i0, i1):
        _, lat_a, lng_a, _ = entries[j]
        _, lat_b, lng_b, _ = entries[j + 1]
        total += haversine_km((lat_a, lng_a), (lat_b, lng_b))
    return total


def build_leg(
    history: Any, from_stop: Stop, to_stop: Stop
) -> tuple[list[list[float]], float] | None:
    """The leg polyline and its ridden kilometres from a Traccar history
    payload; None when unusable.

    None covers legs that predate the tracker (no history), and windows where
    the track never runs origin→destination (e.g. the tracker was off). The
    distance is measured on the full-resolution slice, before decimation.
    """
    entries = parse_history(history)
    coords = [[lng, lat] for _, lat, lng, _ in entries]
    if len(coords) < 2:
        return None
    i0 = nearest_index(coords, from_stop.lat, from_stop.lng)
    i1 = nearest_index(coords, to_stop.lat, to_stop.lng)
    if i1 <= i0:
        return None
    points = location.decimate(coords[i0 : i1 + 1], MAX_LEG_POINTS)
    return points, slice_km(entries, i0, i1)


def sync_leg(session: Session, from_stop: Stop, to_stop: Stop) -> bool:
    """Fetch, slice and upsert one leg's track. True when a track was stored."""
    device_id = location.resolve_device_id()
    start, end = leg_window(from_stop.date, to_stop.date)
    leg = build_leg(location.fetch_history(device_id, start, end), from_stop, to_stop)
    if leg is None:
        return False
    points, distance_km = leg
    row = session.exec(
        select(LegTrack).where(LegTrack.to_stop_id == to_stop.id)
    ).first()
    if row is None:
        row = LegTrack(from_stop_id=from_stop.id, to_stop_id=to_stop.id, points=points)
    else:
        row.from_stop_id = from_stop.id
        row.points = points
    row.distance_km = round(distance_km, 1)
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
        # A row without a distance predates the distance field — treat it as
        # missing so a plain sync backfills the measurement.
        if (
            only_missing
            and row is not None
            and row.from_stop_id == prev.id
            and row.distance_km is not None
        ):
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


def ridden_since_last_stop(session: Session) -> RiddenSince | None:
    """Kilometres ridden since the route's latest stop, live from Traccar.

    The start point borrows the leg-slicing trick: fetch history from the
    stop's day onward and cut at the point nearest the stop's pin — in
    practice where the Cub was parked at that stop. Everything after that
    point is the current leg so far. Preparation posts don't anchor the
    route, so the latest non-preparation stop is used. None when the trip
    has no stops yet; a window with no usable track measures 0 km.
    """
    stops = [s for s in _ordered_stops(session) if s.type != "preparation"]
    if not stops:
        return None
    last = stops[-1]
    device_id = location.resolve_device_id()
    start = datetime.combine(last.date, time.min, tzinfo=UTC)
    entries = parse_history(
        location.fetch_history(device_id, start, location.utcnow())
    )
    coords = [[lng, lat] for _, lat, lng, _ in entries]
    if len(coords) < 2:
        return RiddenSince(km=0.0, from_stop_id=last.id)
    i0 = nearest_index(coords, last.lat, last.lng)
    last_i = len(entries) - 1
    km = slice_km(entries, i0, last_i) if i0 < last_i else 0.0
    return RiddenSince(
        km=round(km, 1), from_stop_id=last.id, fix_time=entries[last_i][0]
    )


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
