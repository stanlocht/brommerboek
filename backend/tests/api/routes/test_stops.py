import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models import Comment, HornHonk
from tests.utils.stop import create_test_stop, delete_test_stop, stop_payload

STOPS_URL = f"{settings.API_V1_STR}/stops/"


# ----- Public reads -----------------------------------------------------------


def test_read_stops_public(client: TestClient) -> None:
    r = client.get(STOPS_URL)
    assert r.status_code == 200
    content = r.json()
    assert content["count"] == len(content["data"])
    assert content["count"] >= 10  # the seeded trip
    order = [s["order_index"] for s in content["data"]]
    assert order == sorted(order)
    first = content["data"][0]
    for field in ("id", "place", "country", "lat", "lng", "date", "title", "media"):
        assert field in first


def test_read_stop_by_id_public(client: TestClient) -> None:
    listed = client.get(STOPS_URL).json()["data"][0]
    r = client.get(f"{STOPS_URL}{listed['id']}")
    assert r.status_code == 200
    assert r.json() == listed


def test_read_stop_not_found(client: TestClient) -> None:
    r = client.get(f"{STOPS_URL}{uuid.uuid4()}")
    assert r.status_code == 404
    assert r.json()["detail"] == "Stop not found"


def test_read_stops_zero_reaction_counts(client: TestClient) -> None:
    # Untouched stops carry explicit zero counts so the map never sees nulls.
    for s in client.get(STOPS_URL).json()["data"]:
        assert s["honk_count"] == 0
        assert s["comment_count"] == 0


