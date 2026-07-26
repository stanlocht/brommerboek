# Brommerboek setup blueprint

This document is written to be handed to a coding agent (Claude Code or
similar) to **recreate this project's entire setup from scratch** — codebase
scaffolding, local dev environment, CI/CD, and production infrastructure — for
Brommerboek itself or for a new app built the same way.

Steps an agent can do are written as instructions. Steps only a human can do
(creating cloud accounts, clicking in dashboards, paying for things) are
marked **👤 Human step** — the agent should collect these into a checklist for
the user and pause where it is blocked on them.

Companion documents:

- [`../README.md`](../README.md) — what the app does and where the code lives.
- [`RUNBOOK.md`](./RUNBOOK.md) — day-2 operations (deploys, rollbacks,
  backups, previews, remote ops). This blueprint covers *getting there*;
  the runbook covers *running it*.

---

## 1. What the app is

**Brommerboek** ("moped book") is a personal, mobile-first trip logger for a
Honda Super Cub 50 riding across Europe, live at **https://brommerboek.nl**.
Posts (photos, videos, written stories) are pinned to real coordinates; a
little cub SVG drives the route along a vintage 1970s-road-atlas-styled
MapLibre map. Signature features: a timeline scrubber that drives the cub
stop-to-stop, a repair layer, a per-country stamp wall, a Wrapped-style recap,
live GPS via a self-hosted Traccar server, Web Push "follow the trip"
notifications, and share links with Open Graph previews. UI copy is Dutch.

It is a single-owner hobby app: one production server, one database, low
traffic, but with real users following along — so deploys must be safe and
boring, and data (Postgres + uploaded media) must be backed up off-box.

## 2. Stack summary

