import uuid
from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.models import Stop
from tests.utils.stop import create_test_stop, delete_test_stop

ORIGIN = settings.FRONTEND_HOST.rstrip("/")


def set_media(db: Session, stop: Stop, media: list[dict[str, Any]]) -> None:
    # Straight onto the JSON column — the upload endpoint never writes a
    # `thumb` key today, but the share page must honour one when present.
    stop.media = media
    db.add(stop)
    db.commit()
    db.refresh(stop)


def test_share_page_renders_og_tags(client: TestClient, db: Session) -> None:
    stop = create_test_stop(
        db,
        title="Koffie in Dinant",
        place="Dinant",
        story="De Maas glinsterde en de Cub pruttelde tevreden de heuvel op.",
    )
    try:
        r = client.get(f"/s/{stop.id}")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/html")
        body = r.text
        assert '<meta property="og:title" content="Koffie in Dinant">' in body
        assert (
            '<meta property="og:description" content="De Maas glinsterde en de Cub '
            'pruttelde tevreden de heuvel op.">' in body
        )
        assert '<meta property="og:type" content="article">' in body
        assert f'<meta property="og:url" content="{ORIGIN}/s/{stop.id}">' in body
        assert '<meta name="twitter:card" content="summary_large_image">' in body
        assert f'location.replace("/?stop={stop.id}")' in body
        assert f'<noscript><a href="/?stop={stop.id}">' in body
    finally:
        delete_test_stop(db, stop)


def test_share_page_truncates_and_collapses_story(
    client: TestClient, db: Session
) -> None:
    story = "regen \n en\twind  " * 40  # collapses to way over 160 chars
    stop = create_test_stop(db, story=story)
    try:
        body = client.get(f"/s/{stop.id}").text
        start = body.index('property="og:description" content="') + len(
            'property="og:description" content="'
        )
        description = body[start : body.index('"', start)]
        assert len(description) <= 160
        assert description.endswith("…")
        assert "\n" not in description
        assert "  " not in description
    finally:
        delete_test_stop(db, stop)


def test_share_page_image_prefers_thumb(client: TestClient, db: Session) -> None:
    stop = create_test_stop(db)
    try:
        set_media(
            db,
            stop,
            [
                {
                    "tone": "",
                    "cap": "",
                    "kind": "image",
                    "url": f"/media/{stop.id}/a.jpg",
                    "thumb": f"/media/{stop.id}/a_thumb.jpg",
                }
            ],
        )
        body = client.get(f"/s/{stop.id}").text
        assert (
            f'<meta property="og:image" content="{ORIGIN}/media/{stop.id}/a_thumb.jpg">'
            in body
        )
    finally:
        delete_test_stop(db, stop)


def test_share_page_image_falls_back_to_url(client: TestClient, db: Session) -> None:
    stop = create_test_stop(db)
    try:
        set_media(
            db,
            stop,
            [
                # A tone-swatch placeholder is not a real file — skipped.
                {"tone": "#c9a24e", "cap": "", "kind": "image", "url": None},
                {
                    "tone": "",
                    "cap": "",
                    "kind": "image",
                    "url": f"/media/{stop.id}/b.jpg",
                },
            ],
        )
        body = client.get(f"/s/{stop.id}").text
        assert (
            f'<meta property="og:image" content="{ORIGIN}/media/{stop.id}/b.jpg">'
            in body
        )
    finally:
        delete_test_stop(db, stop)


def test_share_page_image_uses_flagged_cover(client: TestClient, db: Session) -> None:
    stop = create_test_stop(db)
    try:
        set_media(
            db,
            stop,
            [
                {
                    "tone": "",
                    "cap": "",
                    "kind": "image",
                    "url": f"/media/{stop.id}/a.jpg",
                },
                {
                    "tone": "",
                    "cap": "",
                    "kind": "image",
                    "url": f"/media/{stop.id}/b.jpg",
                    "cover": True,
                },
            ],
        )
        body = client.get(f"/s/{stop.id}").text
        assert (
            f'<meta property="og:image" content="{ORIGIN}/media/{stop.id}/b.jpg">'
            in body
        )
    finally:
        delete_test_stop(db, stop)


def test_share_page_absolute_image_url_kept_as_is(
    client: TestClient, db: Session
) -> None:
    stop = create_test_stop(db)
    try:
        set_media(
            db,
            stop,
            [
                {
                    "tone": "",
                    "cap": "",
                    "kind": "image",
                    "url": "https://cdn.example.com/a.jpg",
                }
            ],
        )
        body = client.get(f"/s/{stop.id}").text
        assert (
            '<meta property="og:image" content="https://cdn.example.com/a.jpg">' in body
        )
    finally:
        delete_test_stop(db, stop)


def test_share_page_omits_image_without_real_media(
    client: TestClient, db: Session
) -> None:
    stop = create_test_stop(db)  # no media at all
    try:
        body = client.get(f"/s/{stop.id}").text
        assert "og:image" not in body

        set_media(
            db, stop, [{"tone": "#c9a24e", "cap": "", "kind": "image", "url": None}]
        )
        body = client.get(f"/s/{stop.id}").text
        assert "og:image" not in body
    finally:
        delete_test_stop(db, stop)


def test_share_page_unknown_stop_404(client: TestClient) -> None:
    r = client.get(f"/s/{uuid.uuid4()}")
    assert r.status_code == 404


def test_share_page_malformed_id_404(client: TestClient) -> None:
    r = client.get("/s/not-a-uuid")
    assert r.status_code == 404


def test_share_page_escapes_user_content(client: TestClient, db: Session) -> None:
    stop = create_test_stop(
        db,
        title='"><script>alert(1)</script>',
        story='</title><script>alert(2)</script> content="pwn"',
    )
    try:
        body = client.get(f"/s/{stop.id}").text
        assert "<script>alert" not in body
        assert "&lt;script&gt;" in body
        # The attribute-breaking quote is escaped too.
        assert (
            '<meta property="og:title" content="&quot;&gt;&lt;script&gt;'
            'alert(1)&lt;/script&gt;">' in body
        )
    finally:
        delete_test_stop(db, stop)


def test_share_page_title_falls_back_to_place(client: TestClient, db: Session) -> None:
    stop = create_test_stop(db, place="Bastogne")
    try:
        # The API requires a non-empty title, but legacy rows might not have
        # one — blank it straight in the database.
        stop.title = ""
        db.add(stop)
        db.commit()
        db.refresh(stop)
        body = client.get(f"/s/{stop.id}").text
        assert '<meta property="og:title" content="Bastogne">' in body
    finally:
        delete_test_stop(db, stop)
