import uuid
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, SessionDep, get_current_active_superuser
from app.core import push
from app.core.ratelimit import rate_limit
from app.models import (
    FEEDBACK_STATUSES,
    Feedback,
    FeedbackCreate,
    FeedbackPublic,
    FeedbacksPublic,
    FeedbackStatusUpdate,
    Message,
    User,
)

router = APIRouter(prefix="/feedback", tags=["feedback"])

FEEDBACK_RATE_LIMIT = 5
FEEDBACK_RATE_WINDOW_SECONDS = 60

FEEDBACK_EXCERPT_LENGTH = 80


def _display_name(user: User) -> str:
    if user.full_name:
        return user.full_name
    return user.email.split("@", 1)[0]


def _excerpt(body: str) -> str:
    if len(body) <= FEEDBACK_EXCERPT_LENGTH:
        return body
    return body[: FEEDBACK_EXCERPT_LENGTH - 1].rstrip() + "…"


def _public(feedback: Feedback, author: User, me: User) -> FeedbackPublic:
    return FeedbackPublic(
        id=feedback.id,
        user_id=feedback.user_id,
        author_name=_display_name(author),
        is_mine=me.id == feedback.user_id,
        body=feedback.body,
        page=feedback.page,
        status=feedback.status,
        created_at=feedback.created_at,
    )


@router.post(
    "/",
    response_model=FeedbackPublic,
    dependencies=[
        Depends(
            rate_limit("feedback", FEEDBACK_RATE_LIMIT, FEEDBACK_RATE_WINDOW_SECONDS)
        )
    ],
)
def create_feedback(
    *,
    session: SessionDep,
    me: CurrentUser,
    feedback_in: FeedbackCreate,
    background_tasks: BackgroundTasks,
) -> Any:
    """
    Report something broken on the site. Any active user may report.
    """
    body = feedback_in.body.strip()
    if not body:
        raise HTTPException(status_code=422, detail="Report cannot be empty")
    feedback = Feedback(user_id=me.id, body=body, page=feedback_in.page.strip())
    session.add(feedback)
    session.commit()
    session.refresh(feedback)
    background_tasks.add_task(
        push.send_to_admins,
        title=f"storing gemeld door {_display_name(me)} 🔧",
        body=f"'{_excerpt(body)}'",
        url="/feedback",
    )
    return _public(feedback, me, me)


@router.get("/mine", response_model=FeedbacksPublic)
def read_my_feedback(
    session: SessionDep,
    me: CurrentUser,
    skip: int = 0,
    limit: int = Query(default=50, le=100),
) -> Any:
    """
    The caller's own reports, newest first, so they can track the status.
    """
    count = session.exec(
        select(func.count()).select_from(Feedback).where(Feedback.user_id == me.id)
    ).one()
    reports = session.exec(
        select(Feedback)
        .where(Feedback.user_id == me.id)
        .order_by(col(Feedback.created_at).desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return FeedbacksPublic(data=[_public(f, me, me) for f in reports], count=count)


@router.get(
    "/",
    response_model=FeedbacksPublic,
    dependencies=[Depends(get_current_active_superuser)],
)
def read_all_feedback(
    session: SessionDep,
    me: CurrentUser,
    status: str | None = Query(default=None),
    skip: int = 0,
    limit: int = Query(default=50, le=100),
) -> Any:
    """
    Superuser-only queue of every report, newest first. Filter with
    `?status=open` / `?status=resolved`.
    """
    if status is not None and status not in FEEDBACK_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"status must be one of: {', '.join(sorted(FEEDBACK_STATUSES))}",
        )
    where = [Feedback.status == status] if status is not None else []
    count = session.exec(select(func.count()).select_from(Feedback).where(*where)).one()
    rows = session.exec(
        select(Feedback, User)
        .join(User, col(Feedback.user_id) == col(User.id))
        .where(*where)
        .order_by(col(Feedback.created_at).desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return FeedbacksPublic(data=[_public(f, u, me) for f, u in rows], count=count)


@router.patch(
    "/{feedback_id}",
    response_model=FeedbackPublic,
    dependencies=[Depends(get_current_active_superuser)],
)
def update_feedback_status(
    session: SessionDep,
    me: CurrentUser,
    feedback_id: uuid.UUID,
    status_in: FeedbackStatusUpdate,
) -> Any:
    """
    Mark a report resolved (or reopen it). Superusers only.
    """
    feedback = session.get(Feedback, feedback_id)
    if not feedback:
        raise HTTPException(status_code=404, detail="Report not found")
    feedback.status = status_in.status
    session.add(feedback)
    session.commit()
    session.refresh(feedback)
    author = session.get(User, feedback.user_id)
    return _public(feedback, author or me, me)


@router.delete("/{feedback_id}")
def delete_feedback(
    session: SessionDep, me: CurrentUser, feedback_id: uuid.UUID
) -> Message:
    """
    Delete a report. The reporter can delete their own; superusers can delete any.
    """
    feedback = session.get(Feedback, feedback_id)
    if not feedback:
        raise HTTPException(status_code=404, detail="Report not found")
    if feedback.user_id != me.id and not me.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    session.delete(feedback)
    session.commit()
    return Message(message="Report deleted successfully")
