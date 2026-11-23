#!/usr/bin/env python3
"""口腔诊所管理系统 — 轻量表格存储服务

设计目标：服务器只负责"存表格"，不跑业务规则、不渲染页面、不维护会话。
- 标准库 http.server + sqlite3，无 FastAPI/uvicorn/pydantic 常驻开销
- SQLite 中 table_store(name TEXT PRIMARY KEY, data TEXT)：每个业务表存一个 JSON 数组
- 接口：GET /api/health、POST /api/auth/login、GET /api/db、PUT /api/db
- 业务逻辑（BR-01~BR-08、表24 统计口径）全部在浏览器前端执行
"""
import calendar
import json
import os
import sqlite3
import sys
import threading
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DB_PATH = Path(__file__).with_name('store.db')
HOST = os.environ.get('CLINIC_HOST', '127.0.0.1')
PORT = int(os.environ.get('CLINIC_PORT', '5100'))
_lock = threading.Lock()

# 表名白名单（与 seed.js 的 DB 对象一致），防止写入无关数据
TABLES = (
    'users', 'basicOptions', 'appointmentTypes', 'clinics', 'employees', 'rooms',
    'priceItems', 'products', 'dentalLabs', 'patients', 'schedules',
    'appointments', 'appointmentEvents', 'encounters', 'recalls',
    'orders', 'orderTooths', 'orderEvents', 'orderAttachments',
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


def migrate():
    """补齐新增业务表并做一次性字段/字典迁移，已有数据不覆盖。"""
    seed_file = Path(__file__).with_name('seed.json')
    if not seed_file.exists():
        return
    seed = json.loads(seed_file.read_text(encoding='utf-8'))
    existing = set(read_db().keys())
    missing = {k: v for k, v in seed.items() if k not in existing}
    if missing:
        write_db(missing)
        print('新增数据表：%s' % ', '.join(missing), flush=True)

    db = read_db()
    changed = {}

    # 预约类型改为独立表后，字典里不再重复保存同类选项
    opts = db.get('basicOptions', [])
    kept = [o for o in opts if o.get('kind') != '预约类型']
    if len(kept) != len(opts):
        changed['basicOptions'] = kept

    # 老预约补来源标记，界面按「前台」展示
    appts = db.get('appointments', [])
    if any('source' not in a for a in appts):
        for a in appts:
            a.setdefault('source', '前台')
            a.setdefault('schedule_id', None)
        changed['appointments'] = appts

    if changed:
        write_db(changed)
        print('迁移字段：%s' % ', '.join(changed), flush=True)


def ensure_seed_users():
    """把 seed.json 中的账号补进已有库：只新增缺失项，不覆盖已有账号。"""
    seed_file = Path(__file__).with_name('seed.json')
    if not seed_file.exists():
        return
    seed = json.loads(seed_file.read_text(encoding='utf-8'))
    wanted = seed.get('users', [])
    if not wanted:
        return
    users = read_db().get('users', [])
    have = {u.get('username') for u in users if isinstance(u, dict)}
    missing = [u for u in wanted if u.get('username') not in have]
    if missing:
        users.extend(missing)
        write_db({'users': users})
        print('Added %d users: %s' % (
            len(missing), ', '.join(u['username'] for u in missing)), flush=True)


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

    # 表24：固定期初欠款收费单队列；分母为期初未收余额（应收-期初前有效收款），
    # 分子为该队列在期间实际回收（成功收款-成功退款），期间新增欠款另列。
    queue = [b for b in bills if b.get('debt_opened_at')
             and str(b['debt_opened_at'])[:10] < (start or end or '9999')]
    opening = recovery = 0.0
    for b in queue:
        lines = [l for l in db.get('billLines', []) if l.get('bill_id') == b['id']]
        line_sum = sum(float(l.get('quantity', 0)) * float(l.get('unit_price', 0))
                       - float(l.get('discount_amount', 0) or 0) for l in lines)
        receivable = max(0.0, line_sum - float(b.get('discount_amount', 0) or 0))
        before = 0.0
        got = 0.0
        for p in pays:
            if p.get('bill_id') != b['id'] or p.get('result') != '成功':
                continue
            signed = float(p.get('amount', 0)) * (1 if p.get('kind') == '收款' else -1)
            d = str(p.get('occurred_at') or p.get('requested_at') or '')[:10]
            if start and d < start:
                before += signed
            if in_range(p.get('occurred_at') or p.get('requested_at')):
                got += signed
        opening += max(0.0, receivable - before)
        recovery += got
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
         'sample': len(queue), 'numerator': round(recovery, 2), 'denominator': round(opening, 2)},
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


