# Brommerboek — repo assessment & feature proposals

_July 2026. Snapshot at `7516922` (merge of the Caddy deploy stack)._

## Where the project stands

The core product is real and works end to end: a public vintage-atlas MapLibre
map with the Cub driving the route via the timeline scrubber, stop detail
sheets with media galleries, a working add/edit/delete flow (superuser-gated),
comments + horn-honk reactions, a stats screen (`/logboek`), account settings,
and a production deploy (Hetzner box, Caddy auto-TLS, GHCR images, nightly
pg_dump + rclone backups). Real media upload is fully implemented server-side
(streamed, 25 MiB cap, type allowlist, cleanup on delete) and the frontend
renders uploaded photos/videos with tone-swatch fallbacks.

Two parts are notably *more* finished than expected: the reactions system
(comments with author-or-superuser delete, honk toggle with race handling and
a capped honkers list) and the migration chain (including a reversible data
migration for the media/weather/km reshape).

## Corrections & drift

1. **README is stale.** It still describes a five-screen app with a
   Stempelmuur (stamp wall), Wrapped recap, Reel screen and bottom nav — none
   of which exist in `frontend/src/brommerboek/` today. It also says
   `POST /stops` is public; it now requires superuser
   (`backend/app/api/routes/stops.py:104`). The README should describe the
   app as it is after the fe-be refactor.
2. **`CLAUDE.md` is referenced but missing.** `README.md:96` and
   `backup.sh:2` both point to a deployment runbook that isn't in the repo.
   The operational knowledge (cron setup, rclone remote config, rollback
   procedure) currently lives nowhere.
3. Not a bug, but worth knowing: `backend/app/api/deps.py:43,78` uses PEP 758
   unparenthesized `except A, B:` syntax — valid only on Python ≥3.14 (which
   the repo pins). Any tooling running an older Python will report it as a
   syntax error.

## Improvements, prioritized

### High

- **Zero tests for anything Brommerboek.** Backend tests cover only the
  template's User/Item code; there is not a single test for stops, stats,
  comments, honks, media upload, `geo.haversine_km`, or the seed. Frontend
  Playwright specs are all inherited template specs, and one
  (`user-settings.spec.ts`) is now *broken* — it targets the old English
  shadcn tabs page while `/settings` renders the Dutch `AccountScreen`.
  Also: `backend/tests/conftest.py:20-24` teardown never cleans
  Stop/Comment/HornHonk rows, which will bite the moment stop tests are
  added. Suggested order: API tests for stops CRUD + media upload +
  reactions, fix or delete the stale settings spec, add a Vitest runner for
  the pure modules (`geo.ts`, `geocode.ts`, `weather.ts` — trivially
  unit-testable).
- **Open self-registration + unthrottled public writes.**
  `POST /users/signup` (`backend/app/api/routes/users.py:146`) is
  unconditionally public — the template's `USERS_OPEN_REGISTRATION` gate was
  dropped. Any account can then post comments and honks with no rate
  limiting. For a single-rider showcase this is spam surface. Options: gate
  signup behind a setting, and add a simple per-IP/per-user rate limit
  (slowapi or a Caddy-level limit) on `POST /comments`, `/honks`, `/signup`.
- **CI doesn't gate the frontend at all.** No lint, typecheck, build, or
  Playwright run on PRs — a broken frontend is first detected during the
  production deploy image build. Lint/typecheck/mypy exist only as local
  pre-commit hooks, so nothing is enforced server-side. A cheap
  `test-frontend.yml` doing `bun install && bun run lint && tsc && vite build`
  would catch most of it in under two minutes.
- **Deploy has no verification or rollback path.** The SSH step runs
  `pull && up -d && prune` and reports success regardless of whether the new
  containers came up healthy or the `prestart` migration failed. Add a
  post-`up` smoke check (`curl -f https://brommerboek.nl/api/v1/utils/health-check/`
  with a retry loop, fail the workflow otherwise) and document the manual
  rollback (`TAG=<old-sha>` in `.env.deploy`) in the runbook.

### Medium

- **Error/empty states conflated or missing.** An empty trip shows "kon de
  reis niet laden — draait de backend?" (`BrommerboekApp.tsx:190-192`);
  stats failures are silently swallowed into zeros; `LogboekScreen` has no
  loading or error state; per-file upload failures vanish
  (`BrommerboekApp.tsx:131-134`); reaction mutations have no `onError`.
- **`blob:` URL leak.** `AddFlow.tsx:296` creates object URLs for media
  previews and never revokes them — memory grows across repeated add flows.
- **No external monitoring.** Container healthcheck exists but nothing pages
  you if the box or cert renewal dies. A free uptime pinger on the
  health-check URL + setting `SENTRY_DSN` (already wired, currently empty)
  covers 90% of it.
