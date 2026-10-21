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
- **当前唯一活跃环境 = 本机 Mac 本地栈**（`docker-compose.local.yml`：postgres-local + api-local + caddy-local），入口 `https://localhost:8443/api`。完整 runbook 见 `HANDOFF.md`。
- ⚠️ 原云端服务器 `47.74.3.104`（`https://ledger.47.74.3.104.sslip.io`、`/root/personal-ledger-pwa`）自 2026-08-29 起失效（80/443 全关、SSH host key 变更），`deploy/update-server.sh` 暂不可用；云端重建与否待用户决策。

The (future) server is small, about 2 GiB RAM. Never build Docker images on it for routine updates.

## Safe Update Flow（本地栈）

1. Change code locally.
2. Run `npm run typecheck`、`npm --workspace @ledger/web run test`、`npm run build`.
3. Commit; push with `python3 scripts/api-push-main.py`（沙箱代理会拦 `git push`；远端 SHA 与本地一致，绝不 force）。
4. GitHub Actions CI builds/pushes GHCR images. 注意：改阈值/逻辑后务必先跑测试，否则 test 门禁会 skip 掉 docker-images、镜像不重建。
5. Deploy to the local stack:
   - 前端：`npm run build` 后由 caddy-local 供 `apps/web/dist`（原地重建免 `--force-recreate`）。
   - 后端：`npm --workspace @ledger/api run build` → `docker compose -f docker-compose.local.yml --env-file .env.local up -d api-local`（bind-mount 直接生效，无需拉镜像）。

`deploy/update-server.sh`（仅当将来重建云端时用）必须保持轻量：只 fetch/reset 代码、拉预构建镜像、重启容器。不要加入服务器端 `npm install`、`npm run build` 或 `docker compose up --build`。

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
- For stack-affecting changes, verify:
  - `https://localhost:8443/api/health`
  - `docker compose -f docker-compose.local.yml ps`（local Mac stack）

See `HANDOFF.md` for the live handoff (single active file); `.workbuddy/memory/MEMORY.md` for long-term distilled knowledge; `docs/codex-handoff.md` for the static project intro.

## Handoff Files Sync Rule（2026-10-21 精简为单一活跃文件）

本项目**只维护一个活跃交接文件 `HANDOFF.md`**（含：当前状态 / 近期变更 / 发布流程 / 关键约束与坑 / 待办 / 文件地图）。原 `task_plan.md` / `findings.md` / `progress.md` 三件套已删除——内容已蒸馏进 `.workbuddy/memory/`，完整原文在 git 历史。**不要再按技能模板重建这三个文件**，否则会再次膨胀。

每次会话结束只做三件事：

- 更新 `HANDOFF.md`：新 commit 记入「近期变更」表；新踩的坑记入「关键约束 & 不要重复踩的坑」；新待办记入「当前待办」。
- 追加当日 `.workbuddy/memory/YYYY-MM-DD.md` 会话日志。
- 有长期价值的结论蒸馏进 `.workbuddy/memory/MEMORY.md`。

历史详情用 `git log` / `git show <commit>:findings.md` 查（删除前最后一次改动在 commit `24f8333`）。

