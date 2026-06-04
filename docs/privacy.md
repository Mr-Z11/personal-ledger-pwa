# 数据与隐私边界

这个仓库设计为可以公开，但财务数据不能公开。

## 可以提交到 GitHub

- 前后端源码
- Prisma schema
- Docker/Caddy 部署模板
- `.env.example`
- 文档

## 不要提交到 GitHub

- `.env`
- 数据库文件或 dump
- `backups/`
- `uploads/`
- 服务器 SSH 私钥
- 日志文件

## 默认数据位置

- iPhone/Mac：IndexedDB 本地缓存和离线队列。
- 云服务器：PostgreSQL 正式数据。
- GitHub：只保存代码，不保存个人财务数据。
