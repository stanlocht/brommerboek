from datetime import date, timedelta
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api.routes import weather
from app.api.routes.weather import (
    ARCHIVE_URL,
    FORECAST_URL,
    WEATHER_RATE_LIMIT,
    WMO_TO_CONDITION,
    open_meteo_request,
    wmo_condition,
)
from app.core.config import settings
from app.models import WEATHER_CONDITIONS

SUGGEST_URL = f"{settings.API_V1_STR}/weather/suggest"

TODAY = date(2024, 6, 15)


@pytest.fixture(autouse=True)
def _pin_today(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(weather, "_today", lambda: TODAY)


def _daily_payload(
    day: str, temp: float | None = 17.4, code: int | None = 61
) -> dict[str, Any]:
    return {
        "daily": {
            "time": [day],
            "temperature_2m_mean": [temp],
            "weather_code": [code],
        }
    }


def _mock_fetch(
    monkeypatch: pytest.MonkeyPatch, payload: dict[str, Any]
) -> list[tuple[str, dict[str, Any]]]:
    """Replace the Open-Meteo call, recording (url, params) per request."""
    calls: list[tuple[str, dict[str, Any]]] = []

    def fake_fetch(url: str, params: dict[str, Any]) -> Any:
        calls.append((url, params))
        return payload

    monkeypatch.setattr(weather, "fetch_open_meteo", fake_fetch)
    return calls


# ----- WMO code mapping --------------------------------------------------------


@pytest.mark.parametrize(
    ("code", "condition"),
    [
        (0, "sunny"),  # clear sky
        (1, "sunny"),  # mainly clear
        (2, "partly"),  # partly cloudy
        (3, "cloudy"),  # overcast
        (45, "fog"),  # fog
        (48, "fog"),  # depositing rime fog
        (51, "rain"),  # light drizzle
        (55, "rain"),  # dense drizzle
        (56, "rain"),  # freezing drizzle
        (61, "rain"),  # slight rain
        (65, "rain"),  # heavy rain
        (67, "rain"),  # heavy freezing rain
        (71, "snow"),  # slight snowfall
        (75, "snow"),  # heavy snowfall
        (77, "snow"),  # snow grains
        (80, "rain"),  # slight rain showers
        (82, "rain"),  # violent rain showers
        (85, "snow"),  # slight snow showers
        (86, "snow"),  # heavy snow showers
        (95, "storm"),  # thunderstorm
        (96, "storm"),  # thunderstorm with slight hail
        (99, "storm"),  # thunderstorm with heavy hail
    ],
)
def test_wmo_condition_mapping(code: int, condition: str) -> None:
    assert wmo_condition(code) == condition


def test_wmo_condition_unknown_code_is_none() -> None:
    # Codes Open-Meteo never emits in `weather_code` fall through to None
    # rather than a bogus condition.
    for code in (4, 10, 40, 50, 60, 70, 90, 100, -1):
        assert wmo_condition(code) is None


def test_wmo_mapping_only_yields_valid_conditions() -> None:
    assert set(WMO_TO_CONDITION.values()) <= WEATHER_CONDITIONS


# ----- Archive vs forecast cutoff ----------------------------------------------


def test_recent_dates_use_forecast_with_past_days() -> None:
    for days_ago in (0, 1, 6):
        url, params = open_meteo_request(
            52.0, 5.0, TODAY - timedelta(days=days_ago), TODAY
        )
        assert url == FORECAST_URL
        assert params["past_days"] == days_ago
        assert params["forecast_days"] == 1
        assert "start_date" not in params


def test_old_dates_use_archive_with_date_range() -> None:
    day = TODAY - timedelta(days=7)
    url, params = open_meteo_request(52.0, 5.0, day, TODAY)
    assert url == ARCHIVE_URL
    assert params["start_date"] == day.isoformat()
    assert params["end_date"] == day.isoformat()
    assert "past_days" not in params


def test_tomorrow_in_client_timezone_gets_second_forecast_day() -> None:
    url, params = open_meteo_request(52.0, 5.0, TODAY + timedelta(days=1), TODAY)
    assert url == FORECAST_URL
    assert params["past_days"] == 0
    assert params["forecast_days"] == 2


def test_request_always_asks_daily_mean_temp_and_code() -> None:
    for day in (TODAY, TODAY - timedelta(days=30)):
        _, params = open_meteo_request(52.0, 5.0, day, TODAY)
        assert params["daily"] == "temperature_2m_mean,weather_code"
        assert params["timezone"] == "auto"
        assert params["latitude"] == 52.0
        assert params["longitude"] == 5.0


# ----- Endpoint ----------------------------------------------------------------


def test_suggest_returns_temp_and_condition(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    day = (TODAY - timedelta(days=2)).isoformat()
    calls = _mock_fetch(monkeypatch, _daily_payload(day, temp=17.4, code=61))
    r = client.get(SUGGEST_URL, params={"lat": 44.1, "lng": 9.7, "date": day})
    assert r.status_code == 200
    assert r.json() == {"temp": 17, "condition": "rain"}
    assert len(calls) == 1
    assert calls[0][0] == FORECAST_URL


def test_suggest_old_date_hits_archive(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    day = (TODAY - timedelta(days=40)).isoformat()
    calls = _mock_fetch(monkeypatch, _daily_payload(day, temp=-0.6, code=2))
    r = client.get(SUGGEST_URL, params={"lat": 52.0, "lng": 5.0, "date": day})
    assert r.status_code == 200
    assert r.json() == {"temp": -1, "condition": "partly"}
    assert calls[0][0] == ARCHIVE_URL


def test_suggest_picks_matching_day_from_multi_day_response(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # past_days responses carry a window of days; the one asked for wins.
    day = (TODAY - timedelta(days=1)).isoformat()
    payload = {
        "daily": {
            "time": [(TODAY - timedelta(days=2)).isoformat(), day, TODAY.isoformat()],
            "temperature_2m_mean": [10.0, 21.5, 30.0],
            "weather_code": [95, 0, 3],
        }
    }
    _mock_fetch(monkeypatch, payload)
    r = client.get(SUGGEST_URL, params={"lat": 52.0, "lng": 5.0, "date": day})
    assert r.status_code == 200
    assert r.json() == {"temp": 22, "condition": "sunny"}


def test_suggest_null_fields_become_none(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    day = (TODAY - timedelta(days=3)).isoformat()
    _mock_fetch(monkeypatch, _daily_payload(day, temp=None, code=None))
    r = client.get(SUGGEST_URL, params={"lat": 52.0, "lng": 5.0, "date": day})
    assert r.status_code == 200
    assert r.json() == {"temp": None, "condition": None}


def test_suggest_rejects_future_date(client: TestClient) -> None:
    day = (TODAY + timedelta(days=2)).isoformat()
    r = client.get(SUGGEST_URL, params={"lat": 52.0, "lng": 5.0, "date": day})
    assert r.status_code == 422
    assert r.json()["detail"] == "date cannot be in the future"


def test_suggest_validates_coordinates_and_date(client: TestClient) -> None:
    day = TODAY.isoformat()
    for params in (
        {"lat": 91.0, "lng": 5.0, "date": day},
        {"lat": -91.0, "lng": 5.0, "date": day},
        {"lat": 52.0, "lng": 181.0, "date": day},
        {"lat": 52.0, "lng": -181.0, "date": day},
        {"lat": 52.0, "lng": 5.0, "date": "gisteren"},
        {"lng": 5.0, "date": day},
        {"lat": 52.0, "date": day},
        {"lat": 52.0, "lng": 5.0},
    ):
        r = client.get(SUGGEST_URL, params=params)
        assert r.status_code == 422, params


def test_suggest_upstream_error_returns_503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail(*_args: Any, **_kwargs: Any) -> Any:
        raise httpx.ConnectTimeout("boom")

    monkeypatch.setattr(weather, "fetch_open_meteo", fail)
    r = client.get(
        SUGGEST_URL, params={"lat": 52.0, "lng": 5.0, "date": TODAY.isoformat()}
    )
    assert r.status_code == 503
    assert r.json()["detail"] == "weather service unavailable, fill in manually"


def test_suggest_malformed_upstream_payload_returns_503(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    day = (TODAY - timedelta(days=2)).isoformat()
    for payload in (
        {},
        {"daily": {}},
        {"daily": {"time": []}},  # requested day missing entirely
        {"daily": {"time": [day]}},  # arrays absent
        {"daily": None},
    ):
        _mock_fetch(monkeypatch, payload)
        r = client.get(SUGGEST_URL, params={"lat": 52.0, "lng": 5.0, "date": day})
        assert r.status_code == 503, payload


def test_suggest_endpoint_is_rate_limited(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    day = (TODAY - timedelta(days=2)).isoformat()
    _mock_fetch(monkeypatch, _daily_payload(day))
    headers = {"X-Forwarded-For": "192.0.2.77"}
    for _ in range(WEATHER_RATE_LIMIT):
        r = client.get(
            SUGGEST_URL, headers=headers, params={"lat": 52.0, "lng": 5.0, "date": day}
        )
        assert r.status_code == 200
    r = client.get(
        SUGGEST_URL, headers=headers, params={"lat": 52.0, "lng": 5.0, "date": day}
    )
    assert r.status_code == 429
    assert "Retry-After" in r.headers

    # A different client IP is unaffected.
    r = client.get(
        SUGGEST_URL,
        headers={"X-Forwarded-For": "192.0.2.78"},
        params={"lat": 52.0, "lng": 5.0, "date": day},
    )
    assert r.status_code == 200
