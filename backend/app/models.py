import uuid
from datetime import UTC, date, datetime

from pydantic import EmailStr
from sqlalchemy import JSON, DateTime, Text, UniqueConstraint
from sqlmodel import Column, Field, Relationship, SQLModel


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
    items: list[Item] = Relationship(back_populates="owner", cascade_delete=True)


# Properties to return via API, id is always required
class UserPublic(UserBase):
    id: uuid.UUID
    created_at: datetime | None = None


class UsersPublic(SQLModel):
    data: list[UserPublic]
    count: int


# Shared properties
class ItemBase(SQLModel):
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=255)


# Properties to receive on item creation
class ItemCreate(ItemBase):
    pass


# Properties to receive on item update
class ItemUpdate(SQLModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=255)


# Database model, database table inferred from class name
class Item(ItemBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )
    owner_id: uuid.UUID = Field(
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
    )
    owner: User | None = Relationship(back_populates="items")


# Properties to return via API, id is always required
class ItemPublic(ItemBase):
    id: uuid.UUID
    owner_id: uuid.UUID
    created_at: datetime | None = None


class ItemsPublic(SQLModel):
    data: list[ItemPublic]
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
    # `tone` is a hex colour used as a vintage-photo placeholder swatch until a
    # real image is dropped in; `cap` is the caption; `video` marks a clip.
    tone: str = Field(max_length=32)
    cap: str = Field(default="", max_length=255)
    video: bool = False


# Shared properties
class StopBase(SQLModel):
    place: str = Field(min_length=1, max_length=255)
    country: str = Field(min_length=1, max_length=255)
    flag: str = Field(default="", max_length=16)  # emoji flag
    code: str = Field(default="", max_length=8)  # ISO country code
    lat: float
    lng: float
    date: date
    title: str = Field(min_length=1, max_length=255)
    km: int = Field(default=0, ge=0)
    weather: str = Field(default="", max_length=255)
    type: str = Field(default="stop", max_length=16)  # "stop" | "repair"
    story: str = Field(default="", sa_type=Text)
    broke: str | None = Field(default=None, sa_type=Text)  # repair: what broke
    fixed: str | None = Field(default=None, sa_type=Text)  # repair: what fixed


# Properties to receive on stop creation
class StopCreate(StopBase):
    media: list[MediaItem] = Field(default_factory=list)


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


# Aggregate trip statistics for the "Wrapped" recap screen. `km` is the summed
# great-circle distance between consecutive stops (real geography, in km).
# `suggested_km` is the highest odometer reading seen so far — the frontend
# uses it to prefill the next stop's km input.
class TripStats(SQLModel):
    km: int
    suggested_km: int
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
        foreign_key="user.id", nullable=False, ondelete="CASCADE"
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


class HonkPublic(SQLModel):
    stop_id: uuid.UUID
    count: int
    honked_by_me: bool


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
