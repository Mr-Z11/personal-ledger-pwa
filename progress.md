# Progress Log

## Session: 2026-08-15 — 功能迭代 + 双重存储

### 预算 Bug 修复 (dd3d237)
- **Status:** complete (已部署)
- BudgetPanel 增加编辑/删除按钮，同月份+分类去重复用已有记录 id
- 前端 find() 取第一条逻辑不变，但不再产生重复预算记录

### 趋势图金额气泡 (adce292)
- **Status:** complete (已部署)
- 点击月份柱子后金额气泡浮在柱子末端，短柱外侧/长柱内侧
- 气泡放在 position:relative 包裹层内，避免 overflow:hidden 裁切

### UI 专业化 (78bdadd)
- **Status:** complete (已部署)
- 上下文感知 topbar（viewHeadingMap: Record<View, {...}>）
- 总览页环比趋势指标（TrendingUp/Down + 百分比）
- 流水行类型色彩标识（row-type-expense/income/transfer 左边框）

### 工资日推送提醒 (478d367)
- **Status:** complete (已部署)
- 新增 3 张表: ReminderSetting, PushSubscription, ReminderLog
- VAPID 密钥在服务器 .env 中
- Service Worker: push-sw.js (importScripts 挂载)
- 设置页 SalaryReminderPanel: 工资日、时间、自定义内容、测试推送
- iOS 需 16.4+ 且添加到主屏幕

### 空 body POST 修复 (116e8be)
- **Status:** complete (已部署)
- apiFetch 仅在有 body 时才设 content-type: application/json

### 本地同步模式 (cfadb86)
- **Status:** complete (已部署)
- api.ts: API_BASE 运行时从 localStorage 读取
- App.tsx: SyncSettingsPanel 显示状态、测试连接、切换地址
- docker-compose.local.yml: postgres-local + api-local + caddy-local
- start-local-sync.sh: 一键启动脚本

### 双重存储 data-sync (b3b1ffe)
- **Status:** complete (已部署)
- scripts/data-sync.sh: 5 命令 (status/backup-cloud/restore-to-local/sync-cloud-to-local/sync-local-to-cloud)
- scripts/auto-backup.sh: 日志 + 自动清理旧备份
- docs/data-storage-guide.md: 完整策略文档
- 关键发现: SSH 管道 >700K 被 SIGKILL，gzip 压缩后 149K 可靠传输

### setup-auto-backup (71752ca)
- **Status:** complete (已部署)
- scripts/setup-auto-backup.sh: 一键安装 launchd
- deploy/com.personal-ledger.data-backup.plist: launchd 配置
- 沙箱内无法 launchctl load，用户需 Terminal 手动运行

## Session: 2026-06-29 — iPhone PWA Cold Start

### Phase 8: Diagnosis and Implementation
- **Status:** complete
- Actions taken:
  - Confirmed iPhone home-screen PWA cold-start scope and deployment requirement.
  - Recovered repository/planning state and preserved pre-existing uncommitted planning documents and handoff file.
  - Measured production HTML/API response timing and inspected generated service-worker behavior.
  - Added deterministic Apple touch icons and portrait iPhone startup images, including 393×852 @3x.
  - Visually verified the primary iPhone launch image.
  - Removed the first-animation-frame dependency from application module loading.
  - Changed service-worker registration to deferred, safe waiting activation and added guarded stale-chunk recovery UI.
  - Ran full typecheck and production build successfully.
  - Inspected generated HTML/service worker and verified safe update behavior plus startup asset inclusion.
  - Verified the production preview at 393×852 reaches the app UI with non-white root/body backgrounds and 12 iPhone startup-image mappings.
  - Added a build-time PWA startup regression verifier and reran the web production build successfully.
  - Ran `npm test`: shared helper tests passed; API/web still have no Vitest files, while the new startup verifier runs as part of every web build.
  - Reloaded the final production preview at 393×852 with no captured console warnings/errors, then stopped the local preview.
  - Committed the scoped application changes as `7570bb3` and pushed `main` to GitHub.
  - Began monitoring GitHub Actions before production deployment.
  - CI code checks passed, but the web image build failed because its build context did not copy the new verifier script into `/app/scripts`.
  - Added the missing verifier copy to `deploy/web.Dockerfile`; production was not deployed from the failed run.
  - Pushed follow-up commit `78febb0`; CI run `28371162168` passed all code checks and both image builds.
  - Deployed with `bash deploy/update-server.sh`; server HEAD is `78febb0`.
  - Verified API/web/PostgreSQL/Caddy container status, production HTTP 200 health, production startup markup, launch-image headers, and safe service-worker activation.
- Files created/modified:
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

## Session: 2026-06-27 — Product Improvement Audit

### Phase 7: Product Improvement Audit
- **Status:** complete
- Actions taken:
  - Confirmed the task package with the user.
  - Read the current-task handoff and prior planning records.
  - Excluded recently completed keypad feedback, report context, anomaly analysis, and synced analysis notes from duplicate recommendations.
  - Inspected app state/sync orchestration, IndexedDB outbox, server push behavior, entry/history/settings/report flows, bundle output, and existing test coverage.
  - Ran `npm run build:web` successfully; core bundles are moderate and import libraries are lazy-loaded.
  - Ran `npm test`: 3 shared tests passed; API and web have no test files.
  - Checked the authentication shell at 393×852 in the in-app browser; authenticated pages were not re-seeded during this read-only audit.
  - Ranked ten recommendations and applied a first-principles/Occam filter.
