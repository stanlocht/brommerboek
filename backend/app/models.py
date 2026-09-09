import uuid
from datetime import UTC, date, datetime
from typing import Any, Literal

from pydantic import EmailStr, field_validator
from sqlalchemy import JSON, DateTime, Text, UniqueConstraint
from sqlmodel import Column, Field, SQLModel


def get_datetime_utc() -> datetime:
    return datetime.now(UTC)


# Shared properties
class UserBase(SQLModel):
    email: EmailStr = Field(unique=True, index=True, max_length=255)
    is_active: bool = True
    is_superuser: bool = False
    full_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on creation
class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserRegister(SQLModel):
    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=255)
    # Moped-plate captcha (see app/core/captcha.py). Optional at the schema
    # level so the check can sit behind SIGNUP_CAPTCHA_ENABLED; the route
    # rejects missing values when the captcha is on.
    captcha_token: str | None = Field(default=None, max_length=2048)
    captcha_answer: str | None = Field(default=None, max_length=32)


# Properties to receive via API on update, all are optional
class UserUpdate(SQLModel):
    email: EmailStr | None = Field(default=None, max_length=255)
    is_active: bool | None = None
    is_superuser: bool | None = None
    full_name: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, min_length=8, max_length=128)


class UserUpdateMe(SQLModel):
    full_name: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = Field(default=None, max_length=255)


