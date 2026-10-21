# Codex Project Notes

This repository is a personal bookkeeping PWA. When maintaining it with Codex, continue from the current architecture instead of re-planning from scratch.

## Current Goal

Build and maintain a cloud-first, offline-capable personal ledger app inspired by common bookkeeping workflows. Do not copy any third-party app branding, icons, wording, or UI exactly.

## Project Shape

- `apps/web`: React + Vite + TypeScript PWA.
- `apps/api`: Fastify + Prisma API.
- `packages/shared`: shared types, money helpers, default seed data.
- Production data is PostgreSQL on the user's Ubuntu server.
- Local browser data uses IndexedDB for offline use and sync queueing.

## Production

- GitHub repo: `https://github.com/Mr-Z11/personal-ledger-pwa`
- Production URL: `https://ledger.47.74.3.104.sslip.io`
- Server app directory: `/root/personal-ledger-pwa`
- Server data directory: `/root/personal-ledger-pwa/data/postgres`
- Server backups: `/root/personal-ledger-pwa/backups`
- Server logs: `/root/personal-ledger-pwa/logs`

The server is small, about 2 GiB RAM. Never build Docker images on the server for routine updates.

## Safe Update Flow

1. Change code locally.
2. Run:
   - `npm run typecheck`
   - `npm run build`
3. Commit and push to `main`.
4. Wait for GitHub Actions CI to build/push GHCR images.
5. Deploy on the server with:
   - `cd /root/personal-ledger-pwa && bash deploy/update-server.sh`

`deploy/update-server.sh` must stay lightweight: fetch/reset code, pull prebuilt images, restart containers. Do not add server-side `npm install`, `npm run build`, or `docker compose up --build` to it.

## Data Safety

Code can be public. Real financial data and secrets must never enter GitHub.

Do not commit:

- `.env` or `.env.*` except `.env.example`
- `data/`
- `backups/`
- `uploads/`
- logs
- SSH keys
- database dumps

Keep user data on the server or local IndexedDB only.

## Existing Features To Preserve

- Login/register with API.
- Offline-capable transaction creation and editing.
- Sync queue via IndexedDB.
- Income uses "收款账户"; expense uses "付款账户".
- Each transaction can be edited.
- Floating "记一笔" button stays in the lower-right corner.
- Category search in "记一笔" should not show all categories by default.
- New categories are quick-created under `其他`.
- Accounts and first/second-level categories are editable.
- Automatic maintenance cron backs up PostgreSQL daily and prunes unused Docker artifacts.

## Verification Checklist

Before finishing a code change:

- Run `npm run typecheck`.
- Run `npm run build` when web/API code changed.
- For server-affecting changes, verify:
  - `https://ledger.47.74.3.104.sslip.io/api/health`
  - `docker compose ps` on the server.

See `HANDOFF.md` for the live handoff (single active file); `.workbuddy/memory/MEMORY.md` for long-term distilled knowledge; `docs/codex-handoff.md` for the static project intro.

## Handoff Files Sync Rule（2026-10-21 精简为单一活跃文件）

本项目**只维护一个活跃交接文件 `HANDOFF.md`**（含：当前状态 / 近期变更 / 发布流程 / 关键约束与坑 / 待办 / 文件地图）。原 `task_plan.md` / `findings.md` / `progress.md` 三件套已删除——内容已蒸馏进 `.workbuddy/memory/`，完整原文在 git 历史。**不要再按技能模板重建这三个文件**，否则会再次膨胀。

每次会话结束只做三件事：

- 更新 `HANDOFF.md`：新 commit 记入「近期变更」表；新踩的坑记入「关键约束 & 不要重复踩的坑」；新待办记入「当前待办」。
- 追加当日 `.workbuddy/memory/YYYY-MM-DD.md` 会话日志。
- 有长期价值的结论蒸馏进 `.workbuddy/memory/MEMORY.md`。

历史详情用 `git log` / `git show <commit>:findings.md` 查（删除前最后一次改动在 commit `24f8333`）。

