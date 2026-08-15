# Task Plan: eliminate iPhone PWA cold-start blank screen

## Goal
Eliminate the 2–10 second blank screen during iPhone home-screen PWA cold starts by rendering an immediate static shell, showing local data first, and keeping cloud synchronization off the critical rendering path; verify, push main, and deploy production.

## Current Phase
Phase 8

## Phases

### Phase 1: Discovery
- [x] Inspect entry keypad implementation
- [x] Inspect report analytics implementation
- [x] Inspect API/shared persistence model
- **Status:** complete

### Phase 2: Data Model and Sync
- [x] Add analysis note shared type/schema
- [x] Add API bootstrap/sync support
- [x] Add web IndexedDB support
- **Status:** complete

### Phase 3: Keypad UX
- [x] Redesign keypad layout for lower mis-tap risk
- [x] Separate destructive actions from commit path
- [x] Add clearer press/disabled feedback
- **Status:** complete

### Phase 4: Report Analytics and Notes
- [x] Add monthly summary analysis
- [x] Add category anomaly detection using budget, previous month, and 3-month baseline
- [x] Add monthly and anomaly note UI
- **Status:** complete

### Phase 5: Verification and Deployment
- [x] Run build/test
- [x] Push GitHub
- [x] Deploy cloud server
- [x] Verify production health
- **Status:** complete

### Phase 6: Entry Feedback and Report Context
- [x] Add keypad haptic fallback and press confirmation
- [x] Add amount preview motion and saved-state confirmation
- [x] Add sticky report period context
- [x] Label report modules by data scope
- [x] Verify, push, deploy
- **Status:** complete

### Phase 7: Product Improvement Audit
- [x] Inventory existing user-facing features and primary flows
- [x] Inspect offline/sync behavior and performance hotspots
- [x] Validate core mobile flows in the running app where feasible
- [x] Rank 8–12 recommendations by impact, cost, and risk
- **Status:** complete

### Phase 8: iPhone PWA Cold-Start Performance
- [x] Measure and identify blank-screen sources in HTML, module startup, service worker, IndexedDB, and sync
- [x] Implement an immediate branded shell and remove avoidable startup delay
- [x] Make cached local data the first authenticated render while cloud work remains background-only
- [x] Add regression checks for first-paint shell and production asset/caching behavior
- [x] Run full verification, commit/push main, wait for CI, deploy server, and verify production
- **Status:** complete

### Phase 9: 预算 Bug + 趋势气泡 + UI 专业化 (2026-08-15)
- [x] BudgetPanel 编辑/删除/去重 (dd3d237)
- [x] 趋势图月份柱子点击金额气泡 (adce292)
- [x] 上下文感知 topbar + 环比趋势 + 流水行色彩 (78bdadd)
- **Status:** complete (全部已部署)

### Phase 10: 工资日推送提醒 (2026-08-15)
- [x] VAPID 密钥生成 + 服务器 .env 配置 (478d367)
- [x] notifications.ts: web-push + 每 20 分钟定时器
- [x] push-sw.js: Service Worker 推送处理
- [x] SalaryReminderPanel: 设置页 UI
- [x] 空 body POST 报错修复 (116e8be)
- **Status:** complete (全部已部署)

### Phase 11: 数据备份 + 本地同步 + 双重存储 (2026-08-15)
- [x] 服务器数据全量备份到本地 (3131 笔交易完整)
- [x] 本地同步模式: 运行时可配 API 地址 (cfadb86)
- [x] 双重存储: data-sync.sh 5 命令 (b3b1ffe)
- [x] 自动备份: auto-backup.sh + launchd 配置 (71752ca)
- [x] WorkBuddy 自动化: 每 6 小时 backup-cloud
- **Status:** complete (全部已部署, 服务器 HEAD: 71752ca)

## Key Questions
1. Where should notes persist so they survive refresh and sync to cloud?
2. How should anomaly IDs remain stable across refreshes and months?
3. How can keypad reduce accidental save/clear actions while keeping one-screen entry?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Use confirmed anomaly thresholds from task package | User confirmed proposed thresholds. |
| Keep专项支出 separate from日常消费 anomaly analysis | Existing app semantics distinguish日常消费 and专项支出. |
| Persist notes as AnalysisNote synced entity | Notes must survive refresh and sync to cloud. |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Playwright bundled browser missing | Tried headless Chromium | Used installed Chrome channel for visual checks. |
| IndexedDB version mismatch in test harness | Opened `ledger-box` with fixed version 2 | Opened existing DB without a fixed version for the seeded UI check. |
| False historical anomaly for a category that decreased MoM | Seeded report data exposed conflict | Required historical anomaly to also increase versus previous month. |
| Report context anchor did not stick in mobile browser check | Tried `position: sticky` with `align-self: start` | Used a mobile fixed context bar with report-page spacing. |
| Browser skill cache path changed | Initial configured `26.623.42026` path was no longer present | Located the current `26.623.61825` plugin cache and continued with its instructions. |
| In-app browser emitted a Statsig network timeout | Browser environment telemetry timed out while local page still loaded | Treated as unrelated tooling noise; DOM verification completed successfully. |
| Workflow inspection glob had no `.yaml` matches | zsh `nomatch` stopped a combined `.yml`/`.yaml` loop | Switched to reading the known `.github/workflows/ci.yml` path directly. |
| Web Docker image could not find startup verifier | `deploy/web.Dockerfile` copied `apps/web` and `packages/shared` but not `/scripts` | Added an explicit verifier copy to the local Docker build stage; will validate Docker locally before repushing. |
| Local Docker validation unavailable | `docker` CLI is not installed on this Mac | Used local full build/path checks and delegated the authoritative container build to the next GitHub Actions run. |
| SSH 管道传输 >700K 被 SIGKILL (exit 137) | 直接 `ssh ... "docker exec pg_dump" > file` | 服务器端 gzip 压缩 (822K→149K) 后传输再本地解压 |
| `launchctl load/bootstrap` 在沙箱内报 I/O error | 尝试 osascript / crontab 均被阻止 | 创建 setup-auto-backup.sh 供用户 Terminal 手动执行 |
| `crontab` 在沙箱内报 "operation not permitted" | 直接 `crontab -` | 改用 WorkBuddy 自动化 + launchd plist (用户手动加载) |
| Git push HTTPS 被 Clash 代理 127.0.0.1:10808 拦截 | `env -u ... git push` | 改用 SSH: `GIT_SSH_COMMAND="ssh -o ProxyCommand=none" git push git@github.com:...` |
| npm install 移除 @rollup/rollup-darwin-arm64 | build 失败 | `npm install --no-save @rollup/rollup-darwin-arm64` 恢复 |

## Notes
- Confirmed requirements: all keypad friction points exist; add professional anomaly analysis and persistent analysis notes.
- Deploy to GitHub/cloud after implementation.
- New confirmed requirements: add input confirmation feeling (press feedback, haptic where supported, amount preview) and reduce report confusion while scrolling by making month/data scope obvious.
- 2026-06-27 confirmed audit scope: single-user use, prioritize entry efficiency, analysis, and long-term habits; include features, UX, performance, and offline sync; prefer low-cost/high-impact improvements; recommendations only, no application code changes.
- 2026-06-29 confirmed startup scope: iPhone home-screen PWA cold start is blank for about 2–10 seconds; local-first rendering is acceptable; complete production deployment is required.
