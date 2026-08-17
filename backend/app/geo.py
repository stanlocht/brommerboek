"""Great-circle geometry helpers shared by the trip aggregations."""

from math import asin, cos, radians, sin, sqrt
from typing import Any

EARTH_RADIUS_KM = 6371.0

# Stops nearer to each other than this count as the same spot, where an
# odometer that hasn't moved is a true reading rather than a stale one.
SAME_PLACE_KM = 1.0


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance between two (lat, lng) points in kilometres."""
    lat1, lng1 = a
    lat2, lng2 = b
    d_lat = radians(lat2 - lat1)
    d_lng = radians(lng2 - lng1)
    h = (
        sin(d_lat / 2) ** 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lng / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * asin(min(1.0, sqrt(h)))


def polyline_km(points: Any) -> float | None:
    """Length of a `[[lng, lat], ...]` polyline in kilometres.

    None when the value isn't a usable line — a stored track that lost its
    shape should fall back to the next distance source, not measure as 0.
    """
    if not isinstance(points, list) or len(points) < 2:
        return None
    total = 0.0
    previous: tuple[float, float] | None = None
    for point in points:
        if not isinstance(point, list | tuple) or len(point) < 2:
            return None
        lng, lat = point[0], point[1]
        if not isinstance(lng, int | float) or not isinstance(lat, int | float):
            return None
        current = (float(lat), float(lng))
        if previous is not None:
            total += haversine_km(previous, current)
        previous = current
    return total


def odometer_trusted(crow_km: float, odometer_km: float | None) -> bool:
    """Whether a leg's pair of odometer readings is a real measurement.

    Riding between two places always moves the dial forward, so a delta that
    stands still or counts down is a data-entry failure, not a leg that
    wasn't ridden: the reading was copied from the previous stop, or a digit
    was transposed. Taken at face value a 0 km delta erases the whole leg
    from the trip total. Between two stops at the same spot, though, a dial
    that hasn't moved is exactly right.
    """
    if odometer_km is None:
        return False
    if odometer_km > 0:
        return True
    return odometer_km == 0 and crow_km <= SAME_PLACE_KM


def leg_km(
    crow_km: float,
    *,
    odometer_km: float | None = None,
    gps_km: float | None = None,
    ferry: bool = False,
) -> float:
    """Kilometres ridden on one leg, from the most trustworthy usable source.

    The rider's odometer delta wins when both stops carry a believable
    reading, the GPS-measured road fills in when they don't, and the straight
    line between the two pins is the last resort. A track measuring less than
    that straight line never spanned the leg, so it is passed over too.

    A ferry leg was crossed, not ridden: the dial stands still on the boat, so
    without a reading of its own the crossing adds nothing to the trip's
    kilometres — neither the sea miles between the two ports nor the GPS
    track, which recorded the boat's course rather than a road.
    """
    if odometer_km is not None and odometer_trusted(crow_km, odometer_km):
        return odometer_km
    if ferry:
        return 0.0
    if gps_km is not None and gps_km >= crow_km:
        return gps_km
    return crow_km
