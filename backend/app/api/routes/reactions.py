import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, OptionalUser, SessionDep
from app.models import (
    Comment,
    CommentCreate,
    CommentPublic,
    CommentsPublic,
    HonkerPublic,
    HonkPublic,
    HornHonk,
    Message,
    Stop,
    User,
)

router = APIRouter(tags=["reactions"])


def _display_name(user: User) -> str:
    if user.full_name:
        return user.full_name
    return user.email.split("@", 1)[0]


def _ensure_stop(session: SessionDep, stop_id: uuid.UUID) -> None:
    if not session.get(Stop, stop_id):
        raise HTTPException(status_code=404, detail="Stop not found")


# ----- Comments --------------------------------------------------------------


@router.get("/stops/{stop_id}/comments", response_model=CommentsPublic)
def read_comments(
    session: SessionDep,
    me: OptionalUser,
    stop_id: uuid.UUID,
    skip: int = 0,
    limit: int = Query(default=50, le=100),
) -> Any:
    """
    Public list of comments on a stop, newest first. `count` is the total
    number of comments so clients can detect further pages.
    """
    _ensure_stop(session, stop_id)
    count = session.exec(
        select(func.count()).select_from(Comment).where(Comment.stop_id == stop_id)
    ).one()
    statement = (
        select(Comment, User)
        .join(User, col(Comment.user_id) == col(User.id))
        .where(Comment.stop_id == stop_id)
        .order_by(col(Comment.created_at).desc())
        .offset(skip)
        .limit(limit)
    )
    rows = session.exec(statement).all()
    data = [
        CommentPublic(
            id=c.id,
            stop_id=c.stop_id,
            user_id=c.user_id,
            author_name=_display_name(u),
            is_mine=me is not None and me.id == c.user_id,
            body=c.body,
            created_at=c.created_at,
        )
        for c, u in rows
    ]
    return CommentsPublic(data=data, count=count)


@router.post("/stops/{stop_id}/comments", response_model=CommentPublic)
def create_comment(
    *,
    session: SessionDep,
    me: CurrentUser,
    stop_id: uuid.UUID,
    comment_in: CommentCreate,
) -> Any:
    """
    Leave a comment on a stop. Any active user may comment.
    """
    _ensure_stop(session, stop_id)
    body = comment_in.body.strip()
    if not body:
        raise HTTPException(status_code=422, detail="Comment cannot be empty")
    comment = Comment(stop_id=stop_id, user_id=me.id, body=body)
    session.add(comment)
    session.commit()
    session.refresh(comment)
    return CommentPublic(
        id=comment.id,
        stop_id=comment.stop_id,
        user_id=comment.user_id,
        author_name=_display_name(me),
        is_mine=True,
        body=comment.body,
        created_at=comment.created_at,
    )


@router.delete("/comments/{comment_id}")
def delete_comment(
    session: SessionDep, me: CurrentUser, comment_id: uuid.UUID
) -> Message:
    """
    Delete a comment. The author can delete their own; superusers can delete any.
    """
    comment = session.get(Comment, comment_id)
    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")
    if comment.user_id != me.id and not me.is_superuser:
        raise HTTPException(status_code=403, detail="Not enough permissions")
    session.delete(comment)
    session.commit()
    return Message(message="Comment deleted successfully")


# ----- Horn honks (a like button that goes 'toet') ---------------------------


HONKERS_LIMIT = 50


def _honk_state(session: SessionDep, me: User | None, stop_id: uuid.UUID) -> HonkPublic:
    count = session.exec(
        select(func.count()).select_from(HornHonk).where(HornHonk.stop_id == stop_id)
    ).one()
    rows = session.exec(
        select(HornHonk, User)
        .join(User, col(HornHonk.user_id) == col(User.id))
        .where(HornHonk.stop_id == stop_id)
        .order_by(col(HornHonk.created_at).desc())
        .limit(HONKERS_LIMIT)
    ).all()
    honkers = [
        HonkerPublic(
            user_id=h.user_id,
            name=_display_name(u),
            is_mine=me is not None and me.id == h.user_id,
            created_at=h.created_at,
        )
        for h, u in rows
    ]
    honked_by_me = me is not None and any(h.is_mine for h in honkers)
    if me is not None and not honked_by_me and count > HONKERS_LIMIT:
        # Rare: the viewer's own honk was truncated off the tail. Confirm
        # via a targeted lookup so the button still shows the right state.
        mine = session.exec(
            select(HornHonk).where(
                HornHonk.stop_id == stop_id, HornHonk.user_id == me.id
            )
        ).first()
        honked_by_me = mine is not None
    return HonkPublic(
        stop_id=stop_id,
        count=count,
        honked_by_me=honked_by_me,
        honkers=honkers,
    )


@router.get("/stops/{stop_id}/honks", response_model=HonkPublic)
def read_honks(session: SessionDep, me: OptionalUser, stop_id: uuid.UUID) -> Any:
    """
    Public honk count for a stop, plus whether the caller has honked.
    """
    _ensure_stop(session, stop_id)
    return _honk_state(session, me, stop_id)


@router.post("/stops/{stop_id}/honks", response_model=HonkPublic)
def toggle_honk(session: SessionDep, me: CurrentUser, stop_id: uuid.UUID) -> Any:
    """
    Toggle the caller's horn honk on a stop.
    """
    _ensure_stop(session, stop_id)
    existing = session.exec(
        select(HornHonk).where(HornHonk.stop_id == stop_id, HornHonk.user_id == me.id)
    ).first()
    if existing:
        session.delete(existing)
        session.commit()
    else:
        honk = HornHonk(stop_id=stop_id, user_id=me.id)
        session.add(honk)
        try:
            session.commit()
        except IntegrityError:
            # Lost a race with another concurrent honk from the same user —
            # the unique constraint already guarantees the desired state.
            session.rollback()
    return _honk_state(session, me, stop_id)