# ---------------------------------------------------------------------------
# 事务性业务提交（设计书 8.7）
# 每张业务表是 table_store 中一行 JSON。写事务内用进程锁 + SQLite 写事务
# 串行化整个提交，等价于"按固定顺序锁定涉及的医生和诊室"的严格实现：
# 后提交者必须读到前一提交的结果，界面上的一次检查不作为最终依据。
# ---------------------------------------------------------------------------
class TxError(Exception):
    pass


def _now():
    return datetime.now().isoformat(timespec='seconds')


def _next_id(rows):
    return max([int(r.get('id') or 0) for r in rows] + [0]) + 1


def _next_no(rows, field, prefix):
    nums = []
    for r in rows:
        v = str(r.get(field) or '')
        if v.startswith(prefix) and v[len(prefix):].isdigit():
            nums.append(int(v[len(prefix):]))
    return '%s%04d' % (prefix, max(nums + [0]) + 1)


def _overlap(appts, doctor_id, room_id, s, e, exclude_id=None):
    return [a for a in appts
            if a.get('id') != exclude_id and a.get('stage') in ('待确认', '已确认', '已到诊')
            and ((doctor_id and a.get('doctor_id') == doctor_id)
                 or (room_id and a.get('room_id') == room_id))
            and s < a.get('ends_at', '') and e > a.get('starts_at', '')]


def _tx_db(c):
    return {n: json.loads(d) for n, d in
            c.execute('SELECT name,data FROM table_store').fetchall()}


def _tx_write(c, db, tables):
    for name in tables:
        c.execute('INSERT INTO table_store(name,data) VALUES(?,?) '
                  'ON CONFLICT(name) DO UPDATE SET data=excluded.data',
                  (name, json.dumps(db.get(name, []), ensure_ascii=False,
                                    separators=(',', ':'))))
    c.execute("UPDATE meta SET v=CAST(CAST(v AS INTEGER)+1 AS TEXT) WHERE k='revision'")
    return int(c.execute("SELECT v FROM meta WHERE k='revision'").fetchone()[0])


def _add_reminder(db, order, kind):
    """设计书 6.5 / UC-03 步骤8：订单形成试戴或取件提醒日期。"""
    if not order.get('promised_date'):
        return
    target = str(order['promised_date']) + 'T09:00'
    rec = next((p.get('phone') for p in db.get('patients', [])
                if p.get('id') == next((e.get('patient_id') for e in db.get('encounters', [])
                                        if e.get('id') == order.get('encounter_id')), None)), '')
    db.setdefault('reminders', []).append({
        'id': _next_id(db['reminders']), 'order_id': order['id'], 'appointment_id': None,
        'channel_id': 6, 'created_by': 4, 'kind': kind, 'scheduled_at': target,
        'recipient': rec, 'content': '订单 %s：%s' % (order.get('order_no', ''), kind),
        'delivery_result': '待发送', 'attempt_count': 0, 'last_attempt_at': None,
        'sent_at': None, 'failure_reason': None,
    })


def tx_create_appointment(body):
    with _lock, connect() as c:
        db = _tx_db(c)
        s, e = body.get('starts_at'), body.get('ends_at')
        if not s or not e or s >= e:
            raise TxError('时间区间无效')
        if _overlap(db['appointments'], body.get('doctor_id'), body.get('room_id'), s, e):
            raise TxError('医生或诊室在该时段已有有效预约（事务检查）')
        row = dict(body)
        row.update({
            'id': _next_id(db['appointments']),
            'appointment_no': _next_no(db['appointments'], 'appointment_no', 'A'),
            'created_at': _now(),
            'confirmed_at': _now() if row.get('stage') == '已确认' else None,
            'arrived_at': None, 'completed_at': None, 'cancelled_at': None,
            'cancel_reason': row.get('cancel_reason'),
        })
        db['appointments'].append(row)
        db['appointmentEvents'].append({
            'id': _next_id(db['appointmentEvents']), 'appointment_id': row['id'],
            'changed_by': int(row.get('created_by') or 1),
            'old_start': None, 'new_start': s, 'old_end': None, 'new_end': e,
            'old_stage': None, 'new_stage': row.get('stage'),
            'reason': '新建预约', 'occurred_at': _now(),
        })
        _tx_write(c, db, ('appointments', 'appointmentEvents'))
        return row


