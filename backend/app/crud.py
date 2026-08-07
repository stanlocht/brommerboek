from typing import Any

from sqlmodel import Session, col, select

from app.core.security import get_password_hash, verify_password
from app.countries import flag_emoji
from app.models import (
    Stop,
    StopCreate,
    StopUpdate,
    User,
    UserCreate,
    UserUpdate,
    normalize_cover,
)


def create_user(*, session: Session, user_create: UserCreate) -> User:
    db_obj = User.model_validate(
        user_create, update={"hashed_password": get_password_hash(user_create.password)}
    )
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    return db_obj


def update_user(*, session: Session, db_user: User, user_in: UserUpdate) -> Any:
    user_data = user_in.model_dump(exclude_unset=True)
    extra_data = {}
    if "password" in user_data:
        password = user_data["password"]
        hashed_password = get_password_hash(password)
        extra_data["hashed_password"] = hashed_password
    db_user.sqlmodel_update(user_data, update=extra_data)
    session.add(db_user)
    session.commit()
    session.refresh(db_user)
    return db_user


def get_user_by_email(*, session: Session, email: str) -> User | None:
    statement = select(User).where(User.email == email)
    session_user = session.exec(statement).first()
    return session_user


# Dummy hash to use for timing attack prevention when user is not found
# This is an Argon2 hash of a random password, used to ensure constant-time comparison
DUMMY_HASH = "$argon2id$v=19$m=65536,t=3,p=4$MjQyZWE1MzBjYjJlZTI0Yw$YTU4NGM5ZTZmYjE2NzZlZjY0ZWY3ZGRkY2U2OWFjNjk"


def authenticate(*, session: Session, email: str, password: str) -> User | None:
    db_user = get_user_by_email(session=session, email=email)
    if not db_user:
        # Prevent timing attacks by running password verification even when user doesn't exist
        # This ensures the response time is similar whether or not the email exists
        verify_password(password, DUMMY_HASH)
        return None
    verified, updated_password_hash = verify_password(password, db_user.hashed_password)
    if not verified:
        return None
    if updated_password_hash:
        db_user.hashed_password = updated_password_hash
        session.add(db_user)
        session.commit()
        session.refresh(db_user)
    return db_user


def resequence_stops(*, session: Session) -> None:
    """Renumber order_index so the route follows the stops' dates.

    Stops sharing a date keep their existing relative order (order_index is
    the tiebreaker), so same-day stops stay in the order they were added.
    """
    stops = session.exec(
        select(Stop).order_by(col(Stop.date).asc(), col(Stop.order_index).asc())
    ).all()
    for i, stop in enumerate(stops):
        if stop.order_index != i:
            stop.order_index = i
            session.add(stop)
    session.commit()


def create_stop(
    *, session: Session, stop_in: StopCreate, order_index: int | None = None
) -> Stop:
    explicit_order = order_index is not None
    if order_index is None:
        last = session.exec(select(Stop).order_by(col(Stop.order_index).desc())).first()
        order_index = (last.order_index + 1) if last else 0
    media = normalize_cover([m.model_dump() for m in stop_in.media])
    db_stop = Stop.model_validate(
        stop_in,
        update={
            "order_index": order_index,
            "media": media,
            # Canonical: derive the emoji flag from the ISO code so the client
            # can't drift out of sync with the code it also sends.
            "flag": flag_emoji(stop_in.code),
        },
    )
    session.add(db_stop)
    session.commit()
    # A backdated stop belongs earlier on the route, not at the end — reslot
    # everything by date. Callers passing an explicit order_index (seeding)
    # opt out.
    if not explicit_order:
        resequence_stops(session=session)
    session.refresh(db_stop)
    return db_stop


def move_stop_within_day(
    *, session: Session, db_stop: Stop, direction: str
) -> tuple[Stop, Stop] | None:
    """Swap a stop with its same-day neighbour on the route.

    Stops carry only a date, so same-day posts are ordered by insertion
    (order_index is the resequence tiebreaker). This is the admin's fix for
    posts added out of sequence: "up" moves the stop earlier in its day,
    "down" later. Same-day stops sit consecutively on the route, so a plain
    order_index swap is enough — every other stop keeps its (date,
    order_index) position. Returns (moved, neighbour) or None when the stop
    is already the first (up) or last (down) post of its day.
    """
    if direction == "up":
        neighbour = session.exec(
            select(Stop)
            .where(Stop.date == db_stop.date)
            .where(col(Stop.order_index) < db_stop.order_index)
            .order_by(col(Stop.order_index).desc())
        ).first()
    else:
        neighbour = session.exec(
            select(Stop)
            .where(Stop.date == db_stop.date)
            .where(col(Stop.order_index) > db_stop.order_index)
            .order_by(col(Stop.order_index).asc())
        ).first()
    if neighbour is None:
        return None
    db_stop.order_index, neighbour.order_index = (
        neighbour.order_index,
        db_stop.order_index,
    )
    session.add(db_stop)
    session.add(neighbour)
    session.commit()
    session.refresh(db_stop)
    session.refresh(neighbour)
    return db_stop, neighbour


def update_stop(*, session: Session, db_stop: Stop, stop_in: StopUpdate) -> Stop:
    data = stop_in.model_dump(exclude_unset=True)
    extra: dict[str, Any] = {}
    # Media items arrive as MediaItem models — flatten to plain dicts for the
    # JSON column.
    if "media" in data and data["media"] is not None:
        extra["media"] = normalize_cover(
            [
                m.model_dump() if hasattr(m, "model_dump") else dict(m)
                for m in stop_in.media or []
            ]
        )
        data.pop("media")
    # Keep flag derived from the ISO code, same rule as create_stop.
    if "code" in data:
        extra["flag"] = flag_emoji(data["code"])
    date_changed = "date" in data and data["date"] != db_stop.date
    db_stop.sqlmodel_update(data, update=extra)
    session.add(db_stop)
    session.commit()
    # Moving a stop to another date can move it along the route too.
    if date_changed:
        resequence_stops(session=session)
    session.refresh(db_stop)
    return db_stop
