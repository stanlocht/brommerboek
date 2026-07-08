import json
from collections.abc import Generator
from types import SimpleNamespace
from typing import Any

import pytest
from cryptography.hazmat.primitives import serialization
from fastapi.testclient import TestClient
from py_vapid import Vapid02, b64urlencode
from pywebpush import WebPushException
from sqlmodel import Session, delete, select

from app.core import push as push_core
from app.core.config import settings
from app.models import PushSubscription, Stop
from tests.utils.stop import create_test_stop, delete_test_stop, stop_payload
from tests.utils.utils import random_lower_string

API = settings.API_V1_STR
PUBLIC_KEY_URL = f"{API}/push/public-key"
SUBSCRIBE_URL = f"{API}/push/subscribe"


def _generate_test_key() -> tuple[str, str]:
    vapid = Vapid02()
    vapid.generate_keys()
    private = b64urlencode(
        vapid.private_key.private_numbers().private_value.to_bytes(32, "big")
    )
    public = b64urlencode(
        vapid.public_key.public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
    )
    return private, public


TEST_PRIVATE_KEY, TEST_PUBLIC_KEY = _generate_test_key()


def sub_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "endpoint": f"https://push.example.com/send/{random_lower_string()}",
        "keys": {"p256dh": "client-p256dh", "auth": "client-auth"},
    }
    payload.update(overrides)
    return payload


@pytest.fixture
def push_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "VAPID_PRIVATE_KEY", TEST_PRIVATE_KEY)


@pytest.fixture
def push_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "VAPID_PRIVATE_KEY", "")


