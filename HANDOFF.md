# 任务交接

## 1. 当前任务目标

维护个人记账 PWA 的日常迭代与数据安全。**云端服务器已于 2026-08-29 失效**，当前数据完全以本地 Mac 为中心（local-first 架构 + 本地 PostgreSQL）。云端重建与否待用户决策。

## 2. 已完成并部署的变更（2026-08-16 最新）

所有变更已推送到 GitHub main 分支并部署到云服务器（当前 HEAD: `ffa0a54`）。

| Commit | 描述 | 关键文件 | 状态 |
|--------|------|---------|------|
| `1e8be1c` | 本地全栈接管 + 前端 API 自动故障转移（云不可达自动切本地） | api.ts, docker-compose.local.yml, auto-backup.sh, colima.plist | 已部署 |
| `314899d` | CORS 修复：允许 PUT/DELETE/PATCH 跨域请求 | apps/api/src/index.ts | 已部署 |
| `5a4f61a` | 手机端同步状态栏（原 CSS 在手机端隐藏了 sync-card） | App.tsx, styles.css | 已部署 |
| `909ac42` | 同步状态栏：文字可横向滚动 + 同步完成后自动隐藏 | App.tsx, styles.css | 已部署 |
| `ffa0a54` | **amountCents Int→BigInt 溢出修复（同步 500 根因）+ PWA autoUpdate** | schema.prisma, serializers.ts, index.ts, vite.config.ts | 已部署 |

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
- 数据库：**3469 笔（2020-05-31 ~ 2026-09-24）**，bigint 金额列，serverVersion 122
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

| 文件 | 用途 |
|------|------|
| `apps/web/src/App.tsx` | 前端主应用（含 .mobile-sync-bar 手机同步状态栏） |
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

## 10. 待确认/建议下一步

- **`scripts/start-local-sync.sh` 的改进尚未提交**（自动注册 binfmt + 自动拉镜像），建议提交
- **云端 47.74.3.104 归属待确认**：是否重装/被回收？决定是重建云端还是彻底转向纯本地架构
- **数据异地备份（紧迫）**：当前数据仅 Mac 单点 + backups/，建议把 backups/ 自动复制到云盘/移动硬盘
- 建议用户检查那条金额约 1 亿元的交易（amountCents=9999999900），很可能是输入错误
- 导出功能在 iOS PWA 独立模式静默失败（`a.download` 被 WebKit 忽略）；如需手机导出，改用 Web Share API（`navigator.share`），但仅本地 origin 的 PWA 能受益（云端 origin 无法更新）
- `limactl` 二进制缺失导致 `colima status/list` 失败；docker 仍可用，但建议修复 lima PATH 便于管理 VM
- findings.md 中 P0 项「reliable-sync 工作包」（串行化 syncNow、逐行 ack outbox、启动先 flush 再 pull）尚未实施，是后续可靠性改进的首选
