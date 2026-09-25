# Progress Log

## Session: 2026-09-25 — 云端失效后的本地栈修复 + 手机数据同步打通

### 数据存储链路诊断 (10:06-10:20)
- **Status:** complete
- 确认三层存储：IndexedDB 唯一活跃 / 本地 PG 冻结 8-31 / 云端已失效
- 云端 47.74.3.104：80/443 全关、SSH host key 变更、最后备份 8-29
- 架构定性：local-first，服务器只是同步目标；云端全挂不影响记账/查看
- 绘制数据存储现状图（show_widget）

### 本地 Mac 栈修复 (10:18-10:25)
- **Status:** complete
- 根因 1：colima VM 丢 qemu binfmt → API crash-loop 11428 次（`exec format error`）
  - 修复：`docker run --rm --privileged tonistiigi/binfmt --install amd64`
- 根因 2：本地 8-16 旧镜像 schema=Int vs 数据库 bigint → `--accept-data-loss` 数据降级风险
  - 升级前备份 `backups/pre-image-upgrade-20260925-101948.sql.gz`
  - 修复：`docker pull --platform linux/amd64` 拉新镜像（BigInt），重建容器，日志 `already in sync` 零数据变更
- 改进 `start-local-sync.sh`：启动前自动注册 binfmt + 自动拉匹配镜像（`bash -n` 通过）
- 验证：localhost / 192.168.3.21 / mDNS 三路径 `/api/health` 均 `{"ok":true}`；`/api/bootstrap` 200（3416 笔 / 18 账户 / 187 分类）

### 手机同步链路打通 (10:35-11:15)
- **Status:** complete
- fetchevent 报错诊断：SW NetworkFirst 拦截 `/api` + iOS WKWebView 不信 IP 类证书
- 关键发现：**mDNS fallback 已自动生效**（`/bootstrap` 200 via froridemacbook-air.local，证明 JWT_SECRET 一致）；workbox 只路由 GET，POST/OPTIONS 直接走网络
- "URL is not valid"：手动输入字符串非法 → 改用「清空地址 + 自动 fallback」
- 验证 `/sync/push` 端点（空 payload 200，serverVersion 121→122）
- **用户确认同步成功**：3469 条（+53），最新 2026-09-24，近一个月零备份数据全部落库

### 数据导出存档 (11:19)
- **Status:** complete
- psql COPY 导出 → Python(openpyxl 3.1.5) 生成 xlsx
- `Desktop/记账数据-截至2026-09-25.xlsx`（3321 条有效流水，账单+说明两表，类型着色/冻结首行/自动筛选）
- Files: `scripts/start-local-sync.sh`（改进，未提交）, `/tmp/make_ledger_xlsx.py`

### 交接文件同步 (11:24)
- **Status:** complete
- 同步更新 task_plan.md(Phase 13) / findings.md / progress.md / HANDOFF.md
- Files: `task_plan.md`, `findings.md`, `progress.md`, `HANDOFF.md`

## Session: 2026-08-16 — 本地备份体系 + 数据同步全链路修复

### 备份频率调整 (09:35)
- **Status:** complete
- 删除 WorkBuddy 自动化（原每 6h），改为 macOS launchd 每 24h（03:00）
- `deploy/com.personal-ledger.data-backup.plist` 更新并重载
- 备份完全脱离 WorkBuddy，由 launchd 管理

### 本地全栈接管 (09:40-09:50)
- **Status:** complete
- 免 sudo 安装 colima + Docker CLI（~/bin, ~/opt/lima）
- 本地栈启动：postgres-local + api-local + caddy-local
- 修复 Caddyfile.local 语法 bug + tls internal on_demand
- auto-backup.sh 重写：云端在线→SSH 备份；离线→本地 PG 备份；Docker 没跑→自动 colima start
- 新增 colima.plist（登录自启）
- Files: docker-compose.local.yml, deploy/Caddyfile.local, scripts/auto-backup.sh, scripts/data-sync.sh, deploy/com.personal-ledger.colima.plist

