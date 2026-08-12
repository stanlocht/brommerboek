import shutil
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from sqlmodel import col, delete, func, select

from app import crud
from app.api.deps import SessionDep, get_current_active_superuser
from app.core import push
from app.core.config import settings
from app.core.media import (
    MEDIA_ROOT,
    MEDIA_URL_PREFIX,
    generate_thumbnail,
    resolve_media_type,
)
from app.geo import haversine_km, leg_km, polyline_km
from app.models import (
    Comment,
    HornHonk,
    LegTrack,
    MediaCaptionUpdate,
    Message,
    Stop,
    StopCreate,
    StopPublic,
    StopsPublic,
    StopUpdate,
    TripStats,
    normalize_cover,
)

router = APIRouter(prefix="/stops", tags=["stops"])

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MiB — plenty for phone photos/clips


def _ordered_stops(session: SessionDep) -> list[Stop]:
    statement = select(Stop).order_by(col(Stop.order_index).asc())
    return list(session.exec(statement).all())


def _honk_counts(session: SessionDep) -> dict[uuid.UUID, int]:
    """Honks per stop_id — one GROUP BY query for the whole trip."""
    rows = session.exec(
        select(HornHonk.stop_id, func.count()).group_by(col(HornHonk.stop_id))
    ).all()
    return dict(rows)


def _comment_counts(session: SessionDep) -> dict[uuid.UUID, int]:
    """Comments per stop_id — one GROUP BY query for the whole trip."""
    rows = session.exec(
        select(Comment.stop_id, func.count()).group_by(col(Comment.stop_id))
    ).all()
    return dict(rows)


@router.get("/", response_model=StopsPublic)
def read_stops(session: SessionDep) -> Any:
    """
    Retrieve all stops of the trip, in route order. Public — this is a
    personal, single-trip showcase. Each stop carries its honk and comment
    counts so the map can badge pins without extra requests.
    """
    count = session.exec(select(func.count()).select_from(Stop)).one()
    stops = _ordered_stops(session)
    honks = _honk_counts(session)
    comments = _comment_counts(session)
    data = []
    for s in stops:
        pub = StopPublic.model_validate(s)
        pub.honk_count = honks.get(s.id, 0)
        pub.comment_count = comments.get(s.id, 0)
        data.append(pub)
    return StopsPublic(data=data, count=count)


@router.get("/stats", response_model=TripStats)
def read_stats(session: SessionDep) -> Any:
    """
    Aggregate trip statistics for the "Wrapped" recap screen.
    """
    stops = _ordered_stops(session)
    # Preparation posts belong to the journal, not the journey: dropping them
    # from the sequence keeps them out of every figure, including the km
    # chain (a mid-sequence stop would otherwise contribute two legs).
    trip = [s for s in stops if s.type != "preparation"]
    # Per-leg distance priority lives in geo.leg_km. The GPS candidate is the
    # measurement tracksync stored; rows synced before that field existed
    # still carry the road geometry, so measuring their polyline beats
    # dropping them (decimation makes it a mild undercount, still far closer
    # than the straight line it would otherwise fall back to).
    gps_km: dict[tuple[uuid.UUID, uuid.UUID], float] = {}
    for row in session.exec(select(LegTrack)).all():
        measured = row.distance_km
        if measured is None:
            measured = polyline_km(row.points)
        if measured is not None:
            gps_km[(row.from_stop_id, row.to_stop_id)] = measured
    km_total = 0.0
    for prev, cur in zip(trip, trip[1:], strict=False):
        odometer = (
            cur.km - prev.km if prev.km is not None and cur.km is not None else None
        )
        km_total += leg_km(
            haversine_km((prev.lat, prev.lng), (cur.lat, cur.lng)),
            odometer_km=odometer,
            gps_km=gps_km.get((prev.id, cur.id)),
        )
    # Suggested km = the most recent stop's odometer reading (whatever order
    # we happened to add them in — falls back to earlier stops if the latest
    # has no reading). All stops count here: a reading noted while packing is
    # still the moped's latest known odometer state.
    suggested_km: int | None = None
    for s in reversed(stops):
        if s.km is not None:
            suggested_km = s.km
            break
    codes = {s.code for s in trip if s.code}
    repairs = sum(1 for s in trip if s.type == "repair")
    days = 0
    if trip:
        # Days on the road run from departure until today, not until the last
        # post: a quiet week without stops is still a week of riding. Inclusive,
        # so the departure day is dag 1; a trip that departs tomorrow is 0.
        # (When the rider can close a trip off, its end date replaces today.)
        departure = min(s.date for s in trip)
        days = max((datetime.now(UTC).date() - departure).days + 1, 0)
    return TripStats(
        km=round(km_total),
        suggested_km=suggested_km,
        days=days,
        countries=len(codes),
        stops=len(trip),
        repairs=repairs,
        stamps=len(codes),
    )


