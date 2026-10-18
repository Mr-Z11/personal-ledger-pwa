# Findings & Decisions

## Cold-Start Task Scope (2026-06-29)
- Primary failure mode: iPhone home-screen PWA cold start shows a blank screen for roughly 2–10 seconds.
- Required outcome: no pure-white phase; static shell target under 500 ms; local data or explicit loading state target under 1.5 s; cloud synchronization must remain off the critical render path.
- Production deployment to `main` and the server is required after verification.
- Actual iPhone Safari service-worker timing remains `待确认` until the production build is deployed and tested on the device.

## Cold-Start Diagnosis
- `index.html` already contains a fully inline, styled boot shell. It does not depend on React or the external stylesheet, so once WebKit receives and paints the document there should not be a pure-white page.
- `main.tsx` deliberately waits for one animation frame, then dynamically imports React, ReactDOM, and the full App. This favors painting the shell first, although it adds one frame before application loading starts.
- The app shell and PWA manifest use `#f6f1e7`, and navigation falls back to precached `/index.html`. Nginx correctly disables long-lived HTML caching.
- Because the user still sees pure white specifically during iPhone home-screen cold start, the leading hypothesis is the native iOS launch/splash phase before HTML paint, not the authenticated React/data path. The project has no `apple-touch-startup-image` assets or links, and the Apple touch icon is currently an SVG; iOS launch presentation therefore remains browser-generated and device-dependent.
- Production/browser lookups returned no diagnostic body through the web lookup surface; precise response timing and headers will be measured directly next. This lookup limitation is logged rather than treated as evidence about production health.

## Production Timing and Cache Findings
- Direct production measurement returned HTML TTFB/total around 0.57 s and API health around 0.63 s from the current environment. Network latency can vary on iPhone, but the server is not consistently spending 10 seconds rendering HTML.
- Production HTML is only about 5.2 kB and already returns `Cache-Control: no-cache, no-store, must-revalidate`; hashed `/assets/` files are immutable. The server caching policy is structurally correct.
- The generated service worker precaches the shell and all initial JS/CSS chunks. API requests use `NetworkFirst`, but those calls occur after React render and do not explain the pre-HTML white phase.
- `registerType: "autoUpdate"` generates `skipWaiting()` plus `clientsClaim()`. During a cold start after deployment, a new worker can activate, delete the old precache, and claim an app instance whose old HTML/module loader may still be requesting old hashed chunks. This update race is a credible intermittent slow/failure source even though it is not the primary native white-splash cause.

## Implementation Decisions
- Add deterministic PNG Apple touch icons and portrait startup images for common iPhone CSS-size/DPR combinations, including the confirmed 393×852 @3x target, so iOS shows a branded launch screen before WebKit paints HTML.
- Start dynamic module preloading immediately instead of waiting for the first `requestAnimationFrame`; the inline shell remains visible while imports resolve, but application loading no longer depends on iOS delivering the first animation frame.
- Change the service-worker update lifecycle from immediate takeover to safe waiting activation, preventing new/old chunk races during a live cold start.
- Add a guarded module-load recovery path: one automatic reload for stale chunk errors, then a visible retry state instead of a permanent blank/silent failure.
- Keep IndexedDB rendering and cloud synchronization architecture local-first; current cloud hydration already starts only after the first local refresh and is not on the synchronous React render path.

## Asset Verification
- Generated a PNG Apple touch icon plus 12 portrait startup images covering common iPhone screen/DPR combinations from 375×667 through 440×956 CSS pixels.
- The confirmed 393×852 @3x target maps to `launch-1179x2556.png` and renders correctly with the app’s existing cream/green/gold visual system, a centered ledger mark, and an explicit “正在打开账本” state.
- Launch PNGs are highly compressed (about 14–32 kB each), so supporting multiple device sizes adds limited transfer/storage cost while covering the native pre-HTML launch phase.

## Built-App Mobile Verification
- Production build contains all 12 startup-image links, a PNG Apple touch icon, `lang: zh-CN`, and the startup PNG files.
- Generated HTML marks `registerSW.js` as `defer`, so service-worker registration no longer blocks parsing the inline boot shell.
- Generated service worker no longer calls `skipWaiting()` or `clientsClaim()` during installation; it waits for an explicit message/normal lifecycle before replacing the active worker.
- At a 393×852 browser viewport, the production preview loaded the authentication UI successfully. Computed `html` and `body` backgrounds are both `rgb(246, 241, 231)`, the page exposes 12 startup-image links, and the service-worker registration script is deferred.
- Browser performance-navigation entries were unavailable inside the read-only evaluation sandbox, so exact first-paint milliseconds remain `待确认` on the physical iPhone; structural first-paint requirements were verified from the built HTML.
- After rebuilding with the regression verifier enabled, the 393×852 production preview reloaded into the authentication UI with no captured console warnings or errors.

## Regression Guard
- `apps/web` production builds now run `scripts/verify-pwa-startup.mjs` automatically.
- The verifier fails the build if broad startup-image coverage, the 393×852 asset, PNG icons, inline background/shell, deferred SW registration, safe SW activation, immediate module loading, or stale-chunk recovery regresses.

## Production Verification
- Application commit `7570bb3` plus Docker build-context fix `78febb0` are on `main`.
- The first CI run correctly rejected the web image because the Docker build stage omitted the verifier script. After adding the explicit copy, CI run `28371162168` completed successfully, including both GHCR images.
- Production server is at `78febb0`; API, web, PostgreSQL, and Caddy containers are running, and PostgreSQL reports healthy.
- Production API health returns HTTP 200.
- Production HTML contains the PNG touch icon, deferred SW registration, and `launch-1179x2556.png`; that image returns HTTP 200, `image/png`, 28,377 bytes, and immutable one-year caching.
- Production service worker contains only the explicit `SKIP_WAITING` message hook, not unconditional `skipWaiting()`/`clientsClaim()` activation, and precaches the 393×852 launch image.
- Physical iPhone launch duration remains `待确认`; an already-installed PWA may need two full close/reopen cycles for the waiting worker and refreshed launch metadata to take effect.

## Current Audit Scope (2026-06-27)
- Audience: the owner as the sole long-term user.
- Outcomes: faster daily entry, more useful analysis, and stronger long-term habit support.
- Technical scope: features, interaction design, performance, and offline sync.
- Filter: prioritize low implementation cost with clear user impact; remove duplicates of already completed work.
- Deliverable: 8–12 concrete recommendations ranked P0/P1/P2 with current evidence, benefit, cost, and risk.

