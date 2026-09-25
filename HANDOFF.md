# 任务交接

## 1. 当前任务目标

维护个人记账 PWA 的日常迭代与数据安全。**云端服务器已于 2026-08-29 失效**，当前数据完全以本地 Mac 为中心（local-first 架构 + 本地 PostgreSQL）。云端重建与否待用户决策。

## 2. 已完成并部署的变更（2026-09-25 最新）

最新 commit `2da791d` 已推送 GitHub main；前端已构建并部署到**本地 Mac 栈**（云端服务器仍失效，见第 3 节）。

| Commit | 描述 | 关键文件 | 状态 |
|--------|------|---------|------|
| `7796d90` | **预算两层（日常/总开支 scope）+ 首页双蓄水池 + 消费节奏图（预算参考线）+ 大额开销规律分析 + 工资提醒纯本地化 + 默认首页改总览** | schema.prisma, shared, serializers, api/index.ts, App.tsx, widgets.tsx(新), utils.ts(新), styles.css | 已部署 |
| `d1907cf` | 手机（≤480px）两个蓄水池保持横向两列（删除堆叠规则，收紧间距字号） | styles.css | 已部署 |
| `717ff32` | 节奏图措辞口语化：「低于/超出预算平均线」→「比预算慢/快 ¥X」；图例改「预算参考线」；焦点卡改「预算每天可花 / 实际每天花」 | widgets.tsx, App.tsx | 已部署 |
| `2da791d` | 蓄水池数字可读性：读数包进磨砂玻璃卡片（半透明米白 + backdrop-blur + 阴影），任意水位高对比 | widgets.tsx, styles.css | 已部署 |
| `1929b20` / `7c6bacd` | 交接文件同步 + caddy 悬空挂载坑记录 | HANDOFF/findings/task_plan/progress | — |

### 2026-09-25 部署细节

- CI (3609435) 构建 GHCR 镜像 → 本机 `docker pull --platform linux/amd64` → 备份（ledger-local-20260925-122935.sql, 3469 条）→ `compose up -d api-local` → 启动自动 `prisma db push` 添加 `Budget.scope` 列（已有 4 行预算全部落为 daily，正确）
- 本地 API health 通过；前端 dist 本地重新构建
- **每次重建 dist 后必须 `up -d --force-recreate caddy-local`**（配置未变时普通 `up -d` 不会重建，绑定挂载会悬空 → 根路径 403，手机看不到任何更新）
- 部署验证：`curl -sk https://localhost:8443/` 返回 200，且 App chunk / App css 含新特征字符串；`https://FrorideMacBook-Air.local:8443/` 返回 200
- vitest 冒烟测试 6 项通过（apps/web/src/widgets.smoke.test.tsx）

### 历史变更（2026-08-16，云端失效前最后部署）

`1e8be1c` 本地全栈接管+故障转移 · `314899d` CORS 修复 · `5a4f61a` 手机同步状态栏 · `909ac42` 状态栏滚动+自动隐藏 · `ffa0a54` amountCents BigInt + PWA autoUpdate（云端 HEAD 定格 ffa0a54）

### 历史变更（2026-08-15，全部已部署）

`dd3d237` 预算编辑/去重 · `adce292` 趋势气泡 · `78bdadd` UI 专业化 · `478d367` 工资日推送 · `116e8be` 空 body POST 修复 · `cfadb86` 本地同步模式 · `b3b1ffe` 双重存储 · `71752ca` setup-auto-backup.sh

### 2026-09-25 会话（本地运维修复，无新 commit）

- 修复本地 API crash-loop（RestartCount 11428，根因 colima VM 丢 qemu binfmt）：`docker run --rm --privileged tonistiigi/binfmt --install amd64`
- 排除旧镜像 `--accept-data-loss` 数据降级风险：拉取 `--platform linux/amd64` 新镜像（BigInt），`db push` 零数据变更
- **改进 `scripts/start-local-sync.sh`（未提交）**：启动前自动注册 binfmt + 自动拉取匹配镜像，防 VM 重启复发
- 打通手机同步：确认 mDNS fallback 自动生效，手机 8-31 后数据全部入本地 PG（3416→3469，最新 2026-09-24）
- 升级前备份：`backups/pre-image-upgrade-20260925-101948.sql.gz`；导出存档 `Desktop/记账数据-截至2026-09-25.xlsx`

