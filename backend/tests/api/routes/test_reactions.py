import uuid
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.models import Comment, HornHonk, Stop, UserCreate
from tests.utils.stop import create_test_stop, delete_test_stop
from tests.utils.user import user_authentication_headers
from tests.utils.utils import random_email, random_lower_string

API = settings.API_V1_STR


def comments_url(stop_id: object) -> str:
    return f"{API}/stops/{stop_id}/comments"


def honks_url(stop_id: object) -> str:
    return f"{API}/stops/{stop_id}/honks"


@pytest.fixture
def stop(db: Session) -> Generator[Stop]:
    stop = create_test_stop(db)
    yield stop
    # Deleting the stop cascades to its comments and honks (FK ON DELETE
    # CASCADE), so each test leaves the reaction tables clean.
    delete_test_stop(db, stop)


@pytest.fixture(scope="module")
def other_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    email = random_email()
    password = random_lower_string()
    crud.create_user(session=db, user_create=UserCreate(email=email, password=password))
    return user_authentication_headers(client=client, email=email, password=password)


def _me(client: TestClient, headers: dict[str, str]) -> dict[str, Any]:
    return cast(dict[str, Any], client.get(f"{API}/users/me", headers=headers).json())


# ----- Comments ----------------------------------------------------------------


def test_create_comment_requires_auth(client: TestClient, stop: Stop) -> None:
    r = client.post(comments_url(stop.id), json={"body": "Mooi!"})
    assert r.status_code == 401


def test_create_and_list_comment(
    client: TestClient, normal_user_token_headers: dict[str, str], stop: Stop
) -> None:
    r = client.post(
        comments_url(stop.id),
        headers=normal_user_token_headers,
        json={"body": "  Wat een tocht!  "},
    )
    assert r.status_code == 200
    created = r.json()
    assert created["body"] == "Wat een tocht!"  # stripped
    assert created["is_mine"] is True
    assert created["author_name"]
    assert created["stop_id"] == str(stop.id)

    # The list is public: no auth needed, and is_mine is False for anonymous.
    r = client.get(comments_url(stop.id))
    assert r.status_code == 200
    listed = r.json()
    assert listed["count"] == 1
    assert listed["data"][0]["id"] == created["id"]
    assert listed["data"][0]["is_mine"] is False

    # The author sees their own comment flagged.
    mine = client.get(comments_url(stop.id), headers=normal_user_token_headers).json()
    assert mine["data"][0]["is_mine"] is True


def test_create_comment_rejects_blank_body(
    client: TestClient, normal_user_token_headers: dict[str, str], stop: Stop
) -> None:
    r = client.post(
        comments_url(stop.id), headers=normal_user_token_headers, json={"body": "   "}
    )
    assert r.status_code == 422
    r = client.post(
        comments_url(stop.id), headers=normal_user_token_headers, json={"body": ""}
    )
    assert r.status_code == 422


