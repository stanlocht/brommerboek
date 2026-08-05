"""The rendered emails must carry their data and no leftover placeholders.

The templates are built from `app/email-templates/src/*.mjml` into
`build/*.html`, and only then rendered by Jinja. That is two steps away from
the context dicts in `app/utils.py`, so a renamed key fails silently — Jinja's
default undefined renders as an empty string, and the mail goes out with a
blank where the reset link should be. These tests pin the contract.
"""

import re

import pytest

from app.core.config import settings
from app.utils import (
    generate_new_account_email,
    generate_reset_password_email,
    generate_test_email,
)

# An unrendered `{{ x }}` means the template asks for a key the context does
# not provide (or vice versa).
UNRENDERED = re.compile(r"{{.*?}}")


def test_test_email_renders() -> None:
    data = generate_test_email("rider@example.com")

    assert not UNRENDERED.search(data.html_content)
    assert "rider@example.com" in data.html_content
    assert settings.PROJECT_NAME in data.subject


def test_reset_password_email_renders_the_link() -> None:
    data = generate_reset_password_email(
        email_to="rider@example.com", email="rider@example.com", token="a-token"
    )

    assert not UNRENDERED.search(data.html_content)
    # The whole point of the mail: a working link, with the token on it.
    assert f"{settings.FRONTEND_HOST}/reset-password?token=a-token" in data.html_content
    assert "rider@example.com" in data.html_content
    assert str(settings.EMAIL_RESET_TOKEN_EXPIRE_HOURS) in data.html_content
    assert settings.PROJECT_NAME in data.subject


def test_new_account_email_renders_the_credentials() -> None:
    data = generate_new_account_email(
        email_to="rider@example.com", username="rider@example.com", password="s3cret-pw"
    )

    assert not UNRENDERED.search(data.html_content)
    assert "rider@example.com" in data.html_content
    assert "s3cret-pw" in data.html_content
    assert settings.PROJECT_NAME in data.subject


@pytest.mark.parametrize(
    "html",
    [
        generate_test_email("rider@example.com").html_content,
        generate_reset_password_email(
            email_to="rider@example.com", email="rider@example.com", token="a-token"
        ).html_content,
        generate_new_account_email(
            email_to="rider@example.com", username="rider@example.com", password="pw"
        ).html_content,
    ],
    ids=["test_email", "reset_password", "new_account"],
)
def test_templates_are_self_contained_and_themed(html: str) -> None:
    # No remote assets: a client that blocks images or webfonts must still get
    # the paper look, so nothing may reach out over the network.
    assert "<img" not in html
    assert "fonts.googleapis.com" not in html
    assert "@import" not in html

    # The vintage palette from frontend/src/brommerboek/theme.ts, not the
    # template's teal-on-white default.
    assert "#efe4c9" in html  # paperLight background
    assert "#f4ecd6" in html  # paperCard
    assert "#3a332a" in html  # ink
    assert "#009688" not in html  # the FastAPI template's teal