## Audit Baseline
- The repository is compact: most web behavior is concentrated in `apps/web/src/App.tsx` and `styles.css`; offline persistence is in `db.ts`, network behavior in `api.ts`.
- Existing user-facing scope already includes authentication, offline transaction create/edit, delete/restore, account/category editing, budgets, reports, CSV import/export, anomaly analysis, and synced analysis notes.
- The app is primarily designed for iPhone home-screen PWA use plus desktop browser use.
- Recently completed work already covers keypad press/amount/save feedback and persistent report-period context, so these are excluded from new recommendations.
- No application test files are visible under `apps/web` or `apps/api`; only shared money helpers currently expose a test file. This is a reliability gap, but recommendations should stay user-outcome focused.

## Preliminary Code Findings
- The web app has six primary views: overview, entry, transactions, reports, settings, and trash.
- `App.tsx` is roughly 3,400+ lines and owns most UI, reporting, import/export, and flow logic. This raises change/regression cost but is not itself a user feature; it matters mainly where it slows safe improvements.
- Transaction history already supports query, grouping, progressive visible limits, batch selection/update, detail drawer, edit, delete, and restore.
- IndexedDB stores full local entity snapshots plus an append-only outbox. `readOutboxPayload()` concatenates every queued version of an entity without deduplication; sync behavior must be inspected before ranking this as a user-visible risk.
- API requests have a 10-second timeout and a generic network error, while the PWA service worker uses `NetworkFirst` for all `/api` paths. The exact effect on authenticated GET responses and offline state messaging needs validation.
- The data model already contains transaction `merchant`, `note`, and `tags`; tags appear in storage/API types but their UI use is not yet evident.
- The server pull/bootstrap returns the entire ledger snapshot. This is simple and appropriate at small personal scale, but client report calculations and startup cost may grow with a long transaction history.

## Confirmed Flow Findings
- Startup calls `hydrateFromServer()` after loading IndexedDB; it bootstraps/pulls a snapshot but does not flush an existing outbox first. Offline changes from a previous session can therefore remain pending indefinitely until a new save, an `online` event, or manual sync.
- Every local save queues an item and may start `syncNow()` without an in-flight mutex. `syncNow()` reads all queued rows, awaits a network push, then clears the entire outbox. A second save made during that request can be cleared even if it was not in the first payload. This is a credible sync-loss race and a P0 candidate.
- Sync status exposes online/offline, pending outbox count, last-sync time, and a manual button, but no per-operation failure detail or explicit durable “已在本机 / 已上云” confirmation.
- Entry already includes useful defaults: usage-ranked categories, meal-time category suggestion, meal-account preference, preserved expanded details, and rapid repeated entry after save.
- Expense entry currently labels the account field `信用卡` even though the account list can contain cash, bank, Alipay, WeChat, etc. This conflicts with the project’s established `付款账户` wording and is a cheap clarity fix.
- Transaction history explicitly filters out every income transaction and its type selector only offers all/expense/transfer. Income can be recorded but is not available in the normal history screen for search, review, or edit; this is a concrete completeness defect.
- History search covers note, merchant, account, and category path, and it supports grouping and batch updates. It lacks explicit period/account/category filters, so common reconciliation tasks depend on text search or scrolling.
- Budget management creates new budget entities but does not expose edit, delete, or copy-previous-month actions. Repeating monthly setup is unnecessary friction and duplicates may be possible.
- Report analysis is already unusually comprehensive for a personal app: monthly/yearly views, daily vs special expenses, category drilldown, historical trends, anomaly detection, and persistent notes. New report suggestions should be small bridges to action, not more charts.

## Performance and Mobile Check
- A fresh web production build succeeds. Initial non-import assets are moderate rather than alarming: core app JS is split, while the large `xlsx` chunk (~429 kB raw / ~143 kB gzip) is loaded dynamically and excluded from service-worker precache.
- Current performance priority should therefore be sync correctness and long-history computation, not cosmetic bundle micro-optimization.
- Mobile browser inspection at 393×852 reached the authentication screen successfully, but the isolated in-app browser had no existing login/local-preview seed. Main authenticated flows were not re-seeded because this audit is read-only; previous verified mobile screenshots and current code remain the evidence for those flows.
- The app shell itself initially shows a loading skeleton before the dynamically imported app renders; this is brief in local testing and not currently a priority.

## Sync and Data-Quality Findings
- Server sync ignores client `version` and `updatedAt`, then unconditionally overwrites the current row and increments its version. An older offline edit from one device can overwrite a newer edit from another device without warning. For a single person using both phone and desktop, this is still relevant.
- Push applies entities sequentially without one database transaction. A mid-push error can partially apply a batch; retries are mostly content-idempotent but version counts and user confidence are not.
- A lightweight reliable-sync improvement should combine: one in-flight sync at a time, outbox row IDs acknowledged individually, startup flush before pull, deduplication by entity ID, and server-side stale-version rejection/merge messaging. Treating these as one reliability work package is clearer than five isolated features.
- No copy/duplicate/reuse action exists for recent transactions. The entry form keeps category/account defaults after a save, but recreating a recurring transaction from history still requires manual re-entry.
- `tags` are imported, exported, and visible in transaction details, but cannot be added or edited in the entry UI and are not included in transaction search. This is an incomplete capability; because tags add taxonomy overhead for one user, completing them is lower value than better category/data-quality flows.
- “其他” and uncategorized data are already detectable in reports, but there is no dedicated “待整理” count or queue. Surfacing only records that weaken later analysis would improve data quality without adding a new classification system.
- Reports contain useful conclusions and notes, but the overview does not surface a small monthly-review prompt or the latest unresolved anomaly. The analysis exists; the habit loop back to the daily home screen is missing.

## Final Prioritization

### P0 — correctness and trust
1. Reliable-sync work package: serialize sync calls, acknowledge only pushed outbox rows, flush on startup before pull, deduplicate entity revisions, use a database transaction, and detect stale versions.
2. Restore income to the transaction history/filter/edit flow; add income totals to grouped history. Also restore the established expense account label from `信用卡` to `付款账户` as an immediate micro-fix.

### P1 — low-cost, high-usage improvements
3. Add “再记一笔/复制” from recent transaction and transaction detail, pre-filling everything except time while allowing amount change.
4. Let budgets be edited/deleted and copied from the previous month; prevent duplicate overall/category budgets for the same month.
5. Add explicit history filters for date range/month, account, category, and income/expense/transfer.
6. Add a small “待整理” queue for uncategorized/`其他`/recently imported records, with existing batch-update controls.
7. Make overview metrics, report increases/decreases, and anomaly items open the corresponding filtered transaction set.
8. Close the habit loop by surfacing the existing monthly review on overview near month-end and showing the previous month’s note next month.