def tx_reschedule_appointment(body):
    with _lock, connect() as c:
        db = _tx_db(c)
        a = next((x for x in db['appointments'] if x.get('id') == body.get('id')), None)
        if not a:
            raise TxError('预约不存在')
        s, e = body.get('starts_at'), body.get('ends_at')
        if not s or not e or s >= e:
            raise TxError('时间区间无效')
        if _overlap(db['appointments'], a.get('doctor_id'), a.get('room_id'), s, e, a['id']):
            raise TxError('改约时段冲突（事务检查）')
        db['appointmentEvents'].append({
            'id': _next_id(db['appointmentEvents']), 'appointment_id': a['id'],
            'changed_by': int(body.get('changed_by') or 1),
            'old_start': a['starts_at'], 'new_start': s,
            'old_end': a['ends_at'], 'new_end': e,
            'old_stage': a['stage'], 'new_stage': a['stage'],
            'reason': body.get('reason') or '改约', 'occurred_at': _now(),
        })
        a['starts_at'], a['ends_at'] = s, e
        _tx_write(c, db, ('appointments', 'appointmentEvents'))
        return a


def tx_appointment_stage(body):
    with _lock, connect() as c:
        db = _tx_db(c)
        a = next((x for x in db['appointments'] if x.get('id') == body.get('id')), None)
        if not a:
            raise TxError('预约不存在')
        src, dst = a.get('stage'), body.get('stage')
        legal = {
            '待确认': ['已确认', '已取消'], '已确认': ['已到诊', '已取消'],
            '已到诊': ['已完成', '爽约'], '已完成': [], '已取消': [], '爽约': [],
        }
        if dst not in legal.get(src, []):
            raise TxError('不允许的预约状态转换：%s → %s' % (src, dst))
        reason = body.get('reason') or ''
        if dst in ('已取消', '爽约') and not reason:
            raise TxError('取消或爽约须填写原因')
        a['stage'] = dst
        stamp = {'已确认': 'confirmed_at', '已到诊': 'arrived_at',
                 '已完成': 'completed_at'}.get(dst)
        if stamp:
            a[stamp] = _now()
        if dst in ('已取消', '爽约'):
            a['cancelled_at'] = _now(); a['cancel_reason'] = reason
        db['appointmentEvents'].append({
            'id': _next_id(db['appointmentEvents']), 'appointment_id': a['id'],
            'changed_by': int(body.get('changed_by') or 1),
            'old_start': a['starts_at'], 'new_start': a['starts_at'],
            'old_end': a['ends_at'], 'new_end': a['ends_at'],
            'old_stage': src, 'new_stage': dst,
            'reason': reason, 'occurred_at': _now(),
        })
        _tx_write(c, db, ('appointments', 'appointmentEvents'))
        return a