def test_read_stops_includes_reaction_counts(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    stop = create_test_stop(db)
    try:
        me = client.get(
            f"{settings.API_V1_STR}/users/me", headers=normal_user_token_headers
        ).json()
        user_id = uuid.UUID(me["id"])
        db.add(HornHonk(stop_id=stop.id, user_id=user_id))
        db.add(Comment(stop_id=stop.id, user_id=user_id, body="toet"))
        db.add(Comment(stop_id=stop.id, user_id=user_id, body="nog een toet"))
        db.commit()

        listed = client.get(STOPS_URL).json()["data"]
        by_id = {s["id"]: s for s in listed}
        mine = by_id[str(stop.id)]
        assert mine["honk_count"] == 1
        assert mine["comment_count"] == 2
        # The other stops stay at zero — counts land on the right stop only.
        for s in listed:
            if s["id"] != str(stop.id):
                assert s["honk_count"] == 0
                assert s["comment_count"] == 0

        # The single-stop endpoint reports the same counts.
        single = client.get(f"{STOPS_URL}{stop.id}").json()
        assert single["honk_count"] == 1
        assert single["comment_count"] == 2
    finally:
        # Cascades away the honk and comments too (FK ON DELETE CASCADE).
        delete_test_stop(db, stop)


def test_stats_match_seed_trip(client: TestClient) -> None:
    # The seeded Amsterdam → Cinque Terre trip: every stop has an odometer
    # reading (0 … 1024 km, monotonically increasing), so total km is the
    # odometer delta; 2024-05-04 → 2024-05-19 is 15 days; NL/BE/FR/CH/IT are
    # 5 countries; 2 of the 10 stops are repairs.
    count = client.get(STOPS_URL).json()["count"]
    assert count == 10, "expected only the seeded stops — a test leaked a stop"
    r = client.get(f"{STOPS_URL}stats")
    assert r.status_code == 200
    stats = r.json()
    assert stats == {
        "km": 1024,
        "suggested_km": 1024,
        "days": 15,
        "countries": 5,
        "stops": 10,
        "repairs": 2,
        "stamps": 5,
    }


def test_stats_haversine_fallback_when_km_missing(
    client: TestClient, db: Session
) -> None:
    # A new stop without an odometer reading: the leg from Cinque Terre
    # (44.1350, 9.6845) to it is measured great-circle instead. Roma is
    # roughly 340 km away as the crow flies.
    stop = create_test_stop(
        db, place="Roma", code="IT", lat=41.9028, lng=12.4964, date="2024-05-21"
    )
    try:
        stats = client.get(f"{STOPS_URL}stats").json()
        assert stats["stops"] == 11
        assert stats["suggested_km"] == 1024  # last *known* odometer reading
        leg = stats["km"] - 1024
        assert 320 < leg < 360
        assert stats["days"] == 17
    finally:
        delete_test_stop(db, stop)


# ----- Write endpoints are superuser-only -------------------------------------


def test_create_stop_requires_auth(client: TestClient) -> None:
    r = client.post(STOPS_URL, json=stop_payload())
    assert r.status_code == 401


def test_create_stop_normal_user_forbidden(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.post(STOPS_URL, headers=normal_user_token_headers, json=stop_payload())
    assert r.status_code == 403


def test_create_and_delete_stop_as_superuser(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    before = client.get(STOPS_URL).json()
    max_order = max(s["order_index"] for s in before["data"])

    r = client.post(STOPS_URL, headers=superuser_token_headers, json=stop_payload())
    assert r.status_code == 200
    created = r.json()
    assert created["place"] == "Teststad"
    assert created["flag"] == "\U0001f1f3\U0001f1f1"  # derived from code NL
    assert created["order_index"] == max_order + 1

    r = client.delete(f"{STOPS_URL}{created['id']}", headers=superuser_token_headers)
    assert r.status_code == 200
    assert r.json()["message"] == "Stop deleted"
    assert client.get(f"{STOPS_URL}{created['id']}").status_code == 404


def test_update_stop_requires_auth(client: TestClient, db: Session) -> None:
    stop = create_test_stop(db)
    try:
        url = f"{STOPS_URL}{stop.id}"
        assert client.patch(url, json={"title": "Nee"}).status_code == 401
        assert client.delete(url).status_code == 401
    finally:
        delete_test_stop(db, stop)


def test_update_stop_normal_user_forbidden(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    stop = create_test_stop(db)
    try:
        url = f"{STOPS_URL}{stop.id}"
        r = client.patch(url, headers=normal_user_token_headers, json={"title": "Nee"})
        assert r.status_code == 403
        assert client.delete(url, headers=normal_user_token_headers).status_code == 403
    finally:
        delete_test_stop(db, stop)


def test_update_stop_as_superuser(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    stop = create_test_stop(db)
    try:
        r = client.patch(
            f"{STOPS_URL}{stop.id}",
            headers=superuser_token_headers,
            json={"title": "Bijgewerkt", "code": "BE", "km": 99},
        )
        assert r.status_code == 200
        updated = r.json()
        assert updated["title"] == "Bijgewerkt"
        assert updated["km"] == 99
        # Flag is re-derived from the new ISO code, never taken from input.
        assert updated["flag"] == "\U0001f1e7\U0001f1ea"
        assert updated["place"] == "Teststad"  # untouched field survives
    finally:
        delete_test_stop(db, stop)


def test_update_stop_not_found(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        f"{STOPS_URL}{uuid.uuid4()}",
        headers=superuser_token_headers,
        json={"title": "Spook"},
    )
    assert r.status_code == 404


def test_delete_stop_not_found(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.delete(f"{STOPS_URL}{uuid.uuid4()}", headers=superuser_token_headers)
    assert r.status_code == 404


# ----- Validation --------------------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        {"lat": 90.5},
        {"lat": -91},
        {"lng": 180.5},
        {"lng": -181},
        {"weather_condition": "drizzle"},
        {"type": "picnic"},
        {"km": -1},
        {"place": ""},
        {"title": ""},
    ],
)
def test_create_stop_rejects_invalid_payload(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    overrides: dict[str, object],
) -> None:
    r = client.post(
        STOPS_URL, headers=superuser_token_headers, json=stop_payload(**overrides)
    )
    assert r.status_code == 422


@pytest.mark.parametrize(
    "patch_body",
    [
        {"lat": 91},
        {"lng": -200},
        {"weather_condition": "hagel"},
        {"type": "party"},
    ],
)
def test_update_stop_rejects_invalid_payload(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db: Session,
    patch_body: dict[str, object],
) -> None:
    stop = create_test_stop(db)
    try:
        r = client.patch(
            f"{STOPS_URL}{stop.id}", headers=superuser_token_headers, json=patch_body
        )
        assert r.status_code == 422
    finally:
        delete_test_stop(db, stop)
