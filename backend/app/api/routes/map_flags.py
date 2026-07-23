from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import SessionDep, get_current_active_superuser
from app.models import (
    DEFAULT_MAP_FLAGS,
    MAP_FLAG_KINDS,
    MapFlag,
    MapFlagPublic,
    MapFlagsPublic,
    MapFlagUpdate,
)

router = APIRouter(prefix="/map-flags", tags=["map-flags"])


def _get_or_create(session: SessionDep, kind: str) -> MapFlag:
    """Fetch a flag row, seeding it with the default spot when missing."""
    flag = session.get(MapFlag, kind)
    if flag is None:
        flag = MapFlag(kind=kind, **DEFAULT_MAP_FLAGS[kind])
        session.add(flag)
        session.commit()
        session.refresh(flag)
    return flag


@router.get("/", response_model=MapFlagsPublic)
def read_map_flags(session: SessionDep) -> Any:
    """
    The start and finish flag positions. Public — the flags are part of the
    map everyone sees. Rows missing from the database (fresh install, or a
    kind added later) come back at their default spot.
    """
    data = [_get_or_create(session, kind) for kind in sorted(MAP_FLAG_KINDS)]
    return MapFlagsPublic(data=data, count=len(data))


@router.patch(
    "/{kind}",
    response_model=MapFlagPublic,
    dependencies=[Depends(get_current_active_superuser)],
)
def update_map_flag(*, session: SessionDep, kind: str, flag_in: MapFlagUpdate) -> Any:
    """
    Move a flag (or rename its label). Superusers only — this is how an
    admin drags the start or finish somewhere else.
    """
    if kind not in MAP_FLAG_KINDS:
        raise HTTPException(status_code=404, detail="Flag not found")
    flag = _get_or_create(session, kind)
    for field, value in flag_in.model_dump(exclude_unset=True).items():
        setattr(flag, field, value)
    session.add(flag)
    session.commit()
    session.refresh(flag)
    return flag
