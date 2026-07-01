"""Deterministic helpers for country data — same input, same output, no I/O."""


def flag_emoji(code: str) -> str:
    """ISO-3166 alpha-2 code → 🇦🇦 emoji, using regional-indicator symbols.

    Returns "" for missing or malformed codes so callers can treat it as a
    plain string field.
    """
    if not code or len(code) != 2:
        return ""
    a = 0x1F1E6
    cc = code.upper()
    return chr(a + ord(cc[0]) - 65) + chr(a + ord(cc[1]) - 65)
