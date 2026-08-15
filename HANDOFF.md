# 任务交接

## 1. 当前任务目标

维护个人记账 PWA 的日常迭代、数据安全、双重存储策略，以及为服务器到期后的故障切换做准备。

## 2. 已完成并部署的变更（2026-08-15）

所有变更已推送到 GitHub main 分支并部署到云服务器（当前 HEAD: `71752ca`）。

| Commit | 描述 | 关键文件 | 状态 |
|--------|------|---------|------|
| `dd3d237` | 修复预算 bug：不能编辑、新增替换原预算 | App.tsx BudgetPanel, styles.css | 已部署 |
| `adce292` | 趋势图点击月份柱子显示金额气泡 | App.tsx TrendFoldPanel, styles.css | 已部署 |
| `78bdadd` | UI 专业化：上下文感知 topbar、环比趋势、流水行色彩 | App.tsx, styles.css | 已部署 |
| `478d367` | 工资日推送提醒：VAPID + Service Worker + 定时器 | notifications.ts, schema.prisma, push-sw.js, vite.config.ts | 已部署 |
| `116e8be` | 修复空 body POST 报错（apiFetch 无条件加 content-type） | api.ts | 已部署 |
| `cfadb86` | 本地同步模式：运行时可配 API 地址、SyncSettingsPanel | api.ts, App.tsx, docker-compose.local.yml, Caddyfile.local | 已部署 |
| `b3b1ffe` | 双重存储：data-sync.sh + auto-backup.sh + 文档 | scripts/data-sync.sh, scripts/auto-backup.sh, docs/data-storage-guide.md | 已部署 |
| `71752ca` | setup-auto-backup.sh 一键安装 launchd | scripts/setup-auto-backup.sh, deploy/com.personal-ledger.data-backup.plist | 已部署 |

## 3. 当前生产环境状态

- **服务器**: `47.74.3.104`（SSH 别名 `aliyun-server`）
- **生产地址**: `https://ledger.47.74.3.104.sslip.io`
- **服务器 HEAD**: `71752ca`
- **容器**: postgres(healthy) + api + web + caddy，全部运行
- **健康检查**: `{"ok":true}`
- **数据库**: PostgreSQL，3131 笔交易、18 账户、187 分类
- **VAPID 密钥**: 在服务器 `.env` 中，`npx web-push generate-vapid-keys` 生成

## 4. 数据存储架构（双重存储）

```
云端 PostgreSQL (primary)  ←→  本地备份文件 (backups/*.sql)  ←→  本地 PostgreSQL (fallback)
```

### 备份位置
- 所有备份在项目文件夹 `backups/`（已 .gitignore 排除）
- 旧 `~/ledger-backup/` 可删除

### data-sync.sh 工具（5 个命令）
- `bash scripts/data-sync.sh status` — 查看云端/本地/备份三方面状态
- `bash scripts/data-sync.sh backup-cloud` — 从云端 dump 到 backups/ 文件
- `bash scripts/data-sync.sh restore-to-local [file]` — 恢复到本地 PG
- `bash scripts/data-sync.sh sync-cloud-to-local` — 云端→本地 PG 实时同步
- `bash scripts/data-sync.sh sync-local-to-cloud` — 本地→云端推送

### 自动化备份
- **WorkBuddy 自动化**: 每 6 小时执行 backup-cloud（依赖电脑开机 + WorkBuddy 运行）
- **macOS launchd**: 配置文件在 `~/Library/LaunchAgents/com.personal-ledger.data-backup.plist`，需用户在 Terminal 运行 `bash scripts/setup-auto-backup.sh` 安装
- **服务器自身 cron**: 每日 03:15 自动备份 PostgreSQL