def tx_create_bill(body):
    with _lock, connect() as c:
        db = _tx_db(c)
        enc_id = body.get('encounter_id')
        dup = next((b for b in db['bills'] if b.get('encounter_id') == enc_id
                    and str(b.get('issued_at', ''))[:10] == datetime.now().date().isoformat()
                    and b.get('stage') != '已作废'), None)
        if dup and body.get('strictDup'):
            raise TxError('检测到重复收费，已拒绝提交')
        lines = body.get('lines') or []
        line_sum = sum(float(l.get('quantity', 0)) * float(l.get('unit_price', 0))
                       - float(l.get('discount_amount', 0) or 0) for l in lines)
        disc = float(body.get('discount_amount') or 0)
        if not lines or line_sum <= 0 or disc > line_sum:
            raise TxError('收费明细无效或整单折扣超出允许范围')
        bill = {
            'id': _next_id(db['bills']), 'bill_no': _next_no(db['bills'], 'bill_no', 'B'),
            'encounter_id': int(enc_id), 'issued_by': int(body.get('issued_by') or 3),
            'discount_amount': disc, 'discount_reason': body.get('discount_reason') or '',
            'issued_at': _now(), 'due_date': body.get('due_date') or None,
            'debt_opened_at': None, 'settled_at': None, 'collection_note': '',
            'stage': '欠款中', 'voided_at': None, 'void_reason': None,
        }
        db['bills'].append(bill)
        for i, l in enumerate(lines):
            db['billLines'].append({
                'id': _next_id(db['billLines']), 'bill_id': bill['id'], 'line_no': i + 1,
                'price_item_id': int(l.get('price_item_id') or 0),
                'dental_order_id': l.get('dental_order_id') or None,
                'item_name': l.get('item_name') or '',
                'unit': l.get('unit') or '颗', 'quantity': float(l.get('quantity') or 0),
                'unit_price': float(l.get('unit_price') or 0),
                'discount_amount': float(l.get('discount_amount') or 0),
                'description': l.get('description') or '',
            })
        # UC-02 步骤5-7：保存后系统请求支付服务，先落待确认支付，再由结果核对更新
        amount = round(max(0.0, line_sum - disc), 2)
        if amount > 0:
            db['payments'].append({
                'id': _next_id(db['payments']), 'bill_id': bill['id'],
                'request_no': _next_no(db['payments'], 'request_no', 'REQ'),
                'external_txn_no': None, 'method_id': int(body.get('method_id') or 3),
                'refund_of_id': None, 'kind': '收款', 'result': '待确认',
                'amount': amount, 'requested_at': _now(), 'occurred_at': None,
                'failure_reason': None, 'checked_at': None,
            })
            bill['debt_opened_at'] = _now()
        _tx_write(c, db, ('bills', 'billLines', 'payments'))
        return bill


def tx_payment_result(body):
    with _lock, connect() as c:
        db = _tx_db(c)
        p = next((x for x in db['payments'] if x.get('id') == body.get('id')), None)
        if not p:
            raise TxError('支付记录不存在')
        result = body.get('result')
        if result not in ('成功', '失败', '待确认', '退款'):
            raise TxError('支付结果不合法')
        if result == '退款':
            original = next((x for x in db['payments']
                             if x.get('id') == p.get('refund_of_id') and x.get('result') == '成功'), None)
            if not original:
                raise TxError('退款必须引用原成功收款')
            refunded = sum(float(x.get('amount') or 0) for x in db['payments']
                           if x.get('refund_of_id') == original['id'] and x.get('result') == '成功')
            if refunded + float(p.get('amount') or 0) > float(original.get('amount') or 0):
                raise TxError('同单累计退款超过原成功金额')
        p.update({'result': result, 'occurred_at': _now(), 'checked_at': _now(),
                  'external_txn_no': body.get('external_txn_no') or p.get('external_txn_no'),
                  'failure_reason': body.get('failure_reason') or None})
        bill = next((b for b in db['bills'] if b.get('id') == p.get('bill_id')), None)
        if bill:
            calc = compute_bill(db, {'bill_id': bill['id']})
            if calc.get('ok') and calc['data']['debt'] <= 0:
                bill['stage'] = '已结清'; bill['settled_at'] = _now()
            else:
                bill['stage'] = '欠款中'; bill['settled_at'] = None
                if not bill.get('debt_opened_at'):
                    bill['debt_opened_at'] = _now()
        _tx_write(c, db, ('payments', 'bills'))
        return p


