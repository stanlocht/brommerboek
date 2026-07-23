from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

from app.core import captcha, ratelimit
from app.core.config import settings
from app.core.db import engine, init_db
from app.main import app
from app.models import (
    Comment,
    ErrorEvent,
    ErrorGroup,
    Feedback,
    HornHonk,
    PushSubscription,
    Stop,
    UsageStat,
    User,
)
from tests.utils.user import authentication_token_from_email
from tests.utils.utils import get_superuser_token_headers


@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[Session]:
    with Session(engine) as session:
        init_db(session)
        yield session
        # Wipe every table the suite touches, children before parents so the
        # foreign keys don't complain (comments and honks reference both
        # stops and users). The 10 seeded trip stops are deleted too — that
        # is deliberate: seed_stops() only fires when the stop table is
        # empty, so init_db() re-seeds the exact same trip at the start of
        # the next session. Emptying everything here keeps runs
        # order-independent and deterministic, instead of preserving rows a
        # mid-suite test may have mutated.
        for model in (
            Comment,
            ErrorEvent,
            ErrorGroup,
            Feedback,
            HornHonk,
            PushSubscription,
            Stop,
            UsageStat,
            User,
        ):
            session.execute(delete(model))
        session.commit()


@pytest.fixture(autouse=True)
def _reset_rate_limits() -> Generator[None]:
    # Rate limiter state lives in a module-global dict keyed by
    # (scope, client IP), and every TestClient request shares the same
    # "testclient" IP. Without this reset, hits leak across tests (e.g. the
    # login limit trips after enough unrelated tests log in) and the suite
    # becomes order-dependent.
    with ratelimit._lock:
        ratelimit._hits.clear()
        ratelimit._last_prune.clear()
    yield


@pytest.fixture(autouse=True)
def _disable_signup_captcha(monkeypatch: pytest.MonkeyPatch) -> Generator[None]:
    # The moped-plate captcha has its own tests (which re-enable it);
    # everything else signs up without solving a plate. Burned nonces are
    # cleared so captcha tests never depend on suite order.
    monkeypatch.setattr(settings, "SIGNUP_CAPTCHA_ENABLED", False)
    with captcha._lock:
        captcha._used_nonces.clear()
    yield


@pytest.fixture(scope="module")
def client() -> Generator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def superuser_token_headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture(scope="module")
def normal_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    return authentication_token_from_email(
        client=client, email=settings.EMAIL_TEST_USER, db=db
    )
