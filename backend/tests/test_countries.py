import pytest

from app.countries import flag_emoji


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        ("NL", "\U0001f1f3\U0001f1f1"),
        ("BE", "\U0001f1e7\U0001f1ea"),
        ("IT", "\U0001f1ee\U0001f1f9"),
        # Lowercase input is normalised.
        ("nl", "\U0001f1f3\U0001f1f1"),
        ("Ch", "\U0001f1e8\U0001f1ed"),
    ],
)
def test_flag_emoji_valid_codes(code: str, expected: str) -> None:
    assert flag_emoji(code) == expected


@pytest.mark.parametrize("code", ["", "N", "NLD", "NEDERLAND"])
def test_flag_emoji_wrong_length_returns_empty(code: str) -> None:
    assert flag_emoji(code) == ""


def test_flag_emoji_uses_regional_indicators() -> None:
    flag = flag_emoji("AA")
    assert flag == "\U0001f1e6\U0001f1e6"  # A → REGIONAL INDICATOR SYMBOL LETTER A
    assert all(0x1F1E6 <= ord(ch) <= 0x1F1FF for ch in flag_emoji("ZZ"))


def test_flag_emoji_does_not_raise_on_garbage() -> None:
    # Two-character garbage is not validated, only mapped — it must at least
    # not blow up.
    assert isinstance(flag_emoji("1!"), str)