| Layer | Choice |
|---|---|
| Backend | Python 3.14, FastAPI + SQLModel + Pydantic v2, Alembic migrations, `uv` for packaging |
| Database | PostgreSQL (16-alpine in prod, 18 in dev compose) |
| Frontend | React 19 + TypeScript, Vite, TanStack Router/Query/Table, Tailwind CSS 4, shadcn/ui (Radix), MapLibre GL |
| Frontend tooling | Bun (install/run), Biome (lint+format), Vitest (unit), Playwright (e2e) |
| API client | Generated from the backend's OpenAPI spec via `@hey-api/openapi-ts` (`scripts/generate-client.sh`) |
| Reverse proxy / TLS | Caddy 2 (automatic Let's Encrypt certs) |
| Containers | Docker Compose; prod images built by CI, hosted on GHCR |
| CI/CD | GitHub Actions (tests, deploy over SSH, PR preview environments, remote ops, error triage) |
| Hosting | One Hetzner Cloud box (4 GB RAM), Ubuntu, user `deploy` |
| Backups | Nightly `pg_dump` + media tarball → rclone → Cloudflare R2 / Backblaze B2 |
| Observability | Sentry (backend, optional), self-hosted error telemetry → GitHub issues, external uptime monitor |

## 3. Starting point: the FastAPI full-stack template

The repo began as the official
[**Full Stack FastAPI Template**](https://github.com/fastapi/full-stack-fastapi-template)
(FastAPI + SQLModel + PostgreSQL backend; React + Vite frontend; JWT auth
with users/items demo, email password recovery, Docker Compose, GitHub
Actions test workflows). To start a new app the same way:

1. Generate a repo from the template (GitHub "Use this template", or
   `copier copy` per the template's README) with your project name.
2. Run it once as-is (`docker compose watch`) so you know the baseline works:
   login, dashboard, items CRUD, API docs at `/docs`.
3. Then apply the divergences below — this is exactly the delta between the
   stock template and this repo.

### 3.1 Divergences from the stock template

Work through these in order; each is an independent, committable change.

1. **npm → Bun, ESLint/Prettier → Biome.** Replace `package-lock.json` with
   `bun.lock`; `lint` script runs `biome check --write`. CI uses
   `oven-sh/setup-bun`.
2. **Chakra UI → Tailwind CSS 4 + shadcn/ui.** The template's demo pages
   (login, dashboard, admin, items) were re-skinned; new app code is plain
   Tailwind + Radix primitives (`components.json` configures shadcn).
3. **Traefik → Caddy.** The template's Traefik `compose.yml` is retired
   (kept only as legacy; every prod command passes `-f docker-compose.yml`
   explicitly so the new file wins). `Caddyfile` at repo root: one site
   block for the domain; `/api/*`, `/media/*`, `/s/*` → `backend:8000`,
   everything else → `frontend:80`; plus `import /etc/caddy/previews/*.caddy`
   for PR previews.
4. **Split compose files:**
   - `docker-compose.yml` — **production**: `caddy`, `frontend`, `backend`,
     `db` (postgres 16-alpine, volume `pgdata`), and a one-shot `prestart`
     service (backend image, `bash scripts/prestart.sh`: wait for DB →
     `alembic upgrade head` → seed). `backend` starts only after `prestart`
     exits 0 (`service_completed_successfully`). **No `build:` keys** —
     images come from GHCR as `ghcr.io/<owner>/<app>-{backend,frontend}:${TAG}`,
     with `TAG` injected from `.env.deploy`. Media is a bind mount
     `./media:/app/media`.
   - `compose.dev.yml` — **dev**: bind-mounted source with hot reload
     (`fastapi dev`, Vite HMR), postgres 18, adminer (`:8080`),
     mailcatcher (`:1080`).
   - `docker-compose.preview.yml` — **PR previews** (§6): per-PR isolated
     stack with throwaway Postgres, joined to a shared external `previews`
     network with per-PR aliases.
5. **CI workflows replaced** (§5) — the template's Playwright/latest-changes
   workflows go away; ours are `test-backend`, `test-frontend`, `deploy`,
   `preview`, `ops`, `error-triage`, plus dependabot + labeler.
6. **Pre-commit** (`.pre-commit-config.yaml`): standard hygiene hooks plus
   *local* hooks — Biome (frontend), Ruff check+format, mypy (strict) and
   `ty` (backend), `zizmor` on workflow files, and **auto-regeneration of the
   frontend API client** whenever `backend/` changes
   (`scripts/generate-client.sh`: export OpenAPI → `openapi-ts` →
   biome-format `frontend/src/client/`).
7. **Password hashing** → `pwdlib[argon2,bcrypt]`; auth otherwise as the
   template ships it (JWT, first superuser from env).
8. **App-specific backend additions** (`backend/app/`): `Stop`/`MediaItem`
   models + public stops API, media upload with WebP thumbnails, share-page
   `/s/<stop_id>` HTML with OG tags, Web Push (`pywebpush` + VAPID),
   Traccar proxy (`/api/v1/location/*`) + leg track sync, Open-Meteo weather
   suggest, error telemetry store + `/api/v1/telemetry/errors`, signup
   captcha. Each has an Alembic migration; initial data is seeded
   idempotently from `core/db.py:init_db()` (`trip_seed.py`).
9. **App-specific frontend** lives in `frontend/src/brommerboek/` and is
   mounted at `/`; the template's demo app is preserved at `/dashboard`.
10. **`.env` handling:** `.env` is tracked in git *with dev values* so
    `docker compose watch` works out of the box; `.env.example` documents
    the production keys. On the production box the real `.env` is protected
    with `git update-index --skip-worktree .env` (see the ⚠️ warning in
    RUNBOOK §1 — skipping this has caused an outage).

### 3.2 Repository layout (target state)

```
├── .github/workflows/     # test-backend, test-frontend, deploy, preview, ops, error-triage
├── backend/               # FastAPI app, alembic/, tests/, Dockerfile + Dockerfile.dev
├── frontend/              # Vite app, src/client/ (generated), src/brommerboek/, Dockerfiles
├── scripts/generate-client.sh
├── Caddyfile
├── docker-compose.yml     # production (GHCR images, prestart gate)
├── compose.dev.yml        # dev hot-reload stack
├── docker-compose.preview.yml
├── backup.sh              # nightly pg_dump + media → rclone
├── .env / .env.example
├── .pre-commit-config.yaml
├── pyproject.toml         # root: uv workspace + dev tooling
└── docs/                  # RUNBOOK.md, this file
```

## 4. Local development

```bash
# Everything in Docker with hot reload (recommended):
docker compose watch          # template default; or: docker compose -f compose.dev.yml up
# frontend http://localhost:5173, API docs http://localhost:8000/docs
# adminer :8080, mailcatcher :1080 — sample trip seeds on first start

# Or manually:
cd backend && uv sync && uv run bash scripts/prestart.sh && uv run fastapi dev app/main.py
cd frontend && bun install && bun run dev

# Quality gates (same as CI):
uv run ruff check && uv run mypy backend/app        # backend
cd frontend && bun run lint && bun run typecheck && bun run test:unit
pre-commit install                                   # run it all on commit
```

After changing backend routes/models, regenerate the typed frontend client:
`bash scripts/generate-client.sh` (pre-commit also enforces this).

## 5. CI/CD (GitHub Actions)

All third-party actions are **pinned to commit SHAs**. Workflows:

- **`test-backend.yml`** (push to main + PRs): uv + Python from
  `.python-version` (3.14), spins up `db`+`mailcatcher` from
  `compose.dev.yml`, runs migrations, pytest with coverage artifact.
- **`test-frontend.yml`** (push to main + PRs): Bun → lint → typecheck →
  vitest → production build.
- **`deploy.yml`** (push to main, or manual): described in §7. Uses
  `concurrency: group: deploy-production, cancel-in-progress: false` —
  deploys queue, never run in parallel, never cancel mid-flight (parallel
  deploys once recreated each other's containers on the box).
- **`preview.yml`** (PRs): per-PR staging at `https://pr-<N>.<domain>` —
  builds `pr-<N>`-tagged images (frontend with the preview URL baked in),
  brings up an isolated stack on the same box (own throwaway Postgres,
  mem-limits), writes a Caddy snippet, reloads Caddy, comments the URL on
  the PR. Max 3 concurrent previews (LRU eviction); `down -v` teardown on
  close. Details + one-time setup: RUNBOOK §7.
- **`ops.yml`** (manual dispatch): allowlisted remote operations over SSH —
  status, logs, restart, migrate, rollback, backup-now, env-set/env-unset,
  preview teardown, etc. Destructive actions require a confirm checkbox;
  mutating actions share the `deploy-production` concurrency group.
  Full action table: RUNBOOK §9.
- **`error-triage.yml`** (cron 4×/day): reads open error groups from
  `/api/v1/telemetry/errors` (auth: `OPS_TOKEN`) and files one GitHub issue
  per group, label `telemetry`. RUNBOOK §8.

### Repository secrets to configure

**👤 Human step** (GitHub → Settings → Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `BOX_IP` | Public IPv4 of the production box |
| `SSH_PRIVATE_KEY` | Private half of a dedicated deploy keypair (§6.2) |
| `OPS_TOKEN` | `openssl rand -hex 32`; same value goes in the box `.env` |

`GITHUB_TOKEN` (automatic) is enough for GHCR pushes. After the first CI
build, **👤 Human step**: make the two GHCR packages
(`<app>-backend`, `<app>-frontend`) **public** (GitHub → package → settings →
visibility) so the box can pull without credentials — otherwise run a
`docker login ghcr.io` with a read-only PAT on the box.

## 6. Production infrastructure (Hetzner)

### 6.1 👤 Human step — create the server & DNS

1. **Hetzner Cloud** (console.hetzner.cloud): create a project, then a
   server — shared vCPU, **4 GB RAM** (e.g. CX22/CAX11 class), Ubuntu LTS,
   the region closest to your users. Add your personal SSH key at creation.
   Note the public IPv4.
2. **DNS** (at your registrar / DNS provider), pointing at that IP:
   - `A  <domain>  → <box IP>`
   - `A  *.<domain> → <box IP>` (wildcard — required for `pr-<N>.` previews)
3. Optional but recommended: Hetzner Cloud Firewall allowing inbound
   22/80/443 only.

### 6.2 Provision the box (agent can do this over SSH as root)

```bash
# 1. Non-root deploy user with docker
adduser --disabled-password --gecos "" deploy
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy

# 2. SSH: install the human's key AND a dedicated CI deploy key for `deploy`
mkdir -p /home/deploy/.ssh
# 👤 Human step: generate `ssh-keygen -t ed25519 -f deploy_key -N ""` locally,
# put deploy_key.pub in /home/deploy/.ssh/authorized_keys,
# and save deploy_key contents as the SSH_PRIVATE_KEY repo secret.
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh

# 3. Basic hardening: in /etc/ssh/sshd_config set
#    PasswordAuthentication no, PermitRootLogin prohibit-password; restart sshd.
#    ufw allow 22,80,443/tcp && ufw enable  (if not using the cloud firewall)

# 4. 2 GB swap so a memory spike degrades instead of OOM-killing containers
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 6.3 App setup on the box (as `deploy`)

```bash
git clone https://github.com/<owner>/<app>.git ~/brommerboek
cd ~/brommerboek

# CRITICAL — the tracked .env holds dev values; protect the prod one (RUNBOOK §1):
git update-index --skip-worktree .env

# Fill in production .env from .env.example: real POSTGRES_PASSWORD,
# SECRET_KEY (openssl rand -hex 32), DOMAIN, FRONTEND_HOST,
# BACKEND_CORS_ORIGINS, FIRST_SUPERUSER(+_PASSWORD), ENVIRONMENT=production,
# OPS_TOKEN (same value as the repo secret).
# 👤 Human step: keep a copy of the finished .env somewhere safe OFF the box.

mkdir -p media caddy-previews previews
docker network create previews          # shared network for PR preview stacks
```

**⚠️ Never build images on the box** — 4 GB RAM; a frontend build will OOM
it. Images are always built by CI and pulled from GHCR (that's why
`docker-compose.yml` has no `build:` keys).

First deploy: push to `main` (or run the `deploy` workflow manually). It
builds, pushes, SSHes in, writes `.env.deploy`, pulls, ups the stack, gates
on the `prestart` migration container's exit code, and polls the health
endpoint before pruning old images. Caddy fetches TLS certificates
automatically once DNS resolves.

### 6.4 Backups

On the box, as `deploy`:

```bash
# 👤 Human step: create a Cloudflare R2 or Backblaze B2 bucket + S3 API keys.
rclone config                     # create an S3-type remote named exactly "remote"
rclone mkdir remote:brommerboek-backups
crontab -e                        # add:
# 30 3 * * * /home/deploy/brommerboek/backup.sh >> /home/deploy/backups/backup.log 2>&1
```

`backup.sh` (repo root) does the nightly `pg_dump` + media tarball, pushes
off-box, prunes local files >7 days. Restore procedure: RUNBOOK §4.

### 6.5 Monitoring

- **👤 Human step**: point an external uptime monitor (UptimeRobot, Better
  Stack, …) at `https://<domain>/api/v1/utils/health-check/`.
- Optional Sentry: create a project, set `SENTRY_DSN` in the box `.env`
  (via ops.yml `env-set`), recreate backend.
- Built-in error telemetry needs no setup beyond `OPS_TOKEN` (§5) — crashes
  become labeled GitHub issues automatically.

## 7. How a deploy works (for reference)

Push to `main` → `deploy.yml`:

1. Build backend + frontend images (frontend with `VITE_API_URL` and
   `VITE_RELEASE=<sha>` baked in at build time), push to GHCR tagged
   `:<git-sha>` and `:latest`, with GHA layer caching.
2. SSH to the box as `deploy`: write `TAG=<sha>` to `.env.deploy`, then
   `docker compose -f docker-compose.yml --env-file .env --env-file .env.deploy pull && up -d`.
3. Verify `prestart` (migrations + seed) exited 0; poll the in-container
   health check up to 12×5 s; only then `docker image prune -f`. Any failure
   dumps logs and turns the run red.

Rollback = write an old SHA to `.env.deploy` and pull/up again (or ops.yml
`rollback`); migrations do not auto-downgrade — RUNBOOK §3.

## 8. Optional external services

All optional, all off by default when their env vars are blank
(RUNBOOK §5 & §10 for details):

- **Web Push** ("volg de reis"): generate a VAPID keypair, set
  `VAPID_PRIVATE_KEY` — self-hosted, no third-party account.
- **Live GPS**: a self-hosted [Traccar](https://www.traccar.org) server +
  tracker; `TRACCAR_BASE_URL`/`TRACCAR_TOKEN`(/`TRACCAR_DEVICE_ID`). The
  backend proxies it, caches fixes, and syncs real ridden-road geometry per
  leg into its own Postgres. **👤 Human step**: run/buy the tracker and the
  Traccar server, create the API token, and back that server up too.
- **Weather auto-fill**: Open-Meteo, keyless and free for non-commercial
  use — keep the "weer · Open-Meteo" attribution (CC BY 4.0).
- **Outbound email**: any SMTP provider via `SMTP_*` vars (template feature;
  used for password recovery).

## 9. Acceptance checklist

The setup is done when all of these hold:

- [ ] `docker compose watch` locally serves the app at :5173 with the seeded
      trip on the map, and API docs at :8000/docs.
- [ ] `pre-commit run --all-files` passes; backend and frontend test
      workflows are green on a PR.
- [ ] Pushing to `main` deploys automatically; the deploy run shows
      migrations-gate + health poll passing.
- [ ] `https://<domain>` serves the app with valid TLS; `/api/v1/utils/health-check/`
      returns `true`; `/s/<stop_id>` returns OG-tagged HTML (test with `curl`).
- [ ] Opening a PR produces a working `https://pr-<N>.<domain>` preview and a
      PR comment; closing it tears the preview down.
- [ ] `ops.yml` → `status` runs from the Actions tab and reports the stack.
- [ ] A nightly backup lands in the rclone remote
      (`rclone ls remote:brommerboek-backups`), and a restore has been
      rehearsed once (RUNBOOK §4).
- [ ] The production `.env` is skip-worktree'd on the box and a copy exists
      off-box; the uptime monitor is armed.
