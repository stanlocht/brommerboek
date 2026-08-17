from typing import Any

from fastapi import APIRouter, Depends

from app.api.deps import SessionDep, get_current_active_superuser
from app.models import TRIP_INFO_ID, TripInfo, TripInfoPublic, TripInfoUpdate

router = APIRouter(prefix="/trip", tags=["trip"])


def _get_or_create(session: SessionDep) -> TripInfo:
    """Fetch the single trip row, seeding it with the default title if absent."""
    info = session.get(TripInfo, TRIP_INFO_ID)
    if info is None:
        info = TripInfo(id=TRIP_INFO_ID)
        session.add(info)
        session.commit()
        session.refresh(info)
    return info


@router.get("/", response_model=TripInfoPublic)
def read_trip_info(session: SessionDep) -> Any:
    """
    The trip's headline, shown above the map. Public — everyone reads the
    same title. A missing row (fresh install) comes back as the default.
    """
    return _get_or_create(session)


@router.patch(
    "/",
    response_model=TripInfoPublic,
    dependencies=[Depends(get_current_active_superuser)],
)
def update_trip_info(*, session: SessionDep, info_in: TripInfoUpdate) -> Any:
    """Rename the trip. Superusers only — this is the title on the home screen."""
    info = _get_or_create(session)
    info.title = info_in.title
    session.add(info)
    session.commit()
    session.refresh(info)
    return info
