# Brommerboek production runbook

Operational reference for the production deployment. Commands assume you are
SSH'd into the box as `deploy` with the app at `~/brommerboek`.

## 1. Architecture

- **One Hetzner box** (4 GB RAM — never build images on it, see the warning in
  `docker-compose.yml`). App lives in `/home/deploy/brommerboek`.
- **Caddy** (`caddy:2-alpine`) terminates TLS for `brommerboek.nl` with
  automatic certificates. Routing per `Caddyfile`: `/api/*`, `/media/*` and
  `/s/*` → `backend:8000`, everything else → `frontend:80`.
- **Share links** (`/s/<stop_id>`): the backend renders a minimal HTML page
  with Open Graph tags so pasted links unfurl in WhatsApp/Slack/social
  (crawlers don't run the SPA's JS); human visitors are immediately
  redirected to `/?stop=<id>`, which the SPA restores to that stop's sheet.
  The `/s/*` handle in the `Caddyfile` must stay pointed at the backend — if
  it ever falls through to the SPA, previews silently stop working while the
  links keep looking fine in a browser. Absolute URLs in the tags are built
  from `FRONTEND_HOST` in `.env`.
- **Images from GHCR**: `ghcr.io/stanlocht/brommerboek-backend` and
  `ghcr.io/stanlocht/brommerboek-frontend`, tagged with the git SHA and
  `latest`. Built by CI, pulled on deploy; `TAG` is injected via `.env.deploy`.
- **Compose stack** (`docker-compose.yml`, always passed with
  `-f docker-compose.yml` so it wins over the legacy `compose.yml`):
  `caddy`, `frontend`, `backend`, `db` (postgres 16, volume `pgdata`), and
  **`prestart`** — a one-shot container running the backend image with
  `bash scripts/prestart.sh` (waits for the DB, runs `alembic upgrade head`,
  seeds initial data). `backend` only starts after `prestart` exits 0
  (`service_completed_successfully`).
- Uploaded media is a bind mount: `~/brommerboek/media` → `/app/media`.

> **⚠️ `.env` is tracked in git with dev values.** The `.gitignore` entry does
> not untrack it, so on the box a `git stash`, `git checkout .` or
> `git reset --hard` (e.g. to get a `git pull` through) silently replaces the
> production `.env` with dev credentials — this took the API down on
> 2026-07-08 (Postgres auth failures; the data volume itself was fine).
> After cloning on the box, always run:
>
> ```bash
> git update-index --skip-worktree .env
> ```
>
> and keep a copy of the production `.env` somewhere safe off-box.

Handy alias for everything below:

```bash
cd ~/brommerboek
alias dc='docker compose -f docker-compose.yml --env-file .env --env-file .env.deploy'
```

## 2. How a deploy works

`.github/workflows/deploy.yml` runs on every push to `main` (or manual
`workflow_dispatch`):

1. Build + push both images to GHCR (`:$GITHUB_SHA` and `:latest`).
2. SSH to the box (`appleboy/ssh-action`, user `deploy`) and:
   - `echo "TAG=<sha>" > .env.deploy`
   - `dc pull` && `dc up -d`
   - verify the `prestart` container exited 0 (`docker inspect` on its exit
     code) — a failed migration fails the workflow
   - poll health: up to 12 attempts, 5 s apart, of
     `dc exec -T backend curl -fsS http://localhost:8000/api/v1/utils/health-check/`
   - only after health passes: `docker image prune -f`
   - on any failure: print `dc logs --tail=100 prestart backend` and exit
     non-zero, so the GitHub run goes red.

Why the health check execs curl **inside the backend container** instead of
hitting Caddy on `http://127.0.0.1`: Caddy only serves the `brommerboek.nl`
site and 308-redirects plain HTTP to HTTPS, and `https://127.0.0.1` fails
certificate verification. Curling uvicorn directly on port 8000 (curl is in
the backend image; the compose healthcheck uses the same URL) tests the app
itself with no TLS/routing noise.

