from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from app.api.deps import OptionalUser, SessionDep
from app.core.config import settings
from app.core.push import vapid_public_key
from app.core.ratelimit import rate_limit
from app.models import (
    Message,
    PushPublicKey,
    PushSubscribeIn,
    PushSubscription,
    PushUnsubscribeIn,
)

router = APIRouter(prefix="/push", tags=["push"])

SUBSCRIBE_RATE_LIMIT = 10
SUBSCRIBE_RATE_WINDOW_SECONDS = 60


def _require_push_configured() -> None:
    if not settings.push_enabled:
        raise HTTPException(status_code=503, detail="push niet geconfigureerd")


@router.get("/public-key", response_model=PushPublicKey)
def read_public_key() -> Any:
    """
    The VAPID application server key browsers need to subscribe. Public.
    """
    _require_push_configured()
    return PushPublicKey(public_key=vapid_public_key())


@router.post(
    "/subscribe",
    response_model=Message,
    dependencies=[
        Depends(
            rate_limit(
                "push-subscribe", SUBSCRIBE_RATE_LIMIT, SUBSCRIBE_RATE_WINDOW_SECONDS
            )
        )
    ],
)
def subscribe(session: SessionDep, me: OptionalUser, body: PushSubscribeIn) -> Any:
    """
    Register (or refresh) a browser push subscription. Public — anonymous
    followers are welcome. Upserts by endpoint. When the caller is signed in
    the subscription is linked to their account; `wants_reactions` only
    sticks for superusers.
    """
    _require_push_configured()
    sub = session.exec(
        select(PushSubscription).where(PushSubscription.endpoint == body.endpoint)
    ).first()
    if sub is None:
        sub = PushSubscription(endpoint=body.endpoint, p256dh="", auth="")
    sub.p256dh = body.keys.p256dh
    sub.auth = body.keys.auth
    if me is not None:
        sub.user_id = me.id
    sub.wants_reactions = bool(
        me is not None and me.is_superuser and body.wants_reactions
    )
    session.add(sub)
    try:
        session.commit()
    except IntegrityError:
        # Lost a race with a concurrent subscribe for the same endpoint —
        # the unique constraint already guarantees a row exists.
        session.rollback()
    return Message(message="je volgt de reis")


@router.delete("/subscribe", response_model=Message)
def unsubscribe(session: SessionDep, body: PushUnsubscribeIn) -> Any:
    """
    Remove a push subscription by endpoint. Idempotent: unknown endpoints
    return 200 too. Works even when push is unconfigured, so stale browsers
    can always clean up after themselves.
    """
    sub = session.exec(
        select(PushSubscription).where(PushSubscription.endpoint == body.endpoint)
    ).first()
    if sub is not None:
        session.delete(sub)
        session.commit()
    return Message(message="melding uitgezet")
