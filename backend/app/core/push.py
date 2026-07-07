"""Self-hosted Web Push sending.

No third-party service beyond the browsers' built-in push relays: each
subscription's endpoint lives at the subscriber's browser vendor and we POST
encrypted payloads straight to it, signed with our VAPID key.

The send helpers run as FastAPI background tasks after the response has been
sent, open their own DB session and never raise — a push failure must never
fail the API request that triggered it.
"""

import json
import logging

from pywebpush import WebPushException, webpush  # type: ignore[import-untyped]
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.models import PushSubscription, User

logger = logging.getLogger(__name__)

# Push relays may drop undelivered messages after this many seconds.
PUSH_TTL_SECONDS = 24 * 60 * 60


def vapid_public_key() -> str:
    """
    The base64url application server key (uncompressed P-256 point) derived
    from the configured private key. Assumes push is configured.
    """
    from cryptography.hazmat.primitives import serialization
    from py_vapid import Vapid, b64urlencode  # type: ignore[import-untyped]

    vapid = Vapid.from_string(settings.VAPID_PRIVATE_KEY)
    key: str = b64urlencode(
        vapid.public_key.public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
    )
    return key


def _send_one(session: Session, sub: PushSubscription, payload: str) -> None:
    try:
        webpush(
            subscription_info={
                "endpoint": sub.endpoint,
                "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
            },
            data=payload,
            vapid_private_key=settings.VAPID_PRIVATE_KEY,
            vapid_claims={"sub": f"mailto:{settings.VAPID_CLAIMS_EMAIL}"},
            ttl=PUSH_TTL_SECONDS,
        )
    except WebPushException as exc:
        status = getattr(exc.response, "status_code", None)
        if status in (404, 410):
            # The subscription no longer exists at the relay — prune it.
            session.delete(sub)
            session.commit()
        else:
            logger.warning("web push to %s failed: %s", sub.endpoint, exc)
    except Exception:
        logger.exception("unexpected web push failure for %s", sub.endpoint)


def _send_payload(
    subscriptions: list[PushSubscription],
    session: Session,
    title: str,
    body: str,
    url: str,
) -> None:
    payload = json.dumps({"title": title, "body": body, "url": url})
    for sub in subscriptions:
        _send_one(session, sub, payload)


def send_to_followers(title: str, body: str, url: str) -> None:
    """Notify every subscribed browser (new-stop notifications)."""
    if not settings.push_enabled:
        return
    with Session(engine) as session:
        subs = list(session.exec(select(PushSubscription)).all())
        _send_payload(subs, session, title, body, url)


def send_to_admins(title: str, body: str, url: str) -> None:
    """Notify superusers who opted into reaction notifications."""
    if not settings.push_enabled:
        return
    with Session(engine) as session:
        statement = (
            select(PushSubscription)
            .join(User, col(PushSubscription.user_id) == col(User.id))
            .where(PushSubscription.wants_reactions, User.is_superuser)
        )
        subs = list(session.exec(statement).all())
        _send_payload(subs, session, title, body, url)
