#!/usr/bin/env bash
# setup-auto-backup.sh — 一次性安装，让本地备份不依赖 WorkBuddy 是否打开。
# 用法：在 Terminal 中执行  bash scripts/setup-auto-backup.sh
set -euo pipefail

PLIST="$HOME/Library/LaunchAgents/com.personal-ledger.data-backup.plist"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SOURCE="$SCRIPT_DIR/deploy/com.personal-ledger.data-backup.plist"

echo "=== 安装自动备份定时任务 ==="
echo ""

# 1. 确保 plist 在位
if [ ! -f "$PLIST" ]; then
  echo "复制 plist 到 $PLIST ..."
  cp "$PLIST_SOURCE" "$PLIST"
else
  echo "plist 已存在，更新为新版 ..."
  cp "$PLIST_SOURCE" "$PLIST"
fi

# 2. 先卸载旧的（如果之前加载过）
launchctl unload "$PLIST" 2>/dev/null || true

# 3. 加载
echo "加载定时任务 ..."
launchctl load "$PLIST"

# 4. 验证
echo ""
if launchctl list com.personal-ledger.data-backup >/dev/null 2>&1; then
  echo "✅ 加载成功！"
  echo ""
  echo "   定时计划：每天 00:00 / 06:00 / 12:00 / 18:00 自动备份"
  echo "   登录时也会自动执行一次（补上关机期间漏掉的备份）"
  echo "   日志文件：$SCRIPT_DIR/backups/auto-backup.log"
  echo ""
  echo "   现在手动触发一次测试 ..."
  launchctl start com.personal-ledger.data-backup 2>/dev/null || true
  sleep 5
  if [ -f "$SCRIPT_DIR/backups/auto-backup.log" ]; then
    echo "   日志已生成："
    tail -10 "$SCRIPT_DIR/backups/auto-backup.log"
  fi
else
  echo "❌ 加载失败。请尝试手动执行："
  echo "   launchctl load $PLIST"
fi

echo ""
echo "=== 管理命令 ==="
echo "  查看状态:  launchctl list com.personal-ledger.data-backup"
echo "  立即执行:  launchctl start com.personal-ledger.data-backup"
echo "  停止卸载:  launchctl unload $PLIST"
echo ""