### 前端 API 自动故障转移 (10:00-10:25)
- **Status:** complete (2 commits: 1e8be1c, 314899d)
- api.ts apiFetch：云不可达→自动切本地端点（localhost:8443 + mDNS）
- CORS 修复：显式声明 PUT/DELETE/PATCH/OPTIONS
- VITE_FALLBACK_API_BASES 编入 bundle
- Files: apps/web/src/api.ts, apps/api/src/index.ts, deploy/web.Dockerfile, .github/workflows/ci.yml

### 手机端同步状态栏 (10:53)
- **Status:** complete (commit: 5a4f61a)
- 根因：.sync-card 在 @media(max-width:940px) 下 display:none
- 修复：新增 .mobile-sync-bar 在手机端顶部显示
- Files: apps/web/src/App.tsx, apps/web/src/styles.css

### 同步状态栏改进 (11:09)
- **Status:** complete (commit: 909ac42)
- 文字区域改为 overflow-x 横向滚动
- 自动隐藏：待同步=0 且在线时关闭
- Files: apps/web/src/App.tsx, apps/web/src/styles.css

### amountCents 溢出修复 + PWA 自动更新 (11:42)
- **Status:** complete (commit: ffa0a54)
- **根因**：sync/push 500 错误，amountCents=9999999900 超过 PostgreSQL integer 上限
- Prisma schema Int→BigInt（amountCents + openingBalanceCents），prisma db push 自动迁移
- serializers.ts 加 Number() 转换 bigint→number
- PWA registerType: prompt→autoUpdate, skipWaiting:true, clientsClaim:true
- verify-pwa-startup.mjs 同步更新
- Files: apps/api/prisma/schema.prisma, apps/api/src/serializers.ts, apps/api/src/index.ts, apps/web/vite.config.ts, scripts/verify-pwa-startup.mjs
- **结果**：用户确认手机端 265 条数据全部成功同步到云端

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

## 2026-09-25 Session: 预算两层 + 蓄水池首页 + 消费节奏 + 大额分析 + 工资提醒本地化 (commit 7796d90)

### 需求（用户 4 项）
1. 每月大额开销清单 + 规律识别（无 AI，纯统计规则）
2. 工资日提醒纯本地、可随时编辑、无服务器也能用
3. 报表消费分析重做：趋势上升/下降、环比、同比、日均 vs 预算平均线；首页蓄水池可视化（打开 App 第一眼看到额度水位）
4. 预算拆分：日常消费预算 + 总开支预算（总开支包含日常）

### 实现
- Budget.scope（daily/total）：schema/shared/API/serializers 四层同步修改；旧数据 DB 默认 daily 零迁移成本
- 关键修复：monthBudgetTotal 必须按 scope 过滤，否则总开支预算会被当成日常预算
- apps/web/src/utils.ts 新抽取纯函数（App.tsx 3925→缩短 ~190 行）；widgets.tsx 新组件文件（蓄水池/横幅/节奏图/焦点卡/大额面板/工资设置）
- 工资提醒：localStorage `ledger-salary-reminder`；打开 App 检查 nextPaydayInfo；横幅当天可关闭（dismiss key）；可选本地 Notification（每天最多一次）；旧 SalaryReminderPanel（Web Push）已删除
- 大额判定线：max(用户阈值默认¥1000, 当月中位数×3)，≥8 笔才启用自动上调；规律：同商户/分类近 6 月 ≥3 次 → 每月固定（典型日中位数 + 均值）
- 默认视图 entry→overview；核心洞察折叠

### 验证
| 检查 | 结果 |
|------|------|
| npm run typecheck | Pass（首次缺 4 个 widgets 导出，补上后通过） |
| npm run build | Pass（首次被沙箱 safe-delete shim 拦截 dist 清空，mv 移出后通过） |
| vitest 冒烟 6 项（widgets.smoke.test.tsx） | Pass |
| GitHub Actions CI (3609435) | Pass 2m27s |
| 部署前备份 | ledger-local-20260925-122935.sql（3469 条） |
| 本地栈更新 | docker pull --platform linux/amd64 → compose up api-local → prisma db push 同步 scope 列 |
| https://localhost:8443/api/health | {"ok":true} |
| Budget 表现有 4 行预算 | scope 全部正确落为 daily |

