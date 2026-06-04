#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/personal-ledger-pwa}"
REPO_URL="${REPO_URL:-}"

if ! command -v docker >/dev/null 2>&1; then
  sudo apt update
  sudo apt install -y ca-certificates curl git
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi

if [ ! -d "$APP_DIR/.git" ]; then
  if [ -z "$REPO_URL" ]; then
    echo "Set REPO_URL first, for example:"
    echo "REPO_URL=https://github.com/YOUR_NAME/personal-ledger-pwa.git bash deploy/server-setup.sh"
    exit 1
  fi
  git clone "$REPO_URL" "$APP_DIR"
fi

cd "$APP_DIR"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env. Edit it before starting the app:"
  echo "nano $APP_DIR/.env"
  exit 0
fi

docker compose pull || true
docker compose up -d --build
docker compose ps
