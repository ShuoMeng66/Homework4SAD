#!/usr/bin/env python3
"""口腔诊所管理系统 — 轻量表格存储服务

设计目标：服务器只负责"存表格"，不跑业务规则、不渲染页面、不维护会话。
- 标准库 http.server + sqlite3，无 FastAPI/uvicorn/pydantic 常驻开销
- SQLite 中 table_store(name TEXT PRIMARY KEY, data TEXT)：每个业务表存一个 JSON 数组
- 接口：GET /api/health、POST /api/auth/login、GET /api/db、PUT /api/db
- 业务逻辑（BR-01~BR-08、表24 统计口径）全部在浏览器前端执行
"""
import json
import os
import sqlite3
import sys
import threading
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DB_PATH = Path(__file__).with_name('store.db')
HOST = os.environ.get('CLINIC_HOST', '127.0.0.1')
PORT = int(os.environ.get('CLINIC_PORT', '5100'))
_lock = threading.Lock()

# 表名白名单（与 seed.js 的 DB 对象一致），防止写入无关数据
TABLES = (
    'users', 'basicOptions', 'clinics', 'employees', 'rooms', 'priceItems',
    'products', 'dentalLabs', 'patients', 'appointments', 'appointmentEvents',
    'encounters', 'orders', 'orderTooths', 'orderEvents', 'orderAttachments',
    'bills', 'billLines', 'payments', 'reminders',
)


def connect():
    c = sqlite3.connect(str(DB_PATH), timeout=5)
    c.execute('PRAGMA journal_mode=WAL')   # 读写不互相阻塞，降低锁竞争与 CPU
    c.execute('PRAGMA synchronous=NORMAL')
    return c


def init_db():
    with connect() as c:
        c.execute('CREATE TABLE IF NOT EXISTS table_store('
                  'name TEXT PRIMARY KEY, data TEXT NOT NULL)')
        c.execute('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)')
        c.execute("INSERT OR IGNORE INTO meta(k,v) VALUES('revision','0')")
        # 首次启动：用随项目交付的种子数据初始化 20 张表，保证登录可用
        if c.execute('SELECT COUNT(*) FROM table_store').fetchone()[0] == 0:
            seed_file = Path(__file__).with_name('seed.json')
            if seed_file.exists():
                seed = json.loads(seed_file.read_text(encoding='utf-8'))
                for name, rows in seed.items():
                    c.execute('INSERT OR IGNORE INTO table_store(name,data) VALUES(?,?)',
                              (name, json.dumps(rows, ensure_ascii=False,
                                                separators=(',', ':'))))
                print('Initialized %d tables from seed.json' % len(seed), flush=True)


def read_db():
    with connect() as c:
        rows = c.execute('SELECT name,data FROM table_store').fetchall()
    return {name: json.loads(data) for name, data in rows}


def write_db(payload):
    if not isinstance(payload, dict):
        raise ValueError('payload must be an object')
    unknown = set(payload) - set(TABLES)
    if unknown:
        raise ValueError('unknown tables: ' + ', '.join(sorted(unknown)))
    with _lock, connect() as c:
        for name, rows in payload.items():
            c.execute('INSERT INTO table_store(name,data) VALUES(?,?) '
                      'ON CONFLICT(name) DO UPDATE SET data=excluded.data',
                      (name, json.dumps(rows, ensure_ascii=False, separators=(',', ':'))))
        c.execute("UPDATE meta SET v=CAST(CAST(v AS INTEGER)+1 AS TEXT) WHERE k='revision'")
        rev = c.execute("SELECT v FROM meta WHERE k='revision'").fetchone()[0]
    return int(rev)


def seed_db():
    """首次启动：把前端提供的种子数据写入。由前端在 connect 时调用 PUT /api/db 完成。"""
    return read_db()


def ok(data=None):
    return {'ok': True, 'data': data, 'error': None}


def err(message):
    return {'ok': False, 'data': None, 'error': message}