- Files created/modified:
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

## Session: 2026-06-23

### Phase 1: Discovery
- **Status:** complete
- **Started:** 2026-06-23 Asia/Shanghai
- Actions taken:
  - Read frontend-design and planning-with-files instructions.
  - Created task planning files.
  - Inspected shared types, API Prisma schema, web IndexedDB schema, report component, and amount keypad.
- Files created/modified:
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

### Phase 2: Data Model and Sync
- **Status:** complete
- Actions taken:
  - Added shared `AnalysisNote` type and included it in snapshot/sync payloads.
  - Added Prisma `AnalysisNote` model and ledger relation.
  - Added API serialization, bootstrap, pull, push, and direct create support for notes.
  - Added IndexedDB `analysisNotes` store, snapshot persistence, reset, and outbox merge support.
- Files created/modified:
  - `packages/shared/src/index.ts`
  - `apps/api/prisma/schema.prisma`
  - `apps/api/src/index.ts`
  - `apps/api/src/serializers.ts`
  - `apps/web/src/db.ts`

### Phase 3: Keypad UX
- **Status:** complete
- Actions taken:
  - Rebuilt amount keypad as a 3-column large-touch numeric pad.
  - Removed save from the keypad and kept save in the sticky bottom action area.
  - Moved clear to a separate header button and kept backspace in a consistent keypad corner.
  - Added clearer pressed and disabled states.
- Files created/modified:
  - `apps/web/src/App.tsx`
  - `apps/web/src/styles.css`

### Phase 4: Report Analytics and Notes
- **Status:** complete
- Actions taken:
  - Added monthly anomaly analysis using budget, previous month, 3-month baseline, and low-frequency large single-transaction rules.
  - Kept专项支出 separate from daily consumption analysis while adding a dedicated reminder.
  - Added monthly analysis notes and per-anomaly notes, saved through the synced note entity.
  - Added top increase/decrease summaries for the selected month.
  - Guarded historical anomaly alerts so categories that decreased MoM do not trigger misleading warnings.
- Files created/modified:
  - `apps/web/src/App.tsx`
  - `apps/web/src/styles.css`

### Phase 5: Verification and Deployment
- **Status:** complete
- Actions taken:
  - Ran typecheck and production build successfully.
  - Ran mobile browser checks using installed Chrome with seeded local preview data.
  - Pushed commit `84dfc00` to GitHub.
  - Deployed cloud server and verified production health.
- Files created/modified:
  -

### Phase 6: Entry Feedback and Report Context
- **Status:** complete
- Actions taken:
  - Confirmed new requirements: add input confirmation feeling and make report period/scope clear while scrolling.
  - Added haptic progressive enhancement for keypad taps and save success.
  - Added keypad live amount preview, amount preview pulse animation, pressed-key confirmation, and saved-state animation.
  - Added report context bar, selected-period scope labels, and history-trend labels.
  - Changed mobile report context bar from sticky to fixed after browser check showed sticky did not remain visible.
  - Ran full typecheck/build, pushed commit `9226bd2`, deployed cloud server, and verified production health.
- Files created/modified:
  - `apps/web/src/App.tsx`
  - `apps/web/src/styles.css`

## Test Results
| Test | Input | Expected | Actual | Status |
|------|-------|----------|--------|--------|
| `npm run typecheck` | Full workspace | TypeScript and Prisma checks pass | Passed | Pass |
| `npm run build` | Full workspace | Shared/API/web production build succeeds | Passed | Pass |
| Mobile entry screenshot | Local preview, 393x852 viewport | Keypad has larger safer touch targets and sticky save remains visible | Passed | Pass |
| Mobile report seeded data | Local preview with budget/anomaly sample data | Shows monthly anomaly analysis and notes; no false warning for decreased category | Passed | Pass |
| `npm run typecheck` | Phase 6 changes | TypeScript and Prisma checks pass | Passed | Pass |
| `npm run build` | Phase 6 changes | Production build succeeds | Passed | Pass |
| Mobile entry feedback | Local preview after entering 123 | Hero and keypad amount previews show `¥123.00`; key feedback is visible | Passed | Pass |
| Mobile report context | Local preview after scrolling report | Current month context remains visible and trend modules are labeled as history | Passed | Pass |

## Error Log
| Timestamp | Error | Attempt | Resolution |
|-----------|-------|---------|------------|
| 2026-06-23 | Playwright bundled Chromium executable missing | Tried launching bundled Chromium | Used installed Chrome channel. |
| 2026-06-23 | IndexedDB fixed version rejected in seeded UI test | Opened `ledger-box` with version 2 | Opened existing DB without specifying version. |
| 2026-06-23 | Report context anchor did not remain sticky in mobile browser check | Added `align-self: start` to sticky grid item | Switched mobile context bar to fixed positioning with reserved report spacing. |

## 5-Question Reboot Check
| Question | Answer |
|----------|--------|
| Where am I? | Phase 6 verification/deployment |
| Where am I going? | Push feedback/context changes to GitHub, deploy cloud server, verify production health |
| What's the goal? | Improve quick-entry keypad confidence and add monthly anomaly analysis with persistent notes |
| What have I learned? | Sticky report context did not hold in mobile layout; fixed context bar is reliable |
| What have I done? | Added input feedback, amount animations, mobile fixed report context, and scope labels |
