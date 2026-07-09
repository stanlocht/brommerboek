from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.usage import bucket_for


def test_status_requires_auth(client: TestClient) -> None:
    r = client.get(f"{settings.API_V1_STR}/status/")
    assert r.status_code == 401


def test_status_forbidden_for_normal_user(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.get(
        f"{settings.API_V1_STR}/status/", headers=normal_user_token_headers
    )
    assert r.status_code == 403


def test_status_reports_health_database_and_usage(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    # Generate at least one tracked request; the status endpoint drains this
    # worker's counters before reading, so it must show up immediately.
    client.get(f"{settings.API_V1_STR}/stops/")

    r = client.get(f"{settings.API_V1_STR}/status/", headers=superuser_token_headers)
    assert r.status_code == 200
    data = r.json()

    assert data["environment"] == settings.ENVIRONMENT
    assert len(data["server"]["load_avg"]) == 3
    assert data["server"]["disk"]["total_bytes"] > 0
    assert data["server"]["disk"]["free_bytes"] > 0
    assert data["media"]["file_count"] >= 0
    assert data["database"]["size_bytes"] > 0
    # The seeded trip plus the test users must be there.
    assert data["database"]["stops"] >= 1
    assert data["database"]["users"] >= 1

    today = datetime.now(UTC).date().isoformat()
    today_buckets = next(d["buckets"] for d in data["usage"] if d["day"] == today)
    assert today_buckets["stops:read"] >= 1


def test_usage_buckets_are_coarse_and_skip_noise() -> None:
    assert bucket_for("/api/v1/stops/", "GET") == "stops:read"
    assert bucket_for("/api/v1/stops/", "POST") == "stops:write"
    assert bucket_for("/api/v1/stops/abc/comments", "GET") == "stops:read"
    assert bucket_for("/media/photo.jpg", "GET") == "media:read"
    assert bucket_for("/s/some-stop", "GET") == "share:read"
    # Health checks ping every few seconds and would drown out real usage.
    assert bucket_for("/api/v1/utils/health-check/", "GET") is None
    # CORS preflights are not usage.
    assert bucket_for("/api/v1/stops/", "OPTIONS") is None
