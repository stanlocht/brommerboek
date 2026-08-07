import base64
import io
import uuid
from collections.abc import Generator
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlmodel import Session

from app.api.routes import stops as stops_module
from app.backfill_thumbs import backfill_thumbs
from app.core.config import settings
from app.models import Stop
from tests.utils.stop import create_test_stop, delete_test_stop

STOPS_URL = f"{settings.API_V1_STR}/stops/"

# A real, valid 1x1 transparent PNG (67 bytes).
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ"
    "AAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def _heif_1px() -> bytes:
    """A real HEIF file, encoded rather than pasted in as a base64 blob.

    Importing the route module has already run `register_heif_opener()` (via
    app.core.media), which is what teaches Pillow both ends of this format.
    """
    buf = io.BytesIO()
    Image.new("RGB", (1, 1), (200, 30, 20)).save(buf, format="HEIF")
    return buf.getvalue()


HEIF_1PX = _heif_1px()


@pytest.fixture
def media_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    # The route module binds MEDIA_ROOT at import time
    # (`from app.core.media import MEDIA_ROOT`), so patch the route module's
    # reference — patching app.core.media would not reach the handlers.
    monkeypatch.setattr(stops_module, "MEDIA_ROOT", tmp_path)
    return tmp_path


@pytest.fixture
def stop(db: Session) -> Generator[Stop]:
    stop = create_test_stop(db)
    yield stop
    delete_test_stop(db, stop)


def _upload(
    client: TestClient,
    headers: dict[str, str],
    stop_id: object,
    *,
    content: bytes = PNG_1PX,
    content_type: str = "image/png",
    caption: str = "",
    filename: str = "foto.png",
    cover: bool = False,
) -> httpx.Response:
    params: dict[str, object] = {}
    if caption:
        params["caption"] = caption
    if cover:
        params["cover"] = True
    response: httpx.Response = client.post(
        f"{STOPS_URL}{stop_id}/media",
        headers=headers,
        params=params or None,
        files={"file": (filename, io.BytesIO(content), content_type)},
    )
    return response