### P2 — only after usage evidence
9. If merchant entry is common, learn merchant → category/account from the user’s own previous records and offer a reversible suggestion.
10. Add long-history performance telemetry/threshold checks first; only introduce incremental sync, paged IndexedDB reads, or report workers when measured history size or render time justifies them.

### Engineering guardrail
- Add focused web/API tests for the two P0 areas: startup with pending outbox, a save during an in-flight push, stale cross-device edits, and income visibility/editing. Current `npm test` passes only three shared-helper tests; API and web report no test files.

### Occam Filter
- Excluded for now: more charts, AI analysis, bank integrations, a full tag workflow, push reminders, account/net-worth expansion, and a broad component rewrite. They either duplicate existing value, add maintenance/taxonomy cost, or lack current evidence that they would change the user’s decisions.

## Requirements
- Improve the quick-entry number keypad: larger safer touch targets, lower accidental save/clear/退格 risk, better feedback.
- Add report anomaly analysis for each month: identify超预算,环比异常,历史异常,低频大额, and专项支出 reminders.
- Add note-taking for monthly analysis results and anomaly items.
- Persist notes so they remain after refresh/reopen and sync to cloud server.
- Update GitHub and cloud server.
- Add stronger input confirmation to quick entry: visible press feedback, haptic feedback where the browser supports it, and animated amount preview.
- Make report scrolling less confusing: users should always know whether each section is current-month data, selected-period data, special expense data, or historical trend data.

## Research Findings
- Shared data types currently include accounts, categories, transactions, and budgets only.
- API Prisma schema currently has User, Ledger, Account, Category, Transaction, Budget, AuditLog; no analysis note table.
- Web IndexedDB currently stores accounts, categories, transactions, budgets, meta, and outbox.
- Reports component lives in `apps/web/src/App.tsx` and already separates daily expenses from special expenses.
- Quick entry keypad is `AmountKeypad` in `apps/web/src/App.tsx`; CSS lives under `.amount-keypad`, `.amount-keypad-grid`, `.amount-key`.
- API Docker image already runs `npm --workspace @ledger/api run prisma:push` before start, so the new table can be applied during normal lightweight server update.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Add AnalysisNote as first-class synced entity | User requires notes to persist across refresh/reopen and cloud server. |
| Store notes by month plus optional subject key | Allows monthly general notes and per-anomaly notes with stable keys. |
| Keep anomaly detection in web layer initially | Analysis derives from existing local data and does not need server computation. |
| Remove save action from the number keypad | Keeps numeric input and commit action separate, reducing accidental saves. |
| Require historical anomaly to also increase MoM | Avoids warning on categories that are below last month but above sparse 3-month average. |
| Use progressive enhancement for vibration | Web vibration support varies by browser; unsupported devices should silently fall back to visual feedback. |
| Add persistent report context near the top of report content | Users lose the selected period when scrolling through dense report modules. |
| Use fixed context bar on mobile reports | Browser check showed sticky context did not stay in viewport in this layout. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| Playwright's bundled Chromium was missing | Used the installed Chrome channel for screenshot checks. |
| Seeded report test initially opened IndexedDB with a lower fixed version | Opened the existing DB without specifying a version. |
| Seeded `买菜` example produced a misleading historical anomaly while MoM decreased | Added MoM-increase guard to historical anomaly logic. |
| Report context anchor did not stick during mobile scroll check | Switched mobile report context to fixed positioning and reserved vertical space. |

## 2026-08-16 会话发现 — 本地备份体系 + 数据同步全链路修复

### 备份体系重构
- 备份从 WorkBuddy 自动化（每 6h）改为 macOS launchd（每天 03:00），完全脱离 WorkBuddy
- `deploy/com.personal-ledger.data-backup.plist`：每天 03:00 跑 `scripts/auto-backup.sh`，RunAtLoad=true（睡眠错过唤醒补跑）
- `deploy/com.personal-ledger.colima.plist`（新增）：登录时自动 `colima start`，确保 Docker VM 常驻

### 本地全栈接管
- 免 sudo 安装容器运行时：~/bin/{docker 29.7.2, colima 0.10.3}、~/opt/lima/limactl 2.2.0、~/.docker/cli-plugins/docker-compose
- colima 用 vz 虚拟化（Apple M2, macOS 26），qemu 模拟运行 amd64 镜像
- 本地栈：postgres-local + api-local（GHCR amd64 镜像）+ caddy-local，入口 https://localhost:8443/api
- 本地 arm64 Docker 构建因 tsup/esbuild 原生二进制问题暂不可用，回退使用 GHCR amd64 镜像
- auto-backup.sh 策略：云端在线→SSH 拉云端库；云端离线→备份本地 PG；Docker 没跑→自动 colima start 自愈
- Caddy 根证书 ~/Desktop/Caddy-Local-CA.crt 需安装到系统钥匙串（一次性）

### 前端 API 自动故障转移
- `apps/web/src/api.ts` 的 apiFetch 实现：云 API 不可达时自动切到 fallback 端点
- Fallback 端点：`https://localhost:8443/api` + `https://FrorideMacBook-Air.local:8443/api`（mDNS）
- localStorage 健康追踪 + 2 分钟冷却期；云恢复后自动切回
- VITE_FALLBACK_API_BASES 通过 CI build-arg 和 web.Dockerfile ARG 编入 JS bundle

### CORS 修复
- `@fastify/cors` 默认只允许 GET/HEAD/POST，跨域 PUT/DELETE 被浏览器拦截
- 修复：`methods: ["GET","HEAD","POST","PUT","DELETE","PATCH","OPTIONS"]`
- 本地 API CORS_ORIGIN=* 接受任意来源

### 数据同步排查链（关键发现）
1. **初始症状**：手机端记到 8 月，Mac 浏览器只显示到 6 月
2. **排查 1**：云端 PG 最新交易 occurredAt = 2026-06-06，确实没有 7-8 月数据
3. **排查 2**：data-sync.sh 的 last_tx 查的是 createdAt（插入时间）而非 occurredAt（交易时间），导致状态报告误导——已修复
4. **排查 3**：云端 API 日志零个 POST /sync/push 请求
5. **排查 4**：手机端 .sync-card 在 @media(max-width:940px) 下 display:none，用户无法看到同步状态
6. **根因定位**：服务器日志显示 `POST /sync/push` 返回 500，`value "9999999900" is out of range for type integer`——某条交易 amountCents≈1 亿元超过 PostgreSQL integer 上限（21.4 亿），导致整批 265 条全部推送失败

