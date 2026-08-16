#!/usr/bin/env bash
# auto-backup.sh — Daily backup with cloud-offline fallback.
# Called by launchd (~/Library/LaunchAgents/com.personal-ledger.data-backup.plist).
# Strategy (runs once a day at 03:00):
#   1. Cloud online  → dump cloud DB → local file; if local PG is running, live-sync too.
#   2. Cloud offline → dump LOCAL PostgreSQL → local file (cloud-stopped fallback),
#      so daily backups never stop as long as the local stack is running.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$PROJECT_DIR/backups/auto-backup.log"
LOCAL_PG="personal-ledger-pwa-postgres-local-1"

# Make colima/lima/docker CLI available (installed under ~/bin and ~/opt/lima,
# outside launchd's default PATH)
export PATH="$HOME/opt/lima/bin:$HOME/bin:$PATH"

ts() { date '+%Y-%m-%d %H:%M:%S'; }

# Self-healing: start the Docker VM if it is not running (e.g. after a reboot)
if ! docker info >/dev/null 2>&1; then
  echo "[$(ts)] Docker daemon not reachable, starting colima VM..." >> "$LOG_FILE"
  colima start >> "$LOG_FILE" 2>&1 || echo "[$(ts)] colima start FAILED" >> "$LOG_FILE"
fi

container_running() {
  docker ps --filter "name=$LOCAL_PG" --filter "status=running" --format '{{.Names}}' 2>/dev/null | grep -q "^$LOCAL_PG$"
}

echo "[$(ts)] === Auto backup started ===" >> "$LOG_FILE"

CLOUD_OK=0
if bash "$PROJECT_DIR/scripts/data-sync.sh" backup-cloud >> "$LOG_FILE" 2>&1; then
  CLOUD_OK=1
  echo "[$(ts)] Cloud backup: OK" >> "$LOG_FILE"
else
  echo "[$(ts)] Cloud backup: FAILED (server may be offline)" >> "$LOG_FILE"
fi

# Live sync cloud → local PG (only meaningful when cloud is reachable)
if [ "$CLOUD_OK" = "1" ] && container_running; then
  echo "[$(ts)] Local PG running, attempting live sync..." >> "$LOG_FILE"
  if bash "$PROJECT_DIR/scripts/data-sync.sh" sync-cloud-to-local >> "$LOG_FILE" 2>&1; then
    echo "[$(ts)] Live sync: OK" >> "$LOG_FILE"
  else
    echo "[$(ts)] Live sync: FAILED (non-critical, file backup already done)" >> "$LOG_FILE"
  fi
fi

# Fallback: cloud unreachable but local stack is running → back up the local DB instead,
# so new data recorded against the local API still lands in ./backups/ every day.
if [ "$CLOUD_OK" = "0" ] && container_running; then
  echo "[$(ts)] Cloud offline — backing up LOCAL PostgreSQL instead..." >> "$LOG_FILE"
  if bash "$PROJECT_DIR/scripts/data-sync.sh" backup-local >> "$LOG_FILE" 2>&1; then
    echo "[$(ts)] Local backup (fallback): OK" >> "$LOG_FILE"
  else
    echo "[$(ts)] Local backup (fallback): FAILED" >> "$LOG_FILE"
  fi
fi

if [ "$CLOUD_OK" = "0" ] && ! container_running; then
  echo "[$(ts)] WARNING: cloud offline AND local PG not running — no new backup possible." >> "$LOG_FILE"
  echo "[$(ts)] Start the local stack: bash scripts/start-local-sync.sh" >> "$LOG_FILE"
fi

# Prune old backups: keep last 30 SQL files (covers ledger-cloud-* and ledger-local-*)
cd "$PROJECT_DIR/backups"
ls -t ledger-*.sql 2>/dev/null | tail -n +31 | while read -r old; do
  rm -f "$old" "${old}.gz"
  echo "[$(ts)] Pruned old backup: $old" >> "$LOG_FILE"
done

echo "[$(ts)] === Auto backup finished ===" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"
