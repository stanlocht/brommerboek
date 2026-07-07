# Brommerboek production runbook

Operational reference for the production deployment. Commands assume you are
SSH'd into the box as `deploy` with the app at `~/brommerboek`.

## 1. Architecture

- **One Hetzner box** (4 GB RAM — never build images on it, see the warning in
  `docker-compose.yml`). App lives in `/home/deploy/brommerboek`.
- **Caddy** (`caddy:2-alpine`) terminates TLS for `brommerboek.nl` with
  automatic certificates. Routing per `Caddyfile`: `/api/*` and `/media/*` →
  `backend:8000`, everything else → `frontend:80`.
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

## 6. Health & monitoring

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
