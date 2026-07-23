"""
Self-hosted signup captcha, styled as a vintage Dutch moped licence plate.

The backend draws a distorted yellow "bromfietsplaat" PNG with a random
plate code and hands the client a signed token that commits to the answer
without revealing it (the token carries an HMAC of the code, not the code
itself). On signup the client sends the token back together with whatever
the human read off the plate; verification checks the HMAC, the expiry
baked into the token, and a one-time-use nonce so a solved captcha cannot
be replayed.

Like the rate limiter, the replay guard is in-process state — fine for the
single-backend deployments this app runs as.
"""

import base64
import hashlib
import hmac
import io
import random
import secrets
import threading
import time

import jwt
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from app.core.config import settings
from app.core.security import ALGORITHM

CAPTCHA_TTL_SECONDS = 10 * 60
_AUDIENCE = "signup-captcha"

# No I/O/Q/S/B and no 0/1: they read ambiguously once the plate is warped.
_LETTERS = "ACDEFGHJKLMNPRTVWXYZ"
_DIGITS = "23456789"

_lock = threading.Lock()
_used_nonces: dict[str, float] = {}


class CaptchaError(Exception):
    """Raised when a captcha token/answer pair does not verify."""


def _normalize(answer: str) -> str:
    return answer.upper().replace("-", "").replace(" ", "")


def _answer_digest(nonce: str, answer: str) -> str:
    message = f"{_AUDIENCE}:{nonce}:{_normalize(answer)}"
    return hmac.new(
        settings.SECRET_KEY.encode(), message.encode(), hashlib.sha256
    ).hexdigest()


def _random_plate_code() -> str:
    rng = secrets.SystemRandom()
    letters = "".join(rng.choice(_LETTERS) for _ in range(2))
    digits = "".join(rng.choice(_DIGITS) for _ in range(2))
    tail = "".join(rng.choice(_LETTERS) for _ in range(2))
    return f"{letters}-{digits}-{tail}"


def create_challenge() -> tuple[str, str, str]:
    """
    Return (token, image_data_uri, plate_code) for a fresh challenge.
    """
    code = _random_plate_code()
    nonce = secrets.token_urlsafe(16)
    token = jwt.encode(
        {
            "exp": int(time.time()) + CAPTCHA_TTL_SECONDS,
            "aud": _AUDIENCE,
            "jti": nonce,
            "ans": _answer_digest(nonce, code),
        },
        settings.SECRET_KEY,
        algorithm=ALGORITHM,
    )
    png = _render_plate(code)
    image = "data:image/png;base64," + base64.b64encode(png).decode()
    return token, image, code


def verify_and_consume(token: str, answer: str) -> None:
    """
    Validate a challenge token/answer pair, burning the token in the
    process (one submit attempt per plate, right or wrong). Raises
    CaptchaError with a user-facing (Dutch) message on any failure.
    """
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[ALGORITHM], audience=_AUDIENCE
        )
    except jwt.ExpiredSignatureError:
        raise CaptchaError("de kentekenplaat is verlopen — haal een nieuwe op")
    except jwt.InvalidTokenError:
        raise CaptchaError("de kentekencontrole is ongeldig — haal een nieuwe plaat op")

    nonce = payload.get("jti")
    expected = payload.get("ans")
    exp = payload.get("exp")
    if not isinstance(nonce, str) or not isinstance(expected, str):
        raise CaptchaError("de kentekencontrole is ongeldig — haal een nieuwe plaat op")

    now = time.time()
    with _lock:
        for spent, spent_exp in list(_used_nonces.items()):
            if spent_exp <= now:
                del _used_nonces[spent]
        if nonce in _used_nonces:
            raise CaptchaError("deze kentekenplaat is al gebruikt — haal een nieuwe op")
        _used_nonces[nonce] = (
            float(exp) if isinstance(exp, int | float) else now + CAPTCHA_TTL_SECONDS
        )

    if not hmac.compare_digest(_answer_digest(nonce, answer), expected):
        raise CaptchaError("dat kenteken klopt niet — probeer een nieuwe plaat")


# --- rendering ------------------------------------------------------------

_PLATE_YELLOW = (244, 186, 26)
_PLATE_EDGE = (26, 24, 16)
_INK = (30, 26, 18)
_BAND_BLUE = (24, 51, 121)


def _render_plate(code: str) -> bytes:
    rng = random.Random(secrets.randbits(64))
    width, height = 360, 116

    plate = Image.new("RGB", (width, height), _PLATE_YELLOW)
    draw = ImageDraw.Draw(plate)

    # Weathered paint: subtle darker speckle across the plate.
    for _ in range(220):
        x = rng.randrange(width)
        y = rng.randrange(height)
        shade = rng.randint(-26, 14)
        base = _PLATE_YELLOW
        draw.point((x, y), fill=tuple(max(0, min(255, c + shade)) for c in base))

    # Blue country band with "NL", like the real bromfietsplaat.
    draw.rounded_rectangle((6, 6, 44, height - 7), radius=8, fill=_BAND_BLUE)
    band_font = ImageFont.load_default(size=18)
    draw.text((14, height - 34), "NL", font=band_font, fill=(240, 240, 235))

    # Each character gets its own jitter and rotation before landing on
    # the plate, so the code can't be read back with naive OCR. Segments
    # are measured up front and the row is centered in the space right of
    # the NL band, so the last letter can never fall off the plate.
    font = ImageFont.load_default(size=44)
    dash_width = 18
    segments: list[tuple[Image.Image | None, int]] = []
    for ch in code:
        if ch == "-":
            segments.append((None, dash_width))
            continue
        bbox = font.getbbox(ch)
        ch_w = int(bbox[2] - bbox[0])
        ch_h = int(bbox[3] - bbox[1])
        tile = Image.new("RGBA", (ch_w + 16, ch_h + 16), (0, 0, 0, 0))
        ImageDraw.Draw(tile).text((8 - bbox[0], 8 - bbox[1]), ch, font=font, fill=_INK)
        tile = tile.rotate(
            rng.uniform(-14, 14), expand=True, resample=Image.Resampling.BICUBIC
        )
        segments.append((tile, ch_w + rng.randint(2, 6)))

    row_width = sum(advance for _, advance in segments)
    x = max(50, 50 + (width - 58 - row_width) // 2)
    for segment, advance in segments:
        if segment is None:
            dash_y = height // 2 + rng.randint(-4, 4)
            draw.line((x + 2, dash_y, x + 14, dash_y), fill=_INK, width=5)
        else:
            y = (height - segment.height) // 2 + rng.randint(-7, 7)
            plate.paste(segment, (x, y), segment)
        x += advance

    # Road grime: a few wavy scratch lines over the code.
    for _ in range(3):
        points = []
        yy = rng.randint(18, height - 18)
        for xx in range(8, width - 8, 14):
            yy += rng.randint(-9, 9)
            points.append((xx, max(10, min(height - 10, yy))))
        draw.line(points, fill=(94, 74, 32), width=2)

    # Plate border, drawn last so the grime stays inside it.
    draw.rounded_rectangle(
        (2, 2, width - 3, height - 3), radius=14, outline=_PLATE_EDGE, width=5
    )

    plate = plate.filter(ImageFilter.SMOOTH)

    buffer = io.BytesIO()
    plate.save(buffer, format="PNG")
    return buffer.getvalue()
