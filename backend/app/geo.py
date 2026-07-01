"""Great-circle geometry helpers shared by the trip aggregations."""

from math import asin, cos, radians, sin, sqrt

EARTH_RADIUS_KM = 6371.0


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
