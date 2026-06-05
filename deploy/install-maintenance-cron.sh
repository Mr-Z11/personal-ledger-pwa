#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/root/personal-ledger-pwa}"
CRON_FILE="/etc/cron.d/personal-ledger-pwa"

mkdir -p "$APP_DIR/backups" "$APP_DIR/logs"

cat > "$CRON_FILE" <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Personal Ledger PWA: daily database backup and old Docker image cleanup.
15 3 * * * root APP_DIR=${APP_DIR} bash ${APP_DIR}/deploy/maintenance.sh >> ${APP_DIR}/logs/maintenance.log 2>&1
EOF

chmod 0644 "$CRON_FILE"

if command -v systemctl >/dev/null 2>&1; then
  systemctl enable --now cron >/dev/null 2>&1 || systemctl enable --now crond >/dev/null 2>&1 || true
fi

echo "Installed ${CRON_FILE}"

