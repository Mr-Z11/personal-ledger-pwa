#!/usr/bin/env bash
# data-sync.sh — Dual-storage data synchronization between cloud and local PostgreSQL.
#
# Ensures at least one of {cloud server, local computer} always has the latest data.
#
# Usage:
#   bash scripts/data-sync.sh status               # Check both sides
#   bash scripts/data-sync.sh backup-cloud          # Dump cloud DB → ./backups/ file
#   bash scripts/data-sync.sh restore-to-local [f]  # Restore backup file → local PG
#   bash scripts/data-sync.sh sync-cloud-to-local   # Live sync cloud → local PG
#   bash scripts/data-sync.sh sync-local-to-cloud   # Push local PG → cloud (overwrites)
#
# NOTE: Large data transfers use a two-step approach (dump to temp file on server,
#       then download via `ssh cat`) because direct piping of `docker exec` output
#       through SSH gets killed by the process manager (exit 137 / SIGKILL).
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="$PROJECT_DIR/backups"
TMP_DIR="/tmp"
SSH_ALIAS="${SSH_ALIAS:-aliyun-server}"
PG_USER="ledger"
PG_DB="ledger"

# Cloud container name (from docker-compose.yml, service "postgres")
CLOUD_PG="personal-ledger-pwa-postgres-1"
# Local container name (from docker-compose.local.yml, service "postgres-local")
LOCAL_PG="personal-ledger-pwa-postgres-local-1"

mkdir -p "$BACKUP_DIR"

# ── Helpers ──────────────────────────────────────────────────────────────────

ts() { date +%Y%m%d-%H%M%S; }

container_running() {
  docker ps --filter "name=$1" --filter "status=running" --format '{{.Names}}' 2>/dev/null | grep -q "^$1$"
}

ssh_ok() {
  ssh -o ConnectTimeout=5 -o BatchMode=yes "$SSH_ALIAS" "echo ok" 2>/dev/null | grep -q ok
}

# Count records in a local container's DB
count_records_local() {
  container_running "$LOCAL_PG" || { echo "n/a"; return; }
  docker exec "$LOCAL_PG" psql -U "$PG_USER" -d "$PG_DB" -t -A -c \
    'SELECT count(*) FROM "Transaction";' 2>/dev/null || echo "error"
}

last_tx_local() {
  container_running "$LOCAL_PG" || { echo "n/a"; return; }
  docker exec "$LOCAL_PG" psql -U "$PG_USER" -d "$PG_DB" -t -A -c \
    "SELECT to_char(max(\"createdAt\"), 'YYYY-MM-DD HH24:MI:SS') FROM \"Transaction\";" 2>/dev/null || echo "error"
}

# Count records in cloud DB (small query — direct ssh is fine)
count_records_cloud() {
  ssh_ok || { echo "n/a"; return; }
  ssh "$SSH_ALIAS" "docker exec $CLOUD_PG psql -U $PG_USER -d $PG_DB -t -A -c \"SELECT count(*) FROM \\\"Transaction\\\";\"" 2>/dev/null || echo "error"
}

last_tx_cloud() {
  ssh_ok || { echo "n/a"; return; }
  ssh "$SSH_ALIAS" "docker exec $CLOUD_PG psql -U $PG_USER -d $PG_DB -t -A -c \"SELECT to_char(max(\\\"createdAt\\\"), 'YYYY-MM-DD HH24:MI:SS') FROM \\\"Transaction\\\";\"" 2>/dev/null || echo "error"
}

# Dump cloud DB → local file via compressed transfer.
# Large SSH pipes get SIGKILL'd by the process manager; gzip keeps transfer small (~150K).
# $1 = destination local file, $2 = extra pg_dump flags (e.g. "--clean --if-exists")
dump_cloud_to_file() {
  local dest="$1"
  local extra="${2:-}"
  local remote_tmp="/tmp/ledger-sync-$$.sql"

  # Step 1: dump on server to temp file
  ssh "$SSH_ALIAS" "docker exec $CLOUD_PG pg_dump -U $PG_USER -d $PG_DB --no-owner --no-privileges $extra > $remote_tmp"
  # Step 2: compress on server (822K → ~149K, well under the kill threshold)
  ssh "$SSH_ALIAS" "gzip -kf $remote_tmp"
  # Step 3: download compressed, decompress locally
  ssh "$SSH_ALIAS" "cat ${remote_tmp}.gz" | gunzip > "$dest"
  # Step 4: clean up server temp files
  ssh "$SSH_ALIAS" "rm -f $remote_tmp ${remote_tmp}.gz" 2>/dev/null || true
}

