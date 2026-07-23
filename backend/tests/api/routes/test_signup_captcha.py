import base64
import time

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core import captcha
from app.core.config import settings
from app.core.security import ALGORITHM
from app.models import User
from tests.utils.utils import random_email, random_lower_string

SIGNUP_URL = f"{settings.API_V1_STR}/users/signup"
CAPTCHA_URL = f"{settings.API_V1_STR}/users/signup-captcha"


@pytest.fixture(autouse=True)
def _open_registration_with_captcha(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "USERS_OPEN_REGISTRATION", True)
    monkeypatch.setattr(settings, "SIGNUP_CAPTCHA_ENABLED", True)


def _signup_payload(**captcha_fields: str) -> dict[str, str]:
    return {
        "email": random_email(),
        "password": random_lower_string(),
        "full_name": "Proefkonijn",
        **captcha_fields,
    }


def _fresh_challenge(client: TestClient) -> dict[str, str]:
    r = client.get(CAPTCHA_URL)
    assert r.status_code == 200
    return r.json()


def test_challenge_returns_plate_image_and_token(client: TestClient) -> None:
    challenge = _fresh_challenge(client)
    assert challenge["token"]
    assert challenge["image"].startswith("data:image/png;base64,")
    # The payload really is a PNG.
    png = base64.b64decode(challenge["image"].split(",", 1)[1])
    assert png.startswith(b"\x89PNG")
    # Local environment exposes the answer for the e2e suite.
    assert settings.ENVIRONMENT == "local"
    assert challenge["answer"]


def test_challenge_hides_answer_outside_local(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ENVIRONMENT", "production")
    challenge = _fresh_challenge(client)
    assert challenge["answer"] is None


def test_signup_without_captcha_is_rejected(client: TestClient, db: Session) -> None:
    payload = _signup_payload()
    r = client.post(SIGNUP_URL, json=payload)
    assert r.status_code == 400
    assert "kenteken" in r.json()["detail"]
    assert db.exec(select(User).where(User.email == payload["email"])).first() is None


def test_signup_with_wrong_answer_is_rejected(client: TestClient) -> None:
    challenge = _fresh_challenge(client)
    r = client.post(
        SIGNUP_URL,
        json=_signup_payload(
            captcha_token=challenge["token"], captcha_answer="XX-00-XX"
        ),
    )
    assert r.status_code == 400
    assert "klopt niet" in r.json()["detail"]


def test_signup_with_correct_answer_creates_user(
    client: TestClient, db: Session
) -> None:
    challenge = _fresh_challenge(client)
    payload = _signup_payload(
        captcha_token=challenge["token"], captcha_answer=challenge["answer"]
    )
    r = client.post(SIGNUP_URL, json=payload)
    assert r.status_code == 200
    assert db.exec(select(User).where(User.email == payload["email"])).first()


def test_answer_is_forgiving_about_case_and_dashes(client: TestClient) -> None:
    challenge = _fresh_challenge(client)
    scrambled = challenge["answer"].replace("-", " ").lower()
    r = client.post(
        SIGNUP_URL,
        json=_signup_payload(
            captcha_token=challenge["token"], captcha_answer=scrambled
        ),
    )
    assert r.status_code == 200


def test_token_is_single_use(client: TestClient) -> None:
    challenge = _fresh_challenge(client)
    first = client.post(
        SIGNUP_URL,
        json=_signup_payload(
            captcha_token=challenge["token"], captcha_answer=challenge["answer"]
        ),
    )
    assert first.status_code == 200
    second = client.post(
        SIGNUP_URL,
        json=_signup_payload(
            captcha_token=challenge["token"], captcha_answer=challenge["answer"]
        ),
    )
    assert second.status_code == 400
    assert "al gebruikt" in second.json()["detail"]


def test_wrong_answer_burns_the_token(client: TestClient) -> None:
    # One submit attempt per plate: a wrong guess can't be retried against
    # the same token, which blocks brute-forcing a single challenge.
    challenge = _fresh_challenge(client)
    r = client.post(
        SIGNUP_URL,
        json=_signup_payload(
            captcha_token=challenge["token"], captcha_answer="XX-00-XX"
        ),
    )
    assert r.status_code == 400
    retry = client.post(
        SIGNUP_URL,
        json=_signup_payload(
            captcha_token=challenge["token"], captcha_answer=challenge["answer"]
        ),
    )
    assert retry.status_code == 400
    assert "al gebruikt" in retry.json()["detail"]


def test_expired_token_is_rejected(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(captcha, "CAPTCHA_TTL_SECONDS", -10)
    challenge = _fresh_challenge(client)
    r = client.post(
        SIGNUP_URL,
        json=_signup_payload(
            captcha_token=challenge["token"], captcha_answer=challenge["answer"]
        ),
    )
    assert r.status_code == 400
    assert "verlopen" in r.json()["detail"]


def test_access_token_is_not_a_captcha_token(client: TestClient) -> None:
    # A regular JWT signed with the same secret (e.g. a login access token)
    # must not pass as a captcha token — the audience claim keeps the two
    # token families apart.
    forged = jwt.encode(
        {"exp": int(time.time()) + 600, "sub": "someone"},
        settings.SECRET_KEY,
        algorithm=ALGORITHM,
    )
    r = client.post(
        SIGNUP_URL,
        json=_signup_payload(captcha_token=forged, captcha_answer="AB-12-CD"),
    )
    assert r.status_code == 400
    assert "ongeldig" in r.json()["detail"]


def test_captcha_check_runs_before_duplicate_email_check(
    client: TestClient,
) -> None:
    # Without a valid captcha the endpoint must not reveal whether an email
    # is registered.
    r = client.post(
        SIGNUP_URL,
        json={
            "email": settings.FIRST_SUPERUSER,
            "password": random_lower_string(),
            "full_name": "Indringer",
        },
    )
    assert r.status_code == 400
    assert "kenteken" in r.json()["detail"]
