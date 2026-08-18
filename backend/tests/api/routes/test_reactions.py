import base64
import io
import uuid
from collections.abc import Generator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from tempfile import SpooledTemporaryFile
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app import crud
from app.api.routes import reactions as reactions_module
from app.core.config import settings
from app.models import Comment, CommentHonk, HornHonk, Stop, UserCreate
from tests.utils.stop import create_test_stop, delete_test_stop
from tests.utils.user import user_authentication_headers
from tests.utils.utils import random_email, random_lower_string

API = settings.API_V1_STR

# A real, valid 1x1 transparent PNG (67 bytes).
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
    "AAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def comments_url(stop_id: object) -> str:
    return f"{API}/stops/{stop_id}/comments"


def honks_url(stop_id: object) -> str:
    return f"{API}/stops/{stop_id}/honks"


def comment_honks_url(comment_id: object) -> str:
    return f"{API}/comments/{comment_id}/honks"


@pytest.fixture
def stop(db: Session) -> Generator[Stop]:
    stop = create_test_stop(db)
    yield stop
    # Deleting the stop cascades to its comments and honks (FK ON DELETE
    # CASCADE), so each test leaves the reaction tables clean.
    delete_test_stop(db, stop)


@pytest.fixture
def media_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    # The route module binds MEDIA_ROOT at import time
    # (`from app.core.media import MEDIA_ROOT`), so patch the route module's
    # reference — patching app.core.media would not reach the handlers.
    monkeypatch.setattr(reactions_module, "MEDIA_ROOT", tmp_path)
    return tmp_path


@pytest.fixture(scope="module")
def other_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    email = random_email()
    password = random_lower_string()
    crud.create_user(session=db, user_create=UserCreate(email=email, password=password))
    return user_authentication_headers(client=client, email=email, password=password)


def _me(client: TestClient, headers: dict[str, str]) -> dict[str, Any]:
    return cast(dict[str, Any], client.get(f"{API}/users/me", headers=headers).json())


# ----- Comments ----------------------------------------------------------------


def test_create_comment_requires_auth(client: TestClient, stop: Stop) -> None:
    r = client.post(comments_url(stop.id), data={"body": "Mooi!"})
    assert r.status_code == 401


def test_create_and_list_comment(
    client: TestClient, normal_user_token_headers: dict[str, str], stop: Stop
) -> None:
    r = client.post(
        comments_url(stop.id),
        headers=normal_user_token_headers,
        data={"body": "  Wat een tocht!  "},
    )
    assert r.status_code == 200
    created = r.json()
    assert created["body"] == "Wat een tocht!"  # stripped
    assert created["is_mine"] is True
    assert created["author_name"]
    assert created["stop_id"] == str(stop.id)
    assert created["photo"] is None
    assert created["photo_thumb"] is None

    # The list is public: no auth needed, and is_mine is False for anonymous.
    r = client.get(comments_url(stop.id))
    assert r.status_code == 200
    listed = r.json()
    assert listed["count"] == 1
    assert listed["data"][0]["id"] == created["id"]
    assert listed["data"][0]["is_mine"] is False

    # The author sees their own comment flagged.
    mine = client.get(comments_url(stop.id), headers=normal_user_token_headers).json()
    assert mine["data"][0]["is_mine"] is True


def test_create_comment_rejects_blank_body(
    client: TestClient, normal_user_token_headers: dict[str, str], stop: Stop
) -> None:
    r = client.post(
        comments_url(stop.id), headers=normal_user_token_headers, data={"body": "   "}
    )
    assert r.status_code == 422
    r = client.post(
        comments_url(stop.id), headers=normal_user_token_headers, data={"body": ""}
    )
    assert r.status_code == 422


