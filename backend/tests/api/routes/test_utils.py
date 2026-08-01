import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.utils import SendResult

TEST_EMAIL_URL = f"{settings.API_V1_STR}/utils/test-email/"


@pytest.fixture
def smtp_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    # `emails_enabled` is a computed field over these two, so setting them is
    # all it takes to flip the feature on for a test.
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(settings, "EMAILS_FROM_EMAIL", "noreply@example.com")


def test_test_email_requires_auth(client: TestClient) -> None:
    r = client.post(TEST_EMAIL_URL, params={"email_to": "rider@example.com"})
    assert r.status_code == 401


def test_test_email_forbidden_for_normal_user(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.post(
        TEST_EMAIL_URL,
        params={"email_to": "rider@example.com"},
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403


def test_test_email_503_without_smtp(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    # No SMTP settings patched: the endpoint must say so, not crash on
    # send_email's assertion the way a bare 500 would.
    r = client.post(
        TEST_EMAIL_URL,
        params={"email_to": "rider@example.com"},
        headers=superuser_token_headers,
    )
    assert r.status_code == 503
    assert "not configured" in r.json()["detail"]


@pytest.mark.usefixtures("smtp_configured")
def test_test_email_rejects_malformed_address(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.post(
        TEST_EMAIL_URL,
        params={"email_to": "not-an-address"},
        headers=superuser_token_headers,
    )
    assert r.status_code == 422


@pytest.mark.usefixtures("smtp_configured")
def test_test_email_sends_to_the_requested_address(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: dict[str, str] = {}

    def fake_send_email(
        *, email_to: str, subject: str, html_content: str
    ) -> SendResult:
        sent.update(email_to=email_to, subject=subject, html_content=html_content)
        return SendResult(success=True, detail="250 OK")

    monkeypatch.setattr("app.api.routes.utils.send_email", fake_send_email)

    r = client.post(
        TEST_EMAIL_URL,
        params={"email_to": "rider@example.com"},
        headers=superuser_token_headers,
    )
    assert r.status_code == 201
    assert r.json()["message"] == "Test email sent to rider@example.com"
    assert sent["email_to"] == "rider@example.com"
    assert settings.PROJECT_NAME in sent["subject"]
    # The rendered template must name the recipient, so a delivered message
    # is recognisable as this test and not a stale one.
    assert "rider@example.com" in sent["html_content"]


@pytest.mark.usefixtures("smtp_configured")
def test_test_email_502_when_the_relay_refuses(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # python-emails swallows SMTP failures into its response object, so a
    # refused message would otherwise be reported to the admin as a success.
    def fake_send_email(**_kwargs: str) -> SendResult:
        return SendResult(success=False, detail="550 Sender address rejected")

    monkeypatch.setattr("app.api.routes.utils.send_email", fake_send_email)

    r = client.post(
        TEST_EMAIL_URL,
        params={"email_to": "rider@example.com"},
        headers=superuser_token_headers,
    )
    assert r.status_code == 502
    assert "550 Sender address rejected" in r.json()["detail"]


def test_health_check(client: TestClient) -> None:
    r = client.get(f"{settings.API_V1_STR}/utils/health-check/")
    assert r.status_code == 200
    assert r.json() is True
