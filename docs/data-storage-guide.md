# 数据双重存储指南

## 目标

确保**云端服务器**和**本地电脑**至少有一处保存最新最全的记账数据。

## 存储架构

```
┌─────────────┐        SSH dump         ┌──────────────┐
│  云服务器    │ ───── backup-cloud ──→  │  本地备份文件  │
│  PostgreSQL  │ ──── sync-cloud-to-→   │  + 本地 PG    │
│  (primary)  │      -local            │  (fallback)   │
└─────────────┘                        └──────────────┘
       ↑                                      │
       └──── sync-local-to-cloud ────────────┘
            (服务器回来后推送本地数据)
```

| 存储位置 | 作用 | 数据格式 |
|---------|------|---------|
| 云服务器 PostgreSQL | 主数据库，App 默认写入这里 | 实时 |
| 本地备份文件 (`backups/*.sql`) | 安全网，定期从云端 dump | 每 6 小时更新 |
| 本地 PostgreSQL (Docker) | 云端离线时的备用数据库 | 按需同步 |

## 日常命令

所有命令在项目根目录执行：`cd ~/Vibecoding/personal-ledger-pwa`

### 查看状态

```bash
bash scripts/data-sync.sh status
```

显示云端、本地、备份文件三方面的记录数和最新交易时间。

### 从云端备份到本地文件

```bash
bash scripts/data-sync.sh backup-cloud
```

从云端 PostgreSQL 导出 SQL 到 `backups/` 目录（同时生成 .gz 压缩副本）。

### 从备份恢复到本地 PostgreSQL

```bash
# 自动选择最新备份
bash scripts/data-sync.sh restore-to-local

# 或指定文件
bash scripts/data-sync.sh restore-to-local backups/ledger-cloud-20260815-204741.sql
```

### 云端 → 本地 PostgreSQL 实时同步

```bash
bash scripts/data-sync.sh sync-cloud-to-local
```

将云端数据库完整同步到本地 PostgreSQL（覆盖本地，自动做安全备份）。

### 本地 → 云端推送

```bash
bash scripts/data-sync.sh sync-local-to-cloud
```

将本地 PostgreSQL 数据推送到云端（覆盖云端，自动做安全备份）**用于服务器恢复后上传本地数据**。

## 自动化备份

### WorkBuddy 自动化（已配置）

已创建每 6 小时自动执行的备份任务：
1. 从云端拉取最新备份到 `backups/`
2. 如果本地 Docker 在运行，同步到本地 PostgreSQL
3. 自动清理超过 30 份的旧备份

管理方式：在对话中输入 `/automations` 查看和修改。

### macOS 定时任务（可选，更可靠）

项目已附带 launchd 配置文件，在 Terminal 中执行：

```bash
launchctl load ~/Library/LaunchAgents/com.personal-ledger.data-backup.plist
```

每 6 小时自动执行 `scripts/auto-backup.sh`。日志在 `backups/auto-backup.log`。

卸载：
```bash
launchctl unload ~/Library/LaunchAgents/com.personal-ledger.data-backup.plist
```

## 故障切换流程

### 场景 1：云服务器到期

1. App 自动降级为离线模式，数据暂存在手机 IndexedDB
2. 在电脑上启动本地 Docker：

```bash
bash scripts/start-local-sync.sh
```

3. 手机在 App 设置 → 数据同步中填入电脑地址
4. 手机暂存数据自动同步到本地 PostgreSQL
5. 数据安全存储在本地

### 场景 2：续费新服务器后恢复

1. 在新服务器上部署应用（参照 `backups/恢复说明.md`）
2. 启动本地 Docker 并确保有最新数据
3. 推送本地数据到新服务器：

```bash
bash scripts/data-sync.sh sync-local-to-cloud
```

4. 手机在 App 设置中切回云端地址
5. 完成

### 场景 3：电脑硬盘损坏

1. 从云端直接恢复（如果服务器还在）：

```bash
bash scripts/data-sync.sh backup-cloud   # 重新拉取
bash scripts/data-sync.sh restore-to-local  # 恢复到新本地 PG
```

2. 如果服务器也到期了，从最后的 `backups/*.sql` 文件恢复

## 本地同步服务

### 首次配置

```bash
cd ~/Vibecoding/personal-ledger-pwa
cp .env.local.example .env.local

# 获取服务器上的 JWT_SECRET（保持一致才能用原登录态）
ssh aliyun-server 'grep JWT_SECRET /root/personal-ledger-pwa/.env'

# 编辑 .env.local，把 JWT_SECRET 改成服务器上的值
# 同时把 POSTGRES_PASSWORD 改成一个强密码
```

### 启动本地服务

```bash
bash scripts/start-local-sync.sh
```

自动启动 postgres + api + caddy，显示局域网 IP 和端口。

### 手机配置

1. 确保手机和电脑连同一 WiFi（或都连 Tailscale）
2. 打开记账 App → 设置 → 数据同步
3. 输入：`https://电脑IP:8443/api`
4. 测试连接 → 保存并应用

### 跨网络（Tailscale 方案）

1. 电脑和手机都安装 Tailscale（https://tailscale.com）
2. 同一账号登录
3. 手机在数据同步地址输入：`https://100.x.x.x:8443/api`

### 证书信任

本地 Caddy 使用自签证书（`tls internal`），手机首次连接时：
- Android：访问地址 → "高级" → "继续前往"
- iOS：设置 → 通用 → 关于本机 → 证书信任设置

### 停止本地服务

```bash
docker compose -f docker-compose.local.yml --env-file .env.local down
```

数据保留在 `data/local-postgres/`，下次启动自动恢复。

## 数据安全提示

- `data/local-postgres/` 是本地数据库的数据目录，不要删除
- `backups/` 目录已加入 `.gitignore`，不会泄露到 GitHub
- 建议把 `backups/` 目录定期复制到云盘做异地备份
- 自动备份保留最近 30 份，旧备份自动清理