### 关键技术坑
- SSH 管道传输 >700K 数据会被进程管理器 SIGKILL（exit 137）
- 解决方案：服务器端 gzip 压缩（822K→149K）后传输
- Git push 绕过代理：`env -u https_proxy -u HTTPS_PROXY ... git push`
- Git push SSH 绕过 Clash 代理：`GIT_SSH_COMMAND="ssh -o ProxyCommand=none" git push git@github.com:...`

## 5. 本地同步模式

- 手机 App 可在设置页切换云端/本地 API 地址
- 本地 Docker: `docker-compose.local.yml`（postgres-local + api-local + caddy-local）
- 启动: `bash scripts/start-local-sync.sh`
- 跨网络: Tailscale 方案（详见 `docs/data-storage-guide.md`）
- JWT_SECRET 需与服务器一致

## 6. 关键文件位置

| 文件 | 用途 |
|------|------|
| `apps/web/src/App.tsx` | 前端主应用（BudgetPanel、TrendFoldPanel、SalaryReminderPanel、SyncSettingsPanel） |
| `apps/web/src/api.ts` | API 请求层（运行时可配 API_BASE、有 body 才设 content-type） |
| `apps/web/src/styles.css` | 全部前端样式 |
| `apps/web/public/push-sw.js` | Service Worker 推送处理 |
| `apps/api/src/notifications.ts` | Web Push 发送 + 工资日定时器 |
| `apps/api/src/index.ts` | API 路由入口 |
| `apps/api/prisma/schema.prisma` | 数据模型（含 ReminderSetting、PushSubscription、ReminderLog） |
| `scripts/data-sync.sh` | 双向数据同步工具 |
| `scripts/auto-backup.sh` | 自动备份包装脚本（含日志、清理） |
| `scripts/setup-auto-backup.sh` | 一键安装 launchd 定时任务 |
| `scripts/start-local-sync.sh` | 启动本地 Docker 同步服务 |
| `docker-compose.local.yml` | 本地 Docker Compose 配置 |
| `deploy/Caddyfile.local` | 本地 Caddy 自签 HTTPS 配置 |
| `docs/data-storage-guide.md` | 完整双重存储策略文档 |
| `docs/local-sync-guide.md` | 本地同步搭建指南 |
| `backups/恢复说明.md` | 数据恢复流程 |

## 7. 重要规则和限制

- 真实财务数据、`.env`、备份、密钥不得提交 GitHub
- 服务器 ~2 GiB RAM，不在服务器构建镜像
- 安全部署流程：typecheck → build → push → 等 CI → `deploy/update-server.sh` → 验证 health
- 服务器到期前必须确保本地有最新备份
- `data/local-postgres/` 是本地数据库数据目录，不可删除

## 8. 服务器到期后的故障切换

1. 服务器到期 → App 自动降级离线模式，数据暂存 IndexedDB
2. 电脑启动本地 Docker: `bash scripts/start-local-sync.sh`
3. 手机设置 → 数据同步 → 输入电脑地址 → 保存
4. 手机暂存数据自动同步到本地 PostgreSQL
5. 续费新服务器后: `bash scripts/data-sync.sh sync-local-to-cloud` 推送数据

## 9. 不要重复做的事情

- 不要重新调查今晚 8 个 commit 是否上线；全部已部署到 `71752ca`
- 不要用直接 SSH 管道传输大文件（>700K 会被 kill）；用 gzip 压缩后传
- 不要在沙箱内尝试 `launchctl load`/`crontab`；用 `osascript do shell script` 或让用户在 Terminal 手动执行
- 不要把数据库备份或 `.env` 提交到 GitHub
- 不要在小内存服务器上构建镜像

## 10. 待确认/建议下一步

- 用户需在 Terminal 运行 `bash scripts/setup-auto-backup.sh` 安装 launchd 定时任务（沙箱内无法自动加载）
- 旧 `~/ledger-backup/` 目录可删除（已迁移到项目 `backups/`）
- 服务器到期时间待确认，到期前确保最后一次 `backup-cloud` 成功
- 考虑把 `backups/` 目录额外复制到云盘做异地备份
