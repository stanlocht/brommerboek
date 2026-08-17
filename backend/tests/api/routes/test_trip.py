import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app.core.config import settings
from app.models import DEFAULT_TRIP_TITLE, TripInfo

API = settings.API_V1_STR
TRIP = f"{API}/trip/"


@pytest.fixture(autouse=True)
def _clean_trip(db: Session) -> None:
    # Start without a row so the lazy default seeding is exercised and titles
    # never leak between tests.
    db.execute(delete(TripInfo))
    db.commit()


def test_read_trip_returns_default_title(client: TestClient) -> None:
    r = client.get(TRIP)
    assert r.status_code == 200
    assert r.json()["title"] == DEFAULT_TRIP_TITLE


def test_update_title_requires_auth(client: TestClient) -> None:
    r = client.patch(TRIP, json={"title": "Van Mokum naar Milaan"})
    assert r.status_code == 401


def test_update_title_forbidden_for_normal_user(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        TRIP,
        headers=normal_user_token_headers,
        json={"title": "Van Mokum naar Milaan"},
    )
    assert r.status_code == 403


def test_superuser_renames_the_trip(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        TRIP,
        headers=superuser_token_headers,
        json={"title": "Van Mokum naar Milaan"},
    )
    assert r.status_code == 200
    assert r.json()["title"] == "Van Mokum naar Milaan"

    # The public read serves the new title to everyone.
    assert client.get(TRIP).json()["title"] == "Van Mokum naar Milaan"


def test_title_is_trimmed(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        TRIP,
        headers=superuser_token_headers,
        json={"title": "  Rondje Ringvaart  "},
    )
    assert r.status_code == 200
    assert r.json()["title"] == "Rondje Ringvaart"


@pytest.mark.parametrize("title", ["", "   ", "x" * 61])
def test_update_rejects_blank_or_overlong_title(
    client: TestClient, superuser_token_headers: dict[str, str], title: str
) -> None:
    r = client.patch(TRIP, headers=superuser_token_headers, json={"title": title})
    assert r.status_code == 422
    # The stored title is untouched by a rejected patch.
    assert client.get(TRIP).json()["title"] == DEFAULT_TRIP_TITLE
