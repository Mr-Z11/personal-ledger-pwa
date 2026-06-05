# Personal Ledger PWA

一个云端优先、可离线使用的个人记账 PWA。代码可以公开到 GitHub，真实财务数据、密钥、备份和附件必须留在本机或自己的云服务器。

## 快速开始

## 换电脑维护

Windows 新电脑 clone 仓库后，优先用这些双击入口：

- `setup-new-computer.cmd`：第一次设置，检查 Git/Node，安装依赖，跑类型检查。
- `start-local-preview.cmd`：打开本地预览。
- `publish-to-github.cmd`：检查、构建、提交并推送到 GitHub。
- `deploy-server.cmd`：轻量更新云服务器，并检查线上健康状态。

云服务器真实数据、备份、日志仍只保存在服务器，不会进入 GitHub。

## 开发命令

```bash
npm install
npm run build
```

开发模式需要先准备 PostgreSQL，并在根目录复制 `.env.example` 为 `.env` 后填入真实配置。

```bash
npm run dev
```

## 本地预览

本机没有 Docker/PostgreSQL 时，`npm --workspace @ledger/web run preview -- --host 127.0.0.1 --port 4283` 仍可打开界面。localhost 下如果 `/api` 不可用，注册会进入“本地预览模式”，数据只写入浏览器 IndexedDB，用于试用界面。

正式部署后，`/api` 由 Caddy 反向代理到云服务器 API，数据保存到云服务器 PostgreSQL。

## 公开仓库安全规则

- 可以提交：源码、Prisma schema、部署模板、`.env.example`、文档。
- 不要提交：`.env`、数据库文件、备份文件、上传附件、日志、服务器私钥。
- 默认生产访问地址：`https://ledger.47.74.3.104.sslip.io`。

## 部署

见 [docs/deployment.md](docs/deployment.md)。

生产更新使用预构建镜像，服务器不要运行 `docker compose up -d --build`。推送到 `main` 后由 GitHub Actions 构建镜像；服务器只需执行：

```bash
cd /root/personal-ledger-pwa
bash deploy/update-server.sh
```

服务器维护任务：

```bash
cd /root/personal-ledger-pwa
bash deploy/install-maintenance-cron.sh
```

它会每天自动备份数据库，并清理未使用的旧 Docker 镜像。
