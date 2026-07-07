import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models import User
from tests.utils.utils import random_email, random_lower_string

SIGNUP_URL = f"{settings.API_V1_STR}/users/signup"


def _signup_payload() -> dict[str, str]:
    return {
        "email": random_email(),
        "password": random_lower_string(),
        "full_name": "Proefkonijn",
    }


def test_signup_forbidden_when_registration_closed(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "USERS_OPEN_REGISTRATION", False)
    payload = _signup_payload()
    r = client.post(SIGNUP_URL, json=payload)
    assert r.status_code == 403
    assert r.json()["detail"] == "Open user registration is forbidden on this server"
    # And no user was created behind the gate.
    assert db.exec(select(User).where(User.email == payload["email"])).first() is None


def test_signup_allowed_when_registration_open(
    client: TestClient, db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "USERS_OPEN_REGISTRATION", True)
    payload = _signup_payload()
    r = client.post(SIGNUP_URL, json=payload)
    assert r.status_code == 200
    created = r.json()
    assert created["email"] == payload["email"]
    assert created["is_superuser"] is False
    user = db.exec(select(User).where(User.email == payload["email"])).first()
    assert user is not None


def test_signup_gate_fires_before_duplicate_check(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # With the gate closed, even an existing email gets the 403 (not the 400
    # duplicate error) — the gate must not leak which emails are registered.
    monkeypatch.setattr(settings, "USERS_OPEN_REGISTRATION", False)
    r = client.post(
        SIGNUP_URL,
        json={
            "email": settings.FIRST_SUPERUSER,
            "password": random_lower_string(),
            "full_name": "Indringer",
        },
    )
    assert r.status_code == 403
