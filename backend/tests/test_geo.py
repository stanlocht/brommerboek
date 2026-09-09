from math import pi

import pytest

from app.geo import (
    EARTH_RADIUS_KM,
    haversine_km,
    leg_km,
    odometer_trusted,
    polyline_km,
)

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


# ----- polyline_km ------------------------------------------------------------


def test_polyline_km_sums_the_hops() -> None:
    # Two 1° hops along the equator.
    one_degree = 2 * pi * EARTH_RADIUS_KM / 360
    line = [[0.0, 0.0], [1.0, 0.0], [2.0, 0.0]]
    assert polyline_km(line) == pytest.approx(2 * one_degree, rel=1e-6)


def test_polyline_km_needs_two_points() -> None:
    assert polyline_km([]) is None
    assert polyline_km([[4.9, 52.4]]) is None


def test_polyline_km_rejects_malformed_geometry() -> None:
    # None, not 0.0: a track that lost its shape must fall through to the
    # next distance source rather than measure as a leg that wasn't ridden.
    assert polyline_km("nope") is None
    assert polyline_km([[0.0, 0.0], ["x", 1.0]]) is None
    assert polyline_km([[0.0, 0.0], [1.0]]) is None


# ----- odometer_trusted / leg_km ---------------------------------------------

# Rotterdam → Wortel-kolonie: ~62 km as the crow flies, ~86 km of real road.
CROW = 62.2
ROAD = 86.0


def test_odometer_trusted_accepts_any_forward_delta() -> None:
    assert odometer_trusted(CROW, 86.0)
    assert odometer_trusted(CROW, 1.0)


def test_odometer_trusted_rejects_a_stale_reading() -> None:
    # The bug this rule exists for: a reading copied from the previous stop
    # instead of re-read made a leg that was really ridden measure 0 km and
    # drop straight out of the trip total.
    assert not odometer_trusted(CROW, 0.0)


def test_odometer_trusted_rejects_a_reading_that_counts_down() -> None:
    assert not odometer_trusted(CROW, -60.0)


def test_odometer_trusted_accepts_a_still_dial_at_one_spot() -> None:
    # Two stops posted from the same place: nothing was ridden between them
    # and the unchanged reading is the truth.
    assert odometer_trusted(0.2, 0.0)
    assert not odometer_trusted(0.2, -5.0)


def test_odometer_trusted_rejects_a_missing_reading() -> None:
    assert not odometer_trusted(CROW, None)


def test_leg_km_prefers_a_believable_odometer_delta() -> None:
    assert leg_km(CROW, odometer_km=90.0, gps_km=ROAD) == 90.0


def test_leg_km_uses_the_ridden_road_when_the_reading_is_stale() -> None:
    assert leg_km(CROW, odometer_km=0.0, gps_km=ROAD) == ROAD


def test_leg_km_uses_the_ridden_road_when_the_reading_counts_down() -> None:
    assert leg_km(CROW, odometer_km=-60.0, gps_km=ROAD) == ROAD


def test_leg_km_uses_gps_when_no_reading_was_noted() -> None:
    assert leg_km(CROW, odometer_km=None, gps_km=ROAD) == ROAD


def test_leg_km_keeps_the_straight_line_when_the_track_is_shorter() -> None:
    # A track that doesn't span both pins under-measures the leg.
    assert leg_km(CROW, gps_km=10.0) == CROW


def test_leg_km_falls_back_to_the_straight_line() -> None:
    assert leg_km(CROW) == CROW
    assert leg_km(CROW, odometer_km=0.0, gps_km=None) == CROW


def test_leg_km_counts_no_kilometres_for_a_crossing() -> None:
    # The Cub stood on the boat deck: neither the sea miles between the two
    # ports nor the boat's GPS course were ridden.
    assert leg_km(CROW, ferry=True) == 0.0
    assert leg_km(CROW, gps_km=ROAD, ferry=True) == 0.0
    # A dial that stood still across the crossing is the truth here, not a
    # stale reading — and it says the same thing.
    assert leg_km(CROW, odometer_km=0.0, gps_km=ROAD, ferry=True) == 0.0


def test_leg_km_keeps_the_ride_to_the_port_on_a_ferry_leg() -> None:
    # Ports are rarely the pin: a reading that moved covers the road either
    # side of the crossing, and the rider's own dial is believed as ever.
    assert leg_km(CROW, odometer_km=40.0, gps_km=ROAD, ferry=True) == 40.0