@router.get("/{id}", response_model=StopPublic)
def read_stop(session: SessionDep, id: uuid.UUID) -> Any:
    """
    Get a single stop by ID.
    """
    stop = session.get(Stop, id)
    if not stop:
        raise HTTPException(status_code=404, detail="Stop not found")
    pub = StopPublic.model_validate(stop)
    pub.honk_count = session.exec(
        select(func.count()).select_from(HornHonk).where(HornHonk.stop_id == id)
    ).one()
    pub.comment_count = session.exec(
        select(func.count()).select_from(Comment).where(Comment.stop_id == id)
    ).one()
    return pub


@router.post(
    "/",
    response_model=StopPublic,
    dependencies=[Depends(get_current_active_superuser)],
)
def create_stop(
    *, session: SessionDep, stop_in: StopCreate, background_tasks: BackgroundTasks
) -> Any:
    """
    Add a new stop to the route, slotted in by its date (a backdated stop
    lands earlier on the route, not at the end). Superusers only — this is
    a single-rider journal.
    """
    stop = crud.create_stop(session=session, stop_in=stop_in)
    background_tasks.add_task(
        push.send_to_followers,
        title=f"nieuwe stop: {stop.place} 🛵",
        body=stop.title,
        url=f"/?stop={stop.id}",
    )
    if settings.traccar_enabled:
        # Pull the leg's real ridden road from Traccar after the response;
        # a backdated stop also re-slices the leg it split.
        from app import tracksync  # deferred: avoids a route-import cycle

        background_tasks.add_task(tracksync.sync_for_stop, stop.id)
    return stop


@router.patch(
    "/{id}",
    response_model=StopPublic,
    dependencies=[Depends(get_current_active_superuser)],
)
def update_stop(
    *,
    session: SessionDep,
    id: uuid.UUID,
    stop_in: StopUpdate,
    background_tasks: BackgroundTasks,
) -> Any:
    """
    Partially update a stop. Superusers only.
    """
    db_stop = session.get(Stop, id)
    if not db_stop:
        raise HTTPException(status_code=404, detail="Stop not found")
    updated = crud.update_stop(session=session, db_stop=db_stop, stop_in=stop_in)
    if settings.traccar_enabled and (
        {"date", "lat", "lng"} & stop_in.model_dump(exclude_unset=True).keys()
    ):
        # A new date or pin reshapes the surrounding legs — re-slice their
        # ridden roads in the background.
        from app import tracksync  # deferred: avoids a route-import cycle

        background_tasks.add_task(tracksync.sync_for_stop, updated.id)
    return updated