# ---------------------------------------------------------------------------
# 权威计算：只放"需要全局一致视角"的业务逻辑，简单 CRUD 仍由前端负责
# 口径来源：PDF BR-01、BR-03/04、BR-06、表17、表24
# ---------------------------------------------------------------------------
def compute_conflict(db, body):
    appts = db.get('appointments', [])
    doctor_id = body.get('doctor_id')
    room_id = body.get('room_id')
    start = body.get('starts_at')
    end = body.get('ends_at')
    if not start or not end or start >= end:
        return err('时间区间无效')
    excl = body.get('exclude_id')
    active = ('待确认', '已确认', '已到诊')
    conflicts = [a for a in appts
                 if a.get('id') != excl and a.get('stage') in active
                 and ((doctor_id and a.get('doctor_id') == doctor_id)
                      or (room_id and a.get('room_id') == room_id))
                 and start < a.get('ends_at', '') and end > a.get('starts_at', '')]
    if not conflicts:
        return ok({'ok': True, 'conflicts': [], 'candidates': []})
    date = start[:10]
    day = [a for a in appts if str(a.get('starts_at', '')).startswith(date)
           and a.get('stage') in active]
    cands = []
    for h in range(8, 18):
        for m in ('00', '30'):
            s = '%sT%02d:%s' % (date, h, m)
            nh = h + (1 if m == '30' else 0)
            e = '%sT%02d:%s' % (date, nh, '00' if m == '30' else '30')
            if not any(s < a.get('ends_at', '') and e > a.get('starts_at', '') for a in day):
                cands.append(s)
    return ok({'ok': False, 'conflicts': conflicts, 'candidates': cands[:6]})


def compute_bill(db, body):
    """BR-03/04：应收=行合计-整单折扣；有效已收=成功收款-成功退款；欠款=max(0,应收-已收)。"""
    bid = body.get('bill_id')
    if bid is not None:
        bill = next((b for b in db.get('bills', []) if b.get('id') == bid), None)
        if not bill:
            return err('收费单不存在')
        lines = [l for l in db.get('billLines', []) if l.get('bill_id') == bid]
        payments = [p for p in db.get('payments', []) if p.get('bill_id') == bid]
        disc = bill.get('discount_amount', 0) or 0
    else:
        lines = body.get('lines', [])
        payments = []
        disc = body.get('discount_amount', 0) or 0
    line_sum = sum(float(l.get('quantity', 0)) * float(l.get('unit_price', 0))
                   - float(l.get('discount_amount', 0) or 0) for l in lines)
    receivable = max(0.0, line_sum - float(disc))
    received = 0.0
    for p in payments:
        if p.get('result') != '成功':
            continue
        received += float(p.get('amount', 0)) * (1 if p.get('kind') == '收款' else -1)
    debt = max(0.0, receivable - received)
    return ok({'receivable': round(receivable, 2), 'received': round(received, 2),
               'debt': round(debt, 2), 'lines': len(lines), 'payments': len(payments)})


TRANSITIONS = {
    '草稿': ['已发送', '已取消'], '已发送': ['已接收', '已取消'],
    '已接收': ['试戴'], '试戴': ['质量确认', '返工'], '返工': ['试戴'],
    '质量确认': ['已交货'], '已交货': ['返工'], '取消': [],
}


def compute_transition(body):
    src, dst = body.get('from'), body.get('to')
    if dst not in TRANSITIONS.get(src, []):
        return ok({'ok': False,
                   'error': '不允许的状态转换：%s → %s%s' % (
                       src, dst, '（已交货不得直接回退）' if src == '已交货' else '')})
    return ok({'ok': True})


