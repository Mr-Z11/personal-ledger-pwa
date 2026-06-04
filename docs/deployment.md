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
docker compose up -d --build
```

## 4. 启动

```bash
docker compose up -d --build
docker compose logs -f caddy api
```

访问：

```text
https://ledger.47.74.3.104.sslip.io
```

iPhone 用 Safari 打开，点击分享按钮，选择“添加到主屏幕”。

## 5. 备份

手动备份：

```bash
mkdir -p backups
docker compose exec postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "backups/ledger-$(date +%F).sql"
```

建议后续加 cron 每天执行一次，并把 `backups/` 保持在 `.gitignore` 中。
