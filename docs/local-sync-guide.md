# 本地数据同步指南

## 适用场景

云服务器到期后，手机继续使用记账 App，数据暂存在手机本地（IndexedDB），等电脑开机联网后自动同步到电脑保存。

## 原理

App 已经是**离线优先**架构：
- 所有记账数据先写入手机浏览器的 IndexedDB
- 通过同步队列自动推送到 API 服务器
- 服务器不可达时，数据暂存在 IndexedDB 队列中，不丢失

**本地同步方案**：在电脑上用 Docker 跑一套 API + 数据库，App 切换到电脑地址后，同步队列自动把暂存数据推送到电脑。

## 搭建步骤

### 1. 安装 Docker Desktop
如果电脑上还没装 Docker，从 https://docker.com 下载安装并启动。

### 2. 首次配置
```bash
cd ~/Vibecoding/personal-ledger-pwa

# 创建本地配置
cp .env.local.example .env.local

# 获取服务器上的 JWT_SECRET（保持一致才能用原登录态）
ssh aliyun-server 'grep JWT_SECRET /root/personal-ledger-pwa/.env'

# 编辑 .env.local，把 JWT_SECRET 改成服务器上的值
# 同时把 POSTGRES_PASSWORD 改成一个强密码
```

### 3. 恢复历史数据（可选）
如果你已经从服务器导出了备份（`~/ledger-backup/`），先导入到本地数据库：
```bash
# 启动本地数据库
docker compose -f docker-compose.local.yml --env-file .env.local up -d postgres-local

# 等待数据库就绪
sleep 10

# 导入备份
docker exec -i personal-ledger-pwa-postgres-local-1 \
  psql -U ledger -d ledger < ~/ledger-backup/ledger-full-20260815-200331.sql
```

### 4. 启动本地同步服务
```bash
bash scripts/start-local-sync.sh
```
脚本会自动启动 postgres + api + caddy，并显示电脑的局域网 IP 和端口。

### 5. 手机配置
1. 确保手机和电脑连同一 WiFi
2. 打开记账 App → **设置 → 数据同步**
3. 在"本地同步地址"输入框填入：`https://电脑IP:8443/api`
   - 电脑 IP 由启动脚本显示，例如 `https://192.168.1.100:8443/api`
4. 点"测试连接"——浏览器会提示证书不受信任，选择"继续访问"
5. 点"保存并应用"——App 刷新后切换到本地地址
6. 手机上的暂存数据会自动同步到电脑的数据库

## 跨网络同步（Tailscale 方案）

如果手机和电脑不在同一 WiFi（如外出用流量），用 Tailscale 组建虚拟内网：

### 安装 Tailscale
1. 电脑和手机都从 https://tailscale.com 下载安装 Tailscale
2. 两端用同一个账号登录
3. 登录后在 Tailscale 管理页面看到电脑的 Tailscale IP（100.x.x.x）

### 配置
启动本地同步后，手机在"数据同步地址"输入：
```
https://100.x.x.x:8443/api
```
（把 100.x.x.x 换成电脑的 Tailscale IP）

无论在哪，只要电脑开机并连了 Tailscale，手机就能同步。

### 证书信任
本地 Caddy 使用自签证书（`tls internal`），手机首次连接时需要手动信任：
- **Android（Chrome/Edge）**：访问地址 → "高级" → "继续前往"
- **iOS（Safari PWA）**：设置 → 通用 → 关于本机 → 证书信任设置 → 开启对应证书
- 或在电脑上导出 Caddy 根证书安装到手机（一劳永逸）

## 日常使用

### 电脑开机后
```bash
bash scripts/start-local-sync.sh
```
Tailscale 自动连接，手机检测到本地 API 后自动同步。

### 电脑关机时
手机自动降级为离线模式，数据暂存在 IndexedDB，不丢失。

### 以后续费新服务器
1. 在新服务器上部署应用（参照 `~/ledger-backup/恢复说明.md`）
2. 手机在设置页切回云端地址（清空输入框 → 保存并应用）
3. 手机暂存数据自动同步到新服务器

## 停止本地服务
```bash
docker compose -f docker-compose.local.yml --env-file .env.local down
```
数据保留在 `data/local-postgres/`，下次启动自动恢复。

## 数据安全提示
- `data/local-postgres/` 是本地数据库的数据目录，不要删除
- 定期备份：`docker exec personal-ledger-pwa-postgres-local-1 pg_dump -U ledger -d ledger > ~/ledger-backup/local-$(date +%Y%m%d).sql`
- 电脑硬盘损坏会丢失数据，建议把 `~/ledger-backup/` 目录复制到云盘做异地备份