def test_upload_media_happy_path(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    r = _upload(client, superuser_token_headers, stop.id, caption="De Cub")
    assert r.status_code == 200
    media = r.json()["media"]
    assert len(media) == 1
    item = media[0]
    assert item["kind"] == "image"
    assert item["cap"] == "De Cub"
    assert item["url"].startswith(f"/media/{stop.id}/")
    assert item["url"].endswith(".png")
    # The bytes actually landed on disk under the stop's directory.
    filename = item["url"].rsplit("/", 1)[-1]
    assert (media_root / str(stop.id) / filename).read_bytes() == PNG_1PX


def test_upload_image_generates_thumbnail(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    r = _upload(client, superuser_token_headers, stop.id)
    assert r.status_code == 200
    item = r.json()["media"][0]
    stem = item["url"].rsplit("/", 1)[-1].rsplit(".", 1)[0]
    assert item["thumb"] == f"/media/{stop.id}/thumb_{stem}.webp"
    thumb_file = media_root / str(stop.id) / f"thumb_{stem}.webp"
    header = thumb_file.read_bytes()
    # A real WebP landed on disk (RIFF container with a WEBP chunk).
    assert header[:4] == b"RIFF" and header[8:12] == b"WEBP"


def test_upload_video_gets_no_thumbnail(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    r = _upload(
        client,
        superuser_token_headers,
        stop.id,
        content=b"\x00\x00\x00\x18ftypmp42not-a-real-clip",
        content_type="video/mp4",
    )
    assert r.status_code == 200
    item = r.json()["media"][0]
    assert item["kind"] == "video"
    assert item["thumb"] is None
    assert not list(media_root.glob("**/thumb_*.webp"))


def test_upload_survives_thumbnail_failure(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    # Declared image/png but not decodable — the thumbnail step must log and
    # move on, never fail the upload.
    r = _upload(client, superuser_token_headers, stop.id, content=b"not a png")
    assert r.status_code == 200
    item = r.json()["media"][0]
    assert item["thumb"] is None
    assert not list(media_root.glob("**/thumb_*.webp"))
    filename = item["url"].rsplit("/", 1)[-1]
    assert (media_root / str(stop.id) / filename).exists()


@pytest.mark.usefixtures("media_root")
def test_upload_media_requires_superuser(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    r = _upload(client, {}, stop.id)
    assert r.status_code == 401
    r = _upload(client, normal_user_token_headers, stop.id)
    assert r.status_code == 403


def test_upload_media_rejects_wrong_content_type(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    r = _upload(
        client,
        superuser_token_headers,
        stop.id,
        content=b"#!/bin/sh\necho boo",
        content_type="text/x-shellscript",
    )
    assert r.status_code == 415
    assert "Unsupported media type" in r.json()["detail"]
    assert not list(media_root.glob("**/*.png"))


@pytest.mark.usefixtures("media_root")
@pytest.mark.parametrize("content_type", ["", "application/octet-stream"])
def test_upload_media_falls_back_to_filename_when_type_unknown(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
    content_type: str,
) -> None:
    # Some Android pickers hand the page a File with no usable `type`, and
    # the multipart part then carries nothing better. Rejecting those meant
    # silently losing the photo, so the extension gets the last word.
    r = _upload(client, superuser_token_headers, stop.id, content_type=content_type)
    assert r.status_code == 200
    item = r.json()["media"][0]
    assert item["kind"] == "image"
    assert item["url"].endswith(".png")


def test_upload_media_filename_cannot_override_a_declared_type(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    # The fallback above is only for "I don't know" — naming a shell script
    # foto.png must not talk its way past the allow-list.
    r = _upload(
        client,
        superuser_token_headers,
        stop.id,
        content=b"#!/bin/sh\necho boo",
        content_type="text/x-shellscript",
        filename="foto.png",
    )
    assert r.status_code == 415
    assert not list(media_root.glob("**/*.png"))


def test_upload_media_accepts_heif(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    # Android cameras label the same container image/heic or image/heif; the
    # latter used to 415 and drop the photo.
    r = _upload(
        client,
        superuser_token_headers,
        stop.id,
        content=HEIF_1PX,
        content_type="image/heif",
        filename="IMG_0001.heic",
    )
    assert r.status_code == 200
    item = r.json()["media"][0]
    assert item["kind"] == "image"
    assert item["url"].endswith(".heic")
    # pillow-heif lets Pillow decode it, so the gallery gets a thumbnail it
    # can actually render instead of falling back to the HEIC original.
    assert item["thumb"] is not None
    stem = item["url"].rsplit("/", 1)[-1].rsplit(".", 1)[0]
    header = (media_root / str(stop.id) / f"thumb_{stem}.webp").read_bytes()
    assert header[:4] == b"RIFF" and header[8:12] == b"WEBP"


def test_upload_media_rejects_oversized_file(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Shrink the cap instead of streaming 25 MiB through the test client.
    monkeypatch.setattr(stops_module, "MAX_UPLOAD_BYTES", 1024)
    r = _upload(client, superuser_token_headers, stop.id, content=b"x" * 2048)
    assert r.status_code == 413
    assert "too large" in r.json()["detail"].lower()
    # The partial file was cleaned up.
    stop_dir = media_root / str(stop.id)
    assert not stop_dir.exists() or not any(stop_dir.iterdir())


@pytest.mark.usefixtures("media_root")
def test_upload_media_stop_not_found(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = _upload(client, superuser_token_headers, uuid.uuid4())
    assert r.status_code == 404


def test_delete_media_by_index_removes_file(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    first = _upload(client, superuser_token_headers, stop.id, caption="een").json()
    second = _upload(client, superuser_token_headers, stop.id, caption="twee").json()
    assert len(second["media"]) == 2
    first_file = media_root / str(stop.id) / first["media"][0]["url"].rsplit("/", 1)[-1]
    assert first_file.exists()

    r = client.delete(f"{STOPS_URL}{stop.id}/media/0", headers=superuser_token_headers)
    assert r.status_code == 200
    media = r.json()["media"]
    assert len(media) == 1
    assert media[0]["cap"] == "twee"
    assert not first_file.exists()


def test_delete_media_removes_thumbnail_file(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    item = _upload(client, superuser_token_headers, stop.id).json()["media"][0]
    stop_dir = media_root / str(stop.id)
    original = stop_dir / item["url"].rsplit("/", 1)[-1]
    thumb = stop_dir / item["thumb"].rsplit("/", 1)[-1]
    assert original.exists() and thumb.exists()

    r = client.delete(f"{STOPS_URL}{stop.id}/media/0", headers=superuser_token_headers)
    assert r.status_code == 200
    assert not original.exists()
    assert not thumb.exists()


@pytest.mark.usefixtures("media_root")
def test_delete_media_index_out_of_range(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    for bad_index in (0, 5, -1):
        r = client.delete(
            f"{STOPS_URL}{stop.id}/media/{bad_index}",
            headers=superuser_token_headers,
        )
        assert r.status_code == 404
        assert r.json()["detail"] == "Media index out of range"


def test_patch_media_caption_happy_path(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    _upload(client, superuser_token_headers, stop.id, caption="een")
    uploaded = _upload(client, superuser_token_headers, stop.id, caption="twee").json()
    assert [m["cap"] for m in uploaded["media"]] == ["een", "twee"]

    r = client.patch(
        f"{STOPS_URL}{stop.id}/media/1",
        headers=superuser_token_headers,
        json={"cap": "de Cub bij zonsondergang"},
    )
    assert r.status_code == 200
    media = r.json()["media"]
    assert [m["cap"] for m in media] == ["een", "de Cub bij zonsondergang"]
    # The change survived the round trip to the JSON column.
    refetched = client.get(f"{STOPS_URL}{stop.id}").json()
    assert refetched["media"][1]["cap"] == "de Cub bij zonsondergang"
    # The file itself is untouched.
    assert media[1]["url"] == uploaded["media"][1]["url"]


@pytest.mark.usefixtures("media_root")
def test_patch_media_caption_index_out_of_range(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    for bad_index in (0, 5, -1):
        r = client.patch(
            f"{STOPS_URL}{stop.id}/media/{bad_index}",
            headers=superuser_token_headers,
            json={"cap": "spook"},
        )
        assert r.status_code == 404
        assert r.json()["detail"] == "Media index out of range"


@pytest.mark.usefixtures("media_root")
def test_patch_media_caption_stop_not_found(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.patch(
        f"{STOPS_URL}{uuid.uuid4()}/media/0",
        headers=superuser_token_headers,
        json={"cap": "spook"},
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "Stop not found"


def test_patch_media_caption_requires_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    _upload(client, superuser_token_headers, stop.id)
    url = f"{STOPS_URL}{stop.id}/media/0"
    assert client.patch(url, json={"cap": "nee"}).status_code == 401
    r = client.patch(url, headers=normal_user_token_headers, json={"cap": "nee"})
    assert r.status_code == 403


def test_patch_media_caption_rejects_overlong_caption(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    _upload(client, superuser_token_headers, stop.id)
    r = client.patch(
        f"{STOPS_URL}{stop.id}/media/0",
        headers=superuser_token_headers,
        json={"cap": "x" * 256},
    )
    assert r.status_code == 422


@pytest.mark.usefixtures("media_root")
def test_set_media_cover_moves_the_flag(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    _upload(client, superuser_token_headers, stop.id, caption="een")
    uploaded = _upload(client, superuser_token_headers, stop.id, caption="twee").json()
    # Nothing is flagged until the rider picks; the first item stands in.
    assert [m["cover"] for m in uploaded["media"]] == [False, False]

    r = client.post(
        f"{STOPS_URL}{stop.id}/media/1/cover", headers=superuser_token_headers
    )
    assert r.status_code == 200
    assert [m["cover"] for m in r.json()["media"]] == [False, True]

    # Picking another one takes the flag off the previous holder.
    r = client.post(
        f"{STOPS_URL}{stop.id}/media/0/cover", headers=superuser_token_headers
    )
    assert [m["cover"] for m in r.json()["media"]] == [True, False]

    # And it survived the round trip to the JSON column.
    refetched = client.get(f"{STOPS_URL}{stop.id}").json()
    assert [m["cover"] for m in refetched["media"]] == [True, False]


@pytest.mark.usefixtures("media_root")
def test_set_media_cover_can_be_cleared(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    _upload(client, superuser_token_headers, stop.id, cover=True)
    r = client.post(
        f"{STOPS_URL}{stop.id}/media/0/cover",
        headers=superuser_token_headers,
        params={"cover": False},
    )
    assert r.status_code == 200
    assert [m["cover"] for m in r.json()["media"]] == [False]


@pytest.mark.usefixtures("media_root")
def test_upload_with_cover_takes_over_the_flag(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    first = _upload(client, superuser_token_headers, stop.id, cover=True).json()
    assert [m["cover"] for m in first["media"]] == [True]

    # A later upload that claims the cover unseats the earlier one — this is
    # how a new stop's deferred uploads land the rider's pick whatever order
    # they finish in.
    second = _upload(client, superuser_token_headers, stop.id, cover=True).json()
    assert [m["cover"] for m in second["media"]] == [False, True]

    # A plain upload leaves the flag where it is.
    third = _upload(client, superuser_token_headers, stop.id).json()
    assert [m["cover"] for m in third["media"]] == [False, True, False]


@pytest.mark.usefixtures("media_root")
def test_set_media_cover_index_out_of_range(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    for bad_index in (0, 5, -1):
        r = client.post(
            f"{STOPS_URL}{stop.id}/media/{bad_index}/cover",
            headers=superuser_token_headers,
        )
        assert r.status_code == 404
        assert r.json()["detail"] == "Media index out of range"


@pytest.mark.usefixtures("media_root")
def test_set_media_cover_stop_not_found(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = client.post(
        f"{STOPS_URL}{uuid.uuid4()}/media/0/cover", headers=superuser_token_headers
    )
    assert r.status_code == 404
    assert r.json()["detail"] == "Stop not found"


@pytest.mark.usefixtures("media_root")
def test_set_media_cover_requires_superuser(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    stop: Stop,
) -> None:
    _upload(client, superuser_token_headers, stop.id)
    url = f"{STOPS_URL}{stop.id}/media/0/cover"
    assert client.post(url).status_code == 401
    assert client.post(url, headers=normal_user_token_headers).status_code == 403


def test_delete_stop_removes_media_directory(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    stop: Stop,
    media_root: Path,
) -> None:
    _upload(client, superuser_token_headers, stop.id)
    stop_dir = media_root / str(stop.id)
    assert stop_dir.exists()

    r = client.delete(f"{STOPS_URL}{stop.id}", headers=superuser_token_headers)
    assert r.status_code == 200
    assert not stop_dir.exists()


def test_backfill_thumbs_fills_missing_and_is_idempotent(
    db: Session,
    stop: Stop,
    media_root: Path,
) -> None:
    stop_dir = media_root / str(stop.id)
    stop_dir.mkdir(parents=True)
    (stop_dir / "foto.png").write_bytes(PNG_1PX)
    stop.media = [
        {"tone": "", "cap": "", "kind": "image", "url": f"/media/{stop.id}/foto.png"},
        {"tone": "", "cap": "", "kind": "video", "url": f"/media/{stop.id}/clip.mp4"},
        {"tone": "#c9a24e", "cap": "", "kind": "image", "url": None},
    ]
    db.add(stop)
    db.commit()

    created = backfill_thumbs(db, media_root=media_root)
    assert created == 1
    db.expire_all()
    refreshed = db.get(Stop, stop.id)
    assert refreshed is not None
    assert refreshed.media[0]["thumb"] == f"/media/{stop.id}/thumb_foto.webp"
    assert (stop_dir / "thumb_foto.webp").exists()
    # Video and URL-less placeholder stay untouched.
    assert refreshed.media[1].get("thumb") is None
    assert refreshed.media[2].get("thumb") is None
    # Second run finds nothing left to do.
    assert backfill_thumbs(db, media_root=media_root) == 0