## 3. 当前环境状态（2026-09-25 更新）

### ⚠️ 云端已失效（2026-08-29 起）

- 服务器 `47.74.3.104`：ping 通但 **80/443 全关**，仅 22 开放；**SSH host key 已变更**（疑实例被重装或释放后 IP 回收分配他人）。**确认归属前不要删 known_hosts 硬连**（有连到他人机器的风险）
- 最后成功云备份：`ledger-cloud-20260829-030322.sql`；此后 `auto-backup.log` 每日 Cloud FAILED
- 云端数据定格在 2026-08-29 前；**云端重建与否待用户决策**

### 本地 Mac 栈（当前唯一活跃数据中心）

- 容器：postgres-local(healthy) + api-local + caddy-local，全部运行
- 本地 API：`https://localhost:8443/api` / `https://192.168.3.21:8443/api` / `https://FrorideMacBook-Air.local:8443/api`
- 数据库：**3469 笔（2020-05-31 ~ 2026-09-24）**，bigint 金额列，serverVersion 122；**Budget 表 2026-09-25 新增 scope 列（daily/total）**
- api-local 镜像：GHCR main @ 7796d90（含预算两层 + 工资本地化后端）
- 前端静态文件：`apps/web/dist` 本地构建 @ 2da791d，由 caddy-local 挂载 `/srv/web`（**改 dist 后需 force-recreate caddy-local**）
- 前端版本核对方法：`curl -sk https://localhost:8443/` → 200；`curl -sk https://localhost:8443/assets/App-*.js | grep -c "总开支额度"` → 1
- 手机 8-31 后数据已于 2026-09-25 11:15 全部同步入本地 PG（用户确认）
- 物理数据：`data/local-postgres/`（65MB，Docker 卷挂载，容器删除数据不丢）
- **风险**：数据仅 Mac 单点，建议异地备份

## 4. 数据存储架构（双重存储，全自动）

```
云端 PostgreSQL (primary)  ←→  本地备份文件 (backups/*.sql)  ←→  本地 PostgreSQL (fallback)
        ↑ 自动故障转移（前端 apiFetch，无需手动改设置）
```

### 自动化备份（全部由 macOS launchd 管理，不依赖 WorkBuddy）

- **`com.personal-ledger.data-backup`**: 每天 03:00 跑 `scripts/auto-backup.sh`（RunAtLoad=true，睡眠错过唤醒补跑）
- **`com.personal-ledger.colima`**: 登录时自动 `colima start`（Docker VM 常驻）
- **auto-backup.sh 策略**: 云端在线→SSH 拉云端库；云端离线→自动备份本地 PG（`ledger-local-*.sql`）；Docker 没跑→自动 `colima start` 自愈
- **服务器自身 cron**: 每日 03:15 自动备份 PostgreSQL

### data-sync.sh 工具（6 个命令）

- `bash scripts/data-sync.sh status` — 查看云端/本地/备份三方面状态
- `bash scripts/data-sync.sh backup-cloud` — 从云端 dump 到 backups/ 文件
- `bash scripts/data-sync.sh backup-local` — 从本地 PG dump 到 backups/ 文件
- `bash scripts/data-sync.sh restore-to-local [file]` — 恢复到本地 PG（先 DROP SCHEMA）
- `bash scripts/data-sync.sh sync-cloud-to-local` — 云端→本地 PG 实时同步
- `bash scripts/data-sync.sh sync-local-to-cloud` — 本地→云端推送
- `SSH_ALIAS` 环境变量可覆盖（测试离线兜底用）

### 关键技术坑

