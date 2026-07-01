import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import col, func, select

from app import crud
from app.api.deps import SessionDep, get_current_active_superuser
from app.geo import haversine_km
from app.models import (
    Stop,
    StopCreate,
    StopPublic,
    StopsPublic,
    TripStats,
)

router = APIRouter(prefix="/stops", tags=["stops"])


def _ordered_stops(session: SessionDep) -> list[Stop]:
    statement = select(Stop).order_by(col(Stop.order_index).asc())
    return list(session.exec(statement).all())


@router.get("/", response_model=StopsPublic)
def read_stops(session: SessionDep) -> Any:
    """
    Retrieve all stops of the trip, in route order. Public — this is a
    personal, single-trip showcase.
    """
    count = session.exec(select(func.count()).select_from(Stop)).one()
    stops = _ordered_stops(session)
    data = [StopPublic.model_validate(s) for s in stops]
    return StopsPublic(data=data, count=count)


@router.get("/stats", response_model=TripStats)
def read_stats(session: SessionDep) -> Any:
    """
    Aggregate trip statistics for the "Wrapped" recap screen.
    """
    stops = _ordered_stops(session)
    metres = 0.0
    for prev, cur in zip(stops, stops[1:], strict=False):
        metres += haversine_km((prev.lat, prev.lng), (cur.lat, cur.lng))
    km = round(metres)
    suggested_km = max((s.km for s in stops), default=0)
    codes = {s.code for s in stops if s.code}
    repairs = sum(1 for s in stops if s.type == "repair")
    days = 0
    if stops:
        dates = sorted(s.date for s in stops)
        days = (dates[-1] - dates[0]).days
    return TripStats(
        km=km,
        suggested_km=suggested_km,
        days=days,
        countries=len(codes),
        stops=len(stops),
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
    return stop


@router.post(
    "/",
    response_model=StopPublic,
    dependencies=[Depends(get_current_active_superuser)],
)
def create_stop(*, session: SessionDep, stop_in: StopCreate) -> Any:
    """
    Add a new stop to the end of the route. Superusers only — this is a
    single-rider journal.
    """
    return crud.create_stop(session=session, stop_in=stop_in)