# Dump local DB → local file.
# $1 = destination file, $2 = extra pg_dump flags
dump_local_to_file() {
  local dest="$1"
  local extra="${2:-}"
  docker exec "$LOCAL_PG" pg_dump -U "$PG_USER" -d "$PG_DB" --no-owner --no-privileges $extra > "$dest"
}

# Upload local file → cloud DB via compressed transfer.
# $1 = source local file
restore_file_to_cloud() {
  local src="$1"
  local local_gz="/tmp/ledger-push-$$.sql.gz"
  local remote_tmp="/tmp/ledger-restore-$$.sql"

  # Step 1: compress locally
  gzip -c "$src" > "$local_gz"
  # Step 2: upload compressed file to server
  ssh "$SSH_ALIAS" "cat > ${remote_tmp}.gz" < "$local_gz"
  rm -f "$local_gz"
  # Step 3: decompress on server
  ssh "$SSH_ALIAS" "gunzip -f ${remote_tmp}.gz"
  # Step 4: restore on server (file is local to server, no docker pipe)
  ssh "$SSH_ALIAS" "docker exec -i $CLOUD_PG psql -U $PG_USER -d $PG_DB < $remote_tmp" 2>&1 \
    | grep -E "^(ERROR|FATAL)" || true
  # Step 5: clean up
  ssh "$SSH_ALIAS" "rm -f $remote_tmp ${remote_tmp}.gz" 2>/dev/null || true
}

# ── Commands ─────────────────────────────────────────────────────────────────

cmd_backup_cloud() {
  echo "=== Cloud → Backup File ==="
  if ! ssh_ok; then
    echo "ERROR: Cannot reach cloud server ($SSH_ALIAS)."
    echo "       The server may be offline or expired."
    echo "       If you have local data, use: bash scripts/data-sync.sh sync-local-to-cloud"
    echo "       (after server is back)"
    exit 1
  fi
  local file="$BACKUP_DIR/ledger-cloud-$(ts).sql"
  echo "Dumping cloud database (two-step: server temp → download)..."
  dump_cloud_to_file "$file"
  local size; size=$(du -h "$file" | cut -f1)
  gzip -kf "$file"
  local records; records=$(count_records_cloud)
  echo "OK  Saved: $(basename "$file") ($size, $records records)"
  echo "    Also:  $(basename "$file").gz"
}

cmd_backup_local() {
  echo "=== Local PostgreSQL → Backup File ==="
  if ! container_running "$LOCAL_PG"; then
    echo "ERROR: Local PostgreSQL ($LOCAL_PG) is not running."
    echo "       Start it first: bash scripts/start-local-sync.sh"
    exit 1
  fi
  local file="$BACKUP_DIR/ledger-local-$(ts).sql"
  echo "Dumping local database..."
  dump_local_to_file "$file"
  local size; size=$(du -h "$file" | cut -f1)
  gzip -kf "$file"
  local records; records=$(count_records_local)
  echo "OK  Saved: $(basename "$file") ($size, $records records)"
  echo "    Also:  $(basename "$file").gz"
}

