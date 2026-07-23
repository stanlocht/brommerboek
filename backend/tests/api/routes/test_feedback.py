import uuid
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app import crud
from app.core.config import settings
from app.models import Feedback, UserCreate
from tests.utils.user import user_authentication_headers
from tests.utils.utils import random_email, random_lower_string

API = settings.API_V1_STR
FEEDBACK = f"{API}/feedback/"


def feedback_url(feedback_id: object) -> str:
    return f"{API}/feedback/{feedback_id}"


@pytest.fixture(autouse=True)
def _clean_feedback(db: Session) -> None:
    # Each test starts from an empty queue so list counts are deterministic
    # regardless of test order.
    db.execute(delete(Feedback))
    db.commit()


@pytest.fixture(scope="module")
def other_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    email = random_email()
    password = random_lower_string()
    crud.create_user(session=db, user_create=UserCreate(email=email, password=password))
    return user_authentication_headers(client=client, email=email, password=password)


def _create(
    client: TestClient,
    headers: dict[str, str],
    body: str = "de kaart laadt niet",
    page: str = "/",
) -> dict[str, Any]:
    r = client.post(FEEDBACK, headers=headers, json={"body": body, "page": page})
    assert r.status_code == 200
    return cast(dict[str, Any], r.json())


def test_create_feedback_requires_auth(client: TestClient) -> None:
    r = client.post(FEEDBACK, json={"body": "kapot"})
    assert r.status_code == 401


def test_create_and_read_own_feedback(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    created = _create(
        client,
        normal_user_token_headers,
        body="  de tijdlijn hangt op iOS  ",
        page="  /logboek  ",
    )
    assert created["body"] == "de tijdlijn hangt op iOS"  # stripped
    assert created["page"] == "/logboek"  # stripped
    assert created["status"] == "open"
    assert created["is_mine"] is True
    assert created["author_name"]

    r = client.get(f"{FEEDBACK}mine", headers=normal_user_token_headers)
    assert r.status_code == 200
    listed = r.json()
    assert listed["count"] == 1
    assert listed["data"][0]["id"] == created["id"]
    assert listed["data"][0]["is_mine"] is True


def test_create_feedback_rejects_empty_body(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.post(
        FEEDBACK, headers=normal_user_token_headers, json={"body": "   ", "page": ""}
    )
    assert r.status_code == 422


def test_mine_excludes_other_users_reports(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    other_user_token_headers: dict[str, str],
) -> None:
    _create(client, other_user_token_headers, body="andermans melding")
    r = client.get(f"{FEEDBACK}mine", headers=normal_user_token_headers)
    assert r.status_code == 200
    assert r.json()["count"] == 0


def test_list_all_requires_superuser(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.get(FEEDBACK, headers=normal_user_token_headers)
    assert r.status_code == 403


def test_superuser_lists_and_filters_all(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    other_user_token_headers: dict[str, str],
) -> None:
    first = _create(client, normal_user_token_headers, body="knop doet niets")
    _create(client, other_user_token_headers, body="foto's laden traag")

    r = client.get(FEEDBACK, headers=superuser_token_headers)
    assert r.status_code == 200
    listed = r.json()
    assert listed["count"] == 2
    # Someone else's report is not "mine" for the superuser.
    assert all(item["is_mine"] is False for item in listed["data"])
    assert all(item["author_name"] for item in listed["data"])

    # Resolve one, then filter both ways.
    r = client.patch(
        feedback_url(first["id"]),
        headers=superuser_token_headers,
        json={"status": "resolved"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "resolved"

    r = client.get(FEEDBACK, headers=superuser_token_headers, params={"status": "open"})
    assert r.json()["count"] == 1
    assert r.json()["data"][0]["body"] == "foto's laden traag"
    r = client.get(
        FEEDBACK, headers=superuser_token_headers, params={"status": "resolved"}
    )
    assert r.json()["count"] == 1
    assert r.json()["data"][0]["id"] == first["id"]


def test_list_all_rejects_unknown_status_filter(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(
        FEEDBACK, headers=superuser_token_headers, params={"status": "banana"}
    )
    assert r.status_code == 422


def test_status_update_requires_superuser(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    created = _create(client, normal_user_token_headers)
    r = client.patch(
        feedback_url(created["id"]),
        headers=normal_user_token_headers,
        json={"status": "resolved"},
    )
    assert r.status_code == 403


def test_status_update_rejects_unknown_status(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
) -> None:
    created = _create(client, normal_user_token_headers)
    r = client.patch(
        feedback_url(created["id"]),
        headers=superuser_token_headers,
        json={"status": "banana"},
    )
    assert r.status_code == 422


def test_status_update_missing_report(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        feedback_url(uuid.uuid4()),
        headers=superuser_token_headers,
        json={"status": "resolved"},
    )
    assert r.status_code == 404


def test_delete_own_feedback(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    created = _create(client, normal_user_token_headers)
    r = client.delete(feedback_url(created["id"]), headers=normal_user_token_headers)
    assert r.status_code == 200
    r = client.get(f"{FEEDBACK}mine", headers=normal_user_token_headers)
    assert r.json()["count"] == 0


def test_delete_other_users_feedback_forbidden(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    other_user_token_headers: dict[str, str],
) -> None:
    created = _create(client, other_user_token_headers)
    r = client.delete(feedback_url(created["id"]), headers=normal_user_token_headers)
    assert r.status_code == 403


def test_superuser_deletes_any_feedback(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
) -> None:
    created = _create(client, normal_user_token_headers)
    r = client.delete(feedback_url(created["id"]), headers=superuser_token_headers)
    assert r.status_code == 200
    r = client.get(FEEDBACK, headers=superuser_token_headers)
    assert r.json()["count"] == 0


def test_delete_missing_report(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.delete(feedback_url(uuid.uuid4()), headers=normal_user_token_headers)
    assert r.status_code == 404


def test_feedback_rate_limit(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    from app.api.routes.feedback import FEEDBACK_RATE_LIMIT

    for i in range(FEEDBACK_RATE_LIMIT):
        _create(client, normal_user_token_headers, body=f"melding {i}")
    r = client.post(
        FEEDBACK,
        headers=normal_user_token_headers,
        json={"body": "één te veel", "page": ""},
    )
    assert r.status_code == 429