## 3. Manual rollback

Pick a previous good SHA from the `deploy` workflow history (or
`git log --oneline` on `main`), then on the box:

```bash
cd ~/brommerboek
echo "TAG=<old-sha>" > .env.deploy
docker compose -f docker-compose.yml --env-file .env --env-file .env.deploy pull backend frontend
docker compose -f docker-compose.yml --env-file .env --env-file .env.deploy up -d
docker compose -f docker-compose.yml --env-file .env --env-file .env.deploy exec -T backend \
  curl -fsS http://localhost:8000/api/v1/utils/health-check/
```

`prestart` runs the backend image, so pulling `backend` covers it. Note the
next push to `main` overwrites `.env.deploy` and rolls forward again.

**Migrations do not auto-downgrade.** The old image's prestart runs
`alembic upgrade head` against *its* migration set — harmless — but if the bad
release added a migration the old code can't live with, downgrade first:

```bash
docker compose -f docker-compose.yml --env-file .env --env-file .env.deploy \
  run --rm prestart alembic downgrade <revision>
```

## 4. Backups

`backup.sh` (repo root, copied to `~/brommerboek/backup.sh` on the box) does a
nightly `pg_dump` + media tarball into `/home/deploy/backups`, pushes both
off-box with rclone, and prunes local files older than 7 days.

Cron (crontab of `deploy`, `crontab -e`):

```cron
30 3 * * * /home/deploy/brommerboek/backup.sh >> /home/deploy/backups/backup.log 2>&1
```

rclone setup (one-time): `rclone config`, create a remote named exactly
`remote` (Cloudflare R2 or Backblaze B2, S3 type), then make sure the
`brommerboek-backups` bucket exists:

```bash
rclone mkdir remote:brommerboek-backups
rclone ls remote:brommerboek-backups   # sanity check
```

### Restore

```bash
cd ~/brommerboek
# fetch a backup pair
rclone copy remote:brommerboek-backups/db-<STAMP>.sql.gz /home/deploy/backups/
rclone copy remote:brommerboek-backups/media-<STAMP>.tar.gz /home/deploy/backups/

# stop writers, recreate the database, load the dump
docker compose -f docker-compose.yml --env-file .env --env-file .env.deploy stop backend
set -a; . .env; set +a
docker compose -f docker-compose.yml --env-file .env --env-file .env.deploy exec -T db \
  psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE \"$POSTGRES_DB\";" -c "CREATE DATABASE \"$POSTGRES_DB\";"
gunzip -c /home/deploy/backups/db-<STAMP>.sql.gz | \
  docker compose -f docker-compose.yml --env-file .env --env-file .env.deploy exec -T db \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

# media + restart
tar xzf /home/deploy/backups/media-<STAMP>.tar.gz -C ~/brommerboek
docker compose -f docker-compose.yml --env-file .env --env-file .env.deploy up -d
```

## 5. Web Push notificaties ("volg de reis")