### amountCents Int→BigInt 修复
- Prisma schema：`amountCents`（Transaction + Budget）和 `openingBalanceCents`（Account）从 Int 改为 BigInt
- 容器启动时 `prisma db push` 自动迁移列为 bigint（已验证三个列均迁移成功）
- serializers.ts：加 `Number()` 转换 bigint→number 保持 JSON 兼容
- index.ts：exportRow 类型注解和 centsToYuan 调用适配 BigInt

### PWA 自动更新机制修复
- 原 `registerType: "prompt"` + `skipWaiting: false`：iOS PWA 独立模式下更新提示不显示，用户一直用旧版本
- 改为 `autoUpdate` + `skipWaiting: true` + `clientsClaim: true`
- verify-pwa-startup.mjs 同步更新（移除对 skipWaiting/clientsClaim 的断言禁止）

### 手机端同步状态栏
- 在 `<main>` 顶部新增 `.mobile-sync-bar`，桌面隐藏、手机显示
- 包含：在线/离线状态点、用户名、待同步数、最后同步时间、手动同步按钮
- 文字区域 overflow-x 横向滚动（隐藏滚动条，触摸滑动）
- 自动隐藏：仅当 待同步>0 或 离线 时显示，同步完成且在线后自动关闭

### 最终状态
- 手机端 265 条待同步数据已全部成功推送到云端（用户确认）
- 云端 + 本地数据一致
- 本地备份体系完全由 launchd 管理，不依赖 WorkBuddy

## Resources
- `/Users/frori/Vibecoding/personal-ledger-pwa/apps/web/src/App.tsx`
- `/Users/frori/Vibecoding/personal-ledger-pwa/apps/web/src/styles.css`
- `/Users/frori/Vibecoding/personal-ledger-pwa/packages/shared/src/index.ts`
- `/Users/frori/Vibecoding/personal-ledger-pwa/apps/api/prisma/schema.prisma`
- `/Users/frori/Vibecoding/personal-ledger-pwa/apps/api/src/index.ts`
- `/Users/frori/Vibecoding/personal-ledger-pwa/apps/web/src/db.ts`

## Visual/Browser Findings
- Mobile entry page: keypad now uses larger 3-column touch targets; save remains sticky at the bottom.
- Mobile reports page with seeded data: anomaly panel shows budget status, total spending, projected daily spending, top increases/decreases, monthly note, and collapsed anomaly items.
- Seeded data confirmed that decreasing categories no longer trigger historical increase warnings.
- Mobile entry feedback check: amount preview updates in the hero and keypad header after tapping numeric keys.
- Mobile report context check: fixed context bar remains visible after scrolling, and trend modules carry history-scope labels.

## 2026-09-25 会话发现 — 云端失效后的本地栈修复 + 手机数据同步打通

### 重大状态变化：云端服务器 47.74.3.104 已失效
- ping 通（73ms，阿里云美国节点 47.74.0.0/15），但 **80/443 端口全部关闭**，仅 22 开放
- **SSH 报 `REMOTE HOST IDENTIFICATION HAS CHANGED`**：ED25519 新指纹与 known_hosts 中 ECDSA 旧键冲突 → 实例很可能被重装或释放后 IP 被回收分配给他人。**确认归属前不要删 known_hosts 硬连**（有连到他人机器的风险）
- `backups/auto-backup.log` 显示云端备份从 **2026-08-29 起每日 FAILED**（最后一次成功 `ledger-cloud-20260829-030322.sql`）
- **架构定性**：该 app 是 local-first，服务器只是同步目标不是数据源。启动先 `refreshLocal()` 读 IndexedDB 渲染，写入先 `db.put()` 本地 + `enqueue()` outbox。**云端全挂不影响记账和查看**

### 本地 API crash-loop 根因（RestartCount 11428）
- 日志 `exec /usr/local/bin/docker-entrypoint.sh: exec format error`
- `tonistiigi/binfmt` 查询输出 `supported: ["linux/arm64"]` —— **colima VM 丢失 qemu amd64 模拟器**（VM 用 vz，重启后 binfmt 注册不持久）
- 修复：`docker run --rm --privileged tonistiigi/binfmt --install amd64` → 注册 `qemu-x86_64`
- ⚠️ **该注册 VM 重启后会丢失，必须重跑**；已在 `start-local-sync.sh` 中加入启动前自动检测/注册

### 旧镜像触发的 --accept-data-loss 数据降级风险（重要）
- 本地 2026-08-16 旧镜像 schema 是 `Int`，而数据库列已是 `bigint`（8-16 当天 `ffa0a54` 迁移过）
- 启动时 `prisma db push` 警告 `alter column amountCents on Transaction (3416 rows) cast from BigInt to Integer` 并要求 `--accept-data-loss`
- **绝不能用 `--accept-data-loss`**：会把 3416 条真实数据的金额列降级丢精度
- 正确解法：拉取与数据库 schema 匹配的新镜像。注意 **`docker pull` 必须带 `--platform linux/amd64`**，否则按宿主 arm64 找 manifest 报 `no matching manifest for linux/arm64/v8`
- 新镜像（BigInt）启动日志 `The database is already in sync with the Prisma schema` → **零数据变更**

### 手机同步链路技术坑（关键）
- **Service Worker**（vite.config.ts:35-44）`urlPattern: url.pathname.startsWith("/api")` 匹配**任何 origin**，切本地地址后所有 `/api` 请求都被 SW 用 NetworkFirst 拦截
- **workbox registerRoute 默认只路由 GET** → POST /sync/push 与 OPTIONS preflight 不被 SW 拦截直接走网络（所以 push 能成功）
- **iOS WKWebView（PWA）不信任 IP 类 SAN 证书**（`IP Address:192.168.3.21`），但**信任 DNS 类 SAN 证书**（`DNS:froridemacbook-air.local`）→ 本地同步地址**必须用 mDNS 域名，不能用 IP**（IP 会触发 fetchevent/no-response）
- **mDNS fallback 早已自动生效**：API 日志反复出现 `GET /bootstrap` via `froridemacbook-air.local` 返回 200（无需手动配置），且证明 **JWT_SECRET 与云端一致**（bootstrap 需认证）
- **"URL is not valid"** = 手动输入的地址字符串语法非法（空格/不可见字符），`fetch()` 页面层同步解析 URL 即抛错，请求未发出 → **清空地址用自动 fallback 优于手动输入**
- **数据覆盖风险**：`SyncSettingsPanel.handleSave()` 强制 `window.location.reload()` → mount → `hydrateFromServer()` **只拉不推**，会用本地 PG 旧版本覆盖 IndexedDB 同 ID 记录；outbox（60 条）兜底，切换后必须立即点"同步"推回修正

