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
    ensure_seed_users()
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