def tx_order_transition(body):
    with _lock, connect() as c:
        db = _tx_db(c)
        o = next((x for x in db['orders'] if x.get('id') == body.get('id')), None)
        if not o:
            raise TxError('订单不存在')
        src, dst = o.get('stage'), body.get('to')
        if dst not in TRANSITIONS.get(src, []):
            raise TxError('不允许的状态转换：%s → %s' % (src, dst))
        if dst == '已发送' and not any(t.get('order_id') == o['id'] for t in db['orderTooths']):
            raise TxError('已发送订单至少需要一个有效牙位')
        o['stage'] = dst
        stamp = {'已发送': 'sent_at', '已接收': 'accepted_at', '试戴': 'trial_at',
                 '质量确认': 'trial_at', '已交货': 'delivered_at'}.get(dst)
        if stamp:
            o[stamp] = _now()
        db['orderEvents'].append({
            'id': _next_id(db['orderEvents']), 'order_id': o['id'],
            'source': body.get('source') or '诊所', 'event_no': body.get('event_no') or _next_no(db['orderEvents'], 'event_no', 'EVT'),
            'old_stage': src, 'new_stage': dst, 'occurred_at': _now(),
            'reason': body.get('reason') or '', 'trial_result': body.get('trial_result'),
            'expected_finish_date': body.get('expected_finish_date'),
        })
        if dst == '质量确认':
            _add_reminder(db, o, '试戴提醒')
        if dst == '已交货':
            _add_reminder(db, o, '取件提醒')
        _tx_write(c, db, ('orders', 'orderEvents', 'reminders'))
        return o


def tx_order_receipt(body):
    with _lock, connect() as c:
        db = _tx_db(c)
        o = next((x for x in db['orders'] if x.get('id') == body.get('id')), None)
        if not o:
            raise TxError('订单不存在')
        src, dst = o.get('stage'), body.get('new_stage')
        if dst not in TRANSITIONS.get(src, []):
            raise TxError('不允许的状态转换：%s → %s' % (src, dst))
        source, event_no = body.get('source'), body.get('event_no')
        if not source or not event_no:
            raise TxError('回执缺少来源或事件号')
        dup = next((e for e in db['orderEvents']
                    if e.get('source') == source and e.get('event_no') == event_no), None)
        if dup:
            return {'ok': True, 'duplicate': True, 'order': o}
        db['orderEvents'].append({
            'id': _next_id(db['orderEvents']), 'order_id': o['id'],
            'source': source, 'event_no': event_no,
            'old_stage': src, 'new_stage': dst, 'occurred_at': _now(),
            'reason': body.get('reason') or '', 'trial_result': body.get('trial_result'),
            'expected_finish_date': body.get('expected_finish_date'),
            'external_order_no': body.get('external_order_no'),
        })
        o['stage'] = dst
        if dst == '已接收':
            o['accepted_at'] = _now()
        if dst in ('试戴', '质量确认'):
            o['trial_at'] = _now()
        if dst == '返工':
            o['rework_at'] = _now()
        if dst == '质量确认':
            _add_reminder(db, o, '试戴提醒')
        _tx_write(c, db, ('orders', 'orderEvents', 'reminders'))
        return {'ok': True, 'duplicate': False, 'order': o}


def compute_pay(body):
    """模拟支付服务：请求号由前端携带，返回外部交易标识与结果。"""
    req = body.get('request_no')
    result = body.get('mock_result') or '成功'
    if result not in ('成功', '失败', '待确认'):
        return err('模拟结果不合法')
    return ok({'request_no': req, 'result': result,
               'external_txn_no': 'TXN' + datetime.now().strftime('%Y%m%d%H%M%S'),
               'failure_reason': '支付服务返回失败' if result == '失败' else None})


def _hm(text):
    """'09:30' → 570（当日分钟数）"""
    try:
        h, m = str(text)[:5].split(':')
        return int(h) * 60 + int(m)
    except Exception:
        return None


def _add_months(d, months):
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    return d.replace(year=y, month=m, day=min(d.day, calendar.monthrange(y, m)[1]))


def _in_grid(segs, s, e, duration):
    """时段必须落在某个出诊段内，起点对齐切片，时长与预约类型一致（BR-09）"""
    st, en = _hm(s[11:16]), _hm(e[11:16])
    if st is None or en is None:
        return False
    for seg in segs:
        if seg.get('stage') == '停诊':
            continue
        step = int(seg.get('slot_minutes') or 15)
        cur, end = _hm(seg.get('start_time')), _hm(seg.get('end_time'))
        if None in (cur, end):
            continue
        if (st - cur) % step or en - st != duration or en > end:
            continue
        return True
    return False


