"""Superuser-only server health + usage endpoint.

Everything here is read from the OS or computed with a few cheap queries on
demand — no agents, no polling loops, no extra dependencies. The OS reads
(/proc, disk usage) are host-level values because containers share the
kernel; disk numbers reflect the filesystem Docker runs on, which is what
actually fills up on the box.
"""

import os
import shutil
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlmodel import func, select

from app.api.deps import SessionDep, get_current_active_superuser
from app.core import usage
from app.core.config import settings
from app.core.media import MEDIA_ROOT
from app.models import (
    AdminStatus,
    Comment,
    HornHonk,
    PushSubscription,
    StatusDatabase,
    StatusDisk,
    StatusMedia,
    StatusMemory,
    StatusServer,
    Stop,
    UsageDayPublic,
    UsageStat,
    User,
)

router = APIRouter(
    prefix="/status",
    tags=["status"],
    dependencies=[Depends(get_current_active_superuser)],
)

_WORKER_STARTED_AT = datetime.now(UTC)

USAGE_WINDOW_DAYS = 30


def _memory() -> StatusMemory:
    try:
        fields = {}
        with open("/proc/meminfo") as f:
            for line in f:
                key, _, rest = line.partition(":")
                fields[key] = int(rest.strip().split()[0]) * 1024  # kB -> bytes
        return StatusMemory(
            total_bytes=fields.get("MemTotal"),
            available_bytes=fields.get("MemAvailable"),
        )
    except OSError:
        return StatusMemory()


def _host_uptime() -> float | None:
    try:
        with open("/proc/uptime") as f:
            return float(f.read().split()[0])
    except OSError:
        return None


def _media_stats() -> StatusMedia:
    count = 0
    total = 0
    for dirpath, _dirnames, filenames in os.walk(MEDIA_ROOT):
        for name in filenames:
            try:
                total += os.stat(os.path.join(dirpath, name)).st_size
                count += 1
            except OSError:
                continue
    return StatusMedia(file_count=count, total_bytes=total)


def _count(session, model) -> int:
    return session.exec(select(func.count()).select_from(model)).one()


@router.get("/")
def read_status(session: SessionDep) -> AdminStatus:
    """Server health, storage and usage counters for the admin dashboard."""
    # Drain this worker's pending counters so "today" is as fresh as
    # possible; sibling workers may still hold up to a minute of counts.
    usage.flush_now()

    load = os.getloadavg()
    disk = shutil.disk_usage("/")

    since = datetime.now(UTC).date() - timedelta(days=USAGE_WINDOW_DAYS - 1)
    rows = session.exec(
        select(UsageStat)
        .where(UsageStat.day >= since)
        .order_by(UsageStat.day.desc(), UsageStat.bucket)  # type: ignore[attr-defined]
    ).all()
    days: dict = {}
    for row in rows:
        days.setdefault(row.day, {})[row.bucket] = row.count

    return AdminStatus(
        environment=settings.ENVIRONMENT,
        release_tag=os.environ.get("TAG") or None,
        server=StatusServer(
            load_avg=list(load),
            cpu_count=os.cpu_count(),
            memory=_memory(),
            disk=StatusDisk(total_bytes=disk.total, free_bytes=disk.free),
            host_uptime_seconds=_host_uptime(),
            worker_started_at=_WORKER_STARTED_AT,
        ),
        media=_media_stats(),
        database=StatusDatabase(
            size_bytes=session.exec(
                select(func.pg_database_size(func.current_database()))
            ).one(),
            users=_count(session, User),
            stops=_count(session, Stop),
            comments=_count(session, Comment),
            honks=_count(session, HornHonk),
            push_subscriptions=_count(session, PushSubscription),
        ),
        usage=[UsageDayPublic(day=d, buckets=b) for d, b in days.items()],
    )
