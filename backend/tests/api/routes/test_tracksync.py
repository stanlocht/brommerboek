import uuid
from datetime import UTC, date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app import tracksync
from app.api.routes import location
from app.core.config import settings
from app.models import LegTrack, Stop
from app.tracksync import build_leg, leg_window, nearest_index, sync_leg
from tests.utils.utils import get_superuser_token_headers

TRACKS_URL = f"{settings.API_V1_STR}/location/tracks"
SYNC_URL = f"{settings.API_V1_STR}/location/sync-tracks"


@pytest.fixture(autouse=True)
def _traccar_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "TRACCAR_BASE_URL", "https://gps.example.com")
    monkeypatch.setattr(settings, "TRACCAR_TOKEN", "secret-token")
    monkeypatch.setattr(settings, "TRACCAR_DEVICE_ID", 7)
    location.clear_cache()


@pytest.fixture
def _clean_tracks(db: Session) -> None:
    db.execute(delete(LegTrack))
    db.commit()


def _history_entry(lat: float, lng: float, fix: str) -> dict:
    return {"latitude": lat, "longitude": lng, "fixTime": fix}


def _two_stops(db: Session) -> tuple[Stop, Stop]:
    stops = list(db.exec(select(Stop).order_by(Stop.order_index)).all())
    assert len(stops) >= 2, "seeded trip expected"
    return stops[0], stops[1]


# ----- Pure helpers ------------------------------------------------------------


def test_leg_window_spans_both_days_inclusive() -> None:
    start, end = leg_window(date(2026, 7, 1), date(2026, 7, 3))
    assert start == datetime(2026, 7, 1, tzinfo=UTC)
    assert end == datetime(2026, 7, 4, tzinfo=UTC)


def test_nearest_index_finds_closest_coordinate() -> None:
    coords = [[4.9, 52.3], [5.1, 51.8], [4.5, 51.9]]
    assert nearest_index(coords, 51.85, 5.05) == 1
    assert nearest_index(coords, 52.29, 4.91) == 0


def test_build_leg_slices_between_pins_and_sorts_by_time(db: Session) -> None:
    a, b = _two_stops(db)
    # Out-of-order history: riding noise before reaching A's pin, the real
    # leg A→B, then noise after B. Nearest-to-pin slicing keeps the middle.
    history = [
        _history_entry(b.lat, b.lng, "2026-07-02T12:00:00Z"),
        _history_entry(a.lat + 0.5, a.lng + 0.5, "2026-07-01T08:00:00Z"),
        _history_entry(a.lat, a.lng, "2026-07-01T10:00:00Z"),
        _history_entry((a.lat + b.lat) / 2, (a.lng + b.lng) / 2, "2026-07-01T15:00:00Z"),
        _history_entry(b.lat + 0.4, b.lng + 0.4, "2026-07-02T16:00:00Z"),
        {"latitude": "junk", "longitude": 1},
    ]
    leg = build_leg(history, a, b)
    assert leg is not None
    assert leg[0] == [a.lng, a.lat]
    assert leg[-1] == [b.lng, b.lat]
    assert len(leg) == 3


def test_build_leg_unusable_windows_are_none(db: Session) -> None:
    a, b = _two_stops(db)
    assert build_leg([], a, b) is None
    assert build_leg([_history_entry(a.lat, a.lng, "2026-07-01T10:00:00Z")], a, b) is None
    # Track only ever near B then A (wrong direction) → no usable slice.
    reversed_history = [
        _history_entry(b.lat, b.lng, "2026-07-01T08:00:00Z"),
        _history_entry(a.lat, a.lng, "2026-07-01T12:00:00Z"),
    ]
    assert build_leg(reversed_history, a, b) is None
    with pytest.raises(ValueError):
        build_leg({"not": "a list"}, a, b)


# ----- sync_leg upsert ---------------------------------------------------------


