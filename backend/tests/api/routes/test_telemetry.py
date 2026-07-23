from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.core import errortrack
from app.core.config import settings
from app.models import ERROR_EVENTS_KEPT_PER_GROUP, ErrorEvent, ErrorGroup

REPORT_URL = f"{settings.API_V1_STR}/telemetry/errors"


def _report(client: TestClient, message: str, **overrides: str) -> None:
    payload = {
        "message": message,
        "stack": "Error: boom\n    at crash (https://brommerboek.nl/assets/index-abc123.js:1:2345)",
        "url": "https://brommerboek.nl/logboek",
        "release": "deadbeef",
    }
    payload.update(overrides)
    r = client.post(REPORT_URL, json=payload)
    assert r.status_code == 200, r.text


def test_report_error_requires_no_auth(client: TestClient, db: Session) -> None:
    _report(client, "TypeError: x is undefined")
    group = db.exec(
        select(ErrorGroup).where(ErrorGroup.title == "TypeError: x is undefined")
    ).one()
    assert group.source == "frontend"
    assert group.status == "open"
    assert group.event_count == 1
    event = db.exec(select(ErrorEvent).where(ErrorEvent.group_id == group.id)).one()
    assert event.url == "https://brommerboek.nl/logboek"
    assert event.context["release"] == "deadbeef"
    assert "user_agent" in event.context


def test_reports_group_by_fingerprint_despite_volatile_ids(
    client: TestClient, db: Session
) -> None:
    # Same failure, different uuids / line numbers → one group, two events.
    _report(
        client,
        "Failed to load stop 4d3699f2-30e7-4f95-9caa-c94a7d8f9312 (500)",
        stack="at load (https://x/assets/index-1a2b.js:1:111)",
    )
    _report(
        client,
        "Failed to load stop 8d743994-30e7-4f95-9caa-c94a7d8f9313 (500)",
        stack="at load (https://x/assets/index-9f8e.js:7:999)",
    )
    group = db.exec(
        select(ErrorGroup).where(col(ErrorGroup.title).contains("Failed to load stop"))
    ).one()
    assert group.event_count == 2


def test_event_storage_is_capped_but_count_keeps_climbing(db: Session) -> None:
    # Bypass the HTTP rate limit; the cap is enforced in errortrack itself.
    for _ in range(ERROR_EVENTS_KEPT_PER_GROUP + 5):
        errortrack.record(source="frontend", message="crash loop", stack="at loop")
    group = db.exec(select(ErrorGroup).where(ErrorGroup.title == "crash loop")).one()
    assert group.event_count == ERROR_EVENTS_KEPT_PER_GROUP + 5
    stored = db.exec(select(ErrorEvent).where(ErrorEvent.group_id == group.id)).all()
    assert len(stored) == ERROR_EVENTS_KEPT_PER_GROUP


def test_report_rate_limited(client: TestClient) -> None:
    from app.api.routes.telemetry import REPORT_RATE_LIMIT

    for i in range(REPORT_RATE_LIMIT):
        _report(client, f"rate limit probe {i}")
    r = client.post(REPORT_URL, json={"message": "over the limit"})
    assert r.status_code == 429


def test_list_requires_superuser_or_ops_token(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    assert client.get(REPORT_URL).status_code == 403
    assert client.get(REPORT_URL, headers=normal_user_token_headers).status_code == 403
    # A wrong header while OPS_TOKEN is unset must not open the door.
    assert (
        client.get(REPORT_URL, headers={"X-Ops-Token": ""}).status_code == 403
    )


def test_superuser_lists_groups_with_latest_event(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    _report(client, "ReferenceError: kaart is not defined")
    r = client.get(REPORT_URL, headers=superuser_token_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["count"] >= 1
    match = next(
        g for g in body["data"] if g["title"] == "ReferenceError: kaart is not defined"
    )
    assert match["latest_event"]["message"] == "ReferenceError: kaart is not defined"
    assert match["status"] == "open"


def test_ops_token_header_grants_access_and_updates_status(
    client: TestClient, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "OPS_TOKEN", "sekrit-ops-token")
    headers = {"X-Ops-Token": "sekrit-ops-token"}
    _report(client, "NetworkError: fetch failed")
    r = client.get(f"{REPORT_URL}?status=open", headers=headers)
    assert r.status_code == 200
    group = next(
        g for g in r.json()["data"] if g["title"] == "NetworkError: fetch failed"
    )
    r = client.patch(
        f"{REPORT_URL}/{group['id']}",
        headers=headers,
        json={
            "status": "reported",
            "issue_url": "https://github.com/stanlocht/brommerboek/issues/999",
        },
    )
    assert r.status_code == 200
    assert r.json()["status"] == "reported"
    assert r.json()["issue_url"].endswith("/999")
    # Wrong token stays locked out even with OPS_TOKEN configured.
    assert (
        client.get(REPORT_URL, headers={"X-Ops-Token": "wrong"}).status_code == 403
    )


def test_resolved_group_reopens_on_recurrence(
    client: TestClient, superuser_token_headers: dict[str, str], db: Session
) -> None:
    _report(client, "IndexError: list index out of range", stack="at once")
    group = db.exec(
        select(ErrorGroup).where(
            ErrorGroup.title == "IndexError: list index out of range"
        )
    ).one()
    r = client.patch(
        f"{REPORT_URL}/{group.id}",
        headers=superuser_token_headers,
        json={"status": "resolved"},
    )
    assert r.status_code == 200
    _report(client, "IndexError: list index out of range", stack="at once")
    db.expire_all()
    group = db.exec(select(ErrorGroup).where(ErrorGroup.id == group.id)).one()
    assert group.status == "open"
    assert group.issue_url is None


def test_invalid_status_rejected(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.get(f"{REPORT_URL}?status=bogus", headers=superuser_token_headers)
    assert r.status_code == 422


def test_unhandled_backend_exception_is_recorded(db: Session) -> None:
    # Drive the middleware directly with a route that blows up. A separate
    # app instance would lose the middleware, so bolt the route onto the
    # real app and use a client that doesn't re-raise server exceptions.
    from fastapi.testclient import TestClient as TC

    from app.main import app

    # The app's generate_unique_id_function indexes route.tags, so the
    # test route needs one.
    @app.get("/api/v1/_boom_test_route", tags=["boomtest"])
    def _boom() -> None:
        raise RuntimeError("kaboom for telemetry test")

    try:
        with TC(app, raise_server_exceptions=False) as c:
            r = c.get("/api/v1/_boom_test_route")
            assert r.status_code == 500
    finally:
        app.router.routes[:] = [
            route
            for route in app.router.routes
            if getattr(route, "path", "") != "/api/v1/_boom_test_route"
        ]
    group = db.exec(
        select(ErrorGroup).where(
            ErrorGroup.title == "RuntimeError: kaboom for telemetry test"
        )
    ).one()
    assert group.source == "backend"
    event = db.exec(select(ErrorEvent).where(ErrorEvent.group_id == group.id)).one()
    assert event.url == "GET /api/v1/_boom_test_route"
    assert "kaboom for telemetry test" in event.stack
