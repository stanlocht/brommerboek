from datetime import date
from typing import Any

from sqlmodel import Session

from app import crud
from app.models import Stop, StopCreate


def stop_payload(**overrides: Any) -> dict[str, Any]:
    """A valid JSON payload for POST /stops/, with optional overrides."""
    payload: dict[str, Any] = {
        "place": "Teststad",
        "country": "Nederland",
        "code": "NL",
        "lat": 52.0,
        "lng": 5.0,
        "date": "2024-06-01",
        "title": "Teststop",
    }
    payload.update(overrides)
    return payload


def create_test_stop(db: Session, **overrides: Any) -> Stop:
    data = stop_payload(**overrides)
    data["date"] = date.fromisoformat(data["date"])
    return crud.create_stop(session=db, stop_in=StopCreate(**data))


def delete_test_stop(db: Session, stop: Stop) -> None:
    """Remove a stop created for a test (no-op if the test already did)."""
    # Read the id before expiring: refreshing an already-deleted instance
    # would raise. Expiring makes db.get() re-query instead of handing back a
    # stale identity-map object when the test deleted the stop via the API
    # (which uses its own session).
    stop_id = stop.__dict__.get("id", stop.id)
    db.expire_all()
    db_stop = db.get(Stop, stop_id)
    if db_stop is not None:
        db.delete(db_stop)
        db.commit()