- SSH 管道传输 >700K 数据会被 SIGKILL（exit 137）→ 服务器端 gzip 压缩后传输
- Git push SSH 绕过 Clash 代理：`GIT_SSH_COMMAND="ssh -o ProxyCommand=none" git push git@github.com:...`
- 本地 arm64 Docker 构建因 tsup/esbuild 原生二进制问题不可用 → 用 GHCR amd64 镜像 + qemu 模拟
- CSS 是 minified 的，验证部署时 grep 用无空格形式（如 `overflow-x:auto`）
- Prisma 表名是 PascalCase（`"Transaction"` 非 `transactions`）
- data-sync.sh 的 last_tx 查 `occurredAt`（交易时间）而非 `createdAt`（插入时间），且排除已删除记录
- **colima VM 重启后丢失 qemu binfmt 注册** → amd64 镜像 `exec format error` crash-loop；必须重跑 `docker run --rm --privileged tonistiigi/binfmt --install amd64`（已固化进 start-local-sync.sh）
- **本地镜像版本必须匹配数据库 schema**：旧镜像（Int）+ 数据库（bigint）会触发 `prisma db push` 要求 `--accept-data-loss` → 拉匹配镜像，切勿放行降级
- **`docker pull` 必须带 `--platform linux/amd64`**（arm64 宿主默认找 arm64 manifest 报 `no matching manifest`）
- **Service Worker `urlPattern: pathname.startsWith("/api")` 匹配任何 origin**，切本地地址后 `/api` 请求被 SW NetworkFirst 拦截；但 **workbox 默认只路由 GET**，POST/OPTIONS 直接走网络
- **iOS WKWebView（PWA）不信任 IP 类 SAN 证书，信任 DNS 类 SAN 证书** → 本地同步地址必须用 mDNS 域名（`FrorideMacBook-Air.local`），不能用 IP（会 fetchevent/no-response）
- **"URL is not valid"** = 手动输入地址字符串语法非法，fetch() 页面层解析即抛错；**清空地址用自动 fallback 优于手动输入**（mDNS fallback 已编译进 bundle 并自动生效）
- `SyncSettingsPanel.handleSave()` 强制 reload → `hydrateFromServer()` 只拉不推，会用本地旧数据覆盖 IndexedDB 同 ID 记录；切换地址后须立即点"同步"让 outbox 推回修正

## 5. 本地全栈（Mac 上的完整后备环境）

- **容器运行时**（免 sudo 手动安装）: `~/bin/{docker,colima}`、`~/opt/lima/limactl`、`~/.docker/cli-plugins/docker-compose`；colima VM 用 vz（Apple M2）
- **本地栈**: `docker-compose.local.yml`（postgres-local + api-local + caddy-local）
- **本地 API 入口**: `https://localhost:8443/api`（Caddy 自签证书，tls internal + on_demand）
- **本地 Caddy 同时提供 PWA 静态文件**: apps/web/dist → /srv/web
- **Caddy 根证书**: `~/Desktop/Caddy-Local-CA.crt` 需安装到系统钥匙串并设"始终信任"（一次性）
- **JWT_SECRET**: 与云端一致（`.env.local`）
- **CORS**: API 已允许全方法（GET/HEAD/POST/PUT/DELETE/PATCH/OPTIONS），本地 CORS_ORIGIN=*

### 前端 API 自动故障转移

- `apps/web/src/api.ts` 的 apiFetch：云 API 不可达时自动切到 fallback 端点
- Fallback: `https://localhost:8443/api` + `https://FrorideMacBook-Air.local:8443/api`（mDNS）
- localStorage 健康追踪 + 2 分钟冷却；云恢复后自动切回
- `VITE_FALLBACK_API_BASES` 通过 CI build-arg 编入 JS bundle

## 6. 关键文件位置

### 2026-09-25 新增/重构模块

| 文件 | 用途 |
|------|------|
| `apps/web/src/widgets.tsx` | `BudgetReservoir`（蓄水池 SVG 水位）、`SalaryBanner` + `LocalSalaryReminderPanel`（纯本地工资提醒）、`DailyPaceChart`（每日累计 vs 预算参考线）、`TrendFocusCards`（环比/同比/近3月趋势/日均对比）、`BigExpensePanel`（大额清单 + 规律识别） |
| `apps/web/src/utils.ts` | 从 App.tsx 抽出的纯函数（日期/金额/专项分类判定/预算汇总），widgets 与 App 共用 |
| `apps/web/src/widgets.smoke.test.tsx` | vitest + renderToString 冒烟测试（6 项，无浏览器环境可跑） |

### 关键行为约定（改动前务必了解）