@pytest.mark.usefixtures("_clean_tracks")
def test_sync_leg_upserts_by_destination(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    a, b = _two_stops(db)
    history = [
        _history_entry(a.lat, a.lng, "2026-07-01T10:00:00Z"),
        _history_entry(b.lat, b.lng, "2026-07-02T12:00:00Z"),
    ]
    monkeypatch.setattr(location, "fetch_history", lambda *_: history)
    assert sync_leg(db, a, b) is True
    rows = list(db.exec(select(LegTrack)).all())
    assert len(rows) == 1
    assert rows[0].to_stop_id == b.id
    assert rows[0].points == [[a.lng, a.lat], [b.lng, b.lat]]

    # A second sync replaces the row instead of duplicating it.
    assert sync_leg(db, a, b) is True
    assert len(list(db.exec(select(LegTrack)).all())) == 1

    # An unusable window stores nothing and keeps the old track.
    monkeypatch.setattr(location, "fetch_history", lambda *_: [])
    assert sync_leg(db, a, b) is False
    assert len(list(db.exec(select(LegTrack)).all())) == 1


# ----- /location/tracks --------------------------------------------------------


@pytest.mark.usefixtures("_clean_tracks")
def test_tracks_returns_only_current_consecutive_pairs(
    client: TestClient, db: Session
) -> None:
    a, b = _two_stops(db)
    db.add(LegTrack(from_stop_id=a.id, to_stop_id=b.id, points=[[1.0, 2.0], [3.0, 4.0]]))
    # Orphaned row (stops no longer consecutive / deleted) must be filtered.
    db.add(
        LegTrack(
            from_stop_id=uuid.uuid4(), to_stop_id=uuid.uuid4(), points=[[0.0, 0.0]]
        )
    )
    db.commit()
    r = client.get(TRACKS_URL)
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 1
    assert body["data"][0]["from_stop_id"] == str(a.id)
    assert body["data"][0]["to_stop_id"] == str(b.id)
    assert body["data"][0]["points"] == [[1.0, 2.0], [3.0, 4.0]]


# ----- /location/sync-tracks ---------------------------------------------------


@pytest.mark.usefixtures("_clean_tracks")
def test_sync_tracks_backfills_and_skips_existing(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    headers = get_superuser_token_headers(client)
    stops = list(db.exec(select(Stop).order_by(Stop.order_index)).all())

    def history_for(_device: int, start: datetime, end: datetime) -> list[dict]:
        # Every leg window gets a two-point track between the pins whose
        # dates fall inside it — enough for build_leg to slice.
        out = []
        for prev, cur in zip(stops, stops[1:], strict=False):
            out = [
                _history_entry(prev.lat, prev.lng, f"{prev.date}T08:00:00Z"),
                _history_entry(cur.lat, cur.lng, f"{cur.date}T18:00:00Z"),
            ]
            if start <= datetime.combine(cur.date, datetime.min.time(), tzinfo=UTC) < end:
                return out
        return out

    monkeypatch.setattr(location, "fetch_history", history_for)
    r = client.post(SYNC_URL, headers=headers)
    assert r.status_code == 200
    first = r.json()
    assert first["synced"] >= 1
    assert first["failed"] == 0

    # A second run finds everything current and skips it all.
    r = client.post(SYNC_URL, headers=headers)
    assert r.status_code == 200
    second = r.json()
    assert second["synced"] == 0
    assert second["skipped"] == len(stops) - 1


def test_sync_tracks_requires_superuser(client: TestClient) -> None:
    assert client.post(SYNC_URL).status_code == 401


def test_sync_tracks_not_configured_is_404(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "TRACCAR_BASE_URL", "")
    headers = get_superuser_token_headers(client)
    assert client.post(SYNC_URL, headers=headers).status_code == 404


# ----- sync_for_stop background task -------------------------------------------


@pytest.mark.usefixtures("_clean_tracks")
def test_sync_for_stop_syncs_surrounding_legs(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    stops = list(db.exec(select(Stop).order_by(Stop.order_index)).all())
    assert len(stops) >= 3
    mid = stops[1]

    def history_for(_device: int, start: datetime, end: datetime) -> list[dict]:
        for prev, cur in zip(stops, stops[1:], strict=False):
            window_start, window_end = tracksync.leg_window(prev.date, cur.date)
            if (start, end) == (window_start, window_end):
                return [
                    _history_entry(prev.lat, prev.lng, f"{prev.date}T08:00:00Z"),
                    _history_entry(cur.lat, cur.lng, f"{cur.date}T18:00:00Z"),
                ]
        return []

    monkeypatch.setattr(location, "fetch_history", history_for)
    tracksync.sync_for_stop(mid.id)
    rows = {row.to_stop_id for row in db.exec(select(LegTrack)).all()}
    # Both the incoming (0→1) and outgoing (1→2) legs were synced.
    assert rows == {stops[1].id, stops[2].id}

    # Unknown stop id and disabled Traccar are quiet no-ops.
    tracksync.sync_for_stop(uuid.uuid4())
    monkeypatch.setattr(settings, "TRACCAR_BASE_URL", "")
    tracksync.sync_for_stop(mid.id)