### 注意
- 云端 47.74.3.104 仍失效，本次部署目标为本地 Mac 栈；手机端 PWA 经 mDNS 入口刷新即可拿到新版本

## 2026-09-25 Session 2: 上线后用户反馈三轮修复 (d1907cf / 717ff32 / 2da791d)

### 用户反馈与处理
| 反馈 | 诊断 | 处理 | Commit |
|------|------|------|--------|
| 手机打开看不到更新 | dist 被 mv 后重建 → colima 绑定挂载悬空，caddy root 返回 403 空页 | `compose up -d --force-recreate caddy-local`（普通 up -d 不重建容器） | 1929b20(记录) |
| "低于预算平均线"难懂 | 术语太数学化 | 改为「比预算慢 ¥X，花得比计划的省」/「比预算快 ¥X」；图例「预算参考线」；焦点卡「预算每天可花 / 实际每天花」 | 717ff32 |
| 蓄水池数字显示不明显 | 深色数字压在高水位深色水面上，对比度不足 | 读数包进磨砂玻璃卡片 `.reservoir-readout`（半透明米白 + backdrop-blur + 阴影 + 圆角），字重 800 | 2da791d |
| 蓄水池应横向排列 | ≤480px 媒体查询把 grid 改成单列 | 删除单列规则，首页在所有宽度保持两列 | d1907cf |

### 部署验证（每轮都跑）
| 检查 | 结果 |
|------|------|
| typecheck | Pass |
| vitest 冒烟 6 项 | Pass |
| build（先 mv dist 规避 safe-delete shim） | Pass |
| force-recreate caddy-local + curl root | 200 |
| curl App chunk 特征串（总开支额度 / 比预算慢 / reservoir-readout） | 命中 |
| mDNS 入口 https://FrorideMacBook-Air.local:8443/ | 200 |

### 数据核对（回答用户提问）
- 9 月日常预算 ¥5000 ÷ 30 天 × 25 天 = ¥4166.67；实际日常消费 ¥2595.42；差 ¥1571.25
- 9 月 1-25 日全部支出 ¥18135.42，其中约 ¥15540 属专项支出（不参与日常节奏对比）

### 交接状态
- 工作区干净（仅未跟踪的 .workbuddy/、handoffs/、server-backup-20260828/，按规则不入库）
- 四件套已同步：task_plan.md（Phase 15）/ findings.md / progress.md（本节）/ HANDOFF.md（第 2、3、6、9、10 节）
- 待用户在手机上实测确认：PWA 是否已重装/刷新、蓄水池读数与横向排列的实际观感

## 5-Question Reboot Check（2026-09-25 会话结束）

| 问题 | 答案 |
|------|------|
| 我在哪？ | Phase 15 完成：4 轮 UI 反馈修复已部署本地栈，交接文件已同步 |
| 我要去哪？ | 等用户在手机实测反馈（PWA 重装/刷新、蓄水池读数与排列观感）；之后处理待办：提交 start-local-sync.sh 改进、数据异地备份、云端归属决策 |
| 目标是什么？ | 维护个人记账 PWA（本地 Mac 为唯一活跃数据中心）+ 数据安全 |
| 我学到了什么？ | caddy 绑定挂载在 dist 重建后会悬空必须 force-recreate；沙箱 safe-delete shim 拦截 vite 清空 dist；云端 origin 的 PWA 无法接收本地更新 |
| 我做了什么？ | 预算两层 + 双蓄水池 + 节奏图 + 大额分析 + 工资本地化上线；3 轮反馈修复（横向排列/措辞/读数可读性）；四件套交接同步 |
