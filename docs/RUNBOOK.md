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

3. Copy the updated `docker-compose.yml` and `Caddyfile` from the repo to
   `~/brommerboek/` (they add the previews network, the
   `/etc/caddy/previews` mount and the `import previews/*.caddy` line), then
   recreate Caddy:

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

## 9. External services

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
