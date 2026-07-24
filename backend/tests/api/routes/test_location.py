from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api.routes import location
from app.api.routes.location import (
    CACHE_TTL_SECONDS,
    LOCATION_RATE_LIMIT,
    TRAIL_CACHE_TTL_SECONDS,
    TRAIL_MAX_POINTS,
    decimate,
    pick_position,
    to_live_location,
    to_trail_point,
    traccar_url,
)
from app.core.config import settings
from app.models import LiveTrailPoint

LIVE_URL = f"{settings.API_V1_STR}/location/live"
TRAIL_URL = f"{settings.API_V1_STR}/location/trail"

TRACCAR_URL = "https://traccar.example.com"


def _position(
    device_id: int = 7,
    lat: float = 43.77,
    lng: float = 7.49,
    speed_knots: float | None = 10.0,
    fix_time: str | None = "2026-07-20T14:30:00.000+00:00",
    **extra: Any,
) -> dict[str, Any]:
    pos: dict[str, Any] = {
        "deviceId": device_id,
        "latitude": lat,
        "longitude": lng,
        "course": 90.0,
        "attributes": {"batteryLevel": 84},
        **extra,
    }
    if speed_knots is not None:
        pos["speed"] = speed_knots
    if fix_time is not None:
        pos["fixTime"] = fix_time
    return pos


@pytest.fixture(autouse=True)
def _traccar_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "TRACCAR_BASE_URL", TRACCAR_URL)
    monkeypatch.setattr(settings, "TRACCAR_TOKEN", "secret-token")
    monkeypatch.setattr(settings, "TRACCAR_DEVICE_ID", None)
    location.clear_cache()


def _mock_fetch(monkeypatch: pytest.MonkeyPatch, payload: Any) -> list[int]:
    """Replace the Traccar call, counting upstream requests."""
    calls: list[int] = []

    def fake_fetch() -> Any:
        calls.append(1)
        return payload

    monkeypatch.setattr(location, "fetch_positions", fake_fetch)
    return calls


# ----- URL building ------------------------------------------------------------


def test_traccar_url_tolerates_missing_scheme_and_trailing_slash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for base, expected in (
        ("https://gps.example.com", "https://gps.example.com/api/positions"),
        ("https://gps.example.com/", "https://gps.example.com/api/positions"),
        ("http://gps.example.com:8082", "http://gps.example.com:8082/api/positions"),
        # A base configured without a scheme gets https, not an error.
        ("gps.example.com", "https://gps.example.com/api/positions"),
        (" gps.example.com/ ", "https://gps.example.com/api/positions"),
    ):
        monkeypatch.setattr(settings, "TRACCAR_BASE_URL", base)
        assert traccar_url() == expected, base


# ----- Position parsing --------------------------------------------------------


def test_to_live_location_converts_knots_and_reads_attributes() -> None:
    loc = to_live_location(_position(speed_knots=10.0))
    assert loc.lat == 43.77
    assert loc.lng == 7.49
    assert loc.speed_kmh == 18.5
    assert loc.course == 90.0
    assert loc.battery == 84
    assert loc.fix_time is not None
    assert loc.fix_time.isoformat() == "2026-07-20T14:30:00+00:00"


def test_to_live_location_tolerates_missing_optionals() -> None:
    loc = to_live_location(
        {"latitude": 1.0, "longitude": 2.0, "fixTime": "not-a-date"}
    )
    assert loc.speed_kmh is None
    assert loc.course is None
    assert loc.battery is None
    assert loc.fix_time is None


def test_to_live_location_rejects_non_numeric_coordinates() -> None:
    with pytest.raises((ValueError, LookupError, TypeError)):
        to_live_location({"latitude": "x", "longitude": 2.0})
    with pytest.raises((ValueError, LookupError, TypeError)):
        to_live_location({"longitude": 2.0})


