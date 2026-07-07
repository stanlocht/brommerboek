from math import pi

import pytest

from app.geo import EARTH_RADIUS_KM, haversine_km

AMSTERDAM = (52.3676, 4.9041)
PARIS = (48.8566, 2.3522)
CINQUE_TERRE = (44.1350, 9.6845)


def test_zero_distance_for_same_point() -> None:
    assert haversine_km(AMSTERDAM, AMSTERDAM) == 0.0


def test_symmetric() -> None:
    assert haversine_km(AMSTERDAM, PARIS) == pytest.approx(
        haversine_km(PARIS, AMSTERDAM)
    )


def test_amsterdam_to_paris() -> None:
    # Known great-circle distance ≈ 430 km.
    assert haversine_km(AMSTERDAM, PARIS) == pytest.approx(430, rel=0.01)


def test_amsterdam_to_cinque_terre() -> None:
    # Roughly the seed trip as the crow flies ≈ 990 km.
    assert haversine_km(AMSTERDAM, CINQUE_TERRE) == pytest.approx(990, rel=0.02)


def test_one_degree_of_longitude_at_equator() -> None:
    # 1° of arc on a great circle = 2πR / 360.
    expected = 2 * pi * EARTH_RADIUS_KM / 360
    assert haversine_km((0.0, 0.0), (0.0, 1.0)) == pytest.approx(expected, rel=1e-6)


def test_antipodal_points() -> None:
    # Half the earth's circumference, and the asin argument is clamped so
    # floating point noise can't push it out of domain.
    expected = pi * EARTH_RADIUS_KM
    assert haversine_km((0.0, 0.0), (0.0, 180.0)) == pytest.approx(expected, rel=1e-6)


def test_poles() -> None:
    expected = pi * EARTH_RADIUS_KM  # pole to pole
    assert haversine_km((90.0, 0.0), (-90.0, 0.0)) == pytest.approx(expected, rel=1e-6)