class UpdatePassword(SQLModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


# Database model, database table inferred from class name
class User(UserBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    hashed_password: str
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


# Properties to return via API, id is always required
class UserPublic(UserBase):
    id: uuid.UUID
    created_at: datetime | None = None


class UsersPublic(SQLModel):
    data: list[UserPublic]
    count: int


# ----------------------------------------------------------------------------
# Brommerboek — Cub trip logger
#
# A trip is a series of discrete stops the rider uploads after the fact. Each
# stop has real coordinates, a date, a written story, a gallery of media and a
# type (see STOP_TYPES). The route is simply the line connecting the stops
# in order (`order_index`). This is a personal, single-trip showcase, so reads
# are public.
# ----------------------------------------------------------------------------


class MediaItem(SQLModel):
    # `url` points at the uploaded file (served by StaticFiles at /media/…);
    # when absent the frontend falls back to the `tone` hex swatch placeholder.
    # `kind` distinguishes photo from clip.
    tone: str = Field(default="", max_length=32)
    cap: str = Field(default="", max_length=255)
    kind: Literal["image", "video"] = "image"
    url: str | None = Field(default=None, max_length=512)
    # Pre-generated WebP thumbnail next to the original (`thumb_<name>.webp`);
    # None for videos and for uploads that predate thumbnails.
    thumb: str | None = Field(default=None, max_length=512)
    # Marks this item as the stop's cover — the picture shown on the map card,
    # in the replay and in share unfurls. At most one item per stop carries it
    # (see `normalize_cover`); with none flagged the first item stands in, so
    # every stop that predates this field keeps the cover it always had.
    cover: bool = False


def normalize_cover(media: list[dict]) -> list[dict]:
    """Return `media` with at most one item flagged as the cover.

    The first flagged item wins; every other flag is dropped. Callers hand
    us whatever the client sent, so this is the single place that keeps the
    "one cover per stop" invariant.
    """
    out: list[dict] = []
    seen = False
    for item in media:
        item = dict(item)
        if item.get("cover"):
            if seen:
                item["cover"] = False
            seen = True
        out.append(item)
    return out


def pick_cover(media: list[dict]) -> dict | None:
    """The stop's cover item: the flagged one, else the first with a file.

    Falls back to the first item of any kind so a stop whose media is still
    tone swatches keeps its placeholder colour.
    """
    items = [m for m in media or [] if isinstance(m, dict)]
    for item in items:
        if item.get("cover"):
            return item
    for item in items:
        if item.get("url"):
            return item
    return items[0] if items else None


# Short-code weather conditions the picker offers. Kept as a plain str field
# on the wire so we can add new values without a migration.
WEATHER_CONDITIONS = {
    "sunny",
    "partly",
    "cloudy",
    "rain",
    "storm",
    "wind",
    "snow",
    "fog",
}

# "preparation" marks a pre-departure post (packing, tinkering at home);
# it shows up in the journal but is excluded from every trip statistic.
STOP_TYPES = {"stop", "repair", "preparation"}


def check_weather_condition(v: str | None) -> str | None:
    # Empty string means "unspecified"; None only occurs on partial updates.
    if v and v not in WEATHER_CONDITIONS:
        raise ValueError(
            f"weather_condition must be one of: {', '.join(sorted(WEATHER_CONDITIONS))}"
        )
    return v


def check_stop_type(v: str | None) -> str | None:
    if v is not None and v not in STOP_TYPES:
        raise ValueError(f"type must be one of: {', '.join(sorted(STOP_TYPES))}")
    return v


# Shared properties
class StopBase(SQLModel):
    place: str = Field(min_length=1, max_length=255)
    country: str = Field(min_length=1, max_length=255)
    flag: str = Field(default="", max_length=16)  # emoji flag
    code: str = Field(default="", max_length=8)  # ISO country code
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    date: date
    title: str = Field(min_length=1, max_length=255)
    # `km` is the odometer reading at this stop, carried only when the rider
    # deliberately noted one — most days they don't, and the leg is measured
    # from the GPS track instead. Never inherited from the previous stop: two
    # stops sharing a reading would measure the leg between them as 0 km.
    km: int | None = Field(default=None, ge=0)
    # Weather is split for the picker UI: a temperature in °C and one of the
    # `WEATHER_CONDITIONS` short codes (or an empty string for "unspecified").
    weather_temp: int | None = Field(default=None)
    weather_condition: str = Field(default="", max_length=16)
    type: str = Field(default="stop", max_length=16)  # one of STOP_TYPES
    # Marks the leg *into* this stop as a boat crossing: the rider and the Cub
    # came here by ferry instead of riding. It hangs off the arrival stop
    # because that is the post the rider writes after stepping off the boat,
    # and it keeps the flag on a single row when stops are reordered. The map
    # draws that leg as a dashed sea line with a little boat on it.
    ferry: bool = Field(default=False)
    story: str = Field(default="", sa_type=Text)
    broke: str | None = Field(default=None, sa_type=Text)  # repair: what broke
    fixed: str | None = Field(default=None, sa_type=Text)  # repair: what fixed

    @field_validator("weather_condition")
    @classmethod
    def validate_weather_condition(cls, v: str) -> str:
        return check_weather_condition(v)

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str) -> str:
        return check_stop_type(v)


# Properties to receive on stop creation
class StopCreate(StopBase):
    media: list[MediaItem] = Field(default_factory=list)


# Partial update — every field optional so the frontend can PATCH just what
# the user changed. `media` is intentionally *not* patched here; that goes
# through the dedicated upload/delete endpoints.
class StopUpdate(SQLModel):
    place: str | None = Field(default=None, min_length=1, max_length=255)
    country: str | None = Field(default=None, min_length=1, max_length=255)
    code: str | None = Field(default=None, max_length=8)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    date: date | None = None
    title: str | None = Field(default=None, min_length=1, max_length=255)
    km: int | None = Field(default=None, ge=0)
    weather_temp: int | None = None
    weather_condition: str | None = Field(default=None, max_length=16)
    type: str | None = Field(default=None, max_length=16)
    ferry: bool | None = None
    story: str | None = None
    broke: str | None = None
    fixed: str | None = None
    media: list[MediaItem] | None = None

    @field_validator("weather_condition")
    @classmethod
    def validate_weather_condition(cls, v: str | None) -> str | None:
        return check_weather_condition(v)

    @field_validator("type")
    @classmethod
    def validate_type(cls, v: str | None) -> str | None:
        return check_stop_type(v)


# Caption edit for one media item — the only mutable field after upload; the
# file itself is replaced by delete + re-upload.
class MediaCaptionUpdate(SQLModel):
    cap: str = Field(max_length=255)


# Database model, database table inferred from class name
class Stop(StopBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    order_index: int = Field(default=0, index=True)
    media: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


# Properties to return via API, id is always required. The reaction counts
# let the map badge pins in one call; the read endpoints populate them and
# they default to 0 elsewhere (e.g. right after a create).
class StopPublic(StopBase):
    id: uuid.UUID
    order_index: int
    media: list[MediaItem] = Field(default_factory=list)
    honk_count: int = 0
    comment_count: int = 0


class StopsPublic(SQLModel):
    data: list[StopPublic]
    count: int


# Weather auto-fill suggestion looked up at Open-Meteo. Either field may be
# None when the upstream data is incomplete for the requested day; the client
# treats that as "no suggestion" and leaves the field manual.
class WeatherSuggestion(SQLModel):
    temp: int | None
    condition: str | None


# Last known position of the Cub, read from the Traccar GPS server. `fix_time`
# is when the tracker recorded the fix — the frontend renders it as "laatst
# gezien X geleden" and greys the marker when it goes stale. Speed is km/h
# (Traccar reports knots; the route converts). `battery` is the tracker's
# battery percentage when the device reports one.
class LiveLocation(SQLModel):
    lat: float
    lng: float
    speed_kmh: float | None = None
    course: float | None = None
    battery: float | None = None
    fix_time: datetime | None = None


# The breadcrumb trail: recent stored positions from Traccar, oldest first,
# decimated server-side to a drawable size. The map renders them as a dotted
# trail leading to the live marker.
class LiveTrailPoint(SQLModel):
    lat: float
    lng: float
    fix_time: datetime | None = None


class LiveTrail(SQLModel):
    points: list[LiveTrailPoint]


# The real ridden road of one leg, synced from Traccar's position history and
# keyed by the leg's destination stop. Stop ids are plain columns, not FKs:
# when stops are reordered or deleted the row simply stops matching a current
# consecutive pair and is ignored by the read endpoint (and replaced by the
# next sync) instead of blocking the stop mutation. `points` is a decimated
# [[lng, lat], ...] polyline in GeoJSON coordinate order.
class LegTrack(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    from_stop_id: uuid.UUID = Field(index=True)
    to_stop_id: uuid.UUID = Field(unique=True, index=True)
    points: list = Field(default_factory=list, sa_column=Column(JSON))
    # Kilometres actually ridden on this leg, measured from the full-
    # resolution GPS history at sync time (the stored `points` are decimated
    # for drawing and would under-measure). None on rows synced before the
    # field existed — a plain /location/sync-tracks run backfills them.
    distance_km: float | None = Field(default=None)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class LegTrackPublic(SQLModel):
    from_stop_id: uuid.UUID
    to_stop_id: uuid.UUID
    points: list[list[float]]


class LegTracksPublic(SQLModel):
    data: list[LegTrackPublic]
    count: int


class LegTrackSyncResult(SQLModel):
    synced: int
    skipped: int
    failed: int


# Kilometres ridden since the trip's latest stop, measured live from Traccar
# history (see tracksync.ridden_since_last_stop). The logbook adds `km` on
# top of the through-the-last-stop total for a live figure. `fix_time` is the
# newest position the measurement reaches; None when the tracker has no
# usable history since the stop (then `km` is 0).
class RiddenSince(SQLModel):
    km: float
    from_stop_id: uuid.UUID
    fix_time: datetime | None = None


# Aggregate trip statistics for the "Wrapped" recap screen. `km` measures
# each leg by geo.leg_km: a believable odometer delta first, then the leg's
# GPS-measured road, then the great-circle line — except on a ferry leg,
# where only a reading of the rider's own counts. `suggested_km` is the last
# known odometer reading — shown to the rider as a hint next to the km field,
# never pre-filled into it (a copied reading makes a leg measure 0 km).
class TripStats(SQLModel):
    km: int
    suggested_km: int | None
    days: int
    countries: int
    stops: int
    repairs: int
    stamps: int


# ----------------------------------------------------------------------------
# Map flags (start + finish).
#
# The map shows a starting flag and a finish flag marking where the trip
# begins and where it is headed. They are independent of the stops — the
# finish can sit far beyond the latest stop. Reads are public; a superuser
# can drag a flag to a new spot (or rename its label). Exactly one row per
# kind; missing rows are lazily created with the defaults below.
# ----------------------------------------------------------------------------

MAP_FLAG_KINDS = {"start", "finish"}

# Defaults for a fresh database: the trip runs Amsterdam → Tanger (Morocco).
DEFAULT_MAP_FLAGS: dict[str, dict] = {
    "start": {"label": "Amsterdam", "lat": 52.3676, "lng": 4.9041},
    "finish": {"label": "Tanger", "lat": 35.7595, "lng": -5.834},
}


class MapFlagBase(SQLModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    label: str = Field(default="", max_length=255)


class MapFlag(MapFlagBase, table=True):
    kind: str = Field(primary_key=True, max_length=16)  # one of MAP_FLAG_KINDS


# Partial update — a drag sends just lat/lng; the label can change separately.
class MapFlagUpdate(SQLModel):
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    label: str | None = Field(default=None, max_length=255)


class MapFlagPublic(MapFlagBase):
    kind: str


class MapFlagsPublic(SQLModel):
    data: list[MapFlagPublic]
    count: int


# ----------------------------------------------------------------------------
# Trip info (the headline above the map).
#
# One row, one field for now: the title everyone reads on the home screen.
# Reads are public; only a superuser can rewrite it. Like the map flags the
# row is created lazily, so a fresh database serves the default below.
# ----------------------------------------------------------------------------

TRIP_INFO_ID = "trip"
DEFAULT_TRIP_TITLE = "Van Mokum naar Marokko"
# The header renders the title on one line at 23px; longer than this and it
# starts wrapping over the logbook card.
TRIP_TITLE_MAX_LENGTH = 60


class TripInfoBase(SQLModel):
    title: str = Field(
        default=DEFAULT_TRIP_TITLE, min_length=1, max_length=TRIP_TITLE_MAX_LENGTH
    )


class TripInfo(TripInfoBase, table=True):
    id: str = Field(default=TRIP_INFO_ID, primary_key=True, max_length=16)


class TripInfoUpdate(SQLModel):
    title: str = Field(min_length=1, max_length=TRIP_TITLE_MAX_LENGTH)

    # Runs before the length checks so surrounding whitespace never counts
    # against the limit — and a title of only spaces is rejected as empty.
    @field_validator("title", mode="before")
    @classmethod
    def strip_title(cls, v: Any) -> Any:
        return v.strip() if isinstance(v, str) else v


class TripInfoPublic(TripInfoBase):
    pass


# ----------------------------------------------------------------------------
# Comments + horn honks (public reactions on stops).
#
# Anyone can read; only authenticated users can post a comment or honk. A user
# can honk a given stop at most once — the API toggles.
# ----------------------------------------------------------------------------


class Comment(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    stop_id: uuid.UUID = Field(
        foreign_key="stop.id", nullable=False, ondelete="CASCADE", index=True
    )
    user_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE", index=True
    )
    body: str = Field(sa_type=Text)
    # Optional photo or short video attached to the comment. Server-relative
    # URLs into the media volume ("/media/<stop_id>/comments/<uuid>.jpg"),
    # same convention as stop media. Thumb is None for videos (no ffmpeg on
    # board, same as stop media) and when thumbnail generation failed.
    photo: str | None = Field(default=None, max_length=512)
    photo_thumb: str | None = Field(default=None, max_length=512)
    # "image" or "video" — which element the client renders for `photo`.
    # Every attachment that predates video comments is a photo.
    media_kind: str = Field(default="image", max_length=16)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class CommentPublic(SQLModel):
    id: uuid.UUID
    stop_id: uuid.UUID
    user_id: uuid.UUID
    # Rendered display name — full_name when present, otherwise the local part
    # of the email so we don't leak the full address.
    author_name: str
    is_mine: bool = False
    body: str
    photo: str | None = None
    photo_thumb: str | None = None
    # "image" or "video"; meaningless when `photo` is None.
    media_kind: Literal["image", "video"] = "image"
    created_at: datetime | None = None
    # Horn-honk tally for the comment itself, so the list renders honk
    # buttons without a request per comment.
    honk_count: int = 0
    honked_by_me: bool = False


class CommentsPublic(SQLModel):
    data: list[CommentPublic]
    count: int


class HornHonk(SQLModel, table=True):
    # A given user can honk a stop at most once — the API toggles.
    __table_args__ = (UniqueConstraint("stop_id", "user_id", name="uq_honk_stop_user"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    stop_id: uuid.UUID = Field(
        foreign_key="stop.id", nullable=False, ondelete="CASCADE", index=True
    )
    user_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE", index=True
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class CommentHonk(SQLModel, table=True):
    # A given user can honk a comment at most once — the API toggles.
    __table_args__ = (
        UniqueConstraint("comment_id", "user_id", name="uq_honk_comment_user"),
    )

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    comment_id: uuid.UUID = Field(
        foreign_key="comment.id", nullable=False, ondelete="CASCADE", index=True
    )
    user_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE", index=True
    )
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class CommentHonkPublic(SQLModel):
    comment_id: uuid.UUID
    count: int
    honked_by_me: bool


class HonkerPublic(SQLModel):
    # One row per user who honked. Names use the same rendering rule as
    # comments (`full_name` or the email local-part).
    user_id: uuid.UUID
    name: str
    is_mine: bool = False
    created_at: datetime | None = None


class HonkPublic(SQLModel):
    stop_id: uuid.UUID
    count: int
    honked_by_me: bool
    # Most recent honks first. The list is capped server-side to avoid a
    # popular stop shipping a giant payload; when longer, `count` is still
    # the true total.
    honkers: list[HonkerPublic] = Field(default_factory=list)


# ----------------------------------------------------------------------------
# Web Push subscriptions ("volg de reis").
#
# Anyone — logged in or not — can subscribe their browser to new-stop
# notifications. When the subscriber is a signed-in superuser they can also
# opt into reaction notifications (comments + honks). One row per browser
# push endpoint; re-subscribing upserts.
# ----------------------------------------------------------------------------


class PushSubscription(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    # The browser-vendor push URL; globally unique per subscription.
    endpoint: str = Field(unique=True, index=True, max_length=1024)
    p256dh: str = Field(max_length=255)
    auth: str = Field(max_length=255)
    # None = anonymous follower; set = the account that subscribed.
    user_id: uuid.UUID | None = Field(
        default=None, foreign_key="user.id", nullable=True, ondelete="CASCADE"
    )
    # Only honored for superusers — reaction pushes are an admin feature.
    wants_reactions: bool = False
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class PushSubscriptionKeys(SQLModel):
    p256dh: str = Field(min_length=1, max_length=255)
    auth: str = Field(min_length=1, max_length=255)


# Mirrors the JSON of a browser PushSubscription (endpoint + keys), plus the
# admin-only wants_reactions flag.
class PushSubscribeIn(SQLModel):
    endpoint: str = Field(min_length=1, max_length=1024)
    keys: PushSubscriptionKeys
    wants_reactions: bool = False


class PushUnsubscribeIn(SQLModel):
    endpoint: str = Field(min_length=1, max_length=1024)


class PushPublicKey(SQLModel):
    # base64url, uncompressed P-256 point — feeds pushManager.subscribe's
    # applicationServerKey directly.
    public_key: str


# ----------------------------------------------------------------------------
# Feedback / bug reports ("storingsdienst").
#
# Signed-in users can report something broken on the site. Reports land in a
# small queue: the reporter sees their own reports (and their status), a
# superuser sees everything and flips a report to "resolved" once it is
# fixed. New reports push-notify the admins so nothing sits unnoticed.
# ----------------------------------------------------------------------------

FEEDBACK_STATUSES = {"open", "resolved"}


def check_feedback_status(v: str) -> str:
    if v not in FEEDBACK_STATUSES:
        raise ValueError(
            f"status must be one of: {', '.join(sorted(FEEDBACK_STATUSES))}"
        )
    return v


class FeedbackCreate(SQLModel):
    body: str = Field(min_length=1, max_length=4000)
    # Where it went wrong — free text or a path like "/logboek". Optional.
    page: str = Field(default="", max_length=255)


class FeedbackStatusUpdate(SQLModel):
    status: str = Field(max_length=16)

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        return check_feedback_status(v)


class Feedback(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE", index=True
    )
    body: str = Field(sa_type=Text)
    page: str = Field(default="", max_length=255)
    status: str = Field(default="open", max_length=16, index=True)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class FeedbackPublic(SQLModel):
    id: uuid.UUID
    user_id: uuid.UUID
    # Rendered display name — same rule as comments: full_name when present,
    # otherwise the email local-part so the full address never leaks.
    author_name: str
    is_mine: bool = False
    body: str
    page: str
    status: str
    created_at: datetime | None = None


class FeedbacksPublic(SQLModel):
    data: list[FeedbackPublic]
    count: int


# ----------------------------------------------------------------------------
# Usage tracking + server status (superuser-only dashboard).
#
# Requests are counted in memory per worker (see core/usage.py) and flushed
# additively into `usagestat` — one row per (UTC day, bucket), so the table
# stays tiny (a handful of rows per day) no matter the traffic.
# ----------------------------------------------------------------------------


class UsageStat(SQLModel, table=True):
    day: date = Field(primary_key=True)
    # e.g. "stops:read", "media:read", "login:write" — see usage.bucket_for().
    bucket: str = Field(primary_key=True, max_length=48)
    count: int = 0


class UsageDayPublic(SQLModel):
    day: date
    buckets: dict[str, int]


class StatusMemory(SQLModel):
    # None on platforms without /proc (e.g. macOS dev machines).
    total_bytes: int | None = None
    available_bytes: int | None = None


class StatusDisk(SQLModel):
    total_bytes: int
    free_bytes: int


class StatusServer(SQLModel):
    # Load averages are host-wide (containers share the kernel).
    load_avg: list[float]
    cpu_count: int | None
    memory: StatusMemory
    disk: StatusDisk
    host_uptime_seconds: float | None
    worker_started_at: datetime


class StatusMedia(SQLModel):
    file_count: int
    total_bytes: int


class StatusDatabase(SQLModel):
    size_bytes: int
    users: int
    stops: int
    comments: int
    honks: int
    push_subscriptions: int


class AdminStatus(SQLModel):
    environment: str
    # Image tag the box is running (TAG env; None if not passed through).
    release_tag: str | None
    server: StatusServer
    media: StatusMedia
    database: StatusDatabase
    # Last 30 days, newest first. Counters from other workers can lag by up
    # to a minute (each of the 4 workers flushes its own tally).
    usage: list[UsageDayPublic]


# Generic message
class Message(SQLModel):
    message: str


# A signup captcha challenge: the plate image to read and the signed token
# that commits to its answer. `answer` is only filled in on local
# environments so the e2e suite can solve the plate without OCR.
class CaptchaChallenge(SQLModel):
    token: str
    image: str
    answer: str | None = None


# JSON payload containing access token
class Token(SQLModel):
    access_token: str
    token_type: str = "bearer"


# Contents of JWT token
class TokenPayload(SQLModel):
    sub: str | None = None


class NewPassword(SQLModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)


# ----------------------------------------------------------------------------
# Error telemetry ("pechregistratie").
#
# Unhandled backend exceptions and frontend crashes are recorded here so
# broken things surface without a user having to file a storingsdienst
# report. Events are grouped by a normalized fingerprint; a scheduled GitHub
# workflow (error-triage.yml) turns new open groups into GitHub issues and
# flips them to "reported". Superusers (or the workflow, via OPS_TOKEN) read
# and manage the queue through /api/v1/telemetry/errors.
# ----------------------------------------------------------------------------

ERROR_SOURCES = {"frontend", "backend"}
ERROR_GROUP_STATUSES = {"open", "reported", "resolved"}

# Only this many full events are stored per group; beyond that the group
# still counts occurrences (event_count / last_seen) but drops the payloads,
# so a crash-looping client can't grow the table unbounded.
ERROR_EVENTS_KEPT_PER_GROUP = 25


class ErrorGroup(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    # sha256 hex of (source, normalized message, top stack frame).
    fingerprint: str = Field(unique=True, index=True, max_length=64)
    source: str = Field(max_length=16)  # one of ERROR_SOURCES
    title: str = Field(max_length=500)
    status: str = Field(default="open", max_length=16, index=True)
    event_count: int = Field(default=0)
    # Filled by the triage workflow once a GitHub issue exists for the group.
    issue_url: str | None = Field(default=None, max_length=512)
    first_seen: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    last_seen: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


class ErrorEvent(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    group_id: uuid.UUID = Field(
        foreign_key="errorgroup.id", nullable=False, ondelete="CASCADE", index=True
    )
    message: str = Field(sa_type=Text)
    stack: str = Field(default="", sa_type=Text)
    # Frontend: the page URL; backend: "METHOD /path".
    url: str = Field(default="", max_length=1024)
    # Free-form extras: user agent, release tag, HTTP method, …
    context: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


# What the frontend posts when it crashes. Kept deliberately small — no
# auth required (the error boundary may hit while logged out), so nothing
# here is trusted beyond being displayed to a superuser.
class ErrorReportIn(SQLModel):
    message: str = Field(min_length=1, max_length=2000)
    stack: str = Field(default="", max_length=20000)
    url: str = Field(default="", max_length=1024)
    # What the client thinks it is running (e.g. a git SHA baked at build).
    release: str = Field(default="", max_length=64)


class ErrorEventPublic(SQLModel):
    id: uuid.UUID
    message: str
    stack: str
    url: str
    context: dict
    created_at: datetime | None


class ErrorGroupPublic(SQLModel):
    id: uuid.UUID
    fingerprint: str
    source: str
    title: str
    status: str
    event_count: int
    issue_url: str | None
    first_seen: datetime | None
    last_seen: datetime | None
    # Most recent stored event, as the representative sample.
    latest_event: ErrorEventPublic | None = None


class ErrorGroupsPublic(SQLModel):
    data: list[ErrorGroupPublic]
    count: int


class ErrorGroupUpdate(SQLModel):
    status: str = Field(max_length=16)
    issue_url: str | None = Field(default=None, max_length=512)

    @field_validator("status")
    @classmethod
    def check_status(cls, v: str) -> str:
        if v not in ERROR_GROUP_STATUSES:
            raise ValueError(
                f"status must be one of: {', '.join(sorted(ERROR_GROUP_STATUSES))}"
            )
        return v