cmd_restore_to_local() {
  local file="${1:-}"
  if [ -z "$file" ]; then
    file=$(ls -t "$BACKUP_DIR"/ledger-*.sql 2>/dev/null | head -1)
    if [ -z "$file" ]; then
      echo "ERROR: No backup file found in $BACKUP_DIR/"
      echo "       Run: bash scripts/data-sync.sh backup-cloud  (if server is up)"
      exit 1
    fi
    echo "No file specified, using latest: $(basename "$file")"
  fi
  if [ ! -f "$file" ]; then
    echo "ERROR: File not found: $file"
    exit 1
  fi
  echo "=== Restore Backup → Local PostgreSQL ==="
  if ! container_running "$LOCAL_PG"; then
    echo "ERROR: Local PostgreSQL is not running."
    echo "       Start it first: bash scripts/start-local-sync.sh"
    exit 1
  fi
  echo "Restoring from: $(basename "$file") ($(du -h "$file" | cut -f1))"
  # Drop existing schema first: plain backup dumps contain no DROP statements,
  # so restoring over an already-initialized (or previously restored) DB
  # would fail with duplicate-table/constraint errors.
  echo "Resetting local schema (public)..."
  docker exec -i "$LOCAL_PG" psql -U "$PG_USER" -d "$PG_DB" \
    -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" 2>&1 | grep -E "^(ERROR|FATAL)" || true
  cat "$file" | docker exec -i "$LOCAL_PG" psql -U "$PG_USER" -d "$PG_DB" 2>&1 | grep -E "^(ERROR|FATAL)" || true
  echo "OK  Local records: $(count_records_local)"
  echo "    Last transaction: $(last_tx_local)"
}

cmd_sync_cloud_to_local() {
  echo "=== Live Sync: Cloud → Local PostgreSQL ==="
  if ! ssh_ok; then
    echo "ERROR: Cannot reach cloud server ($SSH_ALIAS)."
    exit 1
  fi
  if ! container_running "$LOCAL_PG"; then
    echo "ERROR: Local PostgreSQL is not running."
    echo "       Start it first: bash scripts/start-local-sync.sh"
    exit 1
  fi
  local cloud_count; cloud_count=$(count_records_cloud)
  local local_count; local_count=$(count_records_local)
  echo "  Cloud records: $cloud_count"
  echo "  Local records: $local_count"

  # Safety backup of local (if it has data)
  if [ "$local_count" != "0" ] && [ "$local_count" != "n/a" ] && [ "$local_count" != "error" ]; then
    local backup="$BACKUP_DIR/ledger-local-before-sync-$(ts).sql"
    echo "  Safety backup of local DB..."
    dump_local_to_file "$backup"
    echo "  Saved: $(basename "$backup")"
  fi

  echo "  Dumping cloud → temp file..."
  local tmpfile="$TMP_DIR/ledger-sync-$(ts).sql"
  dump_cloud_to_file "$tmpfile" "--clean --if-exists"

  echo "  Restoring to local PostgreSQL..."
  cat "$tmpfile" | docker exec -i "$LOCAL_PG" psql -U "$PG_USER" -d "$PG_DB" 2>&1 \
    | grep -E "^(ERROR|FATAL)" || true
  rm -f "$tmpfile"

  echo "OK  Local records now: $(count_records_local)"
  echo "    Last transaction:  $(last_tx_local)"
}

cmd_sync_local_to_cloud() {
  echo "=== Push: Local PostgreSQL → Cloud ==="
  echo "WARNING: This OVERWRITES the cloud database with local data."
  if ! container_running "$LOCAL_PG"; then
    echo "ERROR: Local PostgreSQL is not running."
    exit 1
  fi
  if ! ssh_ok; then
    echo "ERROR: Cannot reach cloud server ($SSH_ALIAS)."
    echo "       The server may be offline or expired."
    exit 1
  fi
  local local_count; local_count=$(count_records_local)
  local cloud_count; cloud_count=$(count_records_cloud)
  echo "  Local records: $local_count"
  echo "  Cloud records: $cloud_count"

  # Safety backup of cloud (always, before overwriting)
  local backup="$BACKUP_DIR/ledger-cloud-before-push-$(ts).sql"
  echo "  Safety backup of cloud DB..."
  dump_cloud_to_file "$backup"
  echo "  Saved: $(basename "$backup") ($(du -h "$backup" | cut -f1))"

  # Dump local → temp file, then upload+restore to cloud
  echo "  Dumping local DB → temp file..."
  local tmpfile="$TMP_DIR/ledger-push-$(ts).sql"
  dump_local_to_file "$tmpfile" "--clean --if-exists"

  echo "  Uploading & restoring to cloud..."
  restore_file_to_cloud "$tmpfile"
  rm -f "$tmpfile"

  echo "OK  Cloud records now: $(count_records_cloud)"
  echo "    Last transaction:  $(last_tx_cloud)"
}

