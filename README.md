# Brommerboek — Cub trip logger

> _"moped book"_ — a personal, mobile-first trip logger for a Honda Super Cub 50
> riding across Europe. Post photos, videos and written stories pinned to the
> places you stop; a little cub drives your route along a vintage road-atlas map.

Brommerboek is built on the
[Full Stack FastAPI Template](https://github.com/fastapi/full-stack-fastapi-template)
(FastAPI + SQLModel + PostgreSQL backend, React + Vite + TanStack + Tailwind
frontend) and implements the design exported from Claude Design — see
[`design-reference/`](./design-reference) for the original prototype, chat
transcript and screenshots.

## What's here

The signature experience lives at the site root (`/`), a full-screen mobile app
with five screens plus overlays:

- **Kaart (Map)** — a **real, pannable [MapLibre GL](https://maplibre.org) map**
  styled as a 1970s Michelin/paper atlas: warm paper land, faded sea, muted
  green terrain, ochre roads, dashed brown borders, plus paper-grain, halftone
  and vignette overlays. A thin dashed-red route line connects the stops, each
  stop has a hand-rotated pin, and the **Super Cub SVG parks at the latest stop**.
- **Tijdlijn-schuif (Timeline scrubber)** — the signature interaction. Drag it
  and the cub _drives_ the route stop-to-stop, tilting into each leg (and
  mirroring, never flipping, on westbound legs) while the camera follows; it
  snaps to a stop on release and surfaces that post.
- **Stop-detail** — photo/video gallery, journal story, place/date/km/weather.
  Repair stops get a teal `REPARATIE` badge and a "what broke / what I fixed"
  logbook.
- **Veerboot-legs (Ferry legs)** — tick "per veerboot hierheen" on a stop and
  the leg into it becomes a dashed teal sea line with a little boat halfway
  across; scrub onto it and the Cub crosses standing on a ferry deck. A
  crossing isn't ridden, so it counts as 0 km unless the odometer says
  otherwise (that difference is the road to and from the port).
- **Reparatie-laag (Repair layer)** — the wrench toggle fades the route and
  shows only repair pins, turning the map into a record of the cub's wear.
- **Live locatie** — with a Traccar GPS server configured (`TRACCAR_*` in
  `.env`, see `docs/RUNBOOK.md` §10), a pulsing marker shows where the Cub is
  right now, a dotted teal **breadcrumb trail** traces the last week of riding,
  and the header gets a "LIVE · zojuist" / "laatst gezien X geleden" chip. The
  backend proxies Traccar so its credentials stay server-side. Legs with
  synced GPS history render (and the cub drives) the **real ridden roads**
  instead of straight pin-to-pin lines.
- **Stempelmuur (Stamp wall)** — perforated passport ovals, one per country.
- **Wrapped recap** — big stat cards with a regeneratable highlight line.
- **Reis-highlight (Reel)** — a storyboard mockup of an auto-generated highlight
  clip (map-flyover player + 6-scene filmstrip + disabled export), as designed.
- **Nieuwe stop (New post flow)** — a working 4-step flow (location → media →
  story → type) that **POSTs a real stop** and extends the route.

Seeded with a 10-stop Amsterdam → Cinque Terre trip (NL → BE → FR → CH → IT),
1.024 km, 2 repairs, 5 countries — every stop carries **real coordinates** so it
pins on the real map.

The template's auth app is preserved: the demo dashboard moved to `/dashboard`
(login/signup/admin/items still work).

## Where the code is

**Backend** (`backend/app/`)

- `models.py` — `Stop` / `MediaItem` / `StopPublic` / `TripStats` SQLModels
  (real `lat`/`lng`, media stored as JSON).
- `api/routes/stops.py` — public `GET /api/v1/stops`, `GET /stops/stats`,
  `GET /stops/{id}`, and `POST /stops` for the new-post flow.
- `trip_seed.py` — the 10-stop sample trip; seeded idempotently from
  `core/db.py` `init_db()`.
- `alembic/versions/a1b2c3d4e5f6_add_stop_table.py` — the `stop` table migration.

**Frontend** (`frontend/src/brommerboek/`)

- `mapStyle.ts` — the hand-tuned vintage MapLibre style over keyless
  [OpenFreeMap](https://openfreemap.org) vector tiles.
- `VintageMap.tsx` — MapLibre map, route line, pins and the cub marker driven
  along the route with camera-follow; `geo.ts` has the route-geometry helpers.
- `MapScreen`, `StampScreen`, `StatsScreen`, `ReelScreen`, `StopSheet`,
  `AddFlow`, `BottomNav` — the screens; `BrommerboekApp.tsx` wires state + data.
- `api.ts` — typed client for the public stops + stats API; `trip.ts` — the
  TripStats shape (values are computed server-side). Entry route:
  `frontend/src/routes/index.tsx`.

## Running it

Everything is standard for the underlying template.

**With Docker (recommended):**

```bash
docker compose watch
```

Frontend at http://localhost:5173, API docs at http://localhost:8000/docs.
The sample trip is seeded automatically on first start.

**Manual dev:**

```bash
# backend (needs a PostgreSQL reachable per .env; runs migrations + seeds)
cd backend && uv sync && uv run bash scripts/prestart.sh && uv run fastapi dev app/main.py

# frontend
cd frontend && npm install && npm run dev
```

The frontend reads the API base from `VITE_API_URL` (`frontend/.env`, default
`http://localhost:8000`). See `docs/RUNBOOK.md` for the production deployment
runbook (Hetzner + Caddy + GHCR).

### Map tiles

Tiles come from OpenFreeMap (free, keyless, no sign-up). To use another provider
(MapTiler, Protomaps, a self-host) change `TILE_SOURCE` / `GLYPHS` in
`frontend/src/brommerboek/mapStyle.ts`.

## Notes

- **Media placeholders:** galleries use vintage-photo colour swatches (as in the
  design). Real image uploads are out of scope; drop images into the `MediaItem`
  shape and the slots are ready.
- **Public writes:** this is a single personal trip meant to be shown off, so
  reads _and_ the add-stop `POST` are public (no login). Lock `POST /stops`
  behind `CurrentUser` in `api/routes/stops.py` if you want authored edits only.
- **Python 3.14:** the template targets Python 3.14; run the backend via its
  Docker image or the pinned toolchain.

## License

MIT (inherited from the Full Stack FastAPI Template).
