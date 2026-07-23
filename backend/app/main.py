import functools
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import anyio.to_thread
import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.routing import APIRoute
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask
from starlette.middleware.cors import CORSMiddleware

from app.api.main import api_router
from app.api.routes import share
from app.core import errortrack, usage
from app.core.config import settings
from app.core.media import MEDIA_ROOT, MEDIA_URL_PREFIX


def custom_generate_unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}-{route.name}"


if settings.SENTRY_DSN and settings.ENVIRONMENT != "local":
    sentry_sdk.init(dsn=str(settings.SENTRY_DSN), enable_tracing=True)

@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    # Persist whatever this worker counted since its last usage flush.
    usage.flush_now()


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    generate_unique_id_function=custom_generate_unique_id,
    lifespan=lifespan,
)


@app.middleware("http")
async def capture_unhandled_errors(request: Request, call_next):  # type: ignore[no-untyped-def]
    # Last-resort telemetry: HTTPExceptions are turned into responses deeper
    # in the stack and never reach this middleware, so anything caught here
    # is a genuine unhandled 500. Record it (grouped by fingerprint, in the
    # errors table a superuser / the triage workflow reads) and re-raise so
    # the default 500 handling is unchanged. The DB write runs in the
    # threadpool to keep the event loop free.
    try:
        return await call_next(request)
    except Exception as exc:
        # Bind eagerly (not a lambda): Python unsets `exc` when the except
        # block ends, so a late-called closure would see an undefined name.
        record = functools.partial(
            errortrack.record_exception,
            exc,
            method=request.method,
            path=request.url.path,
            user_agent=request.headers.get("User-Agent", "")[:512],
        )
        await anyio.to_thread.run_sync(record)
        raise


@app.middleware("http")
async def track_usage(request: Request, call_next):  # type: ignore[no-untyped-def]
    response = await call_next(request)
    # A dict increment under a lock; returns a snapshot at most once per
    # flush interval, which is written after the response has been sent
    # (BackgroundTask) so no request ever waits on the stats table.
    pending = usage.record(request.url.path, request.method)
    if pending is not None:
        if response.background is None:
            response.background = BackgroundTask(usage.flush, pending)
        else:
            await anyio.to_thread.run_sync(usage.flush, pending)
    return response


# Set all CORS enabled origins
if settings.all_cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.all_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(api_router, prefix=settings.API_V1_STR)

# Per-stop share pages for link-preview crawlers. Mounted at the root (not
# under the API prefix) so shared URLs stay short and version-stable.
app.include_router(share.router)

# Serve uploaded stop media from the mounted volume. Kept outside the
# versioned API prefix so the URLs stored in `Stop.media[].url` stay stable
# across API-version bumps.
app.mount(MEDIA_URL_PREFIX, StaticFiles(directory=MEDIA_ROOT), name="media")
