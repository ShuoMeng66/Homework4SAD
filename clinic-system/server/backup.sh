#!/bin/sh
# 每日自动备份（报告表 14 可恢复性）：使用 SQLite 在线备份 API 生成一致性快照，保留最近 30 份
# 另支持恢复演练：sh backup.sh restore <backup_file.db>
set -e
DIR=/opt/clinic-system/server
DB="$DIR/clinic_rel.db"
OUT="$DIR/backups"
mkdir -p "$OUT"

if [ "$1" = "restore" ] && [ -n "$2" ]; then
  cp -f "$2" "$DB"
  echo "restored $DB from $2"
  exit 0
fi

TS=$(date +%Y%m%d-%H%M%S)
DST="$OUT/clinic-$TS.db"
python3 - "$DB" "$DST" <<'PY'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1])
dst = sqlite3.connect(sys.argv[2])
with dst:
    src.backup(dst)
src.close()
dst.close()
print('backed up relational db ->', sys.argv[2])
PY
ls -1t "$OUT"/clinic-*.db 2>/dev/null | tail -n +31 | while read -r old; do rm -f "$old"; done
