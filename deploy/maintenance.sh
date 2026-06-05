#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/root/personal-ledger-pwa}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
IMAGE_PRUNE_UNTIL="${IMAGE_PRUNE_UNTIL:-168h}"

cd "$APP_DIR"
mkdir -p backups logs

timestamp="$(date +%Y%m%d-%H%M%S)"
backup_path="backups/ledger-${timestamp}.sql.gz"

echo "[$(date --iso-8601=seconds)] starting database backup: ${backup_path}"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip -9 > "$backup_path"
gzip -t "$backup_path"
echo "[$(date --iso-8601=seconds)] backup complete: $(du -h "$backup_path" | awk '{print $1}')"

echo "[$(date --iso-8601=seconds)] deleting backups older than ${BACKUP_RETENTION_DAYS} days"
find backups -type f -name 'ledger-*.sql.gz' -mtime +"$BACKUP_RETENTION_DAYS" -print -delete

echo "[$(date --iso-8601=seconds)] pruning unused docker images older than ${IMAGE_PRUNE_UNTIL}"
docker image prune -af --filter "until=${IMAGE_PRUNE_UNTIL}"

echo "[$(date --iso-8601=seconds)] docker disk usage"
docker system df

