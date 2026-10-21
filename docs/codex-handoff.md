# Codex Handoff

This document exists so a future Codex session on another computer can maintain the app without rediscovering the project. **The full, always-current runbook is `HANDOFF.md` (repo root); long-term distilled knowledge is `.workbuddy/memory/MEMORY.md`; architecture & data-safety is `AGENTS.md`. Read those first.**

> ⚠️ **部署现实（2026-08-29 起）**：原云端服务器 `47.74.3.104` 已失效（80/443 全关、SSH host key 变更，归属待确认），`deploy/update-server.sh` 暂不可用。**当前唯一活跃环境是开发者本机的 Mac 本地栈**（Docker/colima）。下文原「云端/服务器」描述已按此校正。

## What This App Is

Personal Ledger PWA is a personal bookkeeping app for iPhone Safari home-screen use and Mac/desktop browser use.

Design constraints:

- Code can be public on GitHub.
- Financial data, login data, backups, logs, and secrets must stay local or on the user's own server.
- The app must work offline for daily bookkeeping and sync when online.
- The app references bookkeeping products only as functional inspiration, not as copied branding or UI.

## Current Architecture

- Monorepo with npm workspaces.
- `apps/web`: React, Vite, TypeScript, PWA, IndexedDB.
- `apps/api`: Fastify, Prisma, PostgreSQL.
- `packages/shared`: shared entity types, defaults, amount helpers, report helpers.
- Local-first: IndexedDB + outbox 同步队列；服务端为权威存储。

## Active Environment: Local Mac Stack

当前发布与运行都在本机 Mac（Docker 运行时装在 `~/bin`，colima VM，免 sudo）：

- Compose file: `docker-compose.local.yml`
  - `postgres-local`（Postgres 17，数据在 `data/local-postgres`）
  - `api-local`（Fastify API；`apps/api/dist` 以只读 bind-mount 挂入 `/app/apps/api/dist`）
  - `caddy-local`（HTTPS 反代 + PWA 静态文件，`apps/web/dist → /srv/web`）
- 入口：`https://localhost:8443/api`（Caddy 自签证书，需一次性把 `~/Desktop/Caddy-Local-CA.crt` 装进系统钥匙串，否则浏览器 fetch 被 TLS 拦）。
- 手机端从 `https://<Mac 名>.local:8443` 打开（mDNS）。

## Important URLs And Paths

- GitHub: `https://github.com/Mr-Z11/personal-ledger-pwa`
- 本地 API 入口 / health：`https://localhost:8443/api` / `https://localhost:8443/api/health`
- 本地备份：`backups/ledger-local-*.sql`（由 macOS launchd 每天 03:00 自动生成）
- 历史（已失效，仅存档）：云端 `https://ledger.47.74.3.104.sslip.io`、`/root/personal-ledger-pwa`

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
npm --workspace @ledger/web run test   # 改阈值/逻辑后必跑，否则 CI 门禁会挡住镜像构建
npm run build
```

部署到本地栈（详见 `HANDOFF.md` §3）：

- 前端：`npm run build` 后由 caddy-local 直接供 `apps/web/dist`（原地重建则免 `--force-recreate`）。
- 后端：改 `apps/api` 源码 → `npm --workspace @ledger/api run build` → `docker compose -f docker-compose.local.yml --env-file .env.local up -d api-local`（bind-mount 直接生效，无需拉镜像）。
- 推送：本机沙箱/代理会拦 `git push`（HTTP2 framing error / SSH connection closed），统一用 `python3 scripts/api-push-main.py`（Git Database API 复刻，远端 SHA 与本地一致，绝不 force）。

## Deployment Rules (Local)

- 服务器（若将来重建）RAM 小，禁止在服务器端 `npm install` / `npm run build` / `docker compose up --build`；只拉预构建 GHCR 镜像运行。
- 本机 colima VM 对 GHCR blob CDN 偶发 `TLS handshake timeout`，大镜像 `docker pull` 易卡死——所以后端改用 bind-mount 上线；后端**新增 npm 依赖**时才需要更新镜像内 node_modules（拉新镜像或本地 build）。
- 改 Prisma schema 前先 `bash scripts/data-sync.sh backup-local`；容器启动会自动 `prisma db push`。

## Data And Privacy

Never commit real data or secrets. Keep these out of Git:

- `.env`, `.env.local`, `.env.production`
- database directories (`data/`)
- `backups/`
- `uploads/`
- logs
- SSH keys
- dumps such as `.sql`, `.dump`, `.backup`

`.gitignore` already excludes the expected sensitive paths. Do not weaken it.

## Current Functional State

The app currently supports:

- Registration/login against the API (local stack).
- Offline local-first use; sync when online (outbox queue).
- Ledger bootstrap from server to IndexedDB.
- Offline transaction creation, editing, delete/restore.
- Account management and editing; first/second-level category management.
- Quick category search inside "记一笔"; quick-created categories under `其他`.
- "记一笔" is a large lower-right floating button.
- Income uses `收款账户`; expense uses `付款账户`.
- Reports, budgets, CSV import/export.
- 计划购买清单（云端同步、余额够买时提醒、行内可编辑名称/预算）。
- 每日本地备份 + Docker 清理。

## Category UX Rule

In the "记一笔" flow, do not show the entire category list by default. It makes fast bookkeeping noisy. Default display should show only the selected category. Show matching categories after the user types a search query. If the query does not match an existing category, offer quick creation under `其他`.

## Maintenance (Local, macOS launchd)

备份与 colima 由 macOS launchd 管理，不依赖 WorkBuddy：

- `com.personal-ledger.data-backup`：每天 03:00 跑 `scripts/auto-backup.sh`（云端在线则 SSH 拉云端库，否则备份本地 PG；Docker 没跑会自动 `colima start`）。
- `com.personal-ledger.colima`：登录时启动 Docker VM。
- 数据工具：`scripts/data-sync.sh`，命令 `status / backup-cloud / backup-local / restore-to-local / sync-cloud-to-local / sync-local-to-cloud`。

（历史：原服务器 `deploy/install-maintenance-cron.sh` + `/etc/cron.d/personal-ledger-pwa` 已随云端失效停用。）

## Known Operational Notes

- 本机 `git push` 直连会被沙箱代理拦（`Error in the HTTP2 framing layer` / `Empty reply` / SSH `Connection closed`）→ 用 `python3 scripts/api-push-main.py`。作者信息硬编码 `frori / mofrori@gmail.com`。
- PWA/service-worker 缓存可能显示旧 UI：生产/本地看起来旧时，硬刷新或把已安装 PWA 划掉重开两次（`registerType: autoUpdate`）。
- 原 `sslip.io` 域名绑定已失效的服务器 IP，不再使用。