def test_comment_on_missing_stop(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.post(
        comments_url(uuid.uuid4()),
        headers=normal_user_token_headers,
        json={"body": "Hallo?"},
    )
    assert r.status_code == 404
    assert client.get(comments_url(uuid.uuid4())).status_code == 404


def test_comments_pagination(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    stop: Stop,
) -> None:
    # Seed 7 comments straight into the DB (posting them through the API
    # would trip the 10/minute comment rate limit for larger sets) with
    # strictly increasing timestamps so newest-first ordering is unambiguous.
    me = _me(client, normal_user_token_headers)
    base = datetime(2024, 6, 1, 12, 0, tzinfo=UTC)
    for i in range(7):
        db.add(
            Comment(
                stop_id=stop.id,
                user_id=uuid.UUID(me["id"]),
                body=f"reactie {i}",
                created_at=base + timedelta(minutes=i),
            )
        )
    db.commit()

    # Default page returns everything; count is the total.
    full = client.get(comments_url(stop.id)).json()
    assert full["count"] == 7
    assert [c["body"] for c in full["data"]] == [
        f"reactie {i}" for i in range(6, -1, -1)
    ]

    # limit caps the page but count stays the total number of comments.
    page = client.get(comments_url(stop.id), params={"limit": 3}).json()
    assert page["count"] == 7
    assert [c["body"] for c in page["data"]] == ["reactie 6", "reactie 5", "reactie 4"]

    # skip walks further pages.
    page = client.get(comments_url(stop.id), params={"skip": 5, "limit": 3}).json()
    assert page["count"] == 7
    assert [c["body"] for c in page["data"]] == ["reactie 1", "reactie 0"]

    # skip past the end: empty page, count still total.
    page = client.get(comments_url(stop.id), params={"skip": 100}).json()
    assert page["count"] == 7
    assert page["data"] == []

    # limit is capped at 100.
    r = client.get(comments_url(stop.id), params={"limit": 101})
    assert r.status_code == 422


def _post_comment(
    client: TestClient, headers: dict[str, str], stop_id: object, body: str = "Toet"
) -> dict[str, Any]:
    r = client.post(comments_url(stop_id), headers=headers, json={"body": body})
    assert r.status_code == 200
    return cast(dict[str, Any], r.json())


def test_delete_comment_by_author(
    client: TestClient, normal_user_token_headers: dict[str, str], stop: Stop
) -> None:
    comment = _post_comment(client, normal_user_token_headers, stop.id)
    r = client.delete(
        f"{API}/comments/{comment['id']}", headers=normal_user_token_headers
    )
    assert r.status_code == 200
    assert r.json()["message"] == "Comment deleted successfully"
    assert client.get(comments_url(stop.id)).json()["count"] == 0


def test_delete_comment_by_other_user_forbidden(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    other_user_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    comment = _post_comment(client, normal_user_token_headers, stop.id)
    r = client.delete(
        f"{API}/comments/{comment['id']}", headers=other_user_token_headers
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "Not enough permissions"
    assert client.get(comments_url(stop.id)).json()["count"] == 1


def test_delete_comment_by_superuser(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    comment = _post_comment(client, normal_user_token_headers, stop.id)
    r = client.delete(
        f"{API}/comments/{comment['id']}", headers=superuser_token_headers
    )
    assert r.status_code == 200
    assert client.get(comments_url(stop.id)).json()["count"] == 0


def test_delete_comment_requires_auth_and_existence(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    assert client.delete(f"{API}/comments/{uuid.uuid4()}").status_code == 401
    r = client.delete(
        f"{API}/comments/{uuid.uuid4()}", headers=normal_user_token_headers
    )
    assert r.status_code == 404


# ----- Horn honks ---------------------------------------------------------------


def test_honk_requires_auth(client: TestClient, stop: Stop) -> None:
    r = client.post(honks_url(stop.id))
    assert r.status_code == 401


def test_honk_toggle_on_off(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    other_user_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    # Toggle on.
    r = client.post(honks_url(stop.id), headers=normal_user_token_headers)
    assert r.status_code == 200
    state = r.json()
    assert state["count"] == 1
    assert state["honked_by_me"] is True
    assert len(state["honkers"]) == 1
    assert state["honkers"][0]["is_mine"] is True

    # Anonymous and other users see the honk but not as theirs.
    anon = client.get(honks_url(stop.id)).json()
    assert anon["count"] == 1
    assert anon["honked_by_me"] is False
    other = client.get(honks_url(stop.id), headers=other_user_token_headers).json()
    assert other["honked_by_me"] is False

    # Second user honks too.
    r = client.post(honks_url(stop.id), headers=other_user_token_headers)
    assert r.json()["count"] == 2

    # Toggle off for the first user.
    r = client.post(honks_url(stop.id), headers=normal_user_token_headers)
    assert r.status_code == 200
    state = r.json()
    assert state["count"] == 1
    assert state["honked_by_me"] is False
    assert all(h["is_mine"] is False for h in state["honkers"])


def test_honk_on_missing_stop(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    assert (
        client.post(honks_url(uuid.uuid4()), headers=normal_user_token_headers)
    ).status_code == 404
    assert client.get(honks_url(uuid.uuid4())).status_code == 404


def test_honk_unique_constraint(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    stop: Stop,
) -> None:
    me = _me(client, normal_user_token_headers)
    user_id = uuid.UUID(me["id"])
    db.add(HornHonk(stop_id=stop.id, user_id=user_id))
    db.commit()
    db.add(HornHonk(stop_id=stop.id, user_id=user_id))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    # And through the API the toggle keeps it at one honk max.
    state = client.get(honks_url(stop.id), headers=normal_user_token_headers).json()
    assert state["count"] == 1
    assert state["honked_by_me"] is True