def compute_reports(db, start, end):
    """表24 五项统计口径。start/end 为 YYYY-MM-DD，可为空。"""
    from datetime import date as _date
    today = _date.today().isoformat()
    appts = db.get('appointments', [])
    bills = db.get('bills', [])
    orders = db.get('orders', [])
    pays = db.get('payments', [])

    def in_range(v):
        if not v:
            return False
        d = str(v)[:10]
        return (not start or d >= start) and (not end or d <= end)

    def pct(v):
        return '无可计算样本' if v is None else '%.1f%%' % (v * 100)

    def ratio(n, d):
        return n / d if d else None

    in_appts = [a for a in appts if in_range(a.get('starts_at'))]
    closed = [a for a in in_appts if a.get('stage') in ('已确认', '已到诊', '已完成', '爽约')]
    fulfilled = [a for a in in_appts if a.get('stage') in ('已到诊', '已完成')]
    fulfillment = ratio(len(fulfilled), len(closed))

    confirmed = [a for a in appts if a.get('confirmed_at') and in_range(a.get('confirmed_at'))]

    def mins(a, b):
        try:
            from datetime import datetime as _dt
            return (_dt.fromisoformat(a) - _dt.fromisoformat(b)).total_seconds() / 60
        except Exception:
            return 0
    cyc = sorted(mins(a['confirmed_at'], a.get('created_at') or a['confirmed_at']) for a in confirmed)
    mid = None
    if cyc:
        n = len(cyc)
        mid = cyc[n // 2] if n % 2 else (cyc[n // 2 - 1] + cyc[n // 2]) / 2

    opened = [b for b in bills if b.get('debt_opened_at')
              and (not end or str(b['debt_opened_at'])[:10] <= end)]
    opening = recovery = 0.0
    for b in opened:
        lines = [l for l in db.get('billLines', []) if l.get('bill_id') == b['id']]
        line_sum = sum(float(l.get('quantity', 0)) * float(l.get('unit_price', 0))
                       - float(l.get('discount_amount', 0) or 0) for l in lines)
        opening += max(0.0, line_sum - float(b.get('discount_amount', 0) or 0))
        got = 0.0
        for p in pays:
            if p.get('bill_id') == b['id'] and p.get('result') == '成功' and in_range(
                    p.get('occurred_at') or p.get('requested_at')):
                got += float(p.get('amount', 0)) * (1 if p.get('kind') == '收款' else -1)
        recovery += max(0.0, got)
    rec_rate = ratio(recovery, opening)

    in_orders = [o for o in orders if o.get('promised_date')
                 and (not start or o['promised_date'] >= start)
                 and (not end or o['promised_date'] <= end)]
    due = [o for o in in_orders if o['promised_date'] < today
           and o.get('stage') not in ('已交货', '取消')]
    done = [o for o in in_orders if o.get('stage') == '已交货']
    on_time = [o for o in done if o.get('delivered_at')
               and str(o['delivered_at'])[:10] <= o['promised_date']]
    on_time_rate = ratio(len(on_time), len(done) + len(due))

    encounters = db.get('encounters', [])
    bills_ok = [b for b in bills if any(e['id'] == b.get('encounter_id') for e in encounters)]
    orders_ok = [o for o in orders if any(e['id'] == o.get('encounter_id') for e in encounters)
                 and any(v.get('order_id') == o['id'] for v in db.get('orderEvents', []))]
    total = len(bills) + len(orders)
    complete = ratio(len(bills_ok) + len(orders_ok), total)

    metrics = [
        {'key': 'appointmentConfirmMedian', 'name': '预约确认周期中位数',
         'value': '无可计算样本' if mid is None else '%.1f 分钟' % mid,
         'sample': len(cyc)},
        {'key': 'fulfillment', 'name': '预约兑现率', 'value': pct(fulfillment),
         'sample': len(closed), 'numerator': len(fulfilled), 'denominator': len(closed)},
        {'key': 'recovery', 'name': '欠款回收率', 'value': pct(rec_rate),
         'sample': len(opened), 'numerator': round(recovery, 2), 'denominator': round(opening, 2)},
        {'key': 'onTime', 'name': '订单按期交付率', 'value': pct(on_time_rate),
         'sample': len(done) + len(due), 'numerator': len(on_time),
         'denominator': len(done) + len(due)},
        {'key': 'completeness', 'name': '记录关联完整度', 'value': pct(complete),
         'sample': total, 'numerator': len(bills_ok) + len(orders_ok), 'denominator': total},
    ]
    return ok({'start': start, 'end': end, 'metrics': metrics,
               'anomalies': [b['id'] for b in bills if b not in bills_ok]
                            + [o['id'] for o in orders if o not in orders_ok],
               'overdue': [o['order_no'] for o in orders if o.get('promised_date')
                           and o['promised_date'] < today and o.get('stage') not in ('已交货', '取消')],
               'trial': [o['order_no'] for o in orders if o.get('stage') in ('试戴', '质量确认')],
               'delivered': [o['order_no'] for o in orders if o.get('stage') == '已交货']})


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'ClinicStore/1.0'

    def log_message(self, fmt, *args):
        # 精简日志：只记录非健康检查请求，避免刷屏
        if '/health' not in self.path:
            sys.stderr.write('[%s] %s\n' % (datetime.now().strftime('%H:%M:%S'), fmt % args))

    def _send(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type,X-Token,X-Role')
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        length = int(self.headers.get('Content-Length') or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode('utf-8'))

    def do_OPTIONS(self):
        self._send(ok())

    @staticmethod
    def _normalize(path):
        # nginx /clinic-api/ → :5100/api/ 已补 /api；直连测试则未补。两者都兼容。
        return path[4:] if path.startswith('/api/') else path

    def do_GET(self):
        path = self._normalize(self.path.split('?')[0])
        if path == '/health':
            db = read_db()
            self._send(ok({'service': 'clinic-table-store', 'tables': len(db),
                           'rows': sum(len(v) for v in db.values()),
                           'time': datetime.now().isoformat(timespec='seconds')}))
        elif path == '/db':
            self._send(ok(read_db()))
        elif path == '/compute/reports':
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(self.path).query)
            self._send(compute_reports(read_db(), (q.get('start') or [''])[0],
                                       (q.get('end') or [''])[0]))
        elif path == '/':
            self._send(ok({'service': '口腔诊所管理系统 · 表格存储服务',
                           'endpoints': ['/api/health', '/api/auth/login', '/api/db']}))
        else:
            self._send(err('not found'), 404)

    def do_POST(self):
        path = self._normalize(self.path.split('?')[0])
        if path == '/auth/login':
            try:
                body = self._body()
            except Exception:
                self._send(err('invalid json'), 400)
                return
            users = read_db().get('users', [])
            u = next((x for x in users
                      if x.get('username') == body.get('username')
                      and x.get('password') == body.get('password')), None)
            if not u:
                self._send(err('账号或密码错误'), 401)
                return
            self._send(ok({'username': u['username'], 'role': u['role'],
                           'name': u.get('name', u['username']),
                           'token': 'local-' + u['username']}))
        elif path == '/compute/conflict':
            try:
                self._send(compute_conflict(read_db(), self._body()))
            except Exception as e:
                self._send(err(str(e)), 400)
        elif path == '/compute/bill':
            try:
                self._send(compute_bill(read_db(), self._body()))
            except Exception as e:
                self._send(err(str(e)), 400)
        elif path == '/compute/transition':
            try:
                self._send(compute_transition(self._body()))
            except Exception as e:
                self._send(err(str(e)), 400)
        else:
            self._send(err('not found'), 404)

    def do_PUT(self):
        path = self._normalize(self.path.split('?')[0])
        if path != '/db':
            self._send(err('not found'), 404)
            return
        try:
            payload = self._body()
            rev = write_db(payload)
            self._send(ok({'revision': rev, 'tables': len(payload)}))
        except Exception as e:
            self._send(err(str(e)), 400)


def main():
    init_db()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    srv.daemon_threads = True
    print('Clinic table store listening on %s:%d (db=%s)' % (HOST, PORT, DB_PATH), flush=True)
    try:
        srv.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == '__main__':
    main()
