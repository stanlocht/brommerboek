"""
Error telemetry recording.

`record()` upserts an ErrorGroup (keyed by a normalized fingerprint) and, up
to a per-group cap, stores the full ErrorEvent. It is called from the
last-resort exception middleware in main.py and from the public
/telemetry/errors endpoint the frontend crash handlers post to, so it must
never raise: a broken telemetry write may not take down the request (or
recurse — the middleware would happily record the recording failure).
"""

import hashlib
import logging
import os
import re
import traceback
import uuid

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, func, select

from app.core.db import engine
from app.models import (
    ERROR_EVENTS_KEPT_PER_GROUP,
    ErrorEvent,
    ErrorGroup,
    get_datetime_utc,
)

logger = logging.getLogger(__name__)

TITLE_MAX_LENGTH = 500

# Volatile fragments that would split one logical error into many groups:
# uuids, long hex ids, and any run of digits (line/column numbers in minified
# frontend stacks change every release; ids and timestamps change every
# request).
_UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE
)
_HEX_RE = re.compile(r"\b[0-9a-f]{16,}\b", re.IGNORECASE)
_NUM_RE = re.compile(r"\d+")


def _normalize(text: str) -> str:
    text = _UUID_RE.sub("<uuid>", text)
    text = _HEX_RE.sub("<hex>", text)
    return _NUM_RE.sub("#", text)


def _top_frame(stack: str) -> str:
    # First stack line that points at a code location — enough to separate
    # "same message, different call site" without being release-volatile
    # after normalization.
    for line in stack.splitlines():
        line = line.strip()
        if line.startswith(("at ", "File ")) or "@" in line:
            return line
    return ""


def fingerprint(source: str, message: str, stack: str = "") -> str:
    key = "|".join((source, _normalize(message), _normalize(_top_frame(stack))))
    return hashlib.sha256(key.encode()).hexdigest()


def release_tag() -> str:
    # Same source as the /status endpoint: the image tag the box is running.
    return os.environ.get("TAG") or ""


def _upsert_group(session: Session, print_: str, source: str, title: str) -> ErrorGroup:
    group = session.exec(
        select(ErrorGroup).where(ErrorGroup.fingerprint == print_)
    ).first()
    if group is None:
        group = ErrorGroup(fingerprint=print_, source=source, title=title)
        session.add(group)
        try:
            session.flush()
        except IntegrityError:
            # Two workers saw the same new error at once; the other insert
            # won the unique(fingerprint) race — use its row.
            session.rollback()
            group = session.exec(
                select(ErrorGroup).where(ErrorGroup.fingerprint == print_)
            ).one()
    return group


def record(
    *,
    source: str,
    message: str,
    stack: str = "",
    url: str = "",
    context: dict | None = None,
) -> None:
    """
    Record one error occurrence. Opens its own session (the request's session
    may be mid-rollback when this runs) and swallows every failure.
    """
    try:
        message = message.strip() or "(no message)"
        print_ = fingerprint(source, message, stack)
        title = message[:TITLE_MAX_LENGTH]
        with Session(engine) as session:
            group = _upsert_group(session, print_, source, title)
            group.event_count += 1
            group.last_seen = get_datetime_utc()
            # A recurrence of something marked resolved is a regression —
            # reopen it so the triage workflow files a fresh issue.
            # "reported" stays reported: the existing issue tracks it.
            if group.status == "resolved":
                group.status = "open"
                group.issue_url = None
            stored = session.exec(
                select(func.count())
                .select_from(ErrorEvent)
                .where(ErrorEvent.group_id == group.id)
            ).one()
            if stored < ERROR_EVENTS_KEPT_PER_GROUP:
                session.add(
                    ErrorEvent(
                        group_id=group.id,
                        message=message,
                        stack=stack,
                        url=url,
                        context=context or {},
                    )
                )
            session.add(group)
            session.commit()
    except Exception:
        logger.exception("failed to record error telemetry")


def record_exception(exc: BaseException, *, method: str, path: str, user_agent: str) -> None:
    """Record an unhandled backend exception (called from middleware)."""
    stack = "".join(traceback.format_exception(exc))
    context = {
        "method": method,
        "user_agent": user_agent,
    }
    if release_tag():
        context["release"] = release_tag()
    record(
        source="backend",
        message=f"{type(exc).__name__}: {exc}",
        stack=stack,
        url=f"{method} {path}",
        context=context,
    )


def latest_event(session: Session, group_id: uuid.UUID) -> ErrorEvent | None:
    return session.exec(
        select(ErrorEvent)
        .where(ErrorEvent.group_id == group_id)
        .order_by(col(ErrorEvent.created_at).desc())
        .limit(1)
    ).first()
