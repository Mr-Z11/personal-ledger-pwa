# 部署到 Ubuntu 22.04

服务器：`47.74.3.104`，免费访问地址默认使用 `ledger.47.74.3.104.sslip.io`。

## 1. 安全组

在云服务器控制台开放：

- `22/tcp`：SSH
- `80/tcp`：Caddy 自动申请 HTTPS 证书
- `443/tcp`：PWA 和 API

## 2. 安装 Docker

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
```

## 3. 上传代码

```bash
git clone https://github.com/YOUR_NAME/personal-ledger-pwa.git
cd personal-ledger-pwa
cp .env.example .env
nano .env
```

至少修改：

- `POSTGRES_PASSWORD`
- `DATABASE_URL` 中的密码
- `JWT_SECRET`
- `CADDY_EMAIL`

保持：

```env
CADDY_DOMAIN=ledger.47.74.3.104.sslip.io
PUBLIC_APP_URL=https://ledger.47.74.3.104.sslip.io
CORS_ORIGIN=https://ledger.47.74.3.104.sslip.io
```

也可以使用仓库里的脚本：

```bash
REPO_URL=https://github.com/YOUR_NAME/personal-ledger-pwa.git bash deploy/server-setup.sh
cd ~/personal-ledger-pwa
nano .env
docker compose pull
docker compose up -d
```

## 4. 启动

```bash
docker compose pull
docker compose up -d
docker compose logs -f caddy api
```

访问：

```text
https://ledger.47.74.3.104.sslip.io
```

iPhone 用 Safari 打开，点击分享按钮，选择“添加到主屏幕”。

## 5. 轻量更新

服务器规格只有 2 GiB 内存，不要在服务器上执行 `docker compose up -d --build`、`npm install` 或 `npm run build`。这些构建工作由 GitHub Actions 完成，并推送到 GHCR 镜像仓库。

以后更新服务器只执行：

```bash
cd /root/personal-ledger-pwa
bash deploy/update-server.sh
```

这个脚本只会：

- 拉取 GitHub 最新代码。
- 拉取已经构建好的 `api` / `web` 镜像。
- 重启容器。

如果确实需要在本机或性能更好的机器上手动构建镜像，使用：

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml build
```

## 6. 自动备份和旧镜像清理

安装每日维护任务：

```bash
cd /root/personal-ledger-pwa
bash deploy/install-maintenance-cron.sh
```

默认每天凌晨 `03:15` 执行：

- 备份 PostgreSQL 到 `backups/ledger-YYYYMMDD-HHMMSS.sql.gz`。
- 保留最近 30 天备份，删除更旧的备份。
- 清理 7 天以上且未被容器使用的旧 Docker 镜像。
- 维护日志写入 `logs/maintenance.log`。

手动执行一次：

```bash
cd /root/personal-ledger-pwa
bash deploy/maintenance.sh
```

`backups/` 和 `logs/` 已在 `.gitignore` 中，不会进入 GitHub。
