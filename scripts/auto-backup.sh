#!/usr/bin/env bash
# auto-backup.sh — Runs data-sync backup-cloud with logging.
# Called by launchd (~/Library/LaunchAgents/com.personal-ledger.data-backup.plist).
# Runs every 6 hours to ensure local always has a recent copy of cloud data.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="$PROJECT_DIR/backups/auto-backup.log"

ts() { date '+%Y-%m-%d %H:%M:%S'; }

echo "[$(ts)] === Auto backup started ===" >> "$LOG_FILE"

# 1. Always try to backup from cloud to local file
if bash "$PROJECT_DIR/scripts/data-sync.sh" backup-cloud >> "$LOG_FILE" 2>&1; then
  echo "[$(ts)] Cloud backup: OK" >> "$LOG_FILE"
else
  echo "[$(ts)] Cloud backup: FAILED (server may be offline)" >> "$LOG_FILE"
fi

# 2. If local PostgreSQL is running, also sync cloud → local DB
LOCAL_PG="personal-ledger-pwa-postgres-local-1"
if docker ps --filter "name=$LOCAL_PG" --filter "status=running" --format '{{.Names}}' 2>/dev/null | grep -q "^$LOCAL_PG$"; then
  echo "[$(ts)] Local PG running, attempting live sync..." >> "$LOG_FILE"
  if bash "$PROJECT_DIR/scripts/data-sync.sh" sync-cloud-to-local >> "$LOG_FILE" 2>&1; then
    echo "[$(ts)] Live sync: OK" >> "$LOG_FILE"
  else
    echo "[$(ts)] Live sync: FAILED (non-critical, file backup already done)" >> "$LOG_FILE"
  fi
else
  echo "[$(ts)] Local PG not running, skipped live sync" >> "$LOG_FILE"
fi

# 3. Prune old backups: keep last 30 SQL files
cd "$PROJECT_DIR/backups"
ls -t ledger-*.sql 2>/dev/null | tail -n +31 | while read -r old; do
  rm -f "$old" "${old}.gz"
  echo "[$(ts)] Pruned old backup: $old" >> "$LOG_FILE"
done

echo "[$(ts)] === Auto backup finished ===" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"
