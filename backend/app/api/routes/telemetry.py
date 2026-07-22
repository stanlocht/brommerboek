import secrets
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlmodel import col, func, select

from app.api.deps import OptionalUser, SessionDep
from app.core import errortrack
from app.core.config import settings
from app.core.ratelimit import rate_limit
from app.models import (
    ERROR_GROUP_STATUSES,
    ErrorEventPublic,
    ErrorGroup,
    ErrorGroupPublic,
    ErrorGroupsPublic,
    ErrorGroupUpdate,
    ErrorReportIn,
    Message,
)

router = APIRouter(prefix="/telemetry", tags=["telemetry"])

# The frontend dedupes and caps reports client-side; this is the backstop
# against a crash-looping tab (or someone hosing the open endpoint).
REPORT_RATE_LIMIT = 10
REPORT_RATE_WINDOW_SECONDS = 60


def require_error_access(request: Request, user: OptionalUser) -> None:
    """
    The admin side of telemetry: a superuser JWT, or the OPS_TOKEN header
    the error-triage workflow authenticates with (constant-time compared;
    disabled entirely while OPS_TOKEN is unset).
    """
    token = request.headers.get("X-Ops-Token")
    if (
        token
        and settings.OPS_TOKEN
        and secrets.compare_digest(token, settings.OPS_TOKEN)
    ):
        return
    if user is not None and user.is_superuser:
        return
    raise HTTPException(status_code=403, detail="Not enough permissions")


def _public(group: ErrorGroup, latest: ErrorEventPublic | None) -> ErrorGroupPublic:
    return ErrorGroupPublic(
        id=group.id,
        fingerprint=group.fingerprint,
        source=group.source,
        title=group.title,
        status=group.status,
        event_count=group.event_count,
        issue_url=group.issue_url,
        first_seen=group.first_seen,
        last_seen=group.last_seen,
        latest_event=latest,
    )


def _latest_public(session: SessionDep, group: ErrorGroup) -> ErrorEventPublic | None:
    event = errortrack.latest_event(session, group.id)
    if event is None:
        return None
    return ErrorEventPublic(
        id=event.id,
        message=event.message,
        stack=event.stack,
        url=event.url,
        context=event.context,
        created_at=event.created_at,
    )


@router.post(
    "/errors",
    response_model=Message,
    dependencies=[
        Depends(
            rate_limit("telemetry", REPORT_RATE_LIMIT, REPORT_RATE_WINDOW_SECONDS)
        )
    ],
)
def report_error(request: Request, report: ErrorReportIn) -> Any:
    """
    Crash report from the frontend (error boundary, window.onerror, failed
    queries). Unauthenticated on purpose: the error screen must be able to
    phone home even when the session is broken or the visitor is logged out.
    """
    context: dict = {"user_agent": request.headers.get("User-Agent", "")[:512]}
    if report.release:
        context["release"] = report.release
    errortrack.record(
        source="frontend",
        message=report.message,
        stack=report.stack,
        url=report.url,
        context=context,
    )
    return Message(message="Error report received")


@router.get(
    "/errors",
    response_model=ErrorGroupsPublic,
    dependencies=[Depends(require_error_access)],
)
def list_error_groups(
    session: SessionDep,
    status: str | None = Query(default=None),
    skip: int = 0,
    limit: int = Query(default=50, le=100),
) -> Any:
    """
    Error groups, most recently seen first. Filter with `?status=open` /
    `?status=reported` / `?status=resolved`. Each group carries its most
    recent stored event as a sample.
    """
    if status is not None and status not in ERROR_GROUP_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"status must be one of: {', '.join(sorted(ERROR_GROUP_STATUSES))}",
        )
    where = [ErrorGroup.status == status] if status is not None else []
    count = session.exec(
        select(func.count()).select_from(ErrorGroup).where(*where)
    ).one()
    groups = session.exec(
        select(ErrorGroup)
        .where(*where)
        .order_by(col(ErrorGroup.last_seen).desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return ErrorGroupsPublic(
        data=[_public(g, _latest_public(session, g)) for g in groups], count=count
    )


@router.patch(
    "/errors/{group_id}",
    response_model=ErrorGroupPublic,
    dependencies=[Depends(require_error_access)],
)
def update_error_group(
    session: SessionDep, group_id: uuid.UUID, update: ErrorGroupUpdate
) -> Any:
    """
    Move a group through the triage flow: the workflow marks it "reported"
    (with the issue URL), a superuser marks it "resolved" once fixed.
    """
    group = session.get(ErrorGroup, group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Error group not found")
    group.status = update.status
    if update.issue_url is not None:
        group.issue_url = update.issue_url
    session.add(group)
    session.commit()
    session.refresh(group)
    return _public(group, _latest_public(session, group))