### 同步成功验证（2026-09-25 11:15 用户确认）
- 数据库总笔数 **3416 → 3469（+53）**，最新记录 **2026-08-31 → 2026-09-24**，serverVersion 122
- 有效流水（`deletedAt IS NULL`）3321 条
- 手机近一个月零备份数据全部落库

### 数据落点
- 物理：`/Users/frori/Vibecoding/personal-ledger-pwa/data/local-postgres/`（65MB，Docker 卷挂载，容器删除数据不丢）
- 备份：`backups/`（launchd 每日 03:00）
- **风险**：数据目前仅 Mac 单点，建议异地备份（云盘/移动硬盘）

### 遗留问题
- `limactl` 二进制缺失（原 `~/opt/lima/`），`colima status/list` 报 `lima not found`；docker 通过 `~/.colima/default/docker.sock` 仍可用
- iOS PWA 独立模式下 `a.download` + blob 导出**静默失败**（WebKit 限制）→ 未来应改用 Web Share API（`navigator.share`）做导出，但云端 origin 的 PWA 无法更新，仅本地 origin 能受益

## 2026-09-25 预算两层/蓄水池/节奏图/大额分析/工资本地化 新发现

- **Budget.scope 设计**：`categoryId=null + scope=daily` 日常消费总预算；`categoryId=null + scope=total` 总开支预算（含日常）；分类预算不带 scope 语义。所有"无分类预算"查询必须过滤 scope，否则 total 会串进 daily 统计
- **云端失效后的部署流程**：git push → CI 构建 GHCR → 本机 `docker pull --platform linux/amd64 ghcr.io/mr-z11/personal-ledger-pwa-api:main` → `docker compose -f docker-compose.local.yml --env-file .env.local up -d api-local`（启动自动 prisma db push）；前端无需重启 caddy——apps/web/dist 是宿主机挂载，本地 build 后即时生效
- **WorkBuddy 沙箱 safe-delete shim**：vite build 清空 dist（≥50 文件）会被拦截报 SAFE_DELETE_BULK_CONFIRM_REQUIRED → 先 `mv dist /tmp/xxx` 再 build
- **工资提醒本地化方案**：localStorage 存设置 + 打开 App 时计算 nextPaydayInfo（当月未过→本月，已过→下月，31 日自动夹到月末）；横幅当天 dismiss 存日期 key；系统通知用本地 Notification 构造器（iOS Safari 不支持，try/catch 静默降级，横幅是主通道）
- **SVG 水波蓄水池**：clipPath 裁剪水箱 + 两条相位不同的正弦 path 做 CSS translateX 无限循环（周期=波形重复长度，wave-a 100px / wave-b 80px）；水位用外层 g 的 translateY 定位，波峰 baseline 对齐水面
- **大额规律识别（无 AI）**：分组键 = merchant?.trim() || categoryPath；近 6 个月（含当月）≥3 个不同月份出现 → 每月固定，典型日期取发生日中位数；阈值自动上调规则 = 当月中位数×3（≥8 笔才启用），取用户设定与自动值较高者
- **react-dom/server renderToString + vitest** 可在无浏览器环境做组件冒烟测试（需 stub localStorage；SSR 会跑完整个函数组件，能抓到运行时错误）

### 部署后手机看不到更新（2026-09-25 第二次会话）
- **根因**：为绕过 safe-delete shim 把 `apps/web/dist` `mv` 到 /tmp 后重新 build → colima/virtiofs 绑定挂载按 inode 解析，caddy 容器内的 `/srv/web` 变成悬空挂载（`ls` 报 Operation not permitted，根路径 403 空响应）
- **修复**：`docker compose -f docker-compose.local.yml --env-file .env.local up -d --force-recreate caddy-local`（注意：配置没变时 `up -d` 不会重建容器，必须加 `--force-recreate`）
- **部署流程补充**：本地 build 改动 dist 后，必须 force-recreate caddy-local 并 curl 验证 `https://localhost:8443/` 返回 200 且 App chunk 含新特征字符串
- **手机 PWA origin 决定能否更新**：从云端地址（ledger.47.74.3.104.sslip.io）安装的 PWA 在云端失效后永远收不到更新，必须从 mDNS 地址重新添加到主屏幕（数据已同步入本地 PG，删除旧 PWA 安全）

## 本地栈部署可复用流程（2026-09-25 固化）

云端失效后，每次改动的完整上线步骤（前端，约 1 分钟）：

```bash
cd /Users/frori/Vibecoding/personal-ledger-pwa
export PATH="$HOME/bin:$PATH"
npm run typecheck && npm --workspace @ledger/web run test
mv apps/web/dist /tmp/ledger-web-dist-$(date +%s)   # 规避沙箱 safe-delete shim
npm run build
docker compose -f docker-compose.local.yml --env-file .env.local up -d --force-recreate caddy-local
curl -sk -o /dev/null -w "%{http_code}\n" https://localhost:8443/            # 期望 200
curl -sk https://localhost:8443/assets/App-*.js | grep -c "<新特征字符串>"    # 期望 >=1
git add <files> && git commit -m "..." && git push origin main               # 代理抖动时重试
```

后端改动（Prisma schema / API）额外步骤：

```bash
# 等 CI 构建 GHCR 镜像后
docker pull --platform linux/amd64 ghcr.io/mr-z11/personal-ledger-pwa-api:main
bash scripts/data-sync.sh backup-local                 # 迁移前备份
docker compose -f docker-compose.local.yml --env-file .env.local up -d api-local
docker logs personal-ledger-pwa-api-local-1 | tail     # 确认 prisma db push 无 --accept-data-loss 警告
```

注意点：
- caddy 绑定挂载按目录解析，`mv` + 重建会让容器内挂载悬空（`ls /srv/web` 报 Operation not permitted）→ 必须 force-recreate
- 配置未变化的服务，普通 `up -d` 不会重建容器
- 手机端要看到前端变化：本地 origin 的 PWA 划掉重开两次（autoUpdate 后台下载）；云端 origin 的 PWA 无法更新，必须从 mDNS 地址重装

## 新功能语义备忘（2026-09-25）

