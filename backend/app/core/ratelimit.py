import math
import threading
import time
from collections import deque
from collections.abc import Callable

from fastapi import HTTPException, Request

# Injectable clock so tests can control time.
now: Callable[[], float] = time.monotonic

# Sweep stale keys at most this often (in clock seconds) to bound memory.
_PRUNE_INTERVAL = 60.0

_lock = threading.Lock()
_hits: dict[tuple[str, str], deque[float]] = {}
_last_prune: dict[str, float] = {}


def _client_ip(request: Request) -> str:
    # Caddy fronts the app and sets X-Forwarded-For; the first entry is the
    # original client.
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",", 1)[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def _prune_scope(scope: str, cutoff: float) -> None:
    stale = [
        key
        for key, queue in _hits.items()
        if key[0] == scope and (not queue or queue[-1] <= cutoff)
    ]
    for key in stale:
        del _hits[key]


def rate_limit(
    scope: str, limit: int, window_seconds: int
) -> Callable[[Request], None]:
    """
    Return a FastAPI dependency enforcing a sliding-window rate limit of
    `limit` requests per `window_seconds`, keyed by (scope, client IP).
    """

    def dependency(request: Request) -> None:
        current = now()
        cutoff = current - window_seconds
        key = (scope, _client_ip(request))
        with _lock:
            last = _last_prune.get(scope)
            if last is None or current - last >= _PRUNE_INTERVAL:
                _prune_scope(scope, cutoff)
                _last_prune[scope] = current
            queue = _hits.setdefault(key, deque())
            while queue and queue[0] <= cutoff:
                queue.popleft()
            if len(queue) >= limit:
                retry_after = max(1, math.ceil(queue[0] - cutoff))
                raise HTTPException(
                    status_code=429,
                    detail="Too many requests, please try again later",
                    headers={"Retry-After": str(retry_after)},
                )
            queue.append(current)

    return dependency
