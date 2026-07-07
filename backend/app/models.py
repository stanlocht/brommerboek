import uuid
from datetime import UTC, date, datetime
from typing import Literal

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
# type ("stop" or "repair"). The route is simply the line connecting the stops
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

STOP_TYPES = {"stop", "repair"}


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
    # `km` is the odometer reading at this stop. Optional — a rider who forgot
    # to note it just leaves it blank.
    km: int | None = Field(default=None, ge=0)
    # Weather is split for the picker UI: a temperature in °C and one of the
    # `WEATHER_CONDITIONS` short codes (or an empty string for "unspecified").
    weather_temp: int | None = Field(default=None)
    weather_condition: str = Field(default="", max_length=16)
    type: str = Field(default="stop", max_length=16)  # "stop" | "repair"
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


# Database model, database table inferred from class name
class Stop(StopBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    order_index: int = Field(default=0, index=True)
    media: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


# Properties to return via API, id is always required
class StopPublic(StopBase):
    id: uuid.UUID
    order_index: int
    media: list[MediaItem] = Field(default_factory=list)


class StopsPublic(SQLModel):
    data: list[StopPublic]
    count: int


# Aggregate trip statistics for the "Wrapped" recap screen. `km` uses each
# leg's odometer delta when both endpoints have a km value, and falls back
# to great-circle distance otherwise. `suggested_km` is the last known
# odometer reading — the frontend prefills the next stop's km input with it.
class TripStats(SQLModel):
    km: int
    suggested_km: int | None
    days: int
    countries: int
    stops: int
    repairs: int
    stamps: int


# ----------------------------------------------------------------------------
# Comments + horn honks (public reactions on stops).
#
# Anyone can read; only authenticated users can post a comment or honk. A user
# can honk a given stop at most once — the API toggles.
# ----------------------------------------------------------------------------


class CommentCreate(SQLModel):
    body: str = Field(min_length=1, max_length=2000)


class Comment(SQLModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    stop_id: uuid.UUID = Field(
        foreign_key="stop.id", nullable=False, ondelete="CASCADE", index=True
    )
    user_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE", index=True
    )
    body: str = Field(sa_type=Text)
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
    created_at: datetime | None = None


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


# Generic message
class Message(SQLModel):
    message: str


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
