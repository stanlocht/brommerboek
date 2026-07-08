from datetime import date as date_type
from datetime import timedelta
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.ratelimit import rate_limit
from app.models import WeatherSuggestion

router = APIRouter(prefix="/weather", tags=["weather"])

WEATHER_RATE_LIMIT = 30
WEATHER_RATE_WINDOW_SECONDS = 60

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
# The forecast API serves roughly the last week via `past_days`; anything
# older comes from the historical archive.
FORECAST_MAX_PAST_DAYS = 6
UPSTREAM_TIMEOUT_SECONDS = 5.0

# WMO 4677 weather interpretation codes (the `weather_code` daily variable)
# → the app's WEATHER_CONDITIONS short codes. Open-Meteo has no code for
# wind, so "wind" is never suggested — the rider picks it by hand.
WMO_TO_CONDITION: dict[int, str] = {
    0: "sunny",  # clear sky
    1: "sunny",  # mainly clear
    2: "partly",  # partly cloudy
    3: "cloudy",  # overcast
    45: "fog",  # fog
    48: "fog",  # depositing rime fog
    **dict.fromkeys((51, 53, 55, 56, 57), "rain"),  # drizzle, incl. freezing
    **dict.fromkeys((61, 63, 65, 66, 67), "rain"),  # rain, incl. freezing
    **dict.fromkeys((71, 73, 75, 77), "snow"),  # snowfall + snow grains
    **dict.fromkeys((80, 81, 82), "rain"),  # rain showers
    **dict.fromkeys((85, 86), "snow"),  # snow showers
    **dict.fromkeys((95, 96, 99), "storm"),  # thunderstorm, incl. hail
}


def wmo_condition(code: int) -> str | None:
    return WMO_TO_CONDITION.get(code)


# Injectable so tests can pin "today" around the archive/forecast cutoff.
def _today() -> date_type:
    return date_type.today()


def open_meteo_request(
    lat: float, lng: float, day: date_type, today: date_type
) -> tuple[str, dict[str, Any]]:
    """URL + query params for the Open-Meteo call covering `day`."""
    days_ago = (today - day).days
    params: dict[str, Any] = {
        "latitude": lat,
        "longitude": lng,
        "daily": "temperature_2m_mean,weather_code",
        "timezone": "auto",
    }
    if days_ago > FORECAST_MAX_PAST_DAYS:
        params["start_date"] = day.isoformat()
        params["end_date"] = day.isoformat()
        return ARCHIVE_URL, params
    params["past_days"] = max(0, days_ago)
    # `days_ago` can be -1 for a client whose local calendar is a day ahead
    # of the server's; a second forecast day covers that date too.
    params["forecast_days"] = 2 if days_ago < 0 else 1
    return FORECAST_URL, params


def fetch_open_meteo(url: str, params: dict[str, Any]) -> Any:
    # Kept as a seam: tests monkeypatch this instead of hitting the network.
    response = httpx.get(url, params=params, timeout=UPSTREAM_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()


@router.get(
    "/suggest",
    response_model=WeatherSuggestion,
    dependencies=[
        Depends(rate_limit("weather", WEATHER_RATE_LIMIT, WEATHER_RATE_WINDOW_SECONDS))
    ],
)
def suggest_weather(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    date: date_type = Query(),
) -> Any:
    """
    Suggest the weather at a stop: mean temperature (°C) and a condition
    short code, looked up at Open-Meteo for the given day and coordinates.
    Public and read-only. Returns 503 when the upstream is unreachable —
    the client treats that as "no suggestion", never as an error.
    """
    today = _today()
    # A small margin for clients whose local calendar is ahead of the server.
    if date > today + timedelta(days=1):
        raise HTTPException(status_code=422, detail="date cannot be in the future")
    url, params = open_meteo_request(lat, lng, date, today)
    try:
        payload = fetch_open_meteo(url, params)
        daily = payload["daily"]
        index = daily["time"].index(date.isoformat())
        raw_temp = daily["temperature_2m_mean"][index]
        raw_code = daily["weather_code"][index]
    except httpx.HTTPError, ValueError, LookupError, TypeError:
        raise HTTPException(
            status_code=503, detail="weather service unavailable, fill in manually"
        )
    temp = round(raw_temp) if isinstance(raw_temp, int | float) else None
    condition = wmo_condition(raw_code) if isinstance(raw_code, int) else None
    return WeatherSuggestion(temp=temp, condition=condition)
