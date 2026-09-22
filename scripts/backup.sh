#!/usr/bin/env bash
# =============================================================================
# scripts/backup.sh — P17 H5 魅魔来袭 | PostgreSQL 备份脚本
# =============================================================================
# 用途: 每日备份 PostgreSQL 数据库到 /opt/repark/backups/
# 调用: 由 systemd timer 自动执行（见 deploy.sh 里的 timer 配置）
#
# 用法:
#   ./backup.sh                          # 标准备份
#   ./backup.sh --dry-run               # 模拟运行，不实际备份
#   ./backup.sh --cleanup-only          # 只清理旧备份
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

BACKUP_DIR="${BACKUP_DIR:-/opt/repark/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"
DATABASE_URL="${DATABASE_URL:-}"

# 环境检查
if [[ -z "$DATABASE_URL" ]]; then
  # 尝试从 .env.production 加载
  ENV_FILE="${ENV_FILE:-/opt/repark/.env.production}"
  if [[ -f "$ENV_FILE" ]]; then
    set -a
    source "$ENV_FILE"
    set +a
  fi
fi

[[ -n "$DATABASE_URL" ]] || { echo "ERROR: DATABASE_URL 未设置" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/repark_${TIMESTAMP}.dump"

# Dry run
if [[ "${1:-}" == "--dry-run" ]]; then
  echo "DRY RUN: would run:"
  echo "  pg_dump $DATABASE_URL -> $BACKUP_FILE"
  echo "  keep: $KEEP_DAYS days in $BACKUP_DIR"
  exit 0
fi

# Cleanup only
if [[ "${1:-}" == "--cleanup-only" ]]; then
  echo "清理超过 $KEEP_DAYS 天的备份..."
  find "$BACKUP_DIR" -name "repark_*.dump" -mtime "+$KEEP_DAYS" -delete
  echo "清理完成"
  exit 0
fi

# 执行备份
echo "[BACKUP] 开始备份数据库 -> $BACKUP_FILE"
if pg_dump "$DATABASE_URL" -F c -b > "$BACKUP_FILE" 2>&1; then
  SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
  echo "[BACKUP] 成功: $BACKUP_FILE ($SIZE)"
else
  echo "[BACKUP] 失败!" >&2
  exit 1
fi

# 清理旧备份
CLEANED=$(find "$BACKUP_DIR" -name "repark_*.dump" -mtime "+$KEEP_DAYS" -print -delete | wc -l)
echo "[BACKUP] 清理了 $CLEANED 个超过 $KEEP_DAYS 天的旧备份"
echo "[BACKUP] 完成: $(date)"