def test_pick_position_prefers_configured_device(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "TRACCAR_DEVICE_ID", 9)
    positions = [_position(device_id=7), _position(device_id=9, lat=50.0)]
    picked = pick_position(positions)
    assert picked is not None
    assert picked["deviceId"] == 9

    # Unset, the first device wins.
    monkeypatch.setattr(settings, "TRACCAR_DEVICE_ID", None)
    picked = pick_position(positions)
    assert picked is not None
    assert picked["deviceId"] == 7


def test_pick_position_no_match_is_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "TRACCAR_DEVICE_ID", 99)
    assert pick_position([_position(device_id=7)]) is None
    assert pick_position([]) is None


# ----- Endpoint ----------------------------------------------------------------


def test_live_returns_position(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _mock_fetch(monkeypatch, [_position()])
    r = client.get(LIVE_URL)
    assert r.status_code == 200
    body = r.json()
    assert body["lat"] == 43.77
    assert body["lng"] == 7.49
    assert body["speed_kmh"] == 18.5
    assert body["battery"] == 84
    assert body["fix_time"] == "2026-07-20T14:30:00Z"


def test_live_not_configured_is_404(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "TRACCAR_BASE_URL", "")
    r = client.get(LIVE_URL)
    assert r.status_code == 404
    assert r.json()["detail"] == "live location not configured"


def test_live_no_position_yet_is_404(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _mock_fetch(monkeypatch, [])
    r = client.get(LIVE_URL)
    assert r.status_code == 404
    assert r.json()["detail"] == "no position yet"


def test_live_upstream_error_is_503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail() -> Any:
        raise httpx.ConnectTimeout("boom")

    monkeypatch.setattr(location, "fetch_positions", fail)
    r = client.get(LIVE_URL)
    assert r.status_code == 503
    assert r.json()["detail"] == "gps service unavailable"


def test_live_malformed_payload_is_503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    for payload in (None, {"not": "a list"}, [{"latitude": "x", "longitude": 2.0}]):
        location.clear_cache()
        _mock_fetch(monkeypatch, payload)
        r = client.get(LIVE_URL)
        assert r.status_code == 503, payload


def test_live_caches_within_ttl(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = [1000.0]
    monkeypatch.setattr(location, "now", lambda: clock[0])
    calls = _mock_fetch(monkeypatch, [_position()])

    assert client.get(LIVE_URL).status_code == 200
    assert client.get(LIVE_URL).status_code == 200
    assert len(calls) == 1

    clock[0] += CACHE_TTL_SECONDS + 1
    assert client.get(LIVE_URL).status_code == 200
    assert len(calls) == 2


def test_live_serves_last_known_fix_when_upstream_drops(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    clock = [1000.0]
    monkeypatch.setattr(location, "now", lambda: clock[0])
    _mock_fetch(monkeypatch, [_position()])
    assert client.get(LIVE_URL).status_code == 200

    def fail() -> Any:
        raise httpx.ConnectError("gone")

    monkeypatch.setattr(location, "fetch_positions", fail)
    clock[0] += CACHE_TTL_SECONDS + 1
    r = client.get(LIVE_URL)
    assert r.status_code == 200
    assert r.json()["lat"] == 43.77


def _mock_history(
    monkeypatch: pytest.MonkeyPatch, payload: Any
) -> list[tuple[int, Any, Any]]:
    """Replace the Traccar history call, recording (device_id, start, end)."""
    calls: list[tuple[int, Any, Any]] = []

    def fake_history(device_id: int, start: Any, end: Any) -> Any:
        calls.append((device_id, start, end))
        return payload

    monkeypatch.setattr(location, "fetch_history", fake_history)
    return calls


# ----- Trail helpers -----------------------------------------------------------


def test_to_trail_point_skips_junk_entries() -> None:
    assert to_trail_point({"latitude": "x", "longitude": 2.0}) is None
    assert to_trail_point({"longitude": 2.0}) is None
    point = to_trail_point(_position())
    assert point is not None
    assert (point.lat, point.lng) == (43.77, 7.49)


def test_decimate_keeps_small_trails_and_the_endpoints() -> None:
    small = [LiveTrailPoint(lat=float(i), lng=0.0) for i in range(5)]
    assert decimate(small, TRAIL_MAX_POINTS) is small

    big = [LiveTrailPoint(lat=float(i), lng=0.0) for i in range(1000)]
    thinned = decimate(big, 400)
    assert len(thinned) <= 401
    assert thinned[0] is big[0]
    assert thinned[-1] is big[-1]


# ----- Trail endpoint ----------------------------------------------------------


def test_trail_returns_sorted_points_for_configured_device(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "TRACCAR_DEVICE_ID", 7)
    history = [
        _position(lat=2.0, fix_time="2026-07-20T14:00:00Z"),
        _position(lat=1.0, fix_time="2026-07-20T13:00:00Z"),
        {"latitude": "junk", "longitude": 0},
    ]
    calls = _mock_history(monkeypatch, history)
    r = client.get(TRAIL_URL)
    assert r.status_code == 200
    points = r.json()["points"]
    assert [p["lat"] for p in points] == [1.0, 2.0]
    assert calls[0][0] == 7


def test_trail_resolves_device_id_from_latest_positions(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _mock_fetch(monkeypatch, [_position(device_id=42)])
    calls = _mock_history(monkeypatch, [_position(device_id=42)])
    r = client.get(TRAIL_URL)
    assert r.status_code == 200
    assert calls[0][0] == 42


def test_trail_no_device_yet_is_404(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _mock_fetch(monkeypatch, [])
    r = client.get(TRAIL_URL)
    assert r.status_code == 404
    assert r.json()["detail"] == "no position yet"


def test_trail_not_configured_is_404(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "TRACCAR_BASE_URL", "")
    assert client.get(TRAIL_URL).status_code == 404


def test_trail_validates_hours(client: TestClient) -> None:
    for hours in (0, -1, 49, "gisteren"):
        assert client.get(TRAIL_URL, params={"hours": hours}).status_code == 422


def test_trail_upstream_error_is_503_and_serves_stale_cache(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "TRACCAR_DEVICE_ID", 7)
    clock = [1000.0]
    monkeypatch.setattr(location, "now", lambda: clock[0])

    def fail(*_args: Any) -> Any:
        raise httpx.ConnectError("gone")

    monkeypatch.setattr(location, "fetch_history", fail)
    assert client.get(TRAIL_URL).status_code == 503

    calls = _mock_history(monkeypatch, [_position()])
    assert client.get(TRAIL_URL).status_code == 200
    assert len(calls) == 1
    # Within the TTL the cache answers; after it, a dead upstream falls back
    # to the stale trail instead of erroring.
    assert client.get(TRAIL_URL).status_code == 200
    assert len(calls) == 1
    monkeypatch.setattr(location, "fetch_history", fail)
    clock[0] += TRAIL_CACHE_TTL_SECONDS + 1
    r = client.get(TRAIL_URL)
    assert r.status_code == 200
    assert len(r.json()["points"]) == 1


def test_trail_window_matches_hours_param(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import UTC, datetime, timedelta

    monkeypatch.setattr(settings, "TRACCAR_DEVICE_ID", 7)
    frozen = datetime(2026, 7, 20, 15, 0, tzinfo=UTC)
    monkeypatch.setattr(location, "utcnow", lambda: frozen)
    calls = _mock_history(monkeypatch, [])
    assert client.get(TRAIL_URL, params={"hours": 6}).status_code == 200
    _, start, end = calls[0]
    assert end == frozen
    assert end - start == timedelta(hours=6)


def test_live_endpoint_is_rate_limited(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _mock_fetch(monkeypatch, [_position()])
    headers = {"X-Forwarded-For": "192.0.2.101"}
    for _ in range(LOCATION_RATE_LIMIT):
        assert client.get(LIVE_URL, headers=headers).status_code == 200
    r = client.get(LIVE_URL, headers=headers)
    assert r.status_code == 429
    assert "Retry-After" in r.headers

    # A different client IP is unaffected.
    r = client.get(LIVE_URL, headers={"X-Forwarded-For": "192.0.2.102"})
    assert r.status_code == 200