cmd_status() {
  echo ""
  echo "  ╔══════════════════════════════════════════════╗"
  echo "  ║          Data Storage Status                   ║"
  echo "  ╚══════════════════════════════════════════════╝"
  echo ""

  # Cloud
  echo "  Cloud Server ($SSH_ALIAS):"
  if ssh_ok; then
    local cloud_count; cloud_count=$(count_records_cloud)
    local cloud_last; cloud_last=$(last_tx_cloud)
    echo "    Status:        Online"
    echo "    Records:       $cloud_count"
    echo "    Last tx:       $cloud_last"
  else
    echo "    Status:        Offline (server unreachable)"
  fi
  echo ""

  # Local
  echo "  Local PostgreSQL:"
  if container_running "$LOCAL_PG"; then
    local local_count; local_count=$(count_records_local)
    local local_last; local_last=$(last_tx_local)
    echo "    Status:        Running"
    echo "    Records:       $local_count"
    echo "    Last tx:       $local_last"
  else
    echo "    Status:        Not running"
    echo "                   Start: bash scripts/start-local-sync.sh"
  fi
  echo ""

  # Backups
  echo "  Backup Files ($BACKUP_DIR):"
  local latest; latest=$(ls -t "$BACKUP_DIR"/ledger-*.sql 2>/dev/null | head -1)
  if [ -n "$latest" ]; then
    local lsize; lsize=$(du -h "$latest" | cut -f1)
    local ldate; ldate=$(stat -f '%Sm' -t '%Y-%m-%d %H:%M' "$latest")
    echo "    Latest:        $(basename "$latest")"
    echo "    Size:          $lsize"
    echo "    Date:          $ldate"
    local total; total=$(ls -1 "$BACKUP_DIR"/ledger-*.sql 2>/dev/null | wc -l | tr -d ' ')
    echo "    Total backups: $total SQL files"
  else
    echo "    No backups found"
  fi
  echo ""

  # Recommendation
  echo "  Recommendation:"
  if ssh_ok && container_running "$LOCAL_PG"; then
    echo "    Both online. Run 'sync-cloud-to-local' to keep them in sync."
  elif ssh_ok && ! container_running "$LOCAL_PG"; then
    echo "    Cloud online, local PG offline. Run 'backup-cloud' for a file backup."
  elif ! ssh_ok && container_running "$LOCAL_PG"; then
    echo "    Cloud offline, local PG running. Your data is safe locally."
    echo "    When cloud is back: run 'sync-local-to-cloud' to push data up."
  else
    echo "    Both offline. Restore from latest backup when ready."
  fi
  echo ""
}

# ── Main ─────────────────────────────────────────────────────────────────────

case "${1:-status}" in
  status)              cmd_status ;;
  backup-cloud)       cmd_backup_cloud ;;
  backup-local)       cmd_backup_local ;;
  restore-to-local)   cmd_restore_to_local "${2:-}" ;;
  sync-cloud-to-local)  cmd_sync_cloud_to_local ;;
  sync-local-to-cloud)  cmd_sync_local_to_cloud ;;
  *)
    cat <<EOF
Usage: bash scripts/data-sync.sh <command>

Commands:
  status                 Show both sides' status (record counts, last tx dates)
  backup-cloud           Dump cloud DB → ./backups/ SQL file (+ gzip)
  backup-local           Dump local PostgreSQL → ./backups/ SQL file (+ gzip)
  restore-to-local [f]   Restore a backup file to local PostgreSQL
                         (auto-picks latest if no file given)
  sync-cloud-to-local    Live sync cloud → local PostgreSQL (overwrites local)
  sync-local-to-cloud    Push local PostgreSQL → cloud (overwrites cloud, with safety backup)
EOF
    exit 1
    ;;
esac
