#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/root/personal-ledger-pwa}"
BRANCH="${BRANCH:-main}"

cd "$APP_DIR"

git fetch --depth=1 origin "$BRANCH"
git reset --hard "origin/$BRANCH"

mkdir -p data/postgres data/caddy-data data/caddy-config backups uploads logs

# Keep updates light: pull prebuilt images, never build on the small server.
docker compose pull
docker compose up -d --remove-orphans
docker compose ps
