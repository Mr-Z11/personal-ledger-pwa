# Codex Handoff

This document exists so a future Codex session on another computer can maintain the app without rediscovering the project.

## What This App Is

Personal Ledger PWA is a personal bookkeeping app for iPhone Safari home-screen use and Mac/desktop browser use.

Design constraints:

- Code can be public on GitHub.
- Financial data, login data, backups, logs, and secrets must stay local or on the user's own cloud server.
- The app must work offline for daily bookkeeping and sync when online.
- The app references bookkeeping products only as functional inspiration, not as copied branding or UI.

## Current Architecture

- Monorepo with npm workspaces.
- `apps/web`: React, Vite, TypeScript, PWA, IndexedDB.
- `apps/api`: Fastify, Prisma, PostgreSQL.
- `packages/shared`: shared entity types, defaults, amount helpers, report helpers.
- Docker Compose production services:
  - `postgres`
  - `api`
  - `web`
  - `caddy`

Production uses GHCR images built by GitHub Actions. The cloud server should only pull and run images.

## Important URLs And Paths

- GitHub: `https://github.com/Mr-Z11/personal-ledger-pwa`
- Production: `https://ledger.47.74.3.104.sslip.io`
- API health: `https://ledger.47.74.3.104.sslip.io/api/health`
- Server project: `/root/personal-ledger-pwa`
- PostgreSQL files: `/root/personal-ledger-pwa/data/postgres`
- Backups: `/root/personal-ledger-pwa/backups`
- Maintenance logs: `/root/personal-ledger-pwa/logs/maintenance.log`
- Maintenance cron: `/etc/cron.d/personal-ledger-pwa`

## How To Continue Work

On a new computer:

```bash
git clone https://github.com/Mr-Z11/personal-ledger-pwa.git
cd personal-ledger-pwa
npm install
```

Before committing:

```bash
npm run typecheck
npm run build
```

After pushing to `main`, wait for GitHub Actions success, then update the server:

```bash
ssh root@47.74.3.104
cd /root/personal-ledger-pwa
bash deploy/update-server.sh
```

If the SSH key is available at `~/.ssh/codex_ledger_deploy`, use it. If not, password SSH may be used by the user if enabled.

## Production Update Rules

The server has limited RAM. Do not run build-heavy commands there during normal deploy:

- Do not run `npm install` on the server.
- Do not run `npm run build` on the server.
- Do not run `docker compose up -d --build` on the server.

Use:

```bash
bash deploy/update-server.sh
```

That script should stay light:

- `git fetch`
- `git reset --hard origin/main`
- `docker compose pull`
- `docker compose up -d --remove-orphans`

## Data And Privacy

Never commit real data or secrets. Keep these out of Git:

- `.env`, `.env.local`, `.env.production`
- database directories
- backups
- uploads
- logs
- SSH keys
- dumps such as `.sql`, `.dump`, `.backup`

`.gitignore` already excludes the expected sensitive paths. Do not weaken it.

## Current Functional State

The app currently supports:

- Registration/login against the cloud API.
- Offline local preview fallback on localhost.
- Ledger bootstrap from server to IndexedDB.
- Offline transaction creation and editing.
- Online sync of queued changes.
- Transaction delete/restore.
- Account management and account editing.
- First/second-level category management.
- Quick category search inside "记一笔".
- New quick-created categories are put under `其他`.
- "记一笔" is a large lower-right floating button.
- Income records show/use `收款账户`; expense records show/use `付款账户`.
- Reports, budgets, CSV import/export.
- Daily maintenance script for database backup and Docker cleanup.

## Category UX Rule

In the "记一笔" flow, do not show the entire category list by default. It makes fast bookkeeping noisy. Default display should show only the selected category. Show matching categories after the user types a search query. If the query does not match an existing category, offer quick creation under `其他`.

## Maintenance

Installed server maintenance:

```bash
cd /root/personal-ledger-pwa
bash deploy/install-maintenance-cron.sh
```

Default cron:

```cron
15 3 * * * root APP_DIR=/root/personal-ledger-pwa bash /root/personal-ledger-pwa/deploy/maintenance.sh >> /root/personal-ledger-pwa/logs/maintenance.log 2>&1
```

`deploy/maintenance.sh`:

- creates a compressed PostgreSQL dump in `backups/`
- keeps backups for 30 days by default
- prunes unused Docker images older than 168h
- prunes unused Docker build cache
- prints Docker disk usage

## Known Operational Notes

- Normal `git push` from the original Windows environment sometimes failed with connection reset. If that happens, retry from another network/computer or use GitHub UI/API with credentials already configured. Do not print tokens in logs or chat.
- PWA/service-worker caching can show old UI. If production looks stale, hard refresh or close/reopen the installed PWA.
- The production domain is an `sslip.io` address tied to the server IP, not a purchased domain.

