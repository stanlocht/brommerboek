import uuid
from typing import Any

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, OptionalUser, SessionDep
from app.core import push
from app.core.media import MEDIA_ROOT, MEDIA_URL_PREFIX, generate_thumbnail
from app.core.ratelimit import rate_limit
from app.models import (
    Comment,
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

COMMENT_RATE_LIMIT = 10
COMMENT_RATE_WINDOW_SECONDS = 60
HONK_RATE_LIMIT = 30
HONK_RATE_WINDOW_SECONDS = 60

# Photos only on comments — no visitor-uploaded video to store or moderate.
COMMENT_PHOTO_TYPES = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/heic": "heic",
}
COMMENT_PHOTO_MAX_BYTES = 10 * 1024 * 1024  # 10 MiB — ample for a phone photo


def _display_name(user: User) -> str:
    if user.full_name:
        return user.full_name
    return user.email.split("@", 1)[0]


def _ensure_stop(session: SessionDep, stop_id: uuid.UUID) -> Stop:
    stop = session.get(Stop, stop_id)
    if not stop:
        raise HTTPException(status_code=404, detail="Stop not found")
    return stop


COMMENT_EXCERPT_LENGTH = 80


def _excerpt(body: str) -> str:
    if len(body) <= COMMENT_EXCERPT_LENGTH:
        return body
    return body[: COMMENT_EXCERPT_LENGTH - 1].rstrip() + "…"


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
            photo=c.photo,
            photo_thumb=c.photo_thumb,
            created_at=c.created_at,
        )
        for c, u in rows
    ]
    return CommentsPublic(data=data, count=count)


def _save_comment_photo(stop_id: uuid.UUID, file: UploadFile) -> tuple[str, str | None]:
    """Stream an uploaded comment photo to the media volume.

    Files live under `/media/{stop_id}/comments/…` so deleting the stop
    (which rmtree's the stop's whole media directory) also sweeps up the
    photos of its cascade-deleted comments. Returns `(photo_url, thumb_url)`.
    """
    if file.content_type not in COMMENT_PHOTO_TYPES:
        raise HTTPException(
            status_code=415, detail=f"Unsupported photo type: {file.content_type}"
        )
    ext = COMMENT_PHOTO_TYPES[file.content_type]
    comments_dir = MEDIA_ROOT / str(stop_id) / "comments"
    comments_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.{ext}"
    dest = comments_dir / filename
    try:
        size = 0
        with dest.open("wb") as out:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > COMMENT_PHOTO_MAX_BYTES:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            "Photo too large "
                            f"(max {COMMENT_PHOTO_MAX_BYTES // (1024 * 1024)} MiB)"
                        ),
                    )
                out.write(chunk)
    finally:
        file.file.close()
    photo_url = f"{MEDIA_URL_PREFIX}/{stop_id}/comments/{filename}"
    # Same contract as stop media: a failed thumbnail never fails the upload.
    thumb_url: str | None = None
    thumb_path = generate_thumbnail(dest)
    if thumb_path is not None:
        thumb_url = f"{MEDIA_URL_PREFIX}/{stop_id}/comments/{thumb_path.name}"
    return photo_url, thumb_url


def _delete_comment_photo(comment: Comment) -> None:
    """Remove a comment's photo (and thumbnail) from the media volume."""
    for url in (comment.photo, comment.photo_thumb):
        if url and url.startswith(f"{MEDIA_URL_PREFIX}/"):
            path = MEDIA_ROOT / url[len(MEDIA_URL_PREFIX) + 1 :]
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass


@router.post(
    "/stops/{stop_id}/comments",
    response_model=CommentPublic,
    dependencies=[
        Depends(rate_limit("comments", COMMENT_RATE_LIMIT, COMMENT_RATE_WINDOW_SECONDS))
    ],
)
def create_comment(
    *,
    session: SessionDep,
    me: CurrentUser,
    stop_id: uuid.UUID,
    body: str = Form(default="", max_length=2000),
    file: UploadFile | None = File(default=None),
    background_tasks: BackgroundTasks,
) -> Any:
    """
    Leave a comment on a stop, optionally with a photo attached. Any active
    user may comment. Multipart form: `body` (text) and `file` (image) —
    at least one of the two is required.
    """
    stop = _ensure_stop(session, stop_id)
    body = body.strip()
    if not body and file is None:
        raise HTTPException(status_code=422, detail="Comment cannot be empty")
    photo_url: str | None = None
    photo_thumb: str | None = None
    if file is not None:
        photo_url, photo_thumb = _save_comment_photo(stop_id, file)
    comment = Comment(
        stop_id=stop_id,
        user_id=me.id,
        body=body,
        photo=photo_url,
        photo_thumb=photo_thumb,
    )
    session.add(comment)
    session.commit()
    session.refresh(comment)
    excerpt = _excerpt(body) if body else "📷 foto"
    background_tasks.add_task(
        push.send_to_admins,
        title=f"nieuwe reactie van {_display_name(me)}",
        body=f"op {stop.place}: '{excerpt}'",
        url=f"/?stop={stop_id}",
    )
    return CommentPublic(
        id=comment.id,
        stop_id=comment.stop_id,
        user_id=comment.user_id,
        author_name=_display_name(me),
        is_mine=True,
        body=comment.body,
        photo=comment.photo,
        photo_thumb=comment.photo_thumb,
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
    _delete_comment_photo(comment)
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


@router.post(
    "/stops/{stop_id}/honks",
    response_model=HonkPublic,
    dependencies=[
        Depends(rate_limit("honks", HONK_RATE_LIMIT, HONK_RATE_WINDOW_SECONDS))
    ],
)
def toggle_honk(
    session: SessionDep,
    me: CurrentUser,
    stop_id: uuid.UUID,
    background_tasks: BackgroundTasks,
) -> Any:
    """
    Toggle the caller's horn honk on a stop.
    """
    stop = _ensure_stop(session, stop_id)
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
            # Only a freshly created honk notifies — removals stay silent.
            background_tasks.add_task(
                push.send_to_admins,
                title=f"{_display_name(me)} toetert bij {stop.place} 📯",
                body="",
                url=f"/?stop={stop_id}",
            )
        except IntegrityError:
            # Lost a race with another concurrent honk from the same user —
            # the unique constraint already guarantees the desired state.
            session.rollback()
    return _honk_state(session, me, stop_id)