@router.post(
    "/{id}/move",
    response_model=StopPublic,
    dependencies=[Depends(get_current_active_superuser)],
)
def move_stop(
    *,
    session: SessionDep,
    id: uuid.UUID,
    direction: Literal["up", "down"],
    background_tasks: BackgroundTasks,
) -> Any:
    """
    Swap a stop with its same-day neighbour on the route ("up" = earlier in
    the day, "down" = later). Posts carry a date but no time, so this is the
    admin's fix for two same-day posts added in the wrong order. Superusers
    only. 400 when the stop is already at that edge of its day.
    """
    db_stop = session.get(Stop, id)
    if not db_stop:
        raise HTTPException(status_code=404, detail="Stop not found")
    swapped = crud.move_stop_within_day(
        session=session, db_stop=db_stop, direction=direction
    )
    if swapped is None:
        edge = "first" if direction == "up" else "last"
        raise HTTPException(
            status_code=400, detail=f"Stop is already the {edge} of its day"
        )
    moved, neighbour = swapped
    if settings.traccar_enabled:
        # The swap reshapes three legs (into, between and out of the pair);
        # re-slicing around both stops covers them all.
        from app import tracksync  # deferred: avoids a route-import cycle

        background_tasks.add_task(tracksync.sync_for_stop, moved.id)
        background_tasks.add_task(tracksync.sync_for_stop, neighbour.id)
    return moved


@router.post(
    "/{id}/media",
    response_model=StopPublic,
    dependencies=[Depends(get_current_active_superuser)],
)
def upload_stop_media(
    *,
    session: SessionDep,
    id: uuid.UUID,
    file: UploadFile = File(...),
    caption: str = "",
    cover: bool = False,
) -> Any:
    """
    Attach a photo or short video to a stop. Files land on the media volume
    under `/media/{stop_id}/…` and the stop's `media` array grows by one.

    `cover=true` makes the new item the stop's cover picture, taking the flag
    off whichever item held it — that's how a brand-new stop keeps the cover
    the rider picked while the files were still local previews, whatever order
    the uploads happen to land in.
    """
    db_stop = session.get(Stop, id)
    if not db_stop:
        raise HTTPException(status_code=404, detail="Stop not found")
    resolved = resolve_media_type(file.content_type, file.filename)
    if resolved is None:
        raise HTTPException(
            status_code=415, detail=f"Unsupported media type: {file.content_type}"
        )
    kind, ext = resolved
    # Stream to disk, aborting if it turns out oversized.
    stop_dir = MEDIA_ROOT / str(id)
    stop_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.{ext}"
    dest = stop_dir / filename
    try:
        size = 0
        with dest.open("wb") as out:
            while chunk := file.file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MiB)",
                    )
                out.write(chunk)
    finally:
        file.file.close()
    url = f"{MEDIA_URL_PREFIX}/{id}/{filename}"
    # Pre-generate a small WebP for gallery tiles; videos keep thumb None
    # (no ffmpeg on board) and a failed thumbnail never fails the upload.
    thumb_url: str | None = None
    if kind == "image":
        thumb_path = generate_thumbnail(dest)
        if thumb_path is not None:
            thumb_url = f"{MEDIA_URL_PREFIX}/{id}/{thumb_path.name}"
    media_items = [dict(m) for m in db_stop.media or []]
    if cover:
        for item in media_items:
            item["cover"] = False
    media_items.append(
        {
            "tone": "",
            "cap": caption[:255],
            "kind": kind,
            "url": url,
            "thumb": thumb_url,
            "cover": cover,
        }
    )
    db_stop.media = media_items
    session.add(db_stop)
    session.commit()
    session.refresh(db_stop)
    return db_stop


@router.patch(
    "/{id}/media/{index}",
    response_model=StopPublic,
    dependencies=[Depends(get_current_active_superuser)],
)
def update_stop_media_caption(
    *,
    session: SessionDep,
    id: uuid.UUID,
    index: int,
    caption_in: MediaCaptionUpdate,
) -> Any:
    """
    Change the caption of a media item by its position in the stop's media
    array. The file itself is immutable — delete and re-upload to replace it.
    """
    db_stop = session.get(Stop, id)
    if not db_stop:
        raise HTTPException(status_code=404, detail="Stop not found")
    # Copy the inner dicts too: mutating the loaded JSON in place would leave
    # SQLAlchemy's change detection comparing the value against itself.
    media_items = [dict(m) for m in db_stop.media or []]
    if not 0 <= index < len(media_items):
        raise HTTPException(status_code=404, detail="Media index out of range")
    media_items[index]["cap"] = caption_in.cap
    db_stop.media = media_items
    session.add(db_stop)
    session.commit()
    session.refresh(db_stop)
    return db_stop