Fully self-hosted: subscribers' browsers hand us a push endpoint that lives at
their browser vendor's relay (Mozilla autopush, Google FCM's webpush front,
Apple's push servers, …). The backend POSTs encrypted payloads straight to
those endpoints, signed with our VAPID key — no accounts or third-party
services, the relays are built into the Web Push standard. Nobody but the
subscribed browser can read a payload (it is encrypted against the
subscription's own keys).

### Enable it

1. Generate a VAPID keypair (any machine with the backend venv; nothing is
   registered anywhere, it is just an EC P-256 key):

```bash
cd backend
uv run python -c "
from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid02, b64urlencode
v = Vapid02(); v.generate_keys()
print('VAPID_PRIVATE_KEY=' + b64urlencode(v.private_key.private_numbers().private_value.to_bytes(32, 'big')))
print('# public key (served to clients automatically):')
print(b64urlencode(v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)))
"
```

   On the production box the same one-liner works inside the backend
   container: `dc exec -T backend python -c "…"`. (py_vapid also ships a
   `vapid --gen` CLI, but that writes PEM files; the env var wants the raw
   base64url string the one-liner prints.)

2. Put the private key in `~/brommerboek/.env`:

```bash
VAPID_PRIVATE_KEY=<the base64url string>
# optional; falls back to EMAILS_FROM_EMAIL or FIRST_SUPERUSER
VAPID_CLAIMS_EMAIL=you@example.com
```

3. `dc up -d backend`. That's all — the **public** key is derived from the
   private key at runtime and served at `GET /api/v1/push/public-key`, so it
   never needs configuring separately.

With `VAPID_PRIVATE_KEY` empty, push is off: subscribe endpoints answer
`503 push niet geconfigureerd` and the send helpers no-op.

**Don't rotate the key casually** — existing subscriptions are bound to the
public key they subscribed with; a new key means every follower has to
re-subscribe (old rows get pruned automatically when the relays answer
404/410).

### Behaviour

- Anyone (also anonymous visitors) can tap "🔔 volg de reis" → push on every
  new stop.
- Superusers get an extra "meldingen" card on /settings → push on new
  comments and honks (`wants_reactions`, only honored for superusers).
- Sending happens in FastAPI background tasks; a relay outage can never fail
  the API request. Dead subscriptions (404/410 from the relay) are deleted on
  the spot.

### iOS caveat

iPhone/iPad Safari only allows Web Push from a web app that has been added to
the home screen ("zet op beginscherm") — a plain Safari tab has no push
support. The frontend detects this and shows install instructions instead of
the permission prompt. Once opened from the home screen icon, the normal
subscribe flow works (iOS 16.4+).
## 6. Maintenance

### Backfill media thumbnails

Image uploads get a `thumb_<name>.webp` generated next to the original at
upload time. Media uploaded before that feature existed has no thumbnail, so
the frontend falls back to the full-resolution file. Generate the missing
ones (idempotent, safe to re-run):

```bash
docker compose exec backend python app/backfill_thumbs.py
```

(or `dc exec backend python app/backfill_thumbs.py` with the alias above).

## 7. PR previews (`pr-<N>.brommerboek.nl`)

Every pull request gets its own staging deployment at
`https://pr-<N>.brommerboek.nl`, driven by `.github/workflows/preview.yml`:

- **On PR open/push**: CI builds both images tagged `pr-<N>` (the frontend
  with `VITE_API_URL=https://pr-<N>.brommerboek.nl` baked in, since Vite
  inlines it at build time), then SSHes to the box and brings up an isolated
  stack from `docker-compose.preview.yml` with project name `pr-<N>`:
  frontend, backend, **its own throwaway Postgres** (fresh volume, migrated
  and seeded by `prestart` — PR migrations never touch production data) and a
  per-preview media volume. Once the backend health check passes, CI writes
  `~/brommerboek/caddy-previews/pr-<N>.caddy` and reloads Caddy, which fetches
  a certificate for the subdomain automatically. The preview URL is posted as
  a PR comment.
- **On PR close/merge**: the stack is torn down with `down -v` (volumes gone),
  the Caddy snippet and `previews/pr-<N>/` are removed, Caddy reloads, and the
  `pr-<N>` images are deleted from the box.
- **Isolation**: Caddy reaches preview stacks over a shared external docker
  network named `previews`, using per-PR aliases (`pr-<N>-backend`,
  `pr-<N>-frontend`); each preview's db stays on that stack's private network.
  Preview services carry `mem_limit`s (~1 GB worst case per preview, ~250 MB
  typical), so previews can never eat production's memory.
- **Concurrency cap (automatic)**: at most **`MAX_PREVIEWS=3`** stacks run at
  once (constant in `preview.yml`). Deploying a preview beyond the cap
  **evicts the least-recently-deployed one first** (by the mtime of
  `previews/pr-<N>/.env`, refreshed on every deploy). Eviction is harmless:
  the next push to an evicted PR — or re-running its last `preview` workflow
  run from the Actions tab — redeploys it from scratch. Nothing to babysit;
  lower the constant to 2 if the box ever feels tight.
- **Config**: the per-PR env file `~/brommerboek/previews/pr-<N>/.env` is a
  copy of the production `.env` with `DOMAIN`/`FRONTEND_HOST`/
  `BACKEND_CORS_ORIGINS` pointed at the preview host, `ENVIRONMENT=staging`,
  and `SENTRY_DSN`/`SMTP_HOST` blanked (no alerts or mail from previews).

### One-time setup

1. **DNS**: add a wildcard record at the DNS provider —
   `*.brommerboek.nl  A  <box IP>` (or a wildcard CNAME to `brommerboek.nl`).
   Requests to unknown subdomains just get connection-refused by Caddy; certs
   are only issued for site blocks that exist.
2. **Box**, as `deploy`:

   ```bash
   cd ~/brommerboek
   docker network create previews
   mkdir -p caddy-previews previews
   ```

3. Get the updated `docker-compose.yml` and `Caddyfile` onto the box — they
   add the previews network, the `/etc/caddy/previews` mount and the
   `import previews/*.caddy` line. `git pull` in `~/brommerboek` (after the
   changes are merged to `main`) or `scp` just the two files; verify with
   `grep -n previews docker-compose.yml Caddyfile`. Then recreate Caddy:

   ```bash
   docker compose -f docker-compose.yml --env-file .env --env-file .env.deploy up -d caddy
   ```

No new GitHub secrets — the workflow reuses `BOX_IP` and `SSH_PRIVATE_KEY`.
`docker-compose.preview.yml` itself is (re)written on the box by CI on every
preview deploy, so it never needs manual copying.

Optional safety net (root, one-time): 2 GB of swap, so a memory spike degrades
to slow instead of the kernel OOM-killing a production container:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### Preview triage / manual teardown

```bash
cd ~/brommerboek
alias pc='docker compose -p pr-<N> -f docker-compose.preview.yml --env-file previews/pr-<N>/.env'
pc ps -a
pc logs --tail=100 prestart backend

# nuke a preview by hand (e.g. the teardown job never ran):
pc down -v --remove-orphans
rm -f caddy-previews/pr-<N>.caddy && rm -rf previews/pr-<N>
docker compose -f docker-compose.yml --env-file .env --env-file .env.deploy \
  exec -T caddy caddy reload --config /etc/caddy/Caddyfile
```

## 8. Health & monitoring

- Health endpoint: `GET /api/v1/utils/health-check/` (returns `true`), defined
  in `backend/app/api/routes/utils.py`. Publicly reachable at
  `https://brommerboek.nl/api/v1/utils/health-check/`.
- Point an external uptime monitor (UptimeRobot, Better Stack, …) at that URL
  — the deploy check only covers deploy time, not steady state.
- Errors: set `SENTRY_DSN` in `~/brommerboek/.env` (backend enables Sentry
  when it is set and `ENVIRONMENT != local`), then
  `docker compose -f docker-compose.yml --env-file .env --env-file .env.deploy up -d backend`.
- Quick triage on the box:

```bash
dc ps -a
dc logs --tail=100 backend
dc logs --tail=100 prestart
docker inspect -f '{{.State.ExitCode}}' "$(dc ps -aq prestart)"
```

### Error telemetry → GitHub issues

Users who hit "Motorpech — er ging iets mis" no longer have to report it
themselves; the app phones home:

- **What gets recorded.** Every unhandled backend exception (middleware in
  `backend/app/main.py`) and every frontend crash — router error boundary,
  `window.onerror`, unhandled promise rejections, and failed TanStack
  queries/mutations (`frontend/src/lib/telemetry.ts`) — is POSTed to
  `POST /api/v1/telemetry/errors` and stored in Postgres, grouped by a
  normalized fingerprint (`backend/app/core/errortrack.py`). Per group only
  the first 25 full events are kept; the occurrence counter keeps climbing.
- **Reading the queue.** As a superuser:
  `GET /api/v1/telemetry/errors?status=open` (also `reported` / `resolved`).
  Each group carries its latest sample event (message, stack, URL, release).
- **Issues, automatically.** `.github/workflows/error-triage.yml` runs 4×
  a day, reads the open groups, files one GitHub issue per group (label
  `telemetry`) with the stack sample, and PATCHes the group to `reported`
  with the issue URL. From there the fix is a normal issue → PR flow
  (assign it to Claude Code or pick it up yourself).
- **Lifecycle.** Fix shipped → PATCH the group to `resolved` (or leave the
  issue closed; the group stays `reported` and files nothing new). If a
  `resolved` error recurs it reopens automatically and the next triage run
  files a fresh issue — regressions never rot silently.
- **Setup (one-time).** Generate a token (`openssl rand -hex 32`), then:
  1. save it as the `OPS_TOKEN` **repository secret** on GitHub (the triage
     workflow authenticates with it);
  2. put the same value in the box `.env` as `OPS_TOKEN=…` — easiest via
     ops.yml → `env-set-secret` with `args=OPS_TOKEN`, which reads the value
     straight from that `OPS_TOKEN` repo secret and recreates the backend.
  Without the token everything is still recorded and superuser-readable;
  only the automated issue filing is off (the workflow no-ops with a
  warning).
- Anti-abuse: the report endpoint is rate-limited (10/min/IP), payloads are
  size-capped, the frontend dedupes per page load, and groups cap stored
  events at 25 — a crash loop can't flood the table or the issue tracker
  (one group = one issue).

## 9. Remote ops without SSH (`ops.yml`)

`.github/workflows/ops.yml` exposes the routine box operations from this
runbook as a manually dispatched workflow (Actions tab → **ops** → *Run
workflow*, or via the GitHub API — which also means Claude Code sessions can
run them and read the output back). It reuses the deploy SSH secrets; the
box needs no extra setup.

Every action is an allowlisted command sequence — free-form commands never
reach the box. Inputs: `action` (what to do), `service` (for
`restart`/`logs`), `args` (action-specific), and a `confirm` checkbox that
destructive actions require.

| action | args | does |
|---|---|---|
| `status` | – | `dc ps -a`, uptime, memory, disk, active previews |
| `health` | – | in-container health check + public URL check from the runner |
| `logs` | line count (100) | `dc logs --tail=N <service>` |
| `resources` | – | `docker stats`, `docker system df`, memory/disk, media+backup sizes |
| `db-stats` | – | db size, connections by state, largest tables |
| `migrate-status` | – | `alembic current` / `heads` / recent history |
| `preview-list` | – | running preview stacks, env dirs, Caddy snippets |
| `preview-logs` | PR number | preview stack `ps -a` + prestart/backend logs |
| `backup-list` | – | local + off-box (rclone) backup listing |
| `env-list` | – | `.env` **keys only** (never values), current TAG, `.env` backups |
| `restart` | – | `dc up -d --force-recreate --no-deps <service>` (+ health wait for backend) |
| `restart-all` | – | `dc up -d` + health wait |
| `caddy-reload` | – | reload Caddy config |
| `migrate` | – | run `prestart` (migrations + seed), idempotent |
| `backfill-thumbs` | – | §6 thumbnail backfill |
| `backup-now` | – | run `backup.sh` immediately |
| `cleanup` | – | `docker image prune -f` with before/after disk report |
| `rollback` ⚠️ | git SHA | §3 rollback to a previous image tag (+ health wait) |
| `alembic-downgrade` ⚠️ | revision | §3 migration downgrade |
| `preview-teardown` ⚠️ | PR number | §7 manual preview teardown (incl. label-based leftover cleanup) |
| `env-set` ⚠️ | `KEY=value` | set a **non-secret** `.env` var, recreate `<service>` |
| `env-set-secret` ⚠️ | `KEY` | set a secret `.env` var; value from the repo secret named `KEY`, else `OPS_ENV_VALUE` |
| `env-unset` ⚠️ | `KEY` | remove a `.env` var, recreate `<service>` |

⚠️ = requires the `confirm` checkbox.

### Changing `.env` remotely

Workflow-dispatch inputs are stored **in plain text** in the run metadata, so
there are two paths:

- **Non-secret values** (`ENVIRONMENT`, `SENTRY_DSN=` to clear it, …):
  `env-set` with `args: KEY=value`.
- **Secrets** (SMTP password, `VAPID_PRIVATE_KEY`, …): store the value in a
  repo secret (GitHub → Settings → Secrets and variables → Actions — works
  from a phone browser), then dispatch `env-set-secret` with `args: KEY`.
  The workflow prefers a repo secret **named after the key itself** (e.g.
  `args: OPS_TOKEN` reads the `OPS_TOKEN` secret — one value, kept in one
  place), and falls back to the generic **`OPS_ENV_VALUE`** scratch slot
  for keys you don't want to keep as repo secrets. GitHub masks the value
  everywhere; the workflow never prints it.

All three env actions make a timestamped `.env` backup on the box first
(keeping the last 5, listed by `env-list`), then recreate the `service`
input's container (default `backend`) with a health wait. After any change,
refresh the off-box copy of the production `.env` (§1).

Concurrency: mutating actions share the `deploy-production` concurrency
group with `deploy.yml`, so they queue instead of racing a deploy; read-only
actions never queue. Log output uses `=== section ===` delimiters so it's
easy to parse from the run log.

## 10. External services

- **Weather auto-fill: Open-Meteo** (https://open-meteo.com). The backend's
  `GET /api/v1/weather/suggest` endpoint asks `api.open-meteo.com` (recent
  days) or `archive-api.open-meteo.com` (older dates) for the daily mean
  temperature and weather code at a stop. Open-Meteo is free for
  non-commercial use without an API key; its data is licensed
  [CC BY 4.0](https://open-meteo.com/en/license), so keep the
  "weer · Open-Meteo" attribution in the add-stop flow. The service is
  open-source (AGPL, https://github.com/open-meteo/open-meteo) and can be
  self-hosted via Docker — if it ever changes terms or goes down, run your
  own instance and point `FORECAST_URL`/`ARCHIVE_URL` in
  `backend/app/api/routes/weather.py` at it. Upstream failures degrade
  gracefully: the endpoint returns 503 and the app simply leaves the weather
  fields manual.
- **Live GPS locatie: Traccar** (https://www.traccar.org), self-hosted, with
  a tracker in the Cub. The backend's public `GET /api/v1/location/live`
  proxies Traccar's `GET /api/positions` so the Traccar credentials never
  reach the browser; the frontend polls it once a minute and shows a pulsing
  teal marker on the map plus a "LIVE · zojuist" / "laatst gezien X geleden"
  chip in the header. Enable it in `~/brommerboek/.env`:

  ```bash
  # Base URL of the Traccar server (empty = live location off; the endpoint
  # answers 404 and the app hides the marker)
  TRACCAR_BASE_URL=https://gps.example.com
  # API token, created in the Traccar web UI under Settings → Preferences →
  # (your account) → Token; sent as a Bearer header
  TRACCAR_TOKEN=<token>
  # Optional: pin the tracker when the account has several devices
  # (Settings → Devices shows the numeric id); unset = first device wins
  TRACCAR_DEVICE_ID=1
  ```

  then `dc up -d backend`. Responses are cached in-process for 30 s, so any
  number of viewers costs at most two Traccar calls a minute; when Traccar is
  unreachable the endpoint keeps serving the last fix it saw since the backend
  started (and 503s only when it never saw one). A fix older than 10 minutes
  renders greyed-out as "laatst gezien …" — tracker off, no coverage, or the
  Cub is parked somewhere indoors. A scheme-less base URL defaults to
  `https://`.

  `GET /api/v1/location/trail?hours=24` (1–48) additionally serves the
  **breadcrumb trail**: Traccar's stored positions for the window, thinned to
  ≤400 points and cached for 5 minutes, drawn on the map as a dotted teal
  line under the route. It reads Traccar's own position history, so no extra
  storage or forwarding config is involved; retention follows the Traccar
  server's database.

  **Real ridden roads** (`legtrack` table): the red route line and the cub's
  drive follow the actual GPS track per leg where one is synced, straight
  pin-to-pin lines elsewhere. Matching is time-first (the stops' dates bound
  the Traccar history window), then the leg is sliced at the track points
  nearest to each pin — pins are never moved. Posting a new stop syncs its
  surrounding legs automatically in the background (`app/tracksync.py`); to
  backfill older legs, POST `/api/v1/location/sync-tracks` as superuser
  (`?force=true` re-slices everything). Tracks live in the app's own
  Postgres — ≤500 points per leg — so they survive any Traccar cleanup, and
  legs from before the tracker simply keep their straight lines. Since the
  Traccar database is now the source of ride geometry, keep a backup routine
  on that server too.
- **Uitgaande e-mail: een SMTP-relay** (Resend, Brevo, SMTP2GO, …). Brommerboek
  verstuurt zelf niets zwaars — alleen wachtwoord-herstel, de mail bij een door
  een admin aangemaakt account, en het testbericht hieronder — dus een gratis
  plan is ruim voldoende. **Draai geen eigen MTA op de box**: Hetzner blokkeert
  poort 25 standaard en een verse VPS-IP heeft geen reputatie, waardoor juist
  de herstelmails in spam belanden. Relays luisteren op 587, dat wél open is.

  Zet de records (SPF, DKIM, en bij voorkeur `_dmarc`) bij dezelfde DNS-provider
  als het wildcard-record uit §7, en vul dan `~/brommerboek/.env`:

  ```bash
  # Leeg = e-mail uit: wachtwoord-herstel antwoordt 503 en er gaat niets uit
  SMTP_HOST=smtp.resend.com
  SMTP_USER=resend
  SMTP_PASSWORD=<api key>
  EMAILS_FROM_EMAIL=noreply@brommerboek.nl
  # SMTP_PORT=587 en SMTP_TLS=True zijn de defaults en kloppen voor elk relay
  # hierboven; EMAILS_FROM_NAME valt terug op PROJECT_NAME.
  ```

  daarna `dc up -d --force-recreate backend` (de env komt uit `env_file`, dus
  een herstart alleen is niet genoeg).

  **Controleren**: log in als superuser, ga naar `/admin` en gebruik de kaart
  "✉ stuur een testbericht" — die staat standaard op je eigen adres. De kaart
  toont het resultaat van het relay, niet alleen "verstuurd": een 503 betekent
  dat `SMTP_HOST`/`EMAILS_FROM_EMAIL` niet gezet zijn, een 502 dat het relay de
  mail weigerde (de reden die het teruggaf staat erbij — meestal een nog niet
  geverifieerd domein of een afzender die niet bij het domein hoort). Check ook
  even of de mail niet in spam landt; dat is wat SPF/DKIM/DMARC moeten
  voorkomen. Hetzelfde endpoint is `POST /api/v1/utils/test-email/`.

  PR-previews sturen nooit mail: `preview.yml` maakt `SMTP_HOST` leeg. Lokaal
  vangt de `mailcatcher` uit `compose.dev.yml` alles op (webinterface op poort
  1080), zodat de e2e-tests echte mail kunnen lezen zonder iets te versturen.
