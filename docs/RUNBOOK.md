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

## 5. Maintenance

### Backfill media thumbnails

Image uploads get a `thumb_<name>.webp` generated next to the original at
upload time. Media uploaded before that feature existed has no thumbnail, so
the frontend falls back to the full-resolution file. Generate the missing
ones (idempotent, safe to re-run):

```bash
docker compose exec backend python app/backfill_thumbs.py
```

(or `dc exec backend python app/backfill_thumbs.py` with the alias above).

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
