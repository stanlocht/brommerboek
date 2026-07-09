"""Lightweight request counting for the superuser status endpoint.

Same shape as core/ratelimit.py: module-global state behind a lock, one copy
per uvicorn worker (the container runs 4). Each request increments an
in-memory counter; at most once per FLUSH_INTERVAL_SECONDS a worker drains
its counters into the `usagestat` table with an additive upsert
(count = count + n), so concurrent workers can never clobber each other and
the steady-state cost is one tiny batched write per worker per minute.

Counters are best-effort by design: a worker that dies loses at most one
interval of counts, and a failed flush is logged and dropped rather than
retried. That trade keeps the hot path to a dict increment under a lock.
"""

import logging
import threading
import time
from datetime import UTC, date, datetime

from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session

from app.core.db import engine
from app.models import UsageStat

logger = logging.getLogger(__name__)

FLUSH_INTERVAL_SECONDS = 60

_lock = threading.Lock()
_counts: dict[tuple[date, str], int] = {}
_last_flush = time.monotonic()


def bucket_for(path: str, method: str) -> str | None:
    """Map a request to a coarse counter bucket, or None to not count it.

    Buckets are "<first path segment>:<read|write>" so cardinality stays
    bounded by the number of routers, not the number of URLs.
    """
    if method in ("OPTIONS", "HEAD"):
        return None
    if path.startswith("/api/v1/"):
        segment = path[len("/api/v1/") :].split("/", 1)[0] or "root"
        # utils is the health check, pinged by compose/deploy/uptime
        # monitors every few seconds — it would drown out real usage.
        if segment == "utils":
            return None
        kind = "read" if method == "GET" else "write"
        return f"{segment[:40]}:{kind}"
    if path == "/media" or path.startswith("/media/"):
        return "media:read"
    if path == "/s" or path.startswith("/s/"):
        return "share:read"
    # Anything else never reaches the backend in production (Caddy routes
    # only /api/*, /media/* and /s/* here).
    return None


def record(path: str, method: str) -> dict[tuple[date, str], int] | None:
    """Count one request. Returns a snapshot to flush when one is due."""
    global _last_flush
    bucket = bucket_for(path, method)
    now = time.monotonic()
    with _lock:
        if bucket is not None:
            key = (datetime.now(UTC).date(), bucket)
            _counts[key] = _counts.get(key, 0) + 1
        if _counts and now - _last_flush >= FLUSH_INTERVAL_SECONDS:
            _last_flush = now
            snapshot = dict(_counts)
            _counts.clear()
            return snapshot
    return None


def flush(snapshot: dict[tuple[date, str], int]) -> None:
    """Additively upsert a drained snapshot into usagestat."""
    if not snapshot:
        return
    try:
        stmt = insert(UsageStat).values(
            [
                {"day": day, "bucket": bucket, "count": n}
                for (day, bucket), n in snapshot.items()
            ]
        )
        stmt = stmt.on_conflict_do_update(
            index_elements=["day", "bucket"],
            set_={"count": UsageStat.__table__.c.count + stmt.excluded.count},  # type: ignore[attr-defined]
        )
        with Session(engine) as session:
            session.execute(stmt)
            session.commit()
    except Exception:
        logger.warning(
            "usage flush failed; dropping %d counter(s)", len(snapshot), exc_info=True
        )


def flush_now() -> None:
    """Drain this worker's counters immediately (status endpoint, shutdown)."""
    global _last_flush
    with _lock:
        snapshot = dict(_counts)
        _counts.clear()
        _last_flush = time.monotonic()
    flush(snapshot)