def compute_slots(db, doctor_id, date, duration_min=30, exclude_id=None):
    """号源查询：排班切片 + 已占用预约实时推导，号源不单独落表（BR-09）"""
    try:
        doctor_id = int(doctor_id or 0)
    except Exception:
        return err('医生参数无效')
    if not date:
        return err('缺少日期')
    segs = [s for s in db.get('schedules', [])
            if int(s.get('doctor_id') or 0) == doctor_id and s.get('work_date') == date]
    if not segs:
        return ok({'date': date, 'doctor_id': doctor_id, 'slots': [],
                   'note': '该医生当日未排班'})
    if all(s.get('stage') == '停诊' for s in segs):
        note = next((s.get('note') for s in segs if s.get('note')), '')
        return ok({'date': date, 'doctor_id': doctor_id, 'slots': [],
                   'note': '该医生当日停诊' + ('：' + note if note else '')})
    duration = max(15, int(duration_min or 30))
    slots = []
    for seg in segs:
        if seg.get('stage') == '停诊':
            continue
        step = int(seg.get('slot_minutes') or 15)
        cur, end = _hm(seg.get('start_time')), _hm(seg.get('end_time'))
        if None in (cur, end):
            continue
        while cur + duration <= end:
            st = '%sT%02d:%02d' % (date, cur // 60, cur % 60)
            fin = cur + duration
            en = '%sT%02d:%02d' % (date, fin // 60, fin % 60)
            busy = _overlap(db.get('appointments', []), doctor_id, seg.get('room_id'),
                            st, en, exclude_id)
            slots.append({
                'schedule_id': seg.get('id'), 'room_id': seg.get('room_id'),
                'starts_at': st, 'ends_at': en,
                'state': '已占用' if busy else '可预约',
                'appointment_no': busy[0].get('appointment_no') if busy else None,
            })
            cur += step
    return ok({'date': date, 'doctor_id': doctor_id, 'duration_min': duration,
               'slots': slots, 'note': ''})


def tx_book(body):
    """自助/前台预约：排班 + 号源 + 冲突 + 爽约限制，全部在同一写事务内判定（BR-09/10/11）"""
    with _lock, connect() as c:
        db = _tx_db(c)
        s, e = body.get('starts_at'), body.get('ends_at')
        if not s or not e or s >= e:
            raise TxError('时间区间无效')
        t = next((x for x in db.get('appointmentTypes', [])
                  if x.get('id') == body.get('type_id')), None)
        if not t:
            raise TxError('预约类型不存在')
        source = body.get('source') or '前台'
        date = s[:10]
        segs = [x for x in db.get('schedules', [])
                if x.get('doctor_id') == body.get('doctor_id') and x.get('work_date') == date]
        if not segs:
            raise TxError('该医生当日未排班，不能预约')
        if all(x.get('stage') == '停诊' for x in segs):
            raise TxError('该医生当日停诊')
        if source == '患者自助':
            if not t.get('self_bookable'):
                raise TxError('「%s」需医生评估，请致电或到店由前台安排' % t.get('name'))
            duration = int(t.get('duration_min') or 30)
            if not _in_grid(segs, s, e, duration):
                raise TxError('所选时段不在出诊号源内')
            pid = body.get('patient_id')
            since = (datetime.now() - timedelta(days=90)).date().isoformat()
            no_show = [a for a in db['appointments']
                       if a.get('patient_id') == pid and a.get('stage') == '爽约'
                       and str(a.get('starts_at') or '')[:10] >= since]
            if len(no_show) >= 2:
                raise TxError('近 90 天累计爽约 %d 次，自助预约已暂停，请联系诊所' % len(no_show))
        busy = _overlap(db['appointments'], body.get('doctor_id'), body.get('room_id'), s, e)
        if busy:
            raise TxError('医生或诊室在该时段已有有效预约（事务检查）')
        row = {
            'id': _next_id(db['appointments']),
            'appointment_no': _next_no(db['appointments'], 'appointment_no', 'A'),
            'patient_id': body.get('patient_id'),
            'doctor_id': body.get('doctor_id'),
            'room_id': body.get('room_id'),
            'type_id': body.get('type_id'),
            'created_by': int(body.get('created_by') or 1),
            'chief_complaint': body.get('chief_complaint') or '',
            'starts_at': s, 'ends_at': e,
            'stage': body.get('stage') or '待确认',
            'source': source,
            'schedule_id': body.get('schedule_id'),
            'created_at': _now(),
            'confirmed_at': _now() if body.get('stage') == '已确认' else None,
            'arrived_at': None, 'completed_at': None, 'cancelled_at': None,
            'cancel_reason': None,
        }
        db['appointments'].append(row)
        db['appointmentEvents'].append({
            'id': _next_id(db['appointmentEvents']), 'appointment_id': row['id'],
            'changed_by': row['created_by'],
            'old_start': None, 'new_start': s, 'old_end': None, 'new_end': e,
            'old_stage': None, 'new_stage': row['stage'],
            'reason': '患者自助预约' if source == '患者自助' else '前台排程',
            'occurred_at': _now(),
        })
        # 预约提醒：就诊前一天 09:00 提醒，降低爽约（BR-11 的前置手段）
        phone = next((p.get('phone') for p in db.get('patients', [])
                      if p.get('id') == row['patient_id']), '')
        remind_at = (datetime.fromisoformat(s) - timedelta(days=1)).replace(
            hour=9, minute=0).isoformat(timespec='minutes')
        db['reminders'].append({
            'id': _next_id(db['reminders']), 'order_id': None,
            'appointment_id': row['id'], 'channel_id': 6, 'created_by': row['created_by'],
            'kind': '预约提醒', 'scheduled_at': remind_at, 'recipient': phone,
            'content': '您预约于 %s 到诊，如需取消请提前致电。' % s.replace('T', ' '),
            'delivery_result': '待发送', 'attempt_count': 0,
            'last_attempt_at': None, 'sent_at': None, 'failure_reason': None,
        })
        # 已通知的复诊召回：患者一旦约诊即自动闭环，不需要人工核对（BR-12）
        for rc in db.get('recalls', []):
            if rc.get('patient_id') == row['patient_id'] and rc.get('stage') == '已通知':
                rc['stage'] = '已预约'
                rc['appointment_id'] = row['id']
        _tx_write(c, db, ('appointments', 'appointmentEvents', 'reminders', 'recalls'))
        return row


def tx_recall(body):
    with _lock, connect() as c:
        db = _tx_db(c)
        r = next((x for x in db.get('recalls', []) if x.get('id') == body.get('id')), None)
        if not r:
            raise TxError('召回记录不存在')
        dst = body.get('stage')
        if dst not in ('待通知', '已通知', '已预约', '已关闭'):
            raise TxError('非法的召回状态')
        if r.get('stage') == '已关闭' and dst != '已关闭':
            raise TxError('已关闭的召回不能再变更')
        r['stage'] = dst
        if dst == '已通知':
            r['notified_at'] = _now()
        if dst == '已预约':
            r['appointment_id'] = body.get('appointment_id')
            if not r.get('notified_at'):
                r['notified_at'] = _now()
        if body.get('note') is not None:
            r['note'] = body['note']
        _tx_write(c, db, ('recalls',))
        return r


def ensure_schedules(days=14):
    """按医生的周排班生成未来若干天的出诊段落；已有排班的日期不重复生成。"""
    db = read_db()
    schedules = db.get('schedules', [])
    doctors = [e for e in db.get('employees', [])
               if e.get('role') == 'doctor' and e.get('active', True)]
    rooms = [r for r in db.get('rooms', []) if r.get('active', True)]
    if not doctors or not rooms:
        return 0
    today = datetime.now().date()
    covered = {(s.get('doctor_id'), s.get('work_date')) for s in schedules
               if str(s.get('work_date') or '') >= today.isoformat()}
    added = 0
    for i in range(days):
        day = today + timedelta(days=i)
        if day.weekday() == 6:          # 周日休诊
            continue
        for idx, doc in enumerate(doctors):
            if (doc['id'], day.isoformat()) in covered:
                continue
            room = rooms[idx % len(rooms)]
            for start, end in (('09:00', '12:00'), ('14:00', '18:00')):
                stop = i == 5 and start == '14:00'
                schedules.append({
                    'id': _next_id(schedules), 'doctor_id': doc['id'], 'room_id': room['id'],
                    'work_date': day.isoformat(), 'start_time': start, 'end_time': end,
                    'slot_minutes': 15,
                    'stage': '停诊' if stop else '正常',
                    'note': '外出学习' if stop else '',
                    'created_by': 1, 'created_at': _now(),
                })
                added += 1
            covered.add((doc['id'], day.isoformat()))
    if added:
        write_db({'schedules': schedules})
    return added


def ensure_recalls():
    """诊疗记录填写建议复查间隔后，自动生成待通知的复诊召回（BR-12）"""
    db = read_db()
    encounters = db.get('encounters', [])
    recalls = db.get('recalls', [])
    have = {r.get('encounter_id') for r in recalls}
    added = 0
    for e in encounters:
        months = e.get('recall_months')
        if not months or e.get('id') in have:
            continue
        base = datetime.fromisoformat(str(e.get('occurred_at') or e.get('created_at'))[:16])
        due = _add_months(base, int(months)).date().isoformat()
        recalls.append({
            'id': _next_id(recalls), 'patient_id': e.get('patient_id'),
            'encounter_id': e.get('id'), 'due_date': due,
            'reason': '%s 后 %d 个月复查' % (e.get('diagnosis') or '治疗', int(months)),
            'stage': '待通知', 'notified_at': None, 'appointment_id': None,
            'note': '', 'created_at': _now(),
        })
        added += 1
    if added:
        write_db({'recalls': recalls})
    return added


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
        elif path == '/slots':
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(self.path).query)
            self._send(compute_slots(
                read_db(), (q.get('doctor_id') or ['0'])[0], (q.get('date') or [''])[0],
                (q.get('duration_min') or ['30'])[0], (q.get('exclude_id') or [None])[0]))
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
                           'patientId': u.get('patient_id'),
                           'token': 'local-' + u['username']}))
        elif path == '/commit/appointment':
            try:
                self._send(ok(tx_create_appointment(self._body())))
            except TxError as e:
                self._send(err(str(e)), 400)
            except Exception as e:
                self._send(err(str(e)), 400)
        elif path == '/commit/appointment/stage':
            try:
                self._send(ok(tx_appointment_stage(self._body())))
            except TxError as e:
                self._send(err(str(e)), 400)
            except Exception as e:
                self._send(err(str(e)), 400)
        elif path == '/commit/appointment/reschedule':
            try:
                self._send(ok(tx_reschedule_appointment(self._body())))
            except TxError as e:
                self._send(err(str(e)), 400)
            except Exception as e:
                self._send(err(str(e)), 400)
        elif path == '/commit/bill':
            try:
                self._send(ok(tx_create_bill(self._body())))
            except TxError as e:
                self._send(err(str(e)), 400)
            except Exception as e:
                self._send(err(str(e)), 400)
        elif path == '/commit/payment/result':
            try:
                self._send(ok(tx_payment_result(self._body())))
            except TxError as e:
                self._send(err(str(e)), 400)
            except Exception as e:
                self._send(err(str(e)), 400)
        elif path == '/commit/order/transition':
            try:
                self._send(ok(tx_order_transition(self._body())))
            except TxError as e:
                self._send(err(str(e)), 400)
            except Exception as e:
                self._send(err(str(e)), 400)
        elif path == '/commit/order/receipt':
            try:
                self._send(ok(tx_order_receipt(self._body())))
            except TxError as e:
                self._send(err(str(e)), 400)
            except Exception as e:
                self._send(err(str(e)), 400)
        elif path == '/commit/booking':
            try:
                self._send(ok(tx_book(self._body())))
            except TxError as e:
                self._send(err(str(e)), 400)
            except Exception as e:
                self._send(err(str(e)), 400)
        elif path == '/commit/recall':
            try:
                self._send(ok(tx_recall(self._body())))
            except TxError as e:
                self._send(err(str(e)), 400)
            except Exception as e:
                self._send(err(str(e)), 400)
        elif path == '/compute/pay':
            try:
                self._send(compute_pay(self._body()))
            except Exception as e:
                self._send(err(str(e)), 400)
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
    migrate()
    ensure_seed_users()
    n1 = ensure_schedules()
    n2 = ensure_recalls()
    if n1 or n2:
        print('补排班 %d 段、召回 %d 条' % (n1, n2), flush=True)
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