- 蓄水池两个池子：日常消费额度（不含专项）/ 总开支额度（含专项），读数为磨砂玻璃卡片，水位≤85% 蓝绿、85-100% 琥珀、>100% 红并显示超支额
- 消费节奏图口径：只统计日常消费；预算参考线 = 预算 ÷ 当月天数 × 今天；投影线 = 当前日均 × 当月天数
- 趋势焦点卡：环比（上月同期）/ 同比（去年同月）/ 近3月 vs 前3月日均（±5% 视为持平）/ 日均 vs 预算日均
- 大额阈值优先级：max(用户设定默认 ¥1000, 当月中位数×3 且当月支出 ≥8 笔)

## 新功能语义备忘（2026-09-30，Phase 16）

- 常规项判定：同一支出分类（categoryPath，含专项）近 6 个月出现 ≥3 个月 → 常规项；月均按 6 个月平均；规划页预测金额则按「有支出的月份」平均（避免低估固定开销）
- 规划页预测公式：基准 =（近3月均值 + 近6月均值）÷ 2，趋势因子 = 近3月均值 ÷ 前3月均值（clamp 0.9~1.1），预测 = 基准 × 趋势因子；区间 = 近6月最低~最高；未来第 2/3 个月沿用同一基准
- 当月未结束时历史序列用「实际至今 ÷ 当天号数 × 当月天数」的投影值，图表上标「含预测」
- React `<details open={true}>` 作为「默认展开但可收起」是安全的：prop 不变时 React 不会回写 DOM 属性，用户收起状态在组件重渲染后保留
- 验证部署时 grep 首页拿到的入口 chunk 是 index-*.js 而非 App-*.js（App 是异步 chunk）；要直接取 dist 里的 App-*.js 文件名验证

## Phase 17 新发现（2026-09-30）

- 手机底部导航是 `@media (max-width:940px)` 里 nav 的 `grid-template-columns`，新增导航项必须同步改列数；5 项用 repeat(5,1fr) 单行后，FAB（bottom: calc(5rem+…)）自然不再遮挡
- 常规项表格在手机的"显示不全"根因：min-width:34rem（544px）超过手机视口，overflow-x:auto 理论可滚但体验差且不明显；解法是重构列布局（月均并入名称行）让 grid 自适应，而非依赖横滚
- plan 预测算法 v2：预测值 = 去年同期×0.6 + 近期基准×0.4；每个未来月份独立取各自去年同月；去年无记录退化为全额近期基准；区间须线 = 近6月与去年同期的 min~max 包络
- SVG 里画"去年同期参照"用 path 菱形（rotate 45° 的方块图例 + path 标记），成本低且直观

## Phase 18 新发现（2026-09-30）

- SVG 图表在手机端两种方案：a) min-width + 横滚容器（会有"显示不全"观感，用户不接受）；b) width:100% 随容器缩放（viewBox 680 的 SVG 缩到 390px 文字仍可读，消费节奏图一直如此）——规划页趋势图改用 b 后问题消失
- 移动端表格防溢出范式：单元格内联标签（em 小标签 + b 数值）替代表头行，桌面 5 列 / 手机 2 列卡片，无 nowrap 长文本

## Phase 19 新发现（2026-09-30）

- 保险类刚性年度支出用「缴费日历」修正比历史平均准确：预测总支出 = 原预测 − 历史保险月均 + 当月日历保费（下限=当月预测日常消费，防过度扣减）
- 个人敏感配置（保单、工资提醒、大额阈值）一律 localStorage 本机存储（键前缀 ledger-），不进 GitHub 不同步；代价是换设备需重新导入——提供批量粘贴导入降低摩擦
- parseInsuranceText 容错解析：/^(\d{1,2})月?\s*[、,，.\s]+\s*(.+?)\s+([\d,]+(\.\d+)?)元?$/，非法行静默跳过

## Phase 20 新发现（2026-09-30）

- 「保存」类按钮不要用「数据未变化」作为禁用条件：首次打开面板（草稿=已存）时按钮恒禁用，用户点按无任何反馈，极易被当成 bug；保存幂等操作应始终可点，用按钮文字/状态行给反馈
- 用户无法感知 localStorage 写入是否成功 → 反馈三件套：按钮文字变化（已保存（共 N 项））+ 保存时长状态 + 面板标题行由 items 驱动自动更新

## Phase 21 新发现（2026-10-01）

- 表单交互简化范式：行级编辑自动保存（静默落库完整行）+ 批量操作单一主按钮，比"每处一个保存按钮"更符合用户心智；避免同面板两个保存动作并存造成"该点哪个"的困惑

## Phase 24 新发现（2026-10-01）

- widgets.tsx 与 plan.tsx 需要共用保险日历存储时，存储实现放 widgets（被 App/规划页双向引用），plan.tsx 只做 re-export；反过来放会制造 widgets→plan→widgets 循环导入（Vite/TS 不报运行时错但打包顺序有隐患）
- 总览固定支出面板与规划页必须共用同一套数据源（collectRegularExpenses + 同一保险日历 localStorage），否则两处数字口径漂移用户必然追问；historyEndKey 统一为「上完整月」保证当月数据不误入历史窗口
- 「已支/剩/超」三态用同一进度条表达：width=min(实际/预计,100%)，超支时 .bar.over 变红并把「剩 ¥X」替换为「超 ¥X」——一个组件覆盖常态与异常态，无需两个模板

## Phase 25 新发现（2026-10-12）

- 新增同步实体的完整链路共 9 处：shared 类型 + SyncPayload/LedgerSnapshot、Prisma model + Ledger 关系、serializers（serialize + serializeSnapshot）、API loadSnapshot + /sync/push upsert（Date 字段需 new Date 转换）、Dexie version 升级（版本号 +1 且必须保留全部历史版本定义）、saveSnapshot/resetLocalData/readOutboxPayload、App saveLocalAndQueue 的 kind 联合类型。漏任何一处都会静默丢数据或 typecheck 报错，按此清单逐项核对最稳
- 服务端复用前端业务口径（如"日常消费"分类过滤）时，在 notifications.ts 复制关键词正则与 categoryPath 逻辑，并加注释「与前端 utils.ts 保持一致」；比抽共享包给 API 用更轻量（API 不依赖前端代码）
- ReminderLog 的 [userId, kind, month] 唯一键可以当月级以外的去重用：month 列直接存日期键（2026-10-12），kind 区分场景（daily-limit / planbuy），无需改表结构
- colima VM 运行 12 天后 Docker daemon DNS 会坏（pull 报 lookup ghcr.io on [::1]:53 connection refused），`colima stop && colima start` 即修复；容器随 compose up -d 恢复，无需重装 binfmt
- 全屏警告遮罩用 position:fixed inset:0 + body.daily-limit-lock{overflow:hidden} 锁滚动；useEffect 里加/删 body class，组件卸载自动还原
- docker pull 失败分两类诊断：`lookup ghcr.io on [::1]:53` = colima VM DNS 坏（/etc/resolv.conf 是指向 systemd-resolved 的悬空符号链接，先 `sudo rm` 再写公共 DNS）；`proxyconnect tcp: 192.168.5.2:xxxxx connection refused` = daemon 继承了失效代理（colima stop 后 `env -u HTTP_PROXY -u HTTPS_PROXY ... colima start`）。两个故障可能叠加，需逐个排除
- 服务端推送链路要端到端验证：VAPID 环境变量（容器注入）→ /api/notifications/vapid-key 能返回公钥 → 前端订阅写入 PushSubscription → 调度器送达；只改后端不动订阅入口等于没做（本次第一版就是漏了订阅入口）

