#!/usr/bin/env bash
# Nightly backup: pg_dump + media tarball → local dir → rclone off-box.
# Run from cron on the box (see docs/RUNBOOK.md, "Backups"). Requires rclone
# configured with a remote called "remote".
set -euo pipefail

APP=/home/deploy/brommerboek
OUT=/home/deploy/backups
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p "$OUT"

# Load POSTGRES_* so pg_dump can authenticate.
# shellcheck disable=SC1091
set -a
. "$APP/.env"
set +a

# 1. Postgres logical dump from the running container.
docker compose -f "$APP/docker-compose.yml" --env-file "$APP/.env" exec -T db \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$OUT/db-$STAMP.sql.gz"

# 2. Media archive.
tar czf "$OUT/media-$STAMP.tar.gz" -C "$APP" media

# 3. Push off-box (rclone remote → Cloudflare R2 or Backblaze B2).
rclone copy "$OUT" remote:brommerboek-backups --include "*-$STAMP.*"

# 4. Prune local copies older than 7 days.
find "$OUT" -name "*.gz" -mtime +7 -delete