- 预算模型：`categoryId` 非空 = 分类预算；`categoryId=null & scope=daily` = 日常消费预算；`categoryId=null & scope=total` = 总开支预算（含日常+专项）
- 日常消费 vs 专项支出：靠 `isNonDailyExpenseCategory()` 关键词正则划分（贷款/保险/教育/购车养车等），节奏图与趋势卡只统计日常消费
- 默认首页是 `overview`（蓄水池），记账 FAB 仍指向 `entry`
- 本地设置（不同步服务器）：`localStorage` 键 `ledger-salary-reminder`（工资提醒）、`ledger-big-expense-threshold`（大额判定线）、`ledger-salary-dismissed`、`ledger-salary-notified`

| 文件 | 用途 |
|------|------|
| `apps/web/src/App.tsx` | 前端主应用（含 .mobile-sync-bar 手机同步状态栏） |
| `apps/web/src/widgets.tsx` | 蓄水池/工资横幅/节奏图/趋势焦点卡/大额面板/工资设置（2026-09-25 新增） |
| `apps/web/src/utils.ts` | 纯工具函数（从 App.tsx 抽取，供 widgets 复用） |
| `apps/web/src/api.ts` | API 请求层（apiFetch 自动故障转移 + 运行时可配 API_BASE） |
| `apps/web/src/styles.css` | 全部前端样式 |
| `apps/web/public/push-sw.js` | Service Worker 推送处理 |
| `apps/api/src/notifications.ts` | Web Push 发送 + 工资日定时器 |
| `apps/api/src/index.ts` | API 路由入口（CORS 全方法） |
| `apps/api/src/serializers.ts` | 序列化（bigint→Number() 转换） |
| `apps/api/prisma/schema.prisma` | 数据模型（amountCents/openingBalanceCents 为 BigInt） |
| `apps/web/vite.config.ts` | VitePWA（registerType: autoUpdate, skipWaiting, clientsClaim） |
| `scripts/data-sync.sh` | 双向数据同步工具（6 命令） |
| `scripts/auto-backup.sh` | 自动备份（云端在线/离线双策略 + colima 自愈） |
| `scripts/verify-pwa-startup.mjs` | PWA 启动回归检查（已允许 skipWaiting/clientsClaim） |
| `docker-compose.local.yml` | 本地 Docker Compose 配置 |
| `deploy/Caddyfile.local` | 本地 Caddy 自签 HTTPS + PWA 静态文件 |
| `deploy/com.personal-ledger.data-backup.plist` | launchd 每日备份 |
| `deploy/com.personal-ledger.colima.plist` | launchd 登录启动 Docker |
| `docs/data-storage-guide.md` | 完整双重存储策略文档 |
| `backups/恢复说明.md` | 数据恢复流程 |

## 7. 重要规则和限制

- 真实财务数据、`.env`、备份、密钥不得提交 GitHub
- 服务器 ~2 GiB RAM，不在服务器构建镜像
- 安全部署流程：typecheck → build → push → 等 CI → `deploy/update-server.sh` → 验证 health
- 服务器到期前必须确保本地有最新备份
- `data/local-postgres/` 是本地数据库数据目录，不可删除
- 金额字段（amountCents 等）必须保持 BigInt，勿改回 Int（integer 上限 21.4 亿分 = 2140 万元，真实交易可超）

## 8. 服务器到期后的故障切换（全自动，无需手动）

1. 服务器到期 → 前端 apiFetch 自动切换到本地端点（localhost:8443 / mDNS），数据继续写入本地 PG
2. Mac 重启 → launchd 自动 `colima start` → 本地栈自动可用
3. 每天 03:00 → auto-backup.sh 检测云端离线 → 自动备份本地 PG（ledger-local-*.sql）
4. 手机在 Mac 局域网内时走 mDNS 端点；跨网络时 App 降级离线模式暂存 IndexedDB，回到局域网自动同步
5. 续费新服务器后: `bash scripts/data-sync.sh sync-local-to-cloud` 推送数据

## 9. 不要重复做的事情