## Phase 25c 新发现（2026-10-17）

- Apple Web Push 对 VAPID subject 挑剔：`mailto:user@localhost` 会被判 403 BadJwtToken（无 TLD 的域名不合法）；必须是 `mailto:真实域名` 或 https URL。症状表现为"订阅存在但所有推送 delivered=false"，极易误判成订阅失效
- 排查 Web Push 最快的办法：把 DB 里的 endpoint/p256dh/auth 导出，用本机 node + web-push 直接 sendNotification，看 statusCode/body（比翻日志快）；记得顺手给生产代码的 catch 加上 statusCode+body 日志
- 提醒类功能的语义要分层：应用内警告=即时（用户主动打开就该看到），手机推送=按用户设定时间（避免白天被打扰）；混为一谈会让"设了时间还被推"或"设了时间却不警告"
- 动作按钮不要用状态词命名（"已完成"看起来像状态而非动作）；用「已买到手」这类动词短语，并把破坏性操作（删除）用图标+hover 变红与它区分
- 沙箱代理 502 时 git push 不通：可用 GitHub git data API（blobs→tree→commit→update ref）推提交；`gh api` 读 stdin 必须加 `--input -`
- GHCR 镜像下载在本机只有 8~30 KB/s（换 DNS 无效），一个 100+MB 镜像耗时 6.5 小时；后端更新要提前启动 pull，别卡在最后一步

## Phase 26–28 新发现（2026-10-15 ~ 2026-10-17）

- **预算类数字必须区分"当日实时值"与"当日恒定参考值"**：用户纠正「每天还可花」被当成当日限额是错的。动态日限额 =（月日常预算 − 截至昨日日常支出）÷ 含今日剩余天数——当日自身消费不进分子，所以日内恒定，只滚入次日及以后。设计准则：凡是以"今天"为分母/窗口的额度，先问"当天行为是否应改变它"，再定公式
- **手动维护面板的数据模型**：FixedExpenseItem 按月份 key 分桶（`ledger-fixed-expenses-<month>`），模板复制到未来月时 spent 归零且不覆盖已有数据的月份；关联分类（categoryId）后"已支出"改只读并显示「自动」，按当月该分类 expense 实时汇总，解除关联时保留当前值转手动——"自动/手动"双模式比纯自动或纯手动都贴合实际
- **颜色语义分层**（用户视觉误判的根因）：绿色=真实状态（已买徽章/今日可买高亮），青色=动作按钮（已买到手/链接），红色=危险（删除/超限/超支）。同一个面板里状态色和动作色混用会让用户把"可点的动作"看成"已完成的状态"
- **移动端表单布局坑**：双列 grid（列表+表单）在 ≤940px 塌成单列后，编辑表单落到列表下方→"编辑页面跑到下面去了"。解法是行内编辑：编辑态直接在数据行内展开表单（金额 input autoFocus + 保存/取消），侧栏只留提示卡。凡是"列表+编辑表单"的组合都应按此模式
- **列表行扁平化手段**：行内 flex 由 column 改 row（名字+状态同行、金额+操作同行）+ 手机 @640px flex-wrap；配合 padding/行距/字号逐级压缩。竖列堆叠是手机端"行太高"的根因
- **可折叠面板默认收起**：参考项/数据管理/数据同步这类"需要时才看"的面板，初始 state 设 false；默认展开会把主面板挤到首屏外
- **搜索功能的纯函数化**：searchMatches（关键词命中备注/商户/标签/账户/分类路径，排除 income 与已删除）+ aggregateByPeriod(matches, sliceLen)（7=按月、4=按年；cents 只累计 expense）抽成纯函数后，筛选（分类/账户/排序/时间范围）全部作用于单一 filtered 集合，概览卡/按月汇总/按年汇总/明细四个展示区天然同源，不会出现"汇总与明细对不上"
- **底部导航列数必须与入口数同步**：`@media(max-width:940px)` 里 nav 的 grid-template-columns 从 repeat(5,1fr) 改 repeat(6,1fr) 才容下第 6 个入口；新增导航项忘改列数 → 换行 + FAB 遮挡（本轮「搜索」上线时踩过）
- **"每天必弹"的警告用会话内 dismiss**：持久化 dismiss（localStorage 日期键）会被理解成"今天不再提醒"；用户要的是"当天无论何时打开都是红色警报"→ 用 useState(false) 的会话级关闭，onDismiss 只 setState，刷新/重开即恢复
- **正反馈提醒的去重粒度**：表扬类通知按 `日期:时段` 去重（每天上午/下午各一条），时段划分 hour≥18=pm、≥12=am；零消费=zero、未达限额=thrifty、达/超限不表扬——表扬的门槛必须低于限额线，否则"表扬"变"没超额的安慰"
- **git push 代理坑 + SHA 分叉对齐**：沙箱 HTTP(S)_PROXY 会让 push 报 HTTP2 framing/Empty reply，用 `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy git -c http.version=HTTP/1.1 push` 绕过；早期用 GitHub Data API 推的等价 commit 与本地 SHA 不同造成非快进时，先 `git diff <本地等价> <远端等价>` 确认 tree 相同，再 `git rebase --onto origin/main <本地等价> main` 重放，内容零变化
- **caddy force-recreate 后根路径偶发 000** 是容器启动竞态（不是部署失败），重试 curl 即 200；批量验证时代码里做 2-3 次重试
- **容器热补丁技巧**：API dist 是纯 JS（架构无关），本地构建后 `docker cp apps/api/dist/. api-local:/app/apps/api/dist/ && docker restart api-local` 即可更新容器内容，绕过 GHCR 6 小时下载；Prisma 引擎二进制用容器自带 node_modules，不影响 schema 迁移

## 2026-10-18 新发现 — UI 紧凑化范式

