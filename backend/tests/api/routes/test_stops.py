import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.core.config import settings
from app.models import Comment, HornHonk, LegTrack, Stop
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
    # odometer delta; 2024-05-04 → 2024-05-19 is 16 days on the road counted
    # inclusively (departure day is dag 1); NL/BE/FR/CH/IT are
    # 5 countries; 2 of the 10 stops are repairs.
    count = client.get(STOPS_URL).json()["count"]
    assert count == 10, "expected only the seeded stops — a test leaked a stop"
    r = client.get(f"{STOPS_URL}stats")
    assert r.status_code == 200
    stats = r.json()
    assert stats == {
        "km": 1024,
        "suggested_km": 1024,
        "days": 16,
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
        assert stats["days"] == 18
    finally:
        delete_test_stop(db, stop)


def test_stats_gps_distance_beats_haversine_when_km_missing(
    client: TestClient, db: Session
) -> None:
    # Same Roma leg without an odometer reading, but with a GPS-measured
    # distance synced for it: the measured road wins over the great-circle
    # estimate. An odometer-covered leg with a GPS track keeps the odometer.
    stop = create_test_stop(
        db, place="Roma", code="IT", lat=41.9028, lng=12.4964, date="2024-05-21"
    )
    prev = db.exec(
        select(Stop)
        .where(Stop.order_index < stop.order_index)
        .order_by(Stop.order_index.desc())
    ).first()
    assert prev is not None
    db.add(
        LegTrack(
            from_stop_id=prev.id,
            to_stop_id=stop.id,
            points=[[prev.lng, prev.lat], [stop.lng, stop.lat]],
            distance_km=421.0,
        )
    )
    db.commit()
    try:
        stats = client.get(f"{STOPS_URL}stats").json()
        assert stats["km"] == 1024 + 421
    finally:
        db.execute(delete(LegTrack))
        db.commit()
        delete_test_stop(db, stop)


def test_stats_exclude_preparation_stops(client: TestClient, db: Session) -> None:
    # A preparation post — packing at home weeks before departure, in a
    # country not on the route — must not move a single trip figure.
    baseline = client.get(f"{STOPS_URL}stats").json()
    stop = create_test_stop(
        db,
        place="Thuis",
        country="Duitsland",
        code="DE",
        lat=50.0,
        lng=8.0,
        date="2024-04-01",
        type="preparation",
    )
    try:
        stats = client.get(f"{STOPS_URL}stats").json()
        assert stats == baseline
    finally:
        delete_test_stop(db, stop)


def test_stats_preparation_km_reading_still_suggested(
    client: TestClient, db: Session
) -> None:
    # The odometer prefill is about the moped, not the trip: a reading noted
    # on a preparation post after the latest stop is still the freshest one.
    stop = create_test_stop(
        db, place="Garage", date="2024-05-25", type="preparation", km=1030
    )
    try:
        stats = client.get(f"{STOPS_URL}stats").json()
        assert stats["suggested_km"] == 1030
        assert stats["km"] == 1024  # trip distance untouched
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


def test_create_backdated_stop_slots_into_route_by_date(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    # A stop dated before the seed trip's last stop must slot into the route
    # at its date position, not get appended because it was uploaded last.
    r = client.post(
        STOPS_URL,
        headers=superuser_token_headers,
        json=stop_payload(place="Laatbericht", date="2024-05-10"),
    )
    assert r.status_code == 200
    created = r.json()
    try:
        listed = client.get(STOPS_URL).json()["data"]
        dates = [s["date"] for s in listed]
        assert dates == sorted(dates)
        order = [s["order_index"] for s in listed]
        assert order == list(range(len(listed)))
        # The backdated stop sits after the seed stops of its date and before
        # any later-dated stop — so not at the tail.
        idx = next(i for i, s in enumerate(listed) if s["id"] == created["id"])
        assert idx < len(listed) - 1
    finally:
        r = client.delete(
            f"{STOPS_URL}{created['id']}", headers=superuser_token_headers
        )
        assert r.status_code == 200


def test_update_stop_date_resequences_route(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    # Correcting a stop's date moves it along the route accordingly.
    stop = create_test_stop(db, date="2024-06-01")  # after the seed trip
    try:
        r = client.patch(
            f"{STOPS_URL}{stop.id}",
            headers=superuser_token_headers,
            json={"date": "2024-05-01"},  # before the seed trip
        )
        assert r.status_code == 200
        assert r.json()["order_index"] == 0
        listed = client.get(STOPS_URL).json()["data"]
        assert listed[0]["id"] == str(stop.id)
        dates = [s["date"] for s in listed]
        assert dates == sorted(dates)
    finally:
        delete_test_stop(db, stop)


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


# ----- Same-day reorder (move up/down) ----------------------------------------


def _route_places(client: TestClient) -> list[str]:
    return [s["place"] for s in client.get(STOPS_URL).json()["data"]]


def test_move_stop_swaps_same_day_neighbours(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    # Two posts on the same far-future day, added in the wrong order: the
    # evening stop first, then the morning start. Same-day stops keep
    # insertion order, so "up" on the morning post fixes the route.
    evening = create_test_stop(db, place="Avondstop", date="2027-06-01")
    morning = create_test_stop(db, place="Ochtendstart", date="2027-06-01")
    try:
        assert _route_places(client)[-2:] == ["Avondstop", "Ochtendstart"]
        r = client.post(
            f"{STOPS_URL}{morning.id}/move?direction=up",
            headers=superuser_token_headers,
        )
        assert r.status_code == 200
        assert r.json()["id"] == str(morning.id)
        assert _route_places(client)[-2:] == ["Ochtendstart", "Avondstop"]

        # "down" moves it back again.
        r = client.post(
            f"{STOPS_URL}{morning.id}/move?direction=down",
            headers=superuser_token_headers,
        )
        assert r.status_code == 200
        assert _route_places(client)[-2:] == ["Avondstop", "Ochtendstart"]
    finally:
        delete_test_stop(db, evening)
        delete_test_stop(db, morning)


def test_move_stop_never_crosses_into_another_day(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    # A route predecessor on an earlier day is not a same-day neighbour:
    # moving the day's first post up (or its last post down) is a 400 and
    # leaves the order untouched.
    before = create_test_stop(db, place="Gisteren", date="2027-05-31")
    first = create_test_stop(db, place="Vandaag", date="2027-06-01")
    try:
        baseline = _route_places(client)
        for direction in ("up", "down"):
            r = client.post(
                f"{STOPS_URL}{first.id}/move?direction={direction}",
                headers=superuser_token_headers,
            )
            assert r.status_code == 400
        assert _route_places(client) == baseline
    finally:
        delete_test_stop(db, before)
        delete_test_stop(db, first)


def test_move_stop_requires_superuser(
    client: TestClient, normal_user_token_headers: dict[str, str], db: Session
) -> None:
    stop = create_test_stop(db)
    try:
        url = f"{STOPS_URL}{stop.id}/move?direction=up"
        assert client.post(url).status_code == 401
        assert client.post(url, headers=normal_user_token_headers).status_code == 403
    finally:
        delete_test_stop(db, stop)


def test_move_stop_validates_input(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    stop = create_test_stop(db)
    try:
        r = client.post(
            f"{STOPS_URL}{uuid.uuid4()}/move?direction=up",
            headers=superuser_token_headers,
        )
        assert r.status_code == 404
        r = client.post(
            f"{STOPS_URL}{stop.id}/move?direction=sideways",
            headers=superuser_token_headers,
        )
        assert r.status_code == 422
    finally:
        delete_test_stop(db, stop)
