#!/bin/sh
# 每日备份：导出 SQLite 中全部业务表为带时间戳的 JSON 快照
# 由 systemd timer clinic-backup.timer 每日触发，保留最近 30 份
set -e
DIR=/opt/clinic-system/server
OUT="$DIR/backups"
mkdir -p "$OUT"
TS=$(date +%Y%m%d-%H%M%S)
python3 - "$DIR/store.db" "$OUT/store-$TS.json" <<'PY'
import json, sqlite3, sys
src, dst = sys.argv[1], sys.argv[2]
c = sqlite3.connect(src)
rows = c.execute('SELECT name, data FROM table_store').fetchall()
data = {name: json.loads(js) for name, js in rows}
with open(dst, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
print('backed up %d tables' % len(data))
PY
ls -1t "$OUT"/store-*.json 2>/dev/null | tail -n +31 | while read -r old; do rm -f "$old"; done