- 不要重新调查 2026-08-16 的 6 个 commit 是否上线；全部已部署到 `ffa0a54`
- 不要重新排查"手机端同步失败"问题；根因（amountCents Int 溢出）已修复，265 条已全部同步成功
- 不要重新实现手机端同步状态栏；已实现（滚动 + 自动隐藏）
- 不要把 PWA registerType 改回 "prompt"（iOS 独立模式下更新提示不显示，用户会一直用旧版本）
- 不要用直接 SSH 管道传输大文件（>700K 会被 kill）；用 gzip 压缩后传
- 不要在沙箱内尝试 `launchctl load`/`crontab`；让用户在 Terminal 手动执行
- 不要把数据库备份或 `.env` 提交到 GitHub
- 不要在小内存服务器上构建镜像
- 不要尝试本地 arm64 构建 API 镜像（tsup/esbuild 原生二进制问题）；用 GHCR amd64 + qemu
- 不要在 `prisma db push` 报 `BigInt→Integer` 警告时加 `--accept-data-loss`（会把 3416 条真实数据金额列降级）；应拉取与数据库 schema 匹配的镜像
- 本地同步地址不要填 IP（iOS WKWebView 不信 IP 类证书，会 fetchevent）；用 mDNS 域名 `FrorideMacBook-Air.local:8443`
- 不要 `docker pull` 不带 `--platform linux/amd64`（arm64 宿主会报 `no matching manifest`）
- 不要以为"点同步"能切换同步地址；也无需手动填地址——自动 fallback（mDNS）已生效，或在设置里改 mDNS 地址
- 不要删 known_hosts 硬连 47.74.3.104（host key 已变，IP 可能已分配给他人）
- 不要卸载/重装手机端 PWA（会清空 IndexedDB，丢失未同步数据）
- 不要把"无分类预算"直接当日常预算用；Budget 有 scope 字段，查询必须过滤 `scope ?? "daily"`，否则总开支预算会串进日常统计
- 不要试图恢复旧版 Web Push 工资提醒面板（前端已移除）；工资提醒是纯本地 localStorage 方案，后端 notifications.ts 保留但未被前端调用
- 不要在沙箱里直接 vite build 而不处理 dist 清空拦截（safe-delete shim）；先 `mv apps/web/dist /tmp/...` 再 build
- **不要忘了：改 dist 后必须 `docker compose -f docker-compose.local.yml --env-file .env.local up -d --force-recreate caddy-local`**，否则 caddy 挂载悬空 → 页面 403，手机看不到任何更新（配置未变时普通 `up -d` 不重建容器）
- 不要在"总开支预算"存在时把它当日常预算用；`monthBudgetTotal` 已按 `scope ?? "daily"` 过滤，勿改回 `find(!categoryId)`

## 10. 待确认/建议下一步

- **手机端 PWA 需要用户操作确认**：若 PWA 是从云端 origin（ledger.47.74.3.104.sslip.io）安装的，云端失效后永远收不到更新，需从 `https://FrorideMacBook-Air.local:8443` 重新「添加到主屏幕」（数据已全部入本地 PG，删除旧 PWA 安全）；若本就是本地 origin 安装，划掉重开两次即可。**用户是否已完成重装、手机实测反馈尚未回收**
- **用户已提出的观察点**：首页蓄水池数字可读性（已改为磨砂玻璃读数卡，待手机实测确认）；两个蓄水池横向排列（已修）
- **`scripts/start-local-sync.sh` 的改进尚未提交**（自动注册 binfmt + 自动拉镜像），建议提交
- **云端 47.74.3.104 归属待确认**：是否重装/被回收？决定是重建云端还是彻底转向纯本地架构
- **数据异地备份（紧迫）**：当前数据仅 Mac 单点 + backups/，建议把 backups/ 自动复制到云盘/移动硬盘
- 建议用户检查那条金额约 1 亿元的交易（amountCents=9999999900），很可能是输入错误
- 导出功能在 iOS PWA 独立模式静默失败（`a.download` 被 WebKit 忽略）；如需手机导出，改用 Web Share API（`navigator.share`），但仅本地 origin 的 PWA 能受益
- `limactl` 二进制缺失导致 `colima status/list` 失败；docker 仍可用，但建议修复 lima PATH 便于管理 VM
- findings.md 中 P0 项「reliable-sync 工作包」（串行化 syncNow、逐行 ack outbox、启动先 flush 再 pull）尚未实施，是后续可靠性改进的首选