@router.post(
    "/{id}/media/{index}/cover",
    response_model=StopPublic,
    dependencies=[Depends(get_current_active_superuser)],
)
def set_stop_media_cover(
    *, session: SessionDep, id: uuid.UUID, index: int, cover: bool = True
) -> Any:
    """
    Make the media item at `index` the stop's cover picture — the one shown on
    the map card, in the replay and in share unfurls. Any other item loses the
    flag; `cover=false` clears it, after which the first item stands in again.
    """
    db_stop = session.get(Stop, id)
    if not db_stop:
        raise HTTPException(status_code=404, detail="Stop not found")
    # Copy the inner dicts: mutating the loaded JSON in place leaves
    # SQLAlchemy's change detection comparing the value against itself.
    media_items = [dict(m) for m in db_stop.media or []]
    if not 0 <= index < len(media_items):
        raise HTTPException(status_code=404, detail="Media index out of range")
    for i, item in enumerate(media_items):
        item["cover"] = cover and i == index
    db_stop.media = normalize_cover(media_items)
    session.add(db_stop)
    session.commit()
    session.refresh(db_stop)
    return db_stop


@router.delete(
    "/{id}/media/{index}",
    response_model=StopPublic,
    dependencies=[Depends(get_current_active_superuser)],
)
def delete_stop_media(*, session: SessionDep, id: uuid.UUID, index: int) -> Any:
    """
    Remove a media item by its position in the stop's media array. Also
    deletes the file on disk (if any).
    """
    db_stop = session.get(Stop, id)
    if not db_stop:
        raise HTTPException(status_code=404, detail="Stop not found")
    media_items = list(db_stop.media or [])
    if not 0 <= index < len(media_items):
        raise HTTPException(status_code=404, detail="Media index out of range")
    item = media_items.pop(index)
    for key in ("url", "thumb"):
        url = item.get(key) if isinstance(item, dict) else None
        if url and url.startswith(f"{MEDIA_URL_PREFIX}/"):
            rel = url[len(MEDIA_URL_PREFIX) + 1 :]
            path = MEDIA_ROOT / rel
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
    db_stop.media = media_items
    session.add(db_stop)
    session.commit()
    session.refresh(db_stop)
    return db_stop


@router.delete(
    "/{id}",
    response_model=Message,
    dependencies=[Depends(get_current_active_superuser)],
)
def delete_stop(
    *, session: SessionDep, id: uuid.UUID, background_tasks: BackgroundTasks
) -> Any:
    """
    Delete a stop and any media files attached to it. The two legs around it
    merge into one; its ridden-road tracks are dropped and the merged leg is
    re-sliced in the background.
    """
    db_stop = session.get(Stop, id)
    if not db_stop:
        raise HTTPException(status_code=404, detail="Stop not found")
    next_stop = session.exec(
        select(Stop)
        .where(col(Stop.order_index) > db_stop.order_index)
        .order_by(col(Stop.order_index).asc())
    ).first()
    stop_dir = MEDIA_ROOT / str(id)
    if stop_dir.exists():
        shutil.rmtree(stop_dir, ignore_errors=True)
    session.execute(
        delete(LegTrack).where(
            (col(LegTrack.to_stop_id) == id) | (col(LegTrack.from_stop_id) == id)
        )
    )
    session.delete(db_stop)
    session.commit()
    if settings.traccar_enabled and next_stop is not None:
        from app import tracksync  # deferred: avoids a route-import cycle

        background_tasks.add_task(tracksync.sync_for_stop, next_stop.id)
    return Message(message="Stop deleted")