- **Comments are unpaginated** (`reactions.py:39-64`) while honkers are
  capped at 50 — inconsistent, and one popular stop returns every comment in
  one payload. Also `Comment.user_id` lacks the index `HornHonk.user_id` has.
- **Dead validation:** `WEATHER_CONDITIONS` (`models.py:138`) is declared but
  never enforced; `type`, `MediaItem.kind`, and `weather_condition` are free
  strings on the wire; `lat`/`lng` have no ±90/±180 bounds.
- **Template cruft:** the entire `items` route, models, CRUD, tests, and the
  manual `delete(Item)` in user-delete serve no purpose in this product.
- **`AddFlow.tsx` is 1,124 lines** — the create/edit/delete wizard, geocoder,
  media manager and weather picker in one file. Worth splitting per step
  before the next feature lands there.
- **Dead code:** `weatherIcon`, `geo.routeBounds`, and the `bb-fadeUp` /
  `bb-spin` / `bb-stampIn` CSS keyframes are referenced by nothing.

### Low

- **Accessibility:** the scrubber is a bare `div` — no `role="slider"`,
  ARIA values, or keyboard operation; gallery images have empty `alt` even
  though captions exist; `LoginPrompt` has no focus trap; repair vs stop pins
  differ by color only.
- **Image delivery:** full-res originals are served into 64px thumbnails; no
  `loading="lazy"`, no `srcset`/server-side thumbnails, videos have no poster.
- **Mobile polish:** no `safe-area-inset` padding for notched phones; the FAB
  and preview card crowd each other above the scrubber.
- **Captions can't be entered.** `MediaItem.cap` renders everywhere but the
  upload flow never asks for one (`uploadStopMedia` always sends `""`).
- **No reorder UI** for stops despite `order_index` existing end to end.
- The full-canvas CSS `sepia()` filter on the MapLibre canvas
  (`brommerboek.css:105-108`) repaints every map frame — measurable on
  low-end phones; consider baking the tint into the style layers instead.

## Feature proposals

### ⭐ The wow feature: **"Rij de reis"** — cinematic trip replay

One tap on a play button and the app takes over: the camera swoops down to
Amsterdam, the Cub starts driving, and the whole trip replays as a live
cinematic flyover —

- the camera **banks and rotates into each leg** (MapLibre `bearing` +
  `pitch` easing, so the map turns under the cub like a chase cam);
- the **km counter ticks up** and the date rolls forward in the header;
- at each stop the cub slows in, the **photo card pops up** for a beat
  (longer if there's a story), repair stops get the wrench badge moment;
- crossing a border **slams a passport stamp** onto the screen (the
  `bb-stampIn` keyframe for this already exists in the CSS, unused);
- it ends on a Wrapped-style stat card. Skippable at any time, and the
  scrubber stays live underneath so you can grab control mid-flight.

**Why this one:** it's the "highlight reel" from the original design brief —
which was explicitly mocked and never built — but delivered as an in-app live
replay instead of a video export, which is what makes it *reliable*:

- No video encoding, no server rendering, no new backend, no new data. It's
  a deterministic `requestAnimationFrame` tween over data the app already
  has — and the hard parts (`pointAt`, bearing math, cub transform, camera
  follow, the step-button tween in `BrommerboekApp.tsx:221-247`) are already
  built and proven by the scrubber. This is choreography over existing
  machinery, not new machinery.
- Degrades gracefully: `prefers-reduced-motion` (the CSS block already
  exists) falls back to stepping stop-to-stop; slow tile loads just mean the
  paper map fills in around the cub, which fits the aesthetic.
- It's demoable in one tap — the single strongest "hand someone your phone"
  moment the product can have, and the natural thing to show at the end of
  the trip.

Estimated scope: one focused PR, frontend-only. A `useReplay` hook driving a
timeline (progress + camera keyframes + event cues), a play button on the map
screen, stamp/stat overlays. Follow-up (optional): a share-card image at the
end via canvas export.

### Other feature candidates

1. **Stempelmuur (stamp wall)** — designed (screenshots in
   `design-reference/`), the `stamps` stat is plumbed end to end, the slam-in
   keyframe exists. A perforated-passport grid per country is a small, pure
   frontend feature and pairs with the replay's border-crossing stamps.
2. **Wrapped share cards** — the stats exist; render 2–3 big stat cards to a
   canvas and hook the Web Share API. Cheap, and gives the trip a shareable
   artifact.
3. **Caption entry + photo lightbox** — close the loop on media: ask for a
   caption at upload, add a full-screen pinch-zoom lightbox with the caption
   as alt text. Mostly UX plumbing on existing data.
4. **Honks on the map** — surface reaction counts as tiny badges on pins, so
   the map itself shows where people toeted. The data is one query away.
5. **PWA shell** — manifest + service worker caching the app shell and last
   stops payload, so the trip opens instantly (and roughly offline) on the
   phone that's actually on the trip.
