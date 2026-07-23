import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app.core.config import settings
from app.models import MapFlag

API = settings.API_V1_STR
FLAGS = f"{API}/map-flags/"


def flag_url(kind: str) -> str:
    return f"{API}/map-flags/{kind}"


@pytest.fixture(autouse=True)
def _clean_flags(db: Session) -> None:
    # Each test starts without rows so the lazy default seeding is exercised
    # and positions never leak between tests.
    db.execute(delete(MapFlag))
    db.commit()


def test_read_flags_returns_defaults(client: TestClient) -> None:
    r = client.get(FLAGS)
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 2
    by_kind = {f["kind"]: f for f in body["data"]}
    assert set(by_kind) == {"start", "finish"}
    assert by_kind["start"]["label"] == "Amsterdam"
    assert by_kind["start"]["lat"] == pytest.approx(52.3676)
    assert by_kind["start"]["lng"] == pytest.approx(4.9041)
    assert by_kind["finish"]["label"] == "Tanger"
    assert by_kind["finish"]["lat"] == pytest.approx(35.7595)
    assert by_kind["finish"]["lng"] == pytest.approx(-5.834)


def test_update_flag_requires_auth(client: TestClient) -> None:
    r = client.patch(flag_url("start"), json={"lat": 51.0, "lng": 4.0})
    assert r.status_code == 401


def test_update_flag_forbidden_for_normal_user(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        flag_url("start"),
        headers=normal_user_token_headers,
        json={"lat": 51.0, "lng": 4.0},
    )
    assert r.status_code == 403


def test_superuser_moves_flag(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        flag_url("finish"),
        headers=superuser_token_headers,
        json={"lat": 31.6295, "lng": -7.9811},
    )
    assert r.status_code == 200
    moved = r.json()
    assert moved["kind"] == "finish"
    assert moved["lat"] == pytest.approx(31.6295)
    assert moved["lng"] == pytest.approx(-7.9811)
    # Label untouched by a pure move.
    assert moved["label"] == "Tanger"

    # The public read reflects the new spot; the other flag kept its default.
    body = client.get(FLAGS).json()
    by_kind = {f["kind"]: f for f in body["data"]}
    assert by_kind["finish"]["lat"] == pytest.approx(31.6295)
    assert by_kind["start"]["lat"] == pytest.approx(52.3676)


def test_superuser_renames_flag_label(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        flag_url("start"),
        headers=superuser_token_headers,
        json={"label": "Startpunt"},
    )
    assert r.status_code == 200
    updated = r.json()
    assert updated["label"] == "Startpunt"
    # Coordinates untouched by a label-only patch.
    assert updated["lat"] == pytest.approx(52.3676)


def test_update_unknown_kind_is_404(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        flag_url("checkpoint"),
        headers=superuser_token_headers,
        json={"lat": 50.0, "lng": 4.0},
    )
    assert r.status_code == 404


def test_update_rejects_out_of_range_coordinates(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        flag_url("start"),
        headers=superuser_token_headers,
        json={"lat": 91.0, "lng": 0.0},
    )
    assert r.status_code == 422
