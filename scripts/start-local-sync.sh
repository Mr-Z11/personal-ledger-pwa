#!/usr/bin/env bash
# Start local sync server on your computer.
# Prerequisites: Docker Desktop installed and running.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Please start Docker Desktop first."
  exit 1
fi

if [ ! -f .env.local ]; then
  echo "First-time setup: copying .env.local.example to .env.local"
  cp .env.local.example .env.local
  echo ""
  echo "⚠️  Please edit .env.local and set your JWT_SECRET (must match the cloud server value)."
  echo "    The JWT_SECRET on the server can be found with:"
  echo "    ssh aliyun-server 'grep JWT_SECRET /root/personal-ledger-pwa/.env'"
  echo ""
  read -p "Press Enter after editing .env.local, or Ctrl+C to cancel..."
fi

# On Apple Silicon, the GHCR API image is linux/amd64 and needs qemu binfmt.
# colima VMs lose the binfmt registration on restart, which makes the api
# container crash-loop with "exec format error". Re-register it when missing.
if [ "$(uname -m)" = "arm64" ]; then
  if ! docker run --rm --privileged tonistiigi/binfmt 2>/dev/null | grep -q "linux/amd64"; then
    echo "Registering amd64 emulation (needed after a VM restart)..."
    docker run --rm --privileged tonistiigi/binfmt --install amd64 >/dev/null
    echo "✅ amd64 emulation registered."
  fi
fi

# The api image must match the database schema. An outdated local image makes
# `prisma db push` demand --accept-data-loss, which would downgrade the BigInt
# money columns and corrupt real data. Refresh the image before starting.
# Note: docker pull needs an explicit platform, otherwise it looks for an
# arm64 manifest that does not exist.
echo "Ensuring API image is up to date..."
docker pull --platform linux/amd64 "${API_IMAGE:-ghcr.io/mr-z11/personal-ledger-pwa-api:main}" >/dev/null 2>&1 \
  || echo "⚠️  Could not reach GHCR. Using the cached image."

echo "Starting local sync server..."
docker compose -f docker-compose.local.yml --env-file .env.local up -d

echo ""
echo "Waiting for services to start..."
sleep 5

# Get the computer's local IP
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "localhost")
PORT=$(grep LOCAL_HTTPS_PORT .env.local 2>/dev/null | cut -d= -f2 || echo "8443")
PORT=${PORT:-8443}

echo ""
echo "✅ Local sync server is running."
echo ""
echo "   Local address:  https://localhost:${PORT}/api"
echo "   Network address: https://${LOCAL_IP}:${PORT}/api"
echo ""
echo "📋 Next steps:"
echo "   1. Open the app on your phone → Settings → 数据同步"
echo "   2. Enter: https://${LOCAL_IP}:${PORT}/api"
echo "   3. Tap '测试连接' — accept the certificate warning when prompted"
echo "   4. Tap '保存并应用' — your data will sync to this computer"
echo ""
echo "   To restore existing data from backup:"
echo "   bash scripts/data-sync.sh restore-to-local"
echo "   # or: bash scripts/data-sync.sh sync-cloud-to-local  (live sync from cloud)"
echo ""
echo "   To stop: docker compose -f docker-compose.local.yml down"
