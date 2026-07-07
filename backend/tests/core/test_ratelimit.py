import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.core import ratelimit
from app.core.config import settings
from app.core.ratelimit import rate_limit
from tests.utils.utils import random_email, random_lower_string


def make_request(ip: str = "203.0.113.7", forwarded_for: str | None = None) -> Request:
    headers = []
    if forwarded_for is not None:
        headers.append((b"x-forwarded-for", forwarded_for.encode()))
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/",
            "query_string": b"",
            "headers": headers,
            "client": (ip, 1234),
        }
    )


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> dict[str, float]:
    # The limiter reads time through the injectable `ratelimit.now`;
    # replace it with a hand-cranked clock.
    state = {"t": 1_000.0}
    monkeypatch.setattr(ratelimit, "now", lambda: state["t"])
    return state


@pytest.mark.usefixtures("clock")
def test_allows_up_to_limit_then_429() -> None:
    dep = rate_limit("unit-test", limit=3, window_seconds=10)
    request = make_request()
    for _ in range(3):
        dep(request)  # no exception
    with pytest.raises(HTTPException) as exc_info:
        dep(request)
    exc = exc_info.value
    assert exc.status_code == 429
    # The whole window still has to pass before the oldest hit expires.
    assert exc.headers is not None
    assert exc.headers["Retry-After"] == "10"


def test_window_slides_open_again(clock: dict[str, float]) -> None:
    dep = rate_limit("unit-test-slide", limit=2, window_seconds=10)
    request = make_request()
    dep(request)
    clock["t"] += 4  # second hit at t+4
    dep(request)
    with pytest.raises(HTTPException) as exc_info:
        dep(request)
    # Oldest hit is 4s old; 6 more seconds until it leaves the window.
    assert exc_info.value.headers is not None
    assert exc_info.value.headers["Retry-After"] == "6"

    clock["t"] += 6.5  # first hit has now expired
    dep(request)  # allowed again
    with pytest.raises(HTTPException):
        dep(request)  # but the window is full once more


@pytest.mark.usefixtures("clock")
def test_buckets_are_per_ip_and_prefer_forwarded_header() -> None:
    dep = rate_limit("unit-test-ip", limit=1, window_seconds=60)
    dep(make_request(ip="10.0.0.1"))
    with pytest.raises(HTTPException):
        dep(make_request(ip="10.0.0.1"))
    # A different client IP has its own bucket.
    dep(make_request(ip="10.0.0.2"))
    # X-Forwarded-For (first entry) wins over the socket peer address.
    dep(make_request(ip="10.0.0.1", forwarded_for="198.51.100.9, 10.0.0.1"))
    with pytest.raises(HTTPException):
        dep(make_request(ip="10.0.0.99", forwarded_for="198.51.100.9"))


@pytest.mark.usefixtures("clock")
def test_scopes_are_independent() -> None:
    dep_a = rate_limit("unit-test-a", limit=1, window_seconds=60)
    dep_b = rate_limit("unit-test-b", limit=1, window_seconds=60)
    request = make_request()
    dep_a(request)
    dep_b(request)  # same IP, different scope — not limited
    with pytest.raises(HTTPException):
        dep_a(request)


def test_signup_endpoint_returns_429_over_limit(client: TestClient) -> None:
    # API-level check: the signup limiter (5/hour per IP) runs before the
    # handler, so even gated 403 responses consume the bucket. Use a
    # dedicated X-Forwarded-For so this test gets its own bucket.
    from app.api.routes.users import SIGNUP_RATE_LIMIT

    url = f"{settings.API_V1_STR}/users/signup"
    headers = {"X-Forwarded-For": "192.0.2.55"}
    for _ in range(SIGNUP_RATE_LIMIT):
        r = client.post(
            url,
            headers=headers,
            json={"email": random_email(), "password": random_lower_string()},
        )
        assert r.status_code == 403  # registration is closed, but not limited
    r = client.post(
        url,
        headers=headers,
        json={"email": random_email(), "password": random_lower_string()},
    )
    assert r.status_code == 429
    assert r.json()["detail"] == "Too many requests, please try again later"
    assert "Retry-After" in r.headers
    assert int(r.headers["Retry-After"]) >= 1

    # A different client IP is unaffected.
    r = client.post(
        url,
        headers={"X-Forwarded-For": "192.0.2.56"},
        json={"email": random_email(), "password": random_lower_string()},
    )
    assert r.status_code == 403