@pytest.fixture
def webpush_calls(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    def fake_webpush(**kwargs: Any) -> None:
        calls.append(kwargs)

    monkeypatch.setattr(push_core, "webpush", fake_webpush)
    return calls


@pytest.fixture(autouse=True)
def _clean_push_rows(db: Session) -> Generator[None]:
    yield
    db.execute(delete(PushSubscription))
    db.commit()


def get_sub(db: Session, endpoint: str) -> PushSubscription | None:
    db.expire_all()
    return db.exec(
        select(PushSubscription).where(PushSubscription.endpoint == endpoint)
    ).first()


# ----- Configuration gate -----------------------------------------------------


@pytest.mark.usefixtures("push_disabled")
def test_public_key_503_when_unconfigured(client: TestClient) -> None:
    r = client.get(PUBLIC_KEY_URL)
    assert r.status_code == 503
    assert r.json()["detail"] == "push niet geconfigureerd"


@pytest.mark.usefixtures("push_disabled")
def test_subscribe_503_when_unconfigured(client: TestClient) -> None:
    r = client.post(SUBSCRIBE_URL, json=sub_payload())
    assert r.status_code == 503


@pytest.mark.usefixtures("push_disabled")
def test_send_helpers_noop_when_unconfigured(
    db: Session, webpush_calls: list[dict[str, Any]]
) -> None:
    db.add(
        PushSubscription(
            endpoint="https://push.example.com/send/noop",
            p256dh="k",
            auth="a",
        )
    )
    db.commit()
    push_core.send_to_followers("t", "b", "/")
    push_core.send_to_admins("t", "b", "/")
    assert webpush_calls == []


@pytest.mark.usefixtures("push_enabled")
def test_public_key_returns_derived_key(client: TestClient) -> None:
    r = client.get(PUBLIC_KEY_URL)
    assert r.status_code == 200
    assert r.json()["public_key"] == TEST_PUBLIC_KEY


# ----- Subscribe / unsubscribe ------------------------------------------------


@pytest.mark.usefixtures("push_enabled")
def test_subscribe_anonymous(client: TestClient, db: Session) -> None:
    payload = sub_payload(wants_reactions=True)
    r = client.post(SUBSCRIBE_URL, json=payload)
    assert r.status_code == 200
    sub = get_sub(db, payload["endpoint"])
    assert sub is not None
    assert sub.user_id is None
    assert sub.p256dh == "client-p256dh"
    assert sub.auth == "client-auth"
    # wants_reactions never sticks for anonymous subscribers.
    assert sub.wants_reactions is False


@pytest.mark.usefixtures("push_enabled")
def test_subscribe_upserts_by_endpoint(client: TestClient, db: Session) -> None:
    payload = sub_payload()
    assert client.post(SUBSCRIBE_URL, json=payload).status_code == 200
    payload["keys"] = {"p256dh": "rotated-p256dh", "auth": "rotated-auth"}
    assert client.post(SUBSCRIBE_URL, json=payload).status_code == 200
    db.expire_all()
    rows = db.exec(
        select(PushSubscription).where(PushSubscription.endpoint == payload["endpoint"])
    ).all()
    assert len(rows) == 1
    assert rows[0].p256dh == "rotated-p256dh"
    assert rows[0].auth == "rotated-auth"


@pytest.mark.usefixtures("push_enabled")
def test_subscribe_normal_user_cannot_enable_reactions(
    client: TestClient, db: Session, normal_user_token_headers: dict[str, str]
) -> None:
    payload = sub_payload(wants_reactions=True)
    r = client.post(SUBSCRIBE_URL, json=payload, headers=normal_user_token_headers)
    assert r.status_code == 200
    me = client.get(f"{API}/users/me", headers=normal_user_token_headers).json()
    sub = get_sub(db, payload["endpoint"])
    assert sub is not None
    assert str(sub.user_id) == me["id"]
    assert sub.wants_reactions is False


@pytest.mark.usefixtures("push_enabled")
def test_subscribe_superuser_wants_reactions(
    client: TestClient, db: Session, superuser_token_headers: dict[str, str]
) -> None:
    payload = sub_payload(wants_reactions=True)
    r = client.post(SUBSCRIBE_URL, json=payload, headers=superuser_token_headers)
    assert r.status_code == 200
    sub = get_sub(db, payload["endpoint"])
    assert sub is not None
    assert sub.user_id is not None
    assert sub.wants_reactions is True

    # Re-POST with the flag off updates the same row.
    payload["wants_reactions"] = False
    r = client.post(SUBSCRIBE_URL, json=payload, headers=superuser_token_headers)
    assert r.status_code == 200
    sub = get_sub(db, payload["endpoint"])
    assert sub is not None
    assert sub.wants_reactions is False


@pytest.mark.usefixtures("push_enabled")
def test_unsubscribe_is_idempotent(client: TestClient, db: Session) -> None:
    payload = sub_payload()
    assert client.post(SUBSCRIBE_URL, json=payload).status_code == 200
    body = {"endpoint": payload["endpoint"]}
    r = client.request("DELETE", SUBSCRIBE_URL, json=body)
    assert r.status_code == 200
    assert get_sub(db, payload["endpoint"]) is None
    # Deleting again (or a never-registered endpoint) still answers 200.
    assert client.request("DELETE", SUBSCRIBE_URL, json=body).status_code == 200


@pytest.mark.usefixtures("push_disabled")
def test_unsubscribe_works_when_unconfigured(client: TestClient) -> None:
    body = {"endpoint": "https://push.example.com/send/gone"}
    assert client.request("DELETE", SUBSCRIBE_URL, json=body).status_code == 200


@pytest.mark.usefixtures("push_enabled")
def test_subscribe_rate_limited(client: TestClient) -> None:
    for _ in range(10):
        assert client.post(SUBSCRIBE_URL, json=sub_payload()).status_code == 200
    r = client.post(SUBSCRIBE_URL, json=sub_payload())
    assert r.status_code == 429
    assert "Retry-After" in r.headers


# ----- Notification triggers --------------------------------------------------


@pytest.fixture
def follower_endpoint(client: TestClient, request: pytest.FixtureRequest) -> str:
    request.getfixturevalue("push_enabled")
    payload = sub_payload()
    assert client.post(SUBSCRIBE_URL, json=payload).status_code == 200
    return str(payload["endpoint"])


@pytest.fixture
def admin_endpoint(
    client: TestClient,
    request: pytest.FixtureRequest,
    superuser_token_headers: dict[str, str],
) -> str:
    request.getfixturevalue("push_enabled")
    payload = sub_payload(wants_reactions=True)
    r = client.post(SUBSCRIBE_URL, json=payload, headers=superuser_token_headers)
    assert r.status_code == 200
    return str(payload["endpoint"])


@pytest.fixture
def stop(db: Session) -> Generator[Stop]:
    stop = create_test_stop(db)
    yield stop
    delete_test_stop(db, stop)


def test_new_stop_notifies_all_followers(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    webpush_calls: list[dict[str, Any]],
    follower_endpoint: str,
    admin_endpoint: str,
) -> None:
    r = client.post(
        f"{API}/stops/",
        json=stop_payload(place="Marrakesh"),
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    created = r.json()
    try:
        assert {c["subscription_info"]["endpoint"] for c in webpush_calls} == {
            follower_endpoint,
            admin_endpoint,
        }
        payload = json.loads(webpush_calls[0]["data"])
        assert payload["title"] == "nieuwe stop: Marrakesh 🛵"
        assert payload["body"] == created["title"]
        assert payload["url"] == f"/?stop={created['id']}"
        assert webpush_calls[0]["vapid_private_key"] == TEST_PRIVATE_KEY
    finally:
        client.delete(f"{API}/stops/{created['id']}", headers=superuser_token_headers)


@pytest.mark.usefixtures("follower_endpoint")
def test_comment_notifies_admins_only(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    webpush_calls: list[dict[str, Any]],
    admin_endpoint: str,
    stop: Stop,
) -> None:
    me = client.get(f"{API}/users/me", headers=normal_user_token_headers).json()
    expected_name = me["full_name"] or me["email"].split("@", 1)[0]
    r = client.post(
        f"{API}/stops/{stop.id}/comments",
        json={"body": "wat een mooie plek!"},
        headers=normal_user_token_headers,
    )
    assert r.status_code == 200
    # Only the opted-in superuser subscription is contacted — the plain
    # follower row is not.
    assert len(webpush_calls) == 1
    call = webpush_calls[0]
    assert call["subscription_info"]["endpoint"] == admin_endpoint
    payload = json.loads(call["data"])
    assert payload["title"] == f"nieuwe reactie van {expected_name}"
    assert payload["body"] == "op Teststad: 'wat een mooie plek!'"
    assert payload["url"] == f"/?stop={stop.id}"


@pytest.mark.usefixtures("admin_endpoint")
def test_long_comment_excerpted(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    webpush_calls: list[dict[str, Any]],
    stop: Stop,
) -> None:
    body = "x" * 500
    r = client.post(
        f"{API}/stops/{stop.id}/comments",
        json={"body": body},
        headers=normal_user_token_headers,
    )
    assert r.status_code == 200
    payload = json.loads(webpush_calls[0]["data"])
    assert payload["body"].endswith("…'")
    assert len(payload["body"]) < 120


@pytest.mark.usefixtures("admin_endpoint")
def test_honk_created_notifies_admins_removal_does_not(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    webpush_calls: list[dict[str, Any]],
    stop: Stop,
) -> None:
    me = client.get(f"{API}/users/me", headers=normal_user_token_headers).json()
    expected_name = me["full_name"] or me["email"].split("@", 1)[0]
    r = client.post(f"{API}/stops/{stop.id}/honks", headers=normal_user_token_headers)
    assert r.status_code == 200
    assert len(webpush_calls) == 1
    payload = json.loads(webpush_calls[0]["data"])
    assert payload["title"] == f"{expected_name} toetert bij Teststad 📯"
    assert payload["url"] == f"/?stop={stop.id}"

    # Toggling the honk off must not notify.
    r = client.post(f"{API}/stops/{stop.id}/honks", headers=normal_user_token_headers)
    assert r.status_code == 200
    assert len(webpush_calls) == 1


# ----- Failure handling -------------------------------------------------------


@pytest.mark.usefixtures("push_enabled")
def test_dead_subscription_is_pruned(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    endpoint = "https://push.example.com/send/dead"
    db.add(PushSubscription(endpoint=endpoint, p256dh="k", auth="a"))
    db.commit()

    def gone_webpush(**_kwargs: Any) -> None:
        raise WebPushException("gone", response=SimpleNamespace(status_code=410))

    monkeypatch.setattr(push_core, "webpush", gone_webpush)
    push_core.send_to_followers("t", "b", "/")
    assert get_sub(db, endpoint) is None


@pytest.mark.usefixtures("push_enabled")
def test_push_failure_never_breaks_the_request(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    admin_endpoint: str,
    stop: Stop,
    db: Session,
) -> None:
    def broken_webpush(**_kwargs: Any) -> None:
        raise WebPushException("relay on fire", response=None)

    monkeypatch.setattr(push_core, "webpush", broken_webpush)
    r = client.post(
        f"{API}/stops/{stop.id}/comments",
        json={"body": "toch gelukt"},
        headers=normal_user_token_headers,
    )
    assert r.status_code == 200
    # Non-404/410 failures keep the subscription around.
    assert get_sub(db, admin_endpoint) is not None