def test_comment_on_missing_stop(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.post(
        comments_url(uuid.uuid4()),
        headers=normal_user_token_headers,
        data={"body": "Hallo?"},
    )
    assert r.status_code == 404
    assert client.get(comments_url(uuid.uuid4())).status_code == 404


def test_comments_pagination(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    stop: Stop,
) -> None:
    # Seed 7 comments straight into the DB (posting them through the API
    # would trip the 10/minute comment rate limit for larger sets) with
    # strictly increasing timestamps so newest-first ordering is unambiguous.
    me = _me(client, normal_user_token_headers)
    base = datetime(2024, 6, 1, 12, 0, tzinfo=UTC)
    for i in range(7):
        db.add(
            Comment(
                stop_id=stop.id,
                user_id=uuid.UUID(me["id"]),
                body=f"reactie {i}",
                created_at=base + timedelta(minutes=i),
            )
        )
    db.commit()

    # Default page returns everything; count is the total.
    full = client.get(comments_url(stop.id)).json()
    assert full["count"] == 7
    assert [c["body"] for c in full["data"]] == [
        f"reactie {i}" for i in range(6, -1, -1)
    ]

    # limit caps the page but count stays the total number of comments.
    page = client.get(comments_url(stop.id), params={"limit": 3}).json()
    assert page["count"] == 7
    assert [c["body"] for c in page["data"]] == ["reactie 6", "reactie 5", "reactie 4"]

    # skip walks further pages.
    page = client.get(comments_url(stop.id), params={"skip": 5, "limit": 3}).json()
    assert page["count"] == 7
    assert [c["body"] for c in page["data"]] == ["reactie 1", "reactie 0"]

    # skip past the end: empty page, count still total.
    page = client.get(comments_url(stop.id), params={"skip": 100}).json()
    assert page["count"] == 7
    assert page["data"] == []

    # limit is capped at 100.
    r = client.get(comments_url(stop.id), params={"limit": 101})
    assert r.status_code == 422


def _post_comment(
    client: TestClient, headers: dict[str, str], stop_id: object, body: str = "Toet"
) -> dict[str, Any]:
    r = client.post(comments_url(stop_id), headers=headers, data={"body": body})
    assert r.status_code == 200
    return cast(dict[str, Any], r.json())


def _post_photo_comment(
    client: TestClient,
    headers: dict[str, str],
    stop_id: object,
    *,
    body: str = "",
    content: bytes = PNG_1PX,
    content_type: str = "image/png",
    filename: str = "foto.png",
) -> Any:
    return client.post(
        comments_url(stop_id),
        headers=headers,
        data={"body": body},
        files={"file": (filename, io.BytesIO(content), content_type)},
    )


# ----- Comment photos ---------------------------------------------------------


def test_create_comment_with_photo(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    r = _post_photo_comment(
        client, normal_user_token_headers, stop.id, body="Kijk dan!"
    )
    assert r.status_code == 200
    created = r.json()
    assert created["body"] == "Kijk dan!"
    assert created["photo"].startswith(f"/media/{stop.id}/comments/")
    assert created["photo"].endswith(".png")
    # The bytes landed on disk, plus a real WebP thumbnail next to them.
    filename = created["photo"].rsplit("/", 1)[-1]
    comments_dir = media_root / str(stop.id) / "comments"
    assert (comments_dir / filename).read_bytes() == PNG_1PX
    stem = filename.rsplit(".", 1)[0]
    assert created["photo_thumb"] == f"/media/{stop.id}/comments/thumb_{stem}.webp"
    assert created["media_kind"] == "image"
    header = (comments_dir / f"thumb_{stem}.webp").read_bytes()
    assert header[:4] == b"RIFF" and header[8:12] == b"WEBP"
    # The public list carries the photo too.
    listed = client.get(comments_url(stop.id)).json()
    assert listed["data"][0]["photo"] == created["photo"]
    assert listed["data"][0]["photo_thumb"] == created["photo_thumb"]
    assert listed["data"][0]["media_kind"] == "image"


@pytest.mark.usefixtures("media_root")
def test_create_comment_photo_only_no_body(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    r = _post_photo_comment(client, normal_user_token_headers, stop.id, body="  ")
    assert r.status_code == 200
    created = r.json()
    assert created["body"] == ""
    assert created["photo"] is not None


def test_create_comment_photo_survives_thumbnail_failure(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    # Declared image/png but not decodable — the thumbnail step must log and
    # move on, never fail the upload.
    r = _post_photo_comment(
        client, normal_user_token_headers, stop.id, content=b"not a png"
    )
    assert r.status_code == 200
    created = r.json()
    assert created["photo"] is not None
    assert created["photo_thumb"] is None
    assert not list(media_root.glob("**/thumb_*.webp"))


def test_create_comment_photo_rejects_wrong_content_type(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    r = _post_photo_comment(
        client,
        normal_user_token_headers,
        stop.id,
        content=b"%PDF-1.4 not a picture",
        content_type="application/pdf",
        filename="handleiding.pdf",
    )
    assert r.status_code == 415
    assert "Unsupported media type" in r.json()["detail"]
    assert not list(media_root.glob("**/*"))
    assert client.get(comments_url(stop.id)).json()["count"] == 0


def test_create_comment_photo_rejects_oversized_file(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Shrink the cap instead of streaming 10 MiB through the test client.
    monkeypatch.setattr(reactions_module, "COMMENT_PHOTO_MAX_BYTES", 1024)
    r = _post_photo_comment(
        client, normal_user_token_headers, stop.id, content=b"x" * 2048
    )
    assert r.status_code == 413
    assert "too large" in r.json()["detail"].lower()
    # The partial file was cleaned up and no comment row was created.
    comments_dir = media_root / str(stop.id) / "comments"
    assert not comments_dir.exists() or not any(comments_dir.iterdir())
    assert client.get(comments_url(stop.id)).json()["count"] == 0


def test_delete_comment_removes_photo_files(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    created = _post_photo_comment(client, normal_user_token_headers, stop.id).json()
    comments_dir = media_root / str(stop.id) / "comments"
    original = comments_dir / created["photo"].rsplit("/", 1)[-1]
    thumb = comments_dir / created["photo_thumb"].rsplit("/", 1)[-1]
    assert original.exists() and thumb.exists()

    r = client.delete(
        f"{API}/comments/{created['id']}", headers=normal_user_token_headers
    )
    assert r.status_code == 200
    assert not original.exists()
    assert not thumb.exists()


def test_delete_comment_by_author(
    client: TestClient, normal_user_token_headers: dict[str, str], stop: Stop
) -> None:
    comment = _post_comment(client, normal_user_token_headers, stop.id)
    r = client.delete(
        f"{API}/comments/{comment['id']}", headers=normal_user_token_headers
    )
    assert r.status_code == 200
    assert r.json()["message"] == "Comment deleted successfully"
    assert client.get(comments_url(stop.id)).json()["count"] == 0


def test_delete_comment_by_other_user_forbidden(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    other_user_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    comment = _post_comment(client, normal_user_token_headers, stop.id)
    r = client.delete(
        f"{API}/comments/{comment['id']}", headers=other_user_token_headers
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "Not enough permissions"
    assert client.get(comments_url(stop.id)).json()["count"] == 1


def test_delete_comment_by_superuser(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    comment = _post_comment(client, normal_user_token_headers, stop.id)
    r = client.delete(
        f"{API}/comments/{comment['id']}", headers=superuser_token_headers
    )
    assert r.status_code == 200
    assert client.get(comments_url(stop.id)).json()["count"] == 0


def test_delete_comment_requires_auth_and_existence(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    assert client.delete(f"{API}/comments/{uuid.uuid4()}").status_code == 401
    r = client.delete(
        f"{API}/comments/{uuid.uuid4()}", headers=normal_user_token_headers
    )
    assert r.status_code == 404


# ----- Horn honks ---------------------------------------------------------------


def test_honk_requires_auth(client: TestClient, stop: Stop) -> None:
    r = client.post(honks_url(stop.id))
    assert r.status_code == 401


def test_honk_toggle_on_off(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    other_user_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    # Toggle on.
    r = client.post(honks_url(stop.id), headers=normal_user_token_headers)
    assert r.status_code == 200
    state = r.json()
    assert state["count"] == 1
    assert state["honked_by_me"] is True
    assert len(state["honkers"]) == 1
    assert state["honkers"][0]["is_mine"] is True

    # Anonymous and other users see the honk but not as theirs.
    anon = client.get(honks_url(stop.id)).json()
    assert anon["count"] == 1
    assert anon["honked_by_me"] is False
    other = client.get(honks_url(stop.id), headers=other_user_token_headers).json()
    assert other["honked_by_me"] is False

    # Second user honks too.
    r = client.post(honks_url(stop.id), headers=other_user_token_headers)
    assert r.json()["count"] == 2

    # Toggle off for the first user.
    r = client.post(honks_url(stop.id), headers=normal_user_token_headers)
    assert r.status_code == 200
    state = r.json()
    assert state["count"] == 1
    assert state["honked_by_me"] is False
    assert all(h["is_mine"] is False for h in state["honkers"])


def test_honk_on_missing_stop(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    assert (
        client.post(honks_url(uuid.uuid4()), headers=normal_user_token_headers)
    ).status_code == 404
    assert client.get(honks_url(uuid.uuid4())).status_code == 404


def test_honk_unique_constraint(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    stop: Stop,
) -> None:
    me = _me(client, normal_user_token_headers)
    user_id = uuid.UUID(me["id"])
    db.add(HornHonk(stop_id=stop.id, user_id=user_id))
    db.commit()
    db.add(HornHonk(stop_id=stop.id, user_id=user_id))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    # And through the API the toggle keeps it at one honk max.
    state = client.get(honks_url(stop.id), headers=normal_user_token_headers).json()
    assert state["count"] == 1
    assert state["honked_by_me"] is True


# ----- Comment honks ------------------------------------------------------------


def test_comment_honk_requires_auth(
    client: TestClient, normal_user_token_headers: dict[str, str], stop: Stop
) -> None:
    comment = _post_comment(client, normal_user_token_headers, stop.id)
    r = client.post(comment_honks_url(comment["id"]))
    assert r.status_code == 401


def test_comment_honk_toggle_on_off(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    other_user_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    comment = _post_comment(client, normal_user_token_headers, stop.id)

    # A fresh comment starts unhonked in the list.
    listed = client.get(comments_url(stop.id)).json()
    assert listed["data"][0]["honk_count"] == 0
    assert listed["data"][0]["honked_by_me"] is False

    # Toggle on.
    r = client.post(comment_honks_url(comment["id"]), headers=other_user_token_headers)
    assert r.status_code == 200
    state = r.json()
    assert state["comment_id"] == comment["id"]
    assert state["count"] == 1
    assert state["honked_by_me"] is True

    # The comments list carries the tally; honked_by_me is per viewer.
    anon = client.get(comments_url(stop.id)).json()["data"][0]
    assert anon["honk_count"] == 1
    assert anon["honked_by_me"] is False
    honker = client.get(comments_url(stop.id), headers=other_user_token_headers).json()
    assert honker["data"][0]["honked_by_me"] is True
    author = client.get(comments_url(stop.id), headers=normal_user_token_headers).json()
    assert author["data"][0]["honk_count"] == 1
    assert author["data"][0]["honked_by_me"] is False

    # The comment author honks too.
    r = client.post(comment_honks_url(comment["id"]), headers=normal_user_token_headers)
    assert r.json()["count"] == 2

    # Toggle off for the second user.
    r = client.post(comment_honks_url(comment["id"]), headers=other_user_token_headers)
    assert r.status_code == 200
    state = r.json()
    assert state["count"] == 1
    assert state["honked_by_me"] is False


def test_comment_honk_on_missing_comment(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    r = client.post(comment_honks_url(uuid.uuid4()), headers=normal_user_token_headers)
    assert r.status_code == 404


def test_comment_honk_unique_constraint(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    stop: Stop,
) -> None:
    comment = _post_comment(client, normal_user_token_headers, stop.id)
    me = _me(client, normal_user_token_headers)
    user_id = uuid.UUID(me["id"])
    comment_id = uuid.UUID(comment["id"])
    db.add(CommentHonk(comment_id=comment_id, user_id=user_id))
    db.commit()
    db.add(CommentHonk(comment_id=comment_id, user_id=user_id))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    # And through the API the toggle keeps it at one honk max.
    listed = client.get(comments_url(stop.id), headers=normal_user_token_headers).json()
    assert listed["data"][0]["honk_count"] == 1
    assert listed["data"][0]["honked_by_me"] is True


def test_delete_comment_removes_its_honks(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db: Session,
    stop: Stop,
) -> None:
    comment = _post_comment(client, normal_user_token_headers, stop.id)
    r = client.post(comment_honks_url(comment["id"]), headers=normal_user_token_headers)
    assert r.status_code == 200

    r = client.delete(
        f"{API}/comments/{comment['id']}", headers=normal_user_token_headers
    )
    assert r.status_code == 200
    # The FK ON DELETE CASCADE swept up the comment's honks.
    remaining = db.exec(
        select(CommentHonk).where(CommentHonk.comment_id == uuid.UUID(comment["id"]))
    ).all()
    assert remaining == []


# ----- Comment videos ---------------------------------------------------------

# Enough of an MP4 header to be a plausible clip; nothing decodes it, the
# backend only streams the bytes to disk.
MP4_STUB = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 32


def test_create_comment_with_video(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    r = _post_photo_comment(
        client,
        normal_user_token_headers,
        stop.id,
        body="Moet je horen!",
        content=MP4_STUB,
        content_type="video/mp4",
        filename="clip.mp4",
    )
    assert r.status_code == 200
    created = r.json()
    assert created["media_kind"] == "video"
    assert created["photo"].startswith(f"/media/{stop.id}/comments/")
    assert created["photo"].endswith(".mp4")
    # No ffmpeg on board, so a clip carries no thumbnail — and none is written.
    assert created["photo_thumb"] is None
    filename = created["photo"].rsplit("/", 1)[-1]
    comments_dir = media_root / str(stop.id) / "comments"
    assert (comments_dir / filename).read_bytes() == MP4_STUB
    assert not list(media_root.glob("**/thumb_*.webp"))
    # The public list reports the kind, so clients know to render a player.
    listed = client.get(comments_url(stop.id)).json()
    assert listed["data"][0]["media_kind"] == "video"
    assert listed["data"][0]["photo"] == created["photo"]


@pytest.mark.usefixtures("media_root")
def test_create_comment_video_from_extension_when_type_unknown(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    # Some Android pickers hand the page a File with no usable type; the
    # filename is the fallback (same rule as stop media).
    r = _post_photo_comment(
        client,
        normal_user_token_headers,
        stop.id,
        content=MP4_STUB,
        content_type="application/octet-stream",
        filename="VID_20260812.mov",
    )
    assert r.status_code == 200
    created = r.json()
    assert created["media_kind"] == "video"
    assert created["photo"].endswith(".mov")


def test_create_comment_video_rejects_oversized_file(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Clips get their own, larger budget — shrink it rather than streaming
    # 25 MiB through the test client.
    monkeypatch.setattr(reactions_module, "COMMENT_VIDEO_MAX_BYTES", 1024)
    r = _post_photo_comment(
        client,
        normal_user_token_headers,
        stop.id,
        content=b"x" * 2048,
        content_type="video/mp4",
        filename="clip.mp4",
    )
    assert r.status_code == 413
    assert "too large" in r.json()["detail"].lower()
    comments_dir = media_root / str(stop.id) / "comments"
    assert not comments_dir.exists() or not any(comments_dir.iterdir())
    assert client.get(comments_url(stop.id)).json()["count"] == 0


def test_delete_comment_removes_video_file(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    created = _post_photo_comment(
        client,
        normal_user_token_headers,
        stop.id,
        content=MP4_STUB,
        content_type="video/mp4",
        filename="clip.mp4",
    ).json()
    clip = media_root / str(stop.id) / "comments" / created["photo"].rsplit("/", 1)[-1]
    assert clip.exists()

    r = client.delete(
        f"{API}/comments/{created['id']}", headers=normal_user_token_headers
    )
    assert r.status_code == 200
    assert not clip.exists()


# ----- Retried posts ----------------------------------------------------------


def _post_with_upload_id(
    client: TestClient,
    headers: dict[str, str],
    stop_id: object,
    upload_id: str,
    *,
    body: str = "Toet!",
    with_file: bool = False,
) -> Any:
    data: dict[str, str] = {"body": body, "upload_id": upload_id}
    files = (
        {"file": ("clip.mp4", io.BytesIO(MP4_STUB), "video/mp4")} if with_file else None
    )
    return client.post(comments_url(stop_id), headers=headers, data=data, files=files)


def test_comment_retry_with_same_upload_id_does_not_duplicate(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    # The poster's connection dropped after the comment landed but before
    # the reply arrived, so the client re-sends it. The retry must hand back
    # the comment that already exists rather than post it twice.
    first = _post_with_upload_id(client, normal_user_token_headers, stop.id, "abc")
    assert first.status_code == 200

    retry = _post_with_upload_id(client, normal_user_token_headers, stop.id, "abc")
    assert retry.status_code == 200
    assert retry.json()["id"] == first.json()["id"]
    assert client.get(comments_url(stop.id)).json()["count"] == 1


def test_comment_retry_with_a_file_writes_it_once(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    # The expensive half: a retry must not write a second copy of the clip
    # onto the media volume, orphaning the first.
    first = _post_with_upload_id(
        client, normal_user_token_headers, stop.id, "clip-1", with_file=True
    )
    assert first.status_code == 200
    retry = _post_with_upload_id(
        client, normal_user_token_headers, stop.id, "clip-1", with_file=True
    )
    assert retry.status_code == 200
    assert retry.json()["photo"] == first.json()["photo"]
    comments_dir = media_root / str(stop.id) / "comments"
    assert len(list(comments_dir.glob("*.mp4"))) == 1


def test_comment_upload_id_is_scoped_to_its_author(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    # Keys are minted client-side, so two people can pick the same one. One
    # poster's key must never swallow another's comment.
    _post_with_upload_id(client, normal_user_token_headers, stop.id, "same", body="een")
    r = _post_with_upload_id(
        client, superuser_token_headers, stop.id, "same", body="twee"
    )
    assert r.status_code == 200
    assert r.json()["body"] == "twee"
    assert client.get(comments_url(stop.id)).json()["count"] == 2


def test_comment_without_upload_id_still_posts_twice(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    # Old clients send no key; two identical comments from them are two
    # comments, not one deduplicated away behind their back.
    _post_comment(client, normal_user_token_headers, stop.id, body="dubbel")
    _post_comment(client, normal_user_token_headers, stop.id, body="dubbel")
    assert client.get(comments_url(stop.id)).json()["count"] == 2


def test_comment_media_cleans_up_after_a_failed_write(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Same contract as stop media: a client that hangs up mid-body leaves a
    # partial file nothing references, and it must not survive the request.
    def boom(_self: object, *_args: object, **_kwargs: object) -> bytes:
        raise ConnectionResetError("client went away")

    monkeypatch.setattr(SpooledTemporaryFile, "read", boom)
    with pytest.raises(ConnectionResetError):
        _post_photo_comment(client, normal_user_token_headers, stop.id)
    comments_dir = media_root / str(stop.id) / "comments"
    assert not comments_dir.exists() or not any(comments_dir.iterdir())