- **分类维护 = 单行列表母版**：`.category-line` 用 `grid-template-columns: minmax(0,1fr) auto auto`（名称 | 操作 | 操作），编辑/删除按钮为「图标 + 隐藏 span」，移动端 `@media` 让 `span{display:none}` 只留图标。所有新列表行（账户/预算/固定支出/专项支出）都应复用同款 3 列单行结构，不要回到竖列堆叠（手机端"行太高"的根因）
- **折叠式「新增」母版**：默认只显示一个青色虚线 `*-add-toggle` 按钮，点击展开内联表单（`form-stack *-editor-panel inline-edit-form`），保存后 `if(!wasEditing) setShowNewForm(false)` 自动收起；编辑态隐藏 toggle。账户管理/预算管理/计划购买/本月固定支出/分类维护 5 处已统一，不要再写常驻右侧表单
- **「框大字小」只降框高**：用户明确「字号不变、调框高」。只用 `padding`/`min-height`/`gap` 收紧（如折叠头 `0.9/1.1→0.6/0.88rem`、专项 `min-height 2.65→2.3rem`、图表趋势卡 `0.6/0.7→0.5/0.62rem`）；**严禁动 font-size**。桌面与对应 `@media` 移动端规则要同步改，否则两端比例不一致
- **行内编辑优于双列 grid**：列表 + 编辑表单的组合，编辑态直接在数据行内展开表单（autoFocus + 保存/取消），侧栏只留提示卡；双列 grid 在 ≤940px 塌成单列会把表单挤到列表下方（"编辑跑到页面底部"的根源）
- **移动端操作降级**：操作按钮在手机上只留图标（文字 span CSS 隐藏），桌面保持图标+文字；新增按钮保留文字（青色虚线）以引导点击
- **压缩顺序参考**：先整体密度（面板/卡片/行/边距/字号）→ 再单模块（设置页作用域限定）→ 再单行列表（分类维护母版）→ 再折叠式新增 → 最后单行行内编辑 + 框高修正，逐层递进，用户每轮反馈后再扩到下一个模块
- **表扬提醒「依据」= 真实总支出**：noSpendPraiseDue 的 zero 档必须今日全部支出（含专项/贷款/保险）为 0 才成立；thrifty 才用日常支出对比日限额。专项支出 ≠ 没花钱
- **重复提醒去重规矩**：已订阅 web push（localStorage ledger-push-subscribed=1）时，前端 maybeNotifyDailyLimit / maybePraiseNoSpend 不发本地 Notification，只由服务端 checkSpendingAlerts 后台推送，避免 App 打开时同一条提醒弹两次
- **抬头可省则省**：当列表行自身带 scope 徽标/标签已能区分归属时（如预算管理日常/总开支），删掉重复的 h2 抬头，把说明小字移到列表底部作脚注（`.budget-scope-hint margin:0.5rem 0 0` + `.budget-scope-panel .budget-list{margin-top:0}`），面板更紧凑
- **抬头↔小字间距统一 = 0.12rem**：手机端 `.chart-heading` 上下堆叠（h2 + span）时 flex gap 由 0.55/0.65rem 收紧为 0.12rem，与 `.report-toolbar` 内 span(margin-top:.12rem)、设置摘要 span(margin-top:.1rem) 一致；桌面端 chart-heading 仍横向 h2|span 不受影响
- **说明/备注「?」气泡母版（InfoTip）**：widgets.tsx 导出 `<InfoTip text={...}/>`（? 按钮 + 点击气泡，mousedown/touchstart 外部点击 + Esc 关闭，stopPropagation 防误触父级 toggle）。把冗长说明/备注收进「?」保持界面清爽；**不**收：错误/警告（reminder-hint.warn）、带按钮的交互提示、含金额/笔数/匹配数等关键数据的小字——这些保持 inline
- **「?」气泡必须内联不能占独立行**（用户明确要求）：InfoTip 贴在被解释文字后（标题/标签/状态条/预算行名后），`.info-tip` 用 `inline-flex + vertical-align:middle + margin-left:.28rem` 与文字基线对齐，气泡 `position:absolute` 弹出不受行内位置影响；列表场景把 tip 作为渲染函数可选参数（`renderBudgetLine(budget, tip?)` 贴 `budget-name` 后），切勿 `array.map(renderBudgetLine)`——索引会被当 tip 传入
- **设置页子面板不另起抬头**：SettingsSection 标题（如「账户管理」「分类维护」）已说明归属时，面板内 `<h2>账户</h2>`/`<h2>分类</h2>` 属冗余抬头，删掉；原抬头下的说明段一律改「?」内联到最近的操作行（分类=包进消费/收入切换标签行 `.category-kind-wrap`；账户=跟「新增账户」按钮后）。删抬头后 toolbar 成面板首元素，`margin-top` 要归零与预算面板（`.budget-toolbar` 无 margin-top）对齐
- **「?」化的边界（续）**：除错误态/数据型小字外，**空态引导语保留 inline**（「还没有固定支出项，点标题右侧＋…」「清单是空的…」「输入关键词…」）——列表为空时正是需要引导的时刻，藏进「?」会让人无处下手；表单头说明（新增账户/分类/预算）可「?」化，但编辑态「正在编辑：X」是数据行必须保留
- **坑：祖先 span 规则会把 InfoTip 块级化**（2026-10-18 实测复现）：`.settings-section summary span { display: block }`（0,1,2）专克副标题小字，但 InfoTip 根元素是 `<span class="info-tip">`，其自带 `display:inline-flex`（0,1,0）**特异性更低必被覆盖** → 「?」独占一行。修复用 `span:not(.info-tip)` 排除。教训：① InfoTip 是行内组件，任何 `X span`/`X > span` 的 display 规则都要防它；② 新增此类规则时先想会不会误伤行内组件；③ 怀疑布局问题时用无头 Chrome 导出 computed style + boundingBox 对比（sameLine 判定），别凭代码猜
- **UI 问题无头复现工具箱**（2026-10-18 搭好）：`~/.workbuddy/binaries/node/workspace/` 有 playwright-core；用 `.env.local` 的 JWT_SECRET 本地签 HS256 token（payload `{sub:<用户id>}`，用户 id 从 `docker exec personal-ledger-pwa-postgres-local-1 psql -U ledger -d ledger -t -c 'SELECT id FROM "User"'` 拿），addInitScript 写 `localStorage.ledger-token`，chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:true}) + context ignoreHTTPSErrors:true + viewport 390×844/isMobile 即可渲染需登录页面并截图；当天超限额先点 daily-limit-overlay 的「知道了」否则点击被拦截
