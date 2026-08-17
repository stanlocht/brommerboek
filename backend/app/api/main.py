from fastapi import APIRouter

from app.api.routes import (
    feedback,
    location,
    login,
    map_flags,
    private,
    push,
    reactions,
    status,
    stops,
    telemetry,
    trip,
    users,
    utils,
    weather,
)
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(stops.router)
api_router.include_router(map_flags.router)
api_router.include_router(location.router)
api_router.include_router(reactions.router)
api_router.include_router(push.router)
api_router.include_router(weather.router)
api_router.include_router(feedback.router)
api_router.include_router(status.router)
api_router.include_router(telemetry.router)
api_router.include_router(trip.router)


if settings.ENVIRONMENT == "local":
    api_router.include_router(private.router)
