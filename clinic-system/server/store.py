#!/usr/bin/env python3
"""口腔诊所管理系统 — 关系型 SQLite 后端服务（Python 标准库）

严格依据《口腔诊所管理系统系统分析与设计报告》实现：
- 第 8 章：25 张业务关系表、61 个外键、欠款查询视图（v_bill_debt）及全部表 23 约束
- 第 3-7 章：UC-01 ~ UC-06 业务流程、状态机、事务边界、跨表一致性与表 25 七项统计口径
- 第 5 章表 14：服务端 HMAC 认证、按角色严格隔离数据与操作权限、患者端隐私投影与脱敏、变更审计
- 轻量单进程（http.server + sqlite3），内存占用 < 25MB
"""
import base64
import calendar
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time
import uuid
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get('CLINIC_DB_PATH', str(BASE_DIR / 'clinic_rel.db')))
SCHEMA_PATH = BASE_DIR / 'schema.sql'
UPLOAD_DIR = Path(os.environ.get('CLINIC_UPLOAD_DIR', str(BASE_DIR / 'uploads')))
SECRET_PATH = BASE_DIR / '.secret_key'

HOST = os.environ.get('CLINIC_HOST', '127.0.0.1')
PORT = int(os.environ.get('CLINIC_PORT', '5100'))

_lock = threading.Lock()
_sms_codes = {}  # phone -> (code, expires_ts)

VALID_FDI_TEETH = {
    f'{q}{n}' for q in (1, 2, 3, 4) for n in range(1, 9)
}

APPT_TRANSITIONS = {
    '待确认': ['已确认', '已取消'],
    '已确认': ['已到诊', '已取消', '爽约'],
    '已到诊': ['已完成'],
    '已完成': [],
    '已取消': [],
    '爽约': [],
}

ORDER_TRANSITIONS = {
    '草稿': ['已发送', '取消'],
    '已发送': ['已接收', '取消'],
    '已接收': ['试戴'],
    '试戴': ['质量确认', '返工'],
    '返工': ['试戴'],
    '质量确认': ['已交货'],
    '已交货': ['返工'],
    '取消': [],
}

RECALL_TRANSITIONS = {
    '待通知': ['已通知', '已预约', '已关闭'],
    '已通知': ['已预约', '已关闭'],
    '已预约': ['已关闭'],
    '已关闭': [],
}

PATIENT_PROGRESS = {
    '已发送': '制作中',
    '已接收': '制作中',
    '返工': '制作中',
    '试戴': '待试戴',
    '质量确认': '待试戴',
    '已交货': '可取件',
}

CORE_ROLE_CODES = {'RECEPTIONIST', 'DOCTOR', 'CASHIER', 'MANAGER', 'ADMIN'}

ALLOWED_MIME = {'image/jpeg', 'image/png', 'application/pdf'}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def _get_secret():
    if SECRET_PATH.exists():
        return SECRET_PATH.read_text(encoding='utf-8').strip().encode('utf-8')
    key = secrets.token_hex(32)
    try:
        SECRET_PATH.write_text(key, encoding='utf-8')
        os.chmod(SECRET_PATH, 0o600)
    except Exception:
        pass
    return key.encode('utf-8')


SECRET_KEY = _get_secret()


def hash_password(password, salt=None):
    salt = salt or secrets.token_hex(8)
    digest = hashlib.sha256((salt + ':' + str(password)).encode('utf-8')).hexdigest()
    return f'{salt}${digest}'


def verify_password(password, stored):
    if not stored or '$' not in stored:
        return False
    salt, _ = stored.split('$', 1)
    return hmac.compare_digest(hash_password(password, salt), stored)


def sign_token(payload):
    raw = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    b64 = base64.urlsafe_b64encode(raw).decode('ascii')
    sig = hmac.new(SECRET_KEY, b64.encode('ascii'), hashlib.sha256).hexdigest()
    return f'{b64}.{sig}'


def verify_token(token):
    if not token or '.' not in token:
        return None
    b64, sig = token.rsplit('.', 1)
    expected = hmac.new(SECRET_KEY, b64.encode('ascii'), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(b64.encode('ascii')).decode('utf-8'))
        if data.get('exp', 0) < time.time():
            return None
        return data
    except Exception:
        return None


def now_str():
    return datetime.now().strftime('%Y-%m-%dT%H:%M:%S')


def now_min():
    return datetime.now().strftime('%Y-%m-%dT%H:%M')


def today_str():
    return date.today().isoformat()


def mask_phone(phone):
    s = str(phone or '').strip()
    if len(s) >= 7:
        return s[:3] + '****' + s[-4:]
    return s


def parse_hm(text):
    try:
        parts = str(text).strip()[:5].split(':')
        return int(parts[0]) * 60 + int(parts[1])
    except Exception:
        return None


def add_months(d_obj, months):
    y = d_obj.year + (d_obj.month - 1 + months) // 12
    m = (d_obj.month - 1 + months) % 12 + 1
    day = min(d_obj.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)


def connect():
    c = sqlite3.connect(str(DB_PATH), timeout=10)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys = ON')
    c.execute('PRAGMA journal_mode = WAL')
    c.execute('PRAGMA synchronous = NORMAL')
    c.execute('PRAGMA cache_size = -2000')  # 限制 SQLite 页缓存约 2MB，节省服务器内存
    return c


def rows_to_dicts(rows):
    return [dict(r) for r in rows]


def one_to_dict(row):
    return dict(row) if row else None


def next_code(c, table, col, prefix):
    rows = c.execute(f'SELECT {col} FROM {table}').fetchall()
    mx = 0
    for r in rows:
        v = str(r[0] or '')
        if v.startswith(prefix) and v[len(prefix):].isdigit():
            mx = max(mx, int(v[len(prefix):]))
    return f'{prefix}{mx + 1:04d}'


def audit(c, entity_type, entity_id, action, user, old_val=None, new_val=None, reason=''):
    c.execute(
        '''INSERT INTO sys_audit_log
           (entity_type, entity_id, action, operator_id, operator_name, old_value, new_value, reason, occurred_at)
           VALUES (?,?,?,?,?,?,?,?,?)''',
        (
            entity_type, int(entity_id), action,
            user.get('employee_id') or user.get('account_id'),
            user.get('name', ''),
            json.dumps(old_val, ensure_ascii=False) if old_val is not None else None,
            json.dumps(new_val, ensure_ascii=False) if new_val is not None else None,
            reason or '',
            now_str(),
        ),
    )


def option_has_kind(c, opt_id, expected_kind, require_active=False):
    row = c.execute('SELECT kind, active FROM basic_option WHERE id=?', (opt_id,)).fetchone()
    if not row:
        return False
    if row['kind'] != expected_kind:
        return False
    if require_active and not row['active']:
        return False
    return True


def is_active_doctor(c, emp_id):
    row = c.execute(
        '''SELECT 1
           FROM employee e
           JOIN employee_role er ON er.employee_id = e.id AND er.revoked_at IS NULL
           JOIN basic_option bo ON bo.id = er.role_id AND bo.kind = '岗位' AND bo.code = 'DOCTOR' AND bo.active = 1
           WHERE e.id = ? AND e.active = 1''',
        (emp_id,),
    ).fetchone()
    return row is not None


def get_employee_roles(c, emp_id):
    rows = c.execute(
        '''SELECT bo.id, bo.code, bo.name
           FROM employee_role er
           JOIN basic_option bo ON bo.id = er.role_id
           WHERE er.employee_id = ? AND er.revoked_at IS NULL AND bo.kind = '岗位' ''',
        (emp_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def default_employee_id(c, user):
    if user and user.get('employee_id'):
        return int(user['employee_id'])
    row = c.execute('SELECT id FROM employee WHERE active=1 ORDER BY id LIMIT 1').fetchone()
    return int(row['id']) if row else 1


def sync_bill_stage(c, bill_id):
    """按 v_bill_debt 视图重新核对收费单欠款余额与结清标记（报告 8.4 / 8.7）。"""
    b = c.execute('SELECT * FROM bill WHERE id=?', (bill_id,)).fetchone()
    if not b or b['stage'] == '已作废':
        return None
    v = c.execute('SELECT * FROM v_bill_debt WHERE bill_id=?', (bill_id,)).fetchone()
    debt = float(v['debt']) if v else 0.0
    if debt <= 0.0001:
        settled = b['settled_at'] or now_str()
        c.execute("UPDATE bill SET stage='已结清', settled_at=? WHERE id=?", (settled, bill_id))
    else:
        opened = b['debt_opened_at'] or now_str()
        c.execute(
            "UPDATE bill SET stage='欠款中', settled_at=NULL, debt_opened_at=? WHERE id=?",
            (opened, bill_id),
        )
    return dict(c.execute('SELECT * FROM v_bill_debt WHERE bill_id=?', (bill_id,)).fetchone())


def init_db():
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    schema_sql = SCHEMA_PATH.read_text(encoding='utf-8')
    with connect() as c:
        c.executescript(schema_sql)
        if c.execute('SELECT COUNT(*) FROM clinic').fetchone()[0] == 0:
            seed_initial_data(c)


def seed_initial_data(c):
    """首次初始化空库时写入严格一致的 25 表业务种子数据。"""
    t0 = date.today()
    def d_iso(offset):
        return (t0 + timedelta(days=offset)).isoformat()
    def dt_iso(offset, hhmm='09:00'):
        return f'{d_iso(offset)}T{hhmm}:00'

    # 1. clinic
    c.execute(
        "INSERT INTO clinic(id, clinic_code, name, address, phone, active, created_at, updated_at) "
        "VALUES(1, 'CLINIC01', '口腔诊所', '市中心示范路 88 号', '0571-88001234', 1, ?, ?)",
        (dt_iso(-60), dt_iso(-60)),
    )

    # 2. clinic_room
    c.execute("INSERT INTO clinic_room(id, clinic_id, room_code, name, floor_note, active) VALUES(1, 1, 'R1', '诊室一', '一层 101', 1)")
    c.execute("INSERT INTO clinic_room(id, clinic_id, room_code, name, floor_note, active) VALUES(2, 1, 'R2', '诊室二', '一层 102', 1)")

    # 3. basic_option（包含 岗位、支付方式、通知渠道、颜色、盒子颜色、订单类型、单位、附件类型）
    options = [
        (1, '岗位', 'RECEPTIONIST', '前台接待', '登记、排班、预约与订单跟进', 1),
        (2, '岗位', 'DOCTOR', '口腔医生', '接诊诊疗、治疗计划与义齿下单', 2),
        (3, '岗位', 'CASHIER', '收费员', '收费录入、收款与退款', 3),
        (4, '岗位', 'MANAGER', '诊所负责人', '经营统计、复诊召回与基础维护', 4),
        (5, '岗位', 'ADMIN', '系统管理员', '账号与基础资料维护', 5),
        (6, '支付方式', 'CASH', '现金', '前台现金结算', 1),
        (7, '支付方式', 'CARD', '刷卡', 'POS 银行卡支付', 2),
        (8, '支付方式', 'ONLINE', '在线支付', '第三方移动支付', 3),
        (9, '通知渠道', 'SMS', '短信', '手机短信提醒', 1),
        (10, '通知渠道', 'EMAIL', '邮件', '电子邮箱提醒', 2),
        (11, '颜色', 'A1', 'A1', 'VITA 比色 A1', 1),
        (12, '颜色', 'A2', 'A2', 'VITA 比色 A2', 2),
        (13, '颜色', 'B1', 'B1', 'VITA 比色 B1', 3),
        (14, '盒子颜色', 'WHITE', '白色', '标准白色技工盒', 1),
        (15, '盒子颜色', 'PINK', '粉色', '粉色技工盒', 2),
        (16, '订单类型', 'CROWN', '牙冠', '单冠修复', 1),
        (17, '订单类型', 'BRIDGE', '义桥', '固定桥修复', 2),
        (18, '单位', 'PIECE', '颗', '按牙位/颗计价', 1),
        (19, '单位', 'SET', '套', '按整套计价', 2),
        (20, '单位', 'TIME', '次', '按诊疗次计价', 3),
        (21, '附件类型', 'PHOTO', '口内照片', '比色或口内实拍图', 1),
        (22, '附件类型', 'MODEL', '牙模', '口扫或印模资料', 2),
    ]
    c.executemany(
        'INSERT INTO basic_option(id, kind, code, name, description, sort_order, active) VALUES(?,?,?,?,?,?,1)',
        options,
    )

    # 4. employee + 5. employee_role（支持员工兼岗：可在基础信息中为任意员工配置多个岗位）
    employees = [
        (1, 1, 'E001', '王前台', '13900000001', d_iso(-365)),
        (2, 1, 'E002', '李医生', '13900000002', d_iso(-365)),
        (3, 1, 'E003', '张收费', '13900000003', d_iso(-300)),
        (4, 1, 'E004', '陈负责', '13900000004', d_iso(-400)),
        (5, 1, 'E005', '周医生', '13900000005', d_iso(-200)),
        (6, 1, 'E006', '林管理', '13900000006', d_iso(-400)),
    ]
    c.executemany(
        'INSERT INTO employee(id, clinic_id, employee_no, name, phone, joined_on, active) VALUES(?,?,?,?,?,?,1)',
        employees,
    )
    emp_roles = [
        (1, 1),  # 王前台 -> 前台接待
        (2, 2),  # 李医生 -> 口腔医生
        (3, 3),  # 张收费 -> 收费员
        (4, 4),  # 陈负责 -> 诊所负责人
        (5, 2),  # 周医生 -> 口腔医生
        (6, 5),  # 林管理 -> 系统管理员
    ]
    c.executemany(
        'INSERT INTO employee_role(employee_id, role_id, assigned_at) VALUES(?,?,?)',
        [(e, r, dt_iso(-180)) for e, r in emp_roles],
    )

    # 6. appointment_type
    appt_types = [
        (1, 'FIRST', '初诊检查', 30, 1, '口腔检查 50 元', 1),
        (2, 'REVISIT', '复诊', 30, 1, '按诊疗项目计', 2),
        (3, 'CLEAN', '洁牙', 45, 1, '200 元起', 3),
        (4, 'FILL', '补牙', 45, 0, '300 元/颗', 4),
        (5, 'RCT', '根管治疗', 60, 0, '600 元/颗', 5),
        (6, 'IMPLANT', '种植与修复', 60, 0, '需医生评估后报价', 6),
    ]
    c.executemany(
        'INSERT INTO appointment_type(id, code, name, duration_min, self_bookable, price_hint, sort_order, active) '
        'VALUES(?,?,?,?,?,?,?,1)',
        appt_types,
    )

    # 7. price_item
    prices = [
        (1, 20, 'EXAM', '口腔检查', 50.00),
        (2, 20, 'CLEAN', '超声波洁牙', 200.00),
        (3, 18, 'FILL', '树脂补牙', 300.00),
        (4, 18, 'CROWN', '全瓷冠修复', 1800.00),
        (5, 18, 'EXTRACT', '普通拔牙', 150.00),
        (6, 18, 'RCT', '根管治疗', 600.00),
    ]
    c.executemany(
        'INSERT INTO price_item(id, unit_id, item_code, name, unit_price, active, updated_at) VALUES(?,?,?,?,?,1,?)',
        [(i, u, cd, nm, pr, dt_iso(-30)) for i, u, cd, nm, pr in prices],
    )

    # 8. product & 9. dental_lab
    c.execute(
        "INSERT INTO product(id, unit_id, product_code, name, material, specification, requires_attachment, active) "
        "VALUES(1, 18, 'P-CROWN', '全瓷冠', '二氧化锆', '前牙/后牙高透氧化锆单冠', 1, 1)"
    )
    c.execute(
        "INSERT INTO product(id, unit_id, product_code, name, material, specification, requires_attachment, active) "
        "VALUES(2, 18, 'P-BRIDGE', '固定桥', '钴铬合金', '三单位烤瓷固定桥', 1, 1)"
    )
    c.execute(
        "INSERT INTO dental_lab(id, lab_code, name, contact, phone, address, interface_code, active) "
        "VALUES(1, 'LAB01', '精诚义齿技工所', '刘工', '13800000099', '高新区医疗器械园 B 栋', 'LAB-JC-01', 1)"
    )

    # 10. patient
    patients = [
        (1, 1, 'P0001', '张伟', '1985-03-12', '13800000001', '张丽', '13800000011', '青霉素过敏', dt_iso(-30)),
        (2, 1, 'P0002', '李娜', '1992-07-08', '13800000002', '', '', '', dt_iso(-20)),
        (3, 1, 'P0003', '王强', '1978-11-23', '13800000003', '', '', '需复诊根管', dt_iso(-10)),
        (4, 1, 'P0004', '赵敏', '1999-01-30', '13800000004', '', '', '', dt_iso(-3)),
    ]
    c.executemany(
        'INSERT INTO patient(id, created_by, patient_no, name, birth_date, phone, contact_name, contact_phone, important_note, created_at, updated_at) '
        'VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        [(i, cb, no, nm, bd, ph, cn, cp, nt, ts, ts) for i, cb, no, nm, bd, ph, cn, cp, nt, ts in patients],
    )

    # 11. schedule（生成过去 14 天到未来 14 天排班，满足时长被切片整除、唯一性）
    sched_id = 0
    sched_lookup = {}  # (doctor_id, work_date, start_time) -> id
    for off in range(-14, 15):
        day_s = d_iso(off)
        for doc_id, room_id in ((2, 1), (5, 2)):
            for st, en in (('09:00', '12:00'), ('14:00', '18:00')):
                sched_id += 1
                stage = '停诊' if (off == 4 and doc_id == 5 and st == '14:00') else '正常'
                note = '学术会议停诊' if stage == '停诊' else ''
                c.execute(
                    'INSERT INTO schedule(id, doctor_id, room_id, created_by, work_date, start_time, end_time, slot_minutes, stage, note, created_at) '
                    'VALUES(?,?,?,?,?,?,?,15,?,?,?)',
                    (sched_id, doc_id, room_id, 1, day_s, st, en, stage, note, dt_iso(-15)),
                )
                sched_lookup[(doc_id, day_s, st)] = sched_id

    # 12. appointment + 13. appointment_event（全部对齐排班与时长，时间轴完全一致）
    appts = [
        # A0001：7 天前已完成，关联 EN0001
        (1, 1, 2, 1, 1, 1, sched_lookup[(2, d_iso(-7), '09:00')], 'A0001',
         f'{d_iso(-7)}T09:00', f'{d_iso(-7)}T09:30', '前台', '左下后牙疼痛', '已完成',
         dt_iso(-8, '10:00'), dt_iso(-7, '08:55'), dt_iso(-7, '09:30'), None, None, dt_iso(-8, '09:30')),
        # A0002：今日已确认（李医生，诊室一）
        (2, 1, 2, 1, 2, 1, sched_lookup[(2, d_iso(0), '09:00')], 'A0002',
         f'{d_iso(0)}T09:00', f'{d_iso(0)}T09:30', '前台', '根管复诊检查', '已确认',
         dt_iso(-1, '10:15'), None, None, None, None, dt_iso(-1, '10:00')),
        # A0003：今日已到诊（周医生，诊室二）
        (3, 2, 5, 2, 2, 1, sched_lookup[(5, d_iso(0), '09:00')], 'A0003',
         f'{d_iso(0)}T10:30', f'{d_iso(0)}T11:00', '前台', '前牙修复试戴', '已到诊',
         dt_iso(-2, '09:20'), dt_iso(0, '10:25'), None, None, None, dt_iso(-2, '09:00')),
        # A0004：明日患者自助待确认
        (4, 3, 2, 1, 1, 1, sched_lookup[(2, d_iso(1), '14:00')], 'A0004',
         f'{d_iso(1)}T14:00', f'{d_iso(1)}T14:30', '患者自助', '右下后牙初诊', '待确认',
         None, None, None, None, None, dt_iso(0, '08:30')),
        # A0005：5 天前爽约（含改约历史）
        (5, 4, 5, 2, 3, 1, sched_lookup[(5, d_iso(-5), '14:00')], 'A0005',
         f'{d_iso(-5)}T15:00', f'{d_iso(-5)}T15:45', '患者自助', '洁牙预约', '爽约',
         dt_iso(-6, '11:30'), None, None, dt_iso(-5, '16:00'), '未按时到诊', dt_iso(-6, '11:00')),
    ]
    c.executemany(
        '''INSERT INTO appointment
           (id, patient_id, doctor_id, room_id, type_id, created_by, schedule_id, appointment_no,
            starts_at, ends_at, source, chief_complaint, stage,
            confirmed_at, arrived_at, completed_at, cancelled_at, cancel_reason, created_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
        appts,
    )
    c.executemany(
        '''INSERT INTO appointment_event
           (appointment_id, changed_by, occurred_at, old_start, new_start, old_end, new_end, old_stage, new_stage, reason)
           VALUES(?,?,?,?,?,?,?,?,?,?)''',
        [
            (1, 1, dt_iso(-8, '09:30'), None, f'{d_iso(-7)}T09:00', None, f'{d_iso(-7)}T09:30', '新建', '已确认', '前台排程'),
            (1, 1, dt_iso(-7, '09:30'), f'{d_iso(-7)}T09:00', f'{d_iso(-7)}T09:00', f'{d_iso(-7)}T09:30', f'{d_iso(-7)}T09:30', '已到诊', '已完成', '接诊完成'),
            (5, 1, dt_iso(-6, '14:00'), f'{d_iso(-5)}T14:00', f'{d_iso(-5)}T15:00', f'{d_iso(-5)}T14:45', f'{d_iso(-5)}T15:45', '已确认', '已确认', '患者要求改约'),
            (5, 1, dt_iso(-5, '16:00'), f'{d_iso(-5)}T15:00', f'{d_iso(-5)}T15:00', f'{d_iso(-5)}T15:45', f'{d_iso(-5)}T15:45', '已确认', '爽约', '未按时到诊'),
        ],
    )

    # 14. encounter（EN0001 关联 7 天前已完成的 A0001；EN0002 无预约现场就诊）
    c.execute(
        '''INSERT INTO encounter
           (id, patient_id, clinic_id, doctor_id, appointment_id, encounter_no, occurred_at,
            chief_complaint, diagnosis, treatment_note, recall_months, completed_at, created_at)
           VALUES(1, 1, 1, 2, 1, 'EN0001', ?, '左下后牙疼痛', '36 牙髓炎', '完成根管治疗与固定桥取模', 1, ?, ?)''',
        (dt_iso(-7, '09:10'), dt_iso(-7, '09:30'), dt_iso(-7, '09:10')),
    )
    c.execute(
        '''INSERT INTO encounter
           (id, patient_id, clinic_id, doctor_id, appointment_id, encounter_no, occurred_at,
            chief_complaint, diagnosis, treatment_note, recall_months, completed_at, created_at)
           VALUES(2, 2, 1, 5, NULL, 'EN0002', ?, '前牙美观修复', '11 牙体缺损', '牙体预备并取模制作全瓷冠', 6, ?, ?)''',
        (dt_iso(-4, '10:00'), dt_iso(-4, '10:40'), dt_iso(-4, '10:00')),
    )

    # 15. recall（与 encounter 1:1 对应，含一条已到期用于队列与提醒演示）
    c.execute(
        '''INSERT INTO recall(id, patient_id, encounter_id, appointment_id, due_date, reason, stage, notified_at, note, created_at)
           VALUES(1, 1, 1, NULL, ?, '36 牙髓炎 后 1 个月复查', '待通知', NULL, '', ?)''',
        (d_iso(-1), dt_iso(-7, '09:30')),
    )
    c.execute(
        '''INSERT INTO recall(id, patient_id, encounter_id, appointment_id, due_date, reason, stage, notified_at, note, created_at)
           VALUES(2, 2, 2, NULL, ?, '11 牙体缺损 后 6 个月复查', '待通知', NULL, '', ?)''',
        (add_months(t0 - timedelta(days=4), 6).isoformat(), dt_iso(-4, '10:40')),
    )

    # 16. treatment_plan & 17. plan_item
    c.execute(
        '''INSERT INTO treatment_plan
           (id, patient_id, doctor_id, created_by, plan_no, chief_complaint, diagnosis, stage, quoted_amount, accepted_at, closed_at, created_at)
           VALUES(1, 1, 2, 2, 'TP0001', '左下后牙疼痛', '36 牙髓炎、36-37 牙列缺损', '已完成', 4250.00, ?, ?, ?)''',
        (dt_iso(-7, '09:15'), dt_iso(-2, '15:00'), dt_iso(-7, '09:10')),
    )
    c.execute(
        '''INSERT INTO treatment_plan
           (id, patient_id, doctor_id, created_by, plan_no, chief_complaint, diagnosis, stage, quoted_amount, accepted_at, closed_at, created_at)
           VALUES(2, 2, 5, 5, 'TP0002', '前牙美观修复', '11 牙体缺损', '执行中', 1800.00, ?, NULL, ?)''',
        (dt_iso(-4, '10:10'), dt_iso(-4, '10:05')),
    )
    c.execute(
        '''INSERT INTO treatment_plan
           (id, patient_id, doctor_id, created_by, plan_no, chief_complaint, diagnosis, stage, quoted_amount, accepted_at, closed_at, created_at)
           VALUES(3, 3, 2, 2, 'TP0003', '右下后牙冷热痛', '46 深龋', '拟定', 350.00, NULL, NULL, ?)''',
        (dt_iso(-1, '11:00'),),
    )

    # 先插入 plan_item（bill_id / lab_order_id 随后回填）
    plan_items = [
        (1, 1, 1, 1, None, None, 1, '36', '口腔检查', 1, 50.00, '已执行', dt_iso(-7, '09:10'), dt_iso(-7, '09:15')),
        (2, 1, 6, 1, None, None, 1, '36', '根管治疗', 1, 600.00, '已执行', dt_iso(-7, '09:10'), dt_iso(-7, '09:20')),
        (3, 1, 4, 1, None, None, 2, '36', '全瓷冠修复', 2, 1800.00, '已执行', dt_iso(-7, '09:10'), dt_iso(-7, '09:25')),
        (4, 2, 4, 2, None, None, 1, '11', '全瓷冠修复', 1, 1800.00, '已执行', dt_iso(-4, '10:05'), dt_iso(-4, '10:30')),
        (5, 3, 1, None, None, None, 1, '46', '口腔检查', 1, 50.00, '待执行', dt_iso(-1, '11:00'), None),
        (6, 3, 3, None, None, None, 1, '46', '树脂补牙', 1, 300.00, '待执行', dt_iso(-1, '11:00'), None),
    ]
    c.executemany(
        '''INSERT INTO plan_item
           (id, plan_id, price_item_id, encounter_id, bill_id, lab_order_id,
            phase_no, tooth_code, name, quantity, unit_price, stage, planned_at, executed_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
        plan_items,
    )

    # 18. dental_order + 19. order_tooth + 20. order_event + 21. order_attachment
    # DO0001：试戴阶段（主表与最新进展完全一致！）
    c.execute(
        '''INSERT INTO dental_order
           (id, product_id, lab_id, created_by, color_id, box_color_id, type_id, unit_id,
            encounter_id, plan_item_id, order_no, repair_requirement, quantity, promised_date,
            stage, dispatch_result, expected_at, sent_at, accepted_at, trial_at, trial_result,
            delivered_at, cancelled_at, cancel_reason, created_at)
           VALUES(1, 1, 1, 5, 11, 14, 16, 18, 2, 4, 'DO0001', '11 前牙氧化锆全瓷冠，颜色 A1', 1, ?,
                  '试戴', '已接收', ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)''',
        (d_iso(5), dt_iso(4, '17:00'), dt_iso(-4, '11:00'), dt_iso(-3, '09:00'), dt_iso(-1, '14:00'), dt_iso(-4, '10:40')),
    )
    # DO0002：已交货（按期交付）
    c.execute(
        '''INSERT INTO dental_order
           (id, product_id, lab_id, created_by, color_id, box_color_id, type_id, unit_id,
            encounter_id, plan_item_id, order_no, repair_requirement, quantity, promised_date,
            stage, dispatch_result, expected_at, sent_at, accepted_at, trial_at, trial_result,
            delivered_at, cancelled_at, cancel_reason, created_at)
           VALUES(2, 2, 1, 2, 12, 15, 17, 18, 1, 3, 'DO0002', '36-37 固定桥修复，颜色 A2', 2, ?,
                  '已交货', '已接收', ?, ?, ?, ?, '合格', ?, NULL, NULL, ?)''',
        (d_iso(-1), dt_iso(-2, '17:00'), dt_iso(-7, '10:00'), dt_iso(-6, '09:00'), dt_iso(-3, '10:00'), dt_iso(-2, '15:00'), dt_iso(-7, '09:35')),
    )
    # DO0003：草稿（未填牙位，可用于演示草稿编辑与发送校验）
    c.execute(
        '''INSERT INTO dental_order
           (id, product_id, lab_id, created_by, color_id, box_color_id, type_id, unit_id,
            encounter_id, plan_item_id, order_no, repair_requirement, quantity, promised_date,
            stage, dispatch_result, expected_at, sent_at, accepted_at, trial_at, trial_result,
            delivered_at, cancelled_at, cancel_reason, created_at)
           VALUES(3, 1, 1, 2, 13, 14, 16, 18, 1, NULL, 'DO0003', '后牙氧化锆全瓷冠草稿', 1, ?,
                  '草稿', '', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?)''',
        (d_iso(10), dt_iso(-1, '15:00')),
    )

    c.executemany(
        'INSERT INTO order_tooth(order_id, tooth_code, repair_note) VALUES(?,?,?)',
        [
            (1, '11', '前牙美学全瓷冠'),
            (2, '36', '基牙'),
            (2, '37', '桥体'),
        ],
    )
    c.executemany(
        '''INSERT INTO order_event
           (order_id, changed_by, source, event_no, occurred_at, received_at, old_stage, new_stage, reason, external_order_no)
           VALUES(?,?,?,?,?,?,?,?,?,?)''',
        [
            (1, 5, 'clinic', 'EVT-0001', dt_iso(-4, '10:40'), dt_iso(-4, '10:40'), '', '草稿', '建立草稿', None),
            (1, 5, 'doctor', 'EVT-0002', dt_iso(-4, '11:00'), dt_iso(-4, '11:00'), '草稿', '已发送', '医生确认发送', None),
            (1, None, 'lab', 'LAB-0001', dt_iso(-3, '09:00'), dt_iso(-3, '09:01'), '已发送', '已接收', '技工所已接单', 'JC-2026-001'),
            (1, None, 'lab', 'LAB-0002', dt_iso(-1, '14:00'), dt_iso(-1, '14:01'), '已接收', '试戴', '制作完成送交试戴', 'JC-2026-001'),
            (2, 2, 'clinic', 'EVT-0003', dt_iso(-7, '09:35'), dt_iso(-7, '09:35'), '', '草稿', '建立草稿', None),
            (2, 2, 'doctor', 'EVT-0004', dt_iso(-7, '10:00'), dt_iso(-7, '10:00'), '草稿', '已发送', '医生确认发送', None),
            (2, None, 'lab', 'LAB-0003', dt_iso(-6, '09:00'), dt_iso(-6, '09:01'), '已发送', '已接收', '技工所已接单', 'JC-2026-002'),
            (2, None, 'lab', 'LAB-0004', dt_iso(-3, '10:00'), dt_iso(-3, '10:01'), '已接收', '试戴', '送交试戴', 'JC-2026-002'),
            (2, 2, 'doctor', 'EVT-0005', dt_iso(-3, '11:00'), dt_iso(-3, '11:00'), '试戴', '质量确认', '试戴合格，边缘密合', None),
            (2, 1, 'receptionist', 'EVT-0006', dt_iso(-2, '15:00'), dt_iso(-2, '15:00'), '质量确认', '已交货', '患者已取件', None),
            (3, 2, 'clinic', 'EVT-0007', dt_iso(-1, '15:00'), dt_iso(-1, '15:00'), '', '草稿', '建立草稿', None),
        ],
    )

    # 托管一个示例附件文件，保持磁盘与索引一致
    sample_key = 'order_1_photo.png'
    sample_bytes = base64.b64decode(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    )
    (UPLOAD_DIR / sample_key).write_bytes(sample_bytes)
    c.execute(
        '''INSERT INTO order_attachment
           (id, order_id, type_id, uploaded_by, file_name, storage_key, mime_type, byte_size, checksum, uploaded_at)
           VALUES(1, 1, 21, 5, '前牙比色照片.png', ?, 'image/png', ?, ?, ?)''',
        (sample_key, len(sample_bytes), hashlib.sha256(sample_bytes).hexdigest(), dt_iso(-4, '10:45')),
    )

    # 22. bill + 23. bill_line + 24. payment（金额与支付 100% 一致！）
    # B0001：EN0001 检查+根管 = 50 + 600 = 650，全额结清
    c.execute(
        '''INSERT INTO bill
           (id, issued_by, encounter_id, plan_item_id, bill_no, issued_at,
            discount_amount, discount_reason, due_date, debt_opened_at, settled_at,
            collection_note, stage, voided_at, void_reason)
           VALUES(1, 3, 1, 1, 'B0001', ?, 0, '', ?, NULL, ?, '', '已结清', NULL, NULL)''',
        (dt_iso(-7, '09:40'), d_iso(-7), dt_iso(-7, '09:42')),
    )
    c.execute(
        '''INSERT INTO bill_line
           (bill_id, price_item_id, dental_order_id, line_no, item_name, unit, quantity, unit_price, discount_amount, description)
           VALUES(1, 1, NULL, 1, '口腔检查', '次', 1, 50.00, 0, '36 检查')'''
    )
    c.execute(
        '''INSERT INTO bill_line
           (bill_id, price_item_id, dental_order_id, line_no, item_name, unit, quantity, unit_price, discount_amount, description)
           VALUES(1, 6, NULL, 2, '根管治疗', '颗', 1, 600.00, 0, '36 根管治疗')'''
    )
    c.execute(
        '''INSERT INTO payment
           (id, bill_id, method_id, refund_of_id, request_no, external_txn_no, requested_at,
            kind, result, amount, occurred_at, failure_reason, checked_at)
           VALUES(1, 1, 6, NULL, 'REQ0001', 'TXN20260001', ?, '收款', '成功', 650.00, ?, NULL, ?)''',
        (dt_iso(-7, '09:41'), dt_iso(-7, '09:42'), dt_iso(-7, '09:42')),
    )

    # B0002：EN0002 全瓷冠修复 1800 - 整单折扣 100 = 应收 1700；关联 DO0001；待确认 1700，到期日昨天（用于演示欠款催收与待确认不计入已收）
    c.execute(
        '''INSERT INTO bill
           (id, issued_by, encounter_id, plan_item_id, bill_no, issued_at,
            discount_amount, discount_reason, due_date, debt_opened_at, settled_at,
            collection_note, stage, voided_at, void_reason)
           VALUES(2, 3, 2, 4, 'B0002', ?, 100.00, '老客户优惠', ?, ?, NULL, '待确认线上支付', '欠款中', NULL, NULL)''',
        (dt_iso(-4, '11:00'), d_iso(-1), dt_iso(-4, '11:00')),
    )
    c.execute(
        '''INSERT INTO bill_line
           (bill_id, price_item_id, dental_order_id, line_no, item_name, unit, quantity, unit_price, discount_amount, description)
           VALUES(2, 4, 1, 1, '全瓷冠修复', '颗', 1, 1800.00, 0, '牙位 11')'''
    )
    c.execute(
        '''INSERT INTO payment
           (id, bill_id, method_id, refund_of_id, request_no, external_txn_no, requested_at,
            kind, result, amount, occurred_at, failure_reason, checked_at)
           VALUES(2, 2, 8, NULL, 'REQ0002', NULL, ?, '收款', '待确认', 1700.00, NULL, NULL, NULL)''',
        (dt_iso(-1, '16:00'),),
    )

    # 回填 plan_item 的 bill_id / lab_order_id
    c.execute('UPDATE plan_item SET bill_id=1 WHERE id IN (1, 2)')
    c.execute('UPDATE plan_item SET lab_order_id=2 WHERE id=3')
    c.execute('UPDATE plan_item SET bill_id=2, lab_order_id=1 WHERE id=4')

    # 25. reminder（面向患者的短信绝不暴露内部订单号、技工所及返工明细，符合报告 3.2 与表 12）
    c.executemany(
        '''INSERT INTO reminder
           (channel_id, created_by, order_id, appointment_id, kind, scheduled_at, recipient,
            content, attempt_count, delivery_result, last_attempt_at, sent_at, failure_reason)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)''',
        [
            (9, 1, 1, None, '试戴提醒', dt_iso(0, '09:00'), '13800000002',
             '您的定制修复体（全瓷冠）已到达试戴阶段，请预约来院试戴。', 0, '待发送', None, None, None),
            (9, 1, 2, None, '取件提醒', dt_iso(-2, '15:05'), '13800000001',
             '您的定制修复体（固定桥）已制作完成可取件，请到诊所领取。', 1, '已发送', dt_iso(-2, '15:05'), dt_iso(-2, '15:05'), None),
            (9, 1, None, 4, '预约提醒', dt_iso(0, '09:00'), '13800000003',
             f'您预约于 {d_iso(1)} 14:00 到诊，如需改约请提前联系诊所。', 0, '待发送', None, None, None),
        ],
    )

    # 系统账号表（支持作业要求的角色切换登录 + 患者手机号验证码登录）
    accounts = [
        ('receptionist', 'password', 'receptionist', '王前台', 1, None),
        ('doctor', 'password', 'doctor', '李医生', 2, None),
        ('cashier', 'password', 'cashier', '张收费', 3, None),
        ('manager', 'password', 'manager', '陈负责', 4, None),
        ('admin', 'password', 'admin', '林管理', 6, None),
        ('13800000001', '123456', 'patient', '张伟', None, 1),
    ]
    c.executemany(
        '''INSERT INTO sys_account(username, password_hash, role_code, display_name, employee_id, patient_id, active)
           VALUES(?,?,?,?,?,?,1)''',
        [(u, hash_password(pw), r, nm, eid, pid) for u, pw, r, nm, eid, pid in accounts],
    )


# ---------------------------------------------------------------------
# 业务校验与工具函数
# ---------------------------------------------------------------------
def check_overlap(c, doctor_id, room_id, starts_at, ends_at, exclude_id=None):
    sql = '''SELECT id, appointment_no, doctor_id, room_id, starts_at, ends_at, stage
             FROM appointment
             WHERE stage IN ('待确认', '已确认', '已到诊', '已完成')
               AND starts_at < ? AND ends_at > ?
               AND (doctor_id = ? OR room_id = ?)'''
    params = [ends_at, starts_at, doctor_id, room_id]
    if exclude_id:
        sql += ' AND id != ?'
        params.append(int(exclude_id))
    return rows_to_dicts(c.execute(sql, params).fetchall())


def check_in_schedule_grid(c, doctor_id, room_id, starts_at, ends_at, duration_min):
    work_date = str(starts_at)[:10]
    st_m = parse_hm(str(starts_at)[11:16])
    en_m = parse_hm(str(ends_at)[11:16])
    if st_m is None or en_m is None or en_m <= st_m:
        return None
    if en_m - st_m != int(duration_min):
        return None
    segs = c.execute(
        '''SELECT s.* FROM schedule s
           JOIN clinic_room r ON r.id = s.room_id AND r.active = 1
           WHERE s.doctor_id = ? AND s.work_date = ? AND s.stage = '正常' ''',
        (doctor_id, work_date),
    ).fetchall()
    for seg in segs:
        if room_id and int(seg['room_id']) != int(room_id):
            continue
        cur = parse_hm(seg['start_time'])
        end = parse_hm(seg['end_time'])
        step = int(seg['slot_minutes'])
        if cur is None or end is None or step <= 0:
            continue
        if st_m >= cur and en_m <= end and (st_m - cur) % step == 0:
            return dict(seg)
    return None


def compute_slots(c, doctor_id, work_date, duration_min=30, exclude_id=None, is_patient=False):
    if not doctor_id or not work_date:
        raise ApiError('缺少医生或日期参数')
    if is_patient:
        t0 = date.today()
        try:
            wd = date.fromisoformat(work_date)
        except ValueError:
            raise ApiError('日期格式无效')
        if wd < t0 or wd > t0 + timedelta(days=14):
            return {'date': work_date, 'doctor_id': doctor_id, 'slots': [],
                    'note': '自助预约仅开放未来两周内（14 天内）出诊号源'}
    if not is_active_doctor(c, doctor_id):
        return {'date': work_date, 'doctor_id': doctor_id, 'slots': [],
                'note': '该医生已停用或未配置医生岗位'}
    segs = rows_to_dicts(c.execute(
        '''SELECT s.* FROM schedule s
           JOIN clinic_room r ON r.id = s.room_id AND r.active = 1
           WHERE s.doctor_id = ? AND s.work_date = ?
           ORDER BY s.start_time''',
        (doctor_id, work_date),
    ).fetchall())
    if not segs:
        return {'date': work_date, 'doctor_id': doctor_id, 'slots': [], 'note': '该医生当日未排班'}
    if all(s['stage'] == '停诊' for s in segs):
        note = next((s['note'] for s in segs if s.get('note')), '')
        return {'date': work_date, 'doctor_id': doctor_id, 'slots': [],
                'note': '该医生当日停诊' + ('：' + note if note else '')}
    dur = max(15, int(duration_min or 30))
    now_m = now_min()
    slots = []
    for seg in segs:
        if seg['stage'] == '停诊':
            continue
        cur = parse_hm(seg['start_time'])
        end = parse_hm(seg['end_time'])
        step = int(seg['slot_minutes'] or 15)
        if cur is None or end is None:
            continue
        while cur + dur <= end:
            st = f'{work_date}T{cur // 60:02d}:{cur % 60:02d}'
            fin = cur + dur
            en = f'{work_date}T{fin // 60:02d}:{fin % 60:02d}'
            if is_patient and st <= now_m:
                cur += step
                continue
            busy = check_overlap(c, doctor_id, seg['room_id'], st, en, exclude_id)
            slots.append({
                'schedule_id': seg['id'],
                'room_id': seg['room_id'],
                'starts_at': st,
                'ends_at': en,
                'state': '已占用' if busy else '可预约',
                'appointment_no': busy[0]['appointment_no'] if (busy and not is_patient) else None,
            })
            cur += step
    note_out = ''
    if is_patient and not slots:
        note_out = '当日剩余时段已过或暂无可约号源'
    return {'date': work_date, 'doctor_id': doctor_id, 'duration_min': dur, 'slots': slots, 'note': note_out}


def schedule_reminder(c, created_by, kind, scheduled_at, recipient, content, order_id=None, appointment_id=None, channel_id=None):
    if not recipient or not scheduled_at:
        return
    if not channel_id:
        row = c.execute("SELECT id FROM basic_option WHERE kind='通知渠道' AND active=1 ORDER BY sort_order, id LIMIT 1").fetchone()
        channel_id = int(row['id']) if row else 9
    c.execute(
        '''INSERT OR IGNORE INTO reminder
           (channel_id, created_by, order_id, appointment_id, kind, scheduled_at, recipient,
            content, attempt_count, delivery_result)
           VALUES(?,?,?,?,?,?,?,?,0,'待发送')''',
        (channel_id, created_by, order_id, appointment_id, kind, scheduled_at, recipient, content),
    )


def find_duplicate_patients(c):
    rows = rows_to_dicts(c.execute('SELECT id, patient_no, name, phone, birth_date, important_note FROM patient ORDER BY id').fetchall())
    by_name = {}
    by_phone = {}
    for p in rows:
        nm = (p.get('name') or '').strip()
        ph = (p.get('phone') or '').strip()
        if nm:
            by_name.setdefault(nm, []).append(p)
        if ph:
            by_phone.setdefault(ph, []).append(p)
    dups = []
    seen = set()
    for nm, grp in by_name.items():
        if len(grp) > 1:
            for p in grp:
                if p['id'] not in seen:
                    seen.add(p['id'])
                    dups.append({'id': p['id'], 'patient_no': p['patient_no'], 'name': p['name'],
                                 'reason': f'存在同名患者档案（{nm}）'})
    for ph, grp in by_phone.items():
        if len(grp) > 1:
            names = {p['name'] for p in grp}
            if len(names) == 1:
                for p in grp:
                    if p['id'] not in seen:
                        seen.add(p['id'])
                        dups.append({'id': p['id'], 'patient_no': p['patient_no'], 'name': p['name'],
                                     'reason': f'同名且同电话疑似重复建档'})
    return dups


# ---------------------------------------------------------------------
# 角色隔离数据引导（GET /api/bootstrap）
# ---------------------------------------------------------------------
def build_bootstrap(c, user):
    role = user['role']
    clinics = rows_to_dicts(c.execute('SELECT * FROM clinic ORDER BY id').fetchall())
    rooms = rows_to_dicts(c.execute('SELECT * FROM clinic_room ORDER BY id').fetchall())
    basic_options = rows_to_dicts(c.execute('SELECT * FROM basic_option ORDER BY kind, sort_order, id').fetchall())
    appt_types = rows_to_dicts(c.execute('SELECT * FROM appointment_type ORDER BY sort_order, id').fetchall())
    employees = rows_to_dicts(c.execute('SELECT * FROM employee ORDER BY id').fetchall())
    emp_roles = rows_to_dicts(c.execute('SELECT * FROM employee_role ORDER BY employee_id, role_id').fetchall())
    role_map = {o['id']: o for o in basic_options if o['kind'] == '岗位'}
    for e in employees:
        active_rids = [er['role_id'] for er in emp_roles if er['employee_id'] == e['id'] and not er['revoked_at']]
        e['role_ids'] = active_rids
        e['role_codes'] = [role_map[rid]['code'] for rid in active_rids if rid in role_map]
        e['role_names'] = [role_map[rid]['name'] for rid in active_rids if rid in role_map]
        e['is_doctor'] = 'DOCTOR' in e['role_codes']

    # 患者端：严格隔离展示边界（报告 3.2、表 12），绝不返回内部订单号、技工所、返工历史或他人数据
    if role == 'patient':
        pid = int(user.get('patient_id') or 0)
        me = one_to_dict(c.execute('SELECT * FROM patient WHERE id=?', (pid,)).fetchone())
        my_appts = rows_to_dicts(c.execute(
            'SELECT * FROM appointment WHERE patient_id=? ORDER BY starts_at DESC', (pid,)
        ).fetchall())
        my_encs = rows_to_dicts(c.execute(
            'SELECT id, encounter_no, patient_id, doctor_id, appointment_id, occurred_at, chief_complaint, diagnosis, treatment_note, recall_months, completed_at '
            'FROM encounter WHERE patient_id=? ORDER BY occurred_at DESC', (pid,)
        ).fetchall())
        my_plans = rows_to_dicts(c.execute(
            'SELECT * FROM treatment_plan WHERE patient_id=? ORDER BY created_at DESC', (pid,)
        ).fetchall())
        plan_ids = [p['id'] for p in my_plans]
        my_plan_items = []
        if plan_ids:
            q = ','.join('?' for _ in plan_ids)
            raw_items = rows_to_dicts(c.execute(
                f'SELECT pi.*, o.stage AS _order_stage, pr.name AS _product_name '
                f'FROM plan_item pi '
                f'LEFT JOIN dental_order o ON o.id = pi.lab_order_id '
                f'LEFT JOIN product pr ON pr.id = o.product_id '
                f'WHERE pi.plan_id IN ({q}) ORDER BY pi.phase_no, pi.id',
                plan_ids,
            ).fetchall())
            for it in raw_items:
                order_stage = it.pop('_order_stage', None)
                it.pop('_product_name', None)
                it.pop('lab_order_id', None)  # 隐藏内部订单关联
                if order_stage and order_stage in PATIENT_PROGRESS:
                    it['appliance_progress'] = PATIENT_PROGRESS[order_stage]
                else:
                    it['appliance_progress'] = None
                my_plan_items.append(it)
        # 修复件三态投影（仅展示已发送及之后的在制/待试戴/可取件状态，隐藏草稿、取消、订单号、技工所与返工记录）
        my_appliances = []
        raw_orders = rows_to_dicts(c.execute(
            '''SELECT o.id, o.encounter_id, o.stage, o.promised_date, pr.name AS product_name
               FROM dental_order o
               JOIN encounter e ON e.id = o.encounter_id
               JOIN product pr ON pr.id = o.product_id
               WHERE e.patient_id = ? AND o.stage NOT IN ('草稿', '取消')
               ORDER BY o.id DESC''',
            (pid,),
        ).fetchall())
        for o in raw_orders:
            prog = PATIENT_PROGRESS.get(o['stage'])
            if not prog:
                continue
            teeth = [r['tooth_code'] for r in c.execute('SELECT tooth_code FROM order_tooth WHERE order_id=?', (o['id'],)).fetchall()]
            my_appliances.append({
                'encounter_id': o['encounter_id'],
                'product_name': o['product_name'],
                'teeth': teeth,
                'progress': prog,
                'promised_date': o['promised_date'],
            })
        my_bills = rows_to_dicts(c.execute(
            '''SELECT b.id, b.bill_no, b.encounter_id, b.plan_item_id, b.issued_at,
                      b.discount_amount, b.due_date, b.settled_at, b.stage,
                      v.receivable, v.received, v.debt
               FROM bill b
               JOIN encounter e ON e.id = b.encounter_id
               JOIN v_bill_debt v ON v.bill_id = b.id
               WHERE e.patient_id = ? AND b.stage != '已作废'
               ORDER BY b.id DESC''',
            (pid,),
        ).fetchall())
        bill_ids = [b['id'] for b in my_bills]
        my_lines, my_pays = [], []
        if bill_ids:
            q = ','.join('?' for _ in bill_ids)
            my_lines = rows_to_dicts(c.execute(
                f'SELECT id, bill_id, line_no, item_name, unit, quantity, unit_price, discount_amount, description '
                f'FROM bill_line WHERE bill_id IN ({q}) ORDER BY line_no',
                bill_ids,
            ).fetchall())
            my_pays = rows_to_dicts(c.execute(
                f'SELECT id, bill_id, method_id, kind, result, amount, requested_at, occurred_at '
                f'FROM payment WHERE bill_id IN ({q}) ORDER BY id DESC',
                bill_ids,
            ).fetchall())
        return {
            'clinics': clinics,
            'rooms': [{'id': r['id'], 'name': r['name'], 'active': r['active']} for r in rooms],
            'basicOptions': [o for o in basic_options if o['kind'] in ('支付方式', '单位')],
            'appointmentTypes': appt_types,
            'employees': [{'id': e['id'], 'name': e['name'], 'active': e['active'], 'is_doctor': e['is_doctor']} for e in employees if e['is_doctor']],
            'patients': [me] if me else [],
            'appointments': my_appts,
            'encounters': my_encs,
            'treatmentPlans': my_plans,
            'planItems': my_plan_items,
            'appliances': my_appliances,
            'bills': my_bills,
            'billLines': my_lines,
            'payments': my_pays,
        }

    # 诊所内部岗位：严格按角色隔离
    price_items = rows_to_dicts(c.execute('SELECT * FROM price_item ORDER BY id').fetchall())
    products = rows_to_dicts(c.execute('SELECT * FROM product ORDER BY id').fetchall())
    dental_labs = rows_to_dicts(c.execute('SELECT * FROM dental_lab ORDER BY id').fetchall())

    data = {
        'clinics': clinics,
        'rooms': rooms,
        'basicOptions': basic_options,
        'appointmentTypes': appt_types,
        'employees': employees,
        'employeeRoles': emp_roles,
        'priceItems': price_items,
        'products': products,
        'dentalLabs': dental_labs,
    }

    # 患者列表按角色脱敏（表 11：按角色权限脱敏或隐藏患者敏感信息）
    raw_patients = rows_to_dicts(c.execute('SELECT * FROM patient ORDER BY id DESC').fetchall())
    if role in ('receptionist', 'doctor', 'admin'):
        data['patients'] = raw_patients
    else:
        data['patients'] = [
            {
                'id': p['id'], 'patient_no': p['patient_no'], 'name': p['name'],
                'phone': mask_phone(p['phone']), 'important_note': p['important_note'] if role == 'cashier' else '',
                'created_at': p['created_at'],
            }
            for p in raw_patients
        ]

    if role in ('receptionist', 'doctor', 'manager', 'admin'):
        data['schedules'] = rows_to_dicts(c.execute('SELECT * FROM schedule ORDER BY work_date, start_time').fetchall())
        data['appointments'] = rows_to_dicts(c.execute('SELECT * FROM appointment ORDER BY starts_at').fetchall())
        data['appointmentEvents'] = rows_to_dicts(c.execute('SELECT * FROM appointment_event ORDER BY occurred_at').fetchall())
        data['recalls'] = rows_to_dicts(c.execute('SELECT * FROM recall ORDER BY due_date').fetchall())
    else:
        data['schedules'] = []
        data['appointments'] = []
        data['appointmentEvents'] = []
        data['recalls'] = []

    if role in ('receptionist', 'doctor', 'cashier', 'manager', 'admin'):
        data['encounters'] = rows_to_dicts(c.execute('SELECT * FROM encounter ORDER BY occurred_at DESC').fetchall())
    else:
        data['encounters'] = []

    if role in ('doctor', 'cashier', 'manager', 'admin'):
        data['treatmentPlans'] = rows_to_dicts(c.execute('SELECT * FROM treatment_plan ORDER BY created_at DESC').fetchall())
        data['planItems'] = rows_to_dicts(c.execute('SELECT * FROM plan_item ORDER BY plan_id, phase_no, id').fetchall())
    else:
        data['treatmentPlans'] = []
        data['planItems'] = []

    if role in ('receptionist', 'doctor', 'cashier', 'manager', 'admin'):
        data['orders'] = rows_to_dicts(c.execute('SELECT * FROM dental_order ORDER BY id DESC').fetchall())
        data['orderTooths'] = rows_to_dicts(c.execute('SELECT * FROM order_tooth ORDER BY order_id, tooth_code').fetchall())
        data['orderEvents'] = rows_to_dicts(c.execute('SELECT * FROM order_event ORDER BY occurred_at, id').fetchall())
        data['orderAttachments'] = rows_to_dicts(c.execute('SELECT * FROM order_attachment ORDER BY id').fetchall())
    else:
        data['orders'] = []
        data['orderTooths'] = []
        data['orderEvents'] = []
        data['orderAttachments'] = []

    # 收费数据仅收费员、诊所负责人（统计核查）、管理员可见；前台与医生隔离（表 14）
    if role in ('cashier', 'manager', 'admin'):
        data['bills'] = rows_to_dicts(c.execute(
            '''SELECT b.*, v.line_sum, v.receivable, v.received, v.debt
               FROM bill b JOIN v_bill_debt v ON v.bill_id = b.id
               ORDER BY b.id DESC'''
        ).fetchall())
        data['billLines'] = rows_to_dicts(c.execute('SELECT * FROM bill_line ORDER BY bill_id, line_no').fetchall())
        data['payments'] = rows_to_dicts(c.execute('SELECT * FROM payment ORDER BY id DESC').fetchall())
    else:
        data['bills'] = []
        data['billLines'] = []
        data['payments'] = []

    if role in ('receptionist', 'manager', 'admin'):
        rems = rows_to_dicts(c.execute('SELECT * FROM reminder ORDER BY scheduled_at DESC').fetchall())
        if role == 'manager':
            for r in rems:
                r['recipient'] = mask_phone(r['recipient'])
        data['reminders'] = rems
    else:
        data['reminders'] = []

    if role == 'admin':
        data['accounts'] = rows_to_dicts(c.execute(
            'SELECT id, username, role_code, display_name, employee_id, patient_id, active, created_at FROM sys_account ORDER BY id'
        ).fetchall())
        data['auditLogs'] = rows_to_dicts(c.execute('SELECT * FROM sys_audit_log ORDER BY id DESC LIMIT 100').fetchall())
    if role in ('receptionist', 'admin'):
        data['duplicatePatients'] = find_duplicate_patients(c)

    return data


# ---------------------------------------------------------------------
# 统计报表（严格实现报告表 25 全部七项口径 + 医生/业务类型筛选 + 原始明细下钻）
# ---------------------------------------------------------------------
def compute_reports(c, start='', end='', doctor_id=None, biz_type='全部'):
    today = today_str()
    doc_filter = int(doctor_id) if doctor_id else None

    def in_range(v):
        if not v:
            return False
        d = str(v)[:10]
        if start and d < start:
            return False
        if end and d > end:
            return False
        return True

    def pct(v):
        return '无可计算样本' if v is None else f'{v * 100:.1f}%'

    def ratio(n, d):
        return (n / d) if d else None

    patients_map = {r['id']: dict(r) for r in c.execute('SELECT id, patient_no, name, phone FROM patient').fetchall()}
    emp_map = {r['id']: dict(r) for r in c.execute('SELECT id, name FROM employee').fetchall()}
    room_map = {r['id']: dict(r) for r in c.execute('SELECT id, name FROM clinic_room').fetchall()}
    enc_map = {r['id']: dict(r) for r in c.execute('SELECT * FROM encounter').fetchall()}

    def p_label(pid):
        p = patients_map.get(pid)
        return f"{p['name']}（{mask_phone(p['phone'])}）" if p else '—'

    # 1. 预约兑现率 & 2. 预约确认周期中位数
    appts = rows_to_dicts(c.execute('SELECT * FROM appointment ORDER BY starts_at DESC').fetchall())
    if doc_filter:
        appts = [a for a in appts if a['doctor_id'] == doc_filter]
    in_appts = [a for a in appts if in_range(a['starts_at'])]
    closed_appts = [a for a in in_appts if a['stage'] in ('已确认', '已到诊', '已完成', '爽约')]
    fulfilled_appts = [a for a in in_appts if a['stage'] in ('已到诊', '已完成')]
    fulfillment = ratio(len(fulfilled_appts), len(closed_appts))

    confirmed_appts = [a for a in appts if a.get('confirmed_at') and in_range(a['confirmed_at'])]
    cyc_mins = []
    for a in confirmed_appts:
        try:
            dt1 = datetime.fromisoformat(str(a['confirmed_at'])[:19])
            dt0 = datetime.fromisoformat(str(a['created_at'])[:19])
            cyc_mins.append(max(0.0, (dt1 - dt0).total_seconds() / 60.0))
        except Exception:
            pass
    cyc_mins.sort()
    median_min = None
    if cyc_mins:
        n = len(cyc_mins)
        median_min = cyc_mins[n // 2] if n % 2 else (cyc_mins[n // 2 - 1] + cyc_mins[n // 2]) / 2.0

    # 3. 椅位利用率（表 25：按诊室维度核定，排班区间合并去重不重复累计）
    segs = rows_to_dicts(c.execute("SELECT * FROM schedule WHERE stage != '停诊'").fetchall())
    if doc_filter:
        segs = [s for s in segs if s['doctor_id'] == doc_filter]
    segs = [s for s in segs if in_range(s['work_date'])]

    def merge_intervals(intervals):
        if not intervals:
            return 0
        intervals.sort()
        merged = [list(intervals[0])]
        for s, e in intervals[1:]:
            if s <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], e)
            else:
                merged.append([s, e])
        return sum(e - s for s, e in merged)

    room_sched_iv = {}  # (room_id, work_date) -> [(st, en)]
    for seg in segs:
        a_m, b_m = parse_hm(seg['start_time']), parse_hm(seg['end_time'])
        if a_m is not None and b_m is not None and b_m > a_m:
            room_sched_iv.setdefault((seg['room_id'], seg['work_date']), []).append((a_m, b_m))

    active_appts = [a for a in in_appts if a['stage'] in ('待确认', '已确认', '已到诊', '已完成') and a.get('room_id')]
    room_appt_iv = {}
    for a in active_appts:
        a_m, b_m = parse_hm(str(a['starts_at'])[11:16]), parse_hm(str(a['ends_at'])[11:16])
        if a_m is not None and b_m is not None and b_m > a_m:
            room_appt_iv.setdefault((a['room_id'], str(a['starts_at'])[:10]), []).append((a_m, b_m))

    room_ids = sorted({rid for rid, _ in room_sched_iv.keys()} | {rid for rid, _ in room_appt_iv.keys()})
    room_stats = []
    total_sched_min = 0
    total_booked_min = 0
    for rid in room_ids:
        s_min = sum(merge_intervals(ivs) for (r, _), ivs in room_sched_iv.items() if r == rid)
        b_min = sum(merge_intervals(ivs) for (r, _), ivs in room_appt_iv.items() if r == rid)
        total_sched_min += s_min
        total_booked_min += b_min
        r_rate = ratio(b_min, s_min)
        room_stats.append({
            'room_id': rid,
            'room_name': room_map.get(rid, {}).get('name', f'诊室#{rid}'),
            'booked_min': b_min,
            'sched_min': s_min,
            'rate': pct(r_rate),
        })
    chair_rate = ratio(total_booked_min, total_sched_min)

    # 4. 医生工作量（通过 employee_role 识别医生）
    doctor_rows = rows_to_dicts(c.execute(
        '''SELECT DISTINCT e.id, e.name
           FROM employee e
           JOIN employee_role er ON er.employee_id = e.id AND er.revoked_at IS NULL
           JOIN basic_option bo ON bo.id = er.role_id AND bo.kind='岗位' AND bo.code='DOCTOR'
           ORDER BY e.id'''
    ).fetchall())
    if doc_filter:
        doctor_rows = [d for d in doctor_rows if d['id'] == doc_filter]
    doctors = []
    for d in doctor_rows:
        mine = [a for a in active_appts if a['doctor_id'] == d['id']]
        mins = 0
        for a in mine:
            a_m, b_m = parse_hm(str(a['starts_at'])[11:16]), parse_hm(str(a['ends_at'])[11:16])
            if a_m is not None and b_m is not None and b_m > a_m:
                mins += b_m - a_m
        doctors.append({
            'doctor_id': d['id'],
            'name': d['name'],
            'appointments': len(mine),
            'done': sum(1 for a in mine if a['stage'] == '已完成'),
            'minutes': mins,
        })
    doctors.sort(key=lambda x: (-x['appointments'], x['doctor_id']))

    # 5. 欠款回收率（表 25：锁定统计期初的未作废欠款收费单队列，分母=期初未收余额，分子=该队列期间净回款；期间新增欠款单独列示）
    all_bills = rows_to_dicts(c.execute(
        '''SELECT b.*, v.receivable, v.received, v.debt
           FROM bill b JOIN v_bill_debt v ON v.bill_id = b.id
           WHERE b.stage != '已作废' ORDER BY b.id DESC'''
    ).fetchall())
    if doc_filter:
        all_bills = [b for b in all_bills if enc_map.get(b.get('encounter_id'), {}).get('doctor_id') == doc_filter]
    all_pays = rows_to_dicts(c.execute("SELECT * FROM payment WHERE result='成功'").fetchall())
    pays_by_bill = {}
    for p in all_pays:
        pays_by_bill.setdefault(p['bill_id'], []).append(p)

    opening_balance = 0.0
    period_recovered = 0.0
    opening_queue = []
    new_debt_amount = 0.0
    new_debt_bills = []

    for b in all_bills:
        if not b.get('debt_opened_at'):
            continue
        opened_day = str(b['debt_opened_at'])[:10]
        rec = float(b['receivable'])
        bpays = pays_by_bill.get(b['id'], [])
        if start and opened_day < start:
            before_net = 0.0
            in_net = 0.0
            for p in bpays:
                pd = str(p.get('occurred_at') or p.get('requested_at') or '')[:10]
                signed = float(p['amount']) * (1.0 if p['kind'] == '收款' else -1.0)
                if pd < start:
                    before_net += signed
                if in_range(pd):
                    in_net += signed
            open_bal = max(0.0, rec - before_net)
            if open_bal > 0.0001:
                opening_balance += open_bal
                period_recovered += in_net
                opening_queue.append({
                    'id': b['id'], 'bill_no': b['bill_no'],
                    'patient': p_label(enc_map.get(b.get('encounter_id'), {}).get('patient_id')),
                    'opening_debt': round(open_bal, 2),
                    'recovered': round(in_net, 2),
                    'current_debt': round(float(b['debt']), 2),
                })
        elif in_range(opened_day):
            # 期间新增欠款（截至期末的未结清余额）
            up_to_end = 0.0
            for p in bpays:
                pd = str(p.get('occurred_at') or p.get('requested_at') or '')[:10]
                if not end or pd <= end:
                    up_to_end += float(p['amount']) * (1.0 if p['kind'] == '收款' else -1.0)
            nd = max(0.0, rec - up_to_end)
            if nd > 0.0001:
                new_debt_amount += nd
                new_debt_bills.append({
                    'id': b['id'], 'bill_no': b['bill_no'],
                    'patient': p_label(enc_map.get(b.get('encounter_id'), {}).get('patient_id')),
                    'debt': round(nd, 2), 'due_date': b.get('due_date') or '',
                })
    rec_rate = ratio(period_recovered, opening_balance)

    # 6. 订单按期交付率（表 25：分母为承诺交期落在已结束统计期间的已发送且未取消订单，分子为实际交货 <= 承诺日）
    all_orders = rows_to_dicts(c.execute(
        '''SELECT o.*, pr.name AS product_name, lb.name AS lab_name
           FROM dental_order o
           LEFT JOIN product pr ON pr.id = o.product_id
           LEFT JOIN dental_lab lb ON lb.id = o.lab_id
           ORDER BY o.id DESC'''
    ).fetchall())
    if doc_filter:
        all_orders = [o for o in all_orders if enc_map.get(o.get('encounter_id'), {}).get('doctor_id') == doc_filter]

    effective_end = min(end, today) if end else today
    sent_non_cancel = [
        o for o in all_orders
        if o['stage'] not in ('草稿', '取消') and o.get('promised_date')
        and (not start or o['promised_date'] >= start)
        and o['promised_date'] <= effective_end
        and (o['stage'] == '已交货' or o['promised_date'] < today)
    ]
    on_time_orders = [
        o for o in sent_non_cancel
        if o['stage'] == '已交货' and o.get('delivered_at') and str(o['delivered_at'])[:10] <= o['promised_date']
    ]
    on_time_rate = ratio(len(on_time_orders), len(sent_non_cancel))

    # 7. 记录关联完整度（表 25：期间内纳入核查的收费单与义齿订单，完整关联有效患者、诊疗及必要明细）
    period_bills = [b for b in all_bills if in_range(b['issued_at'])]
    period_orders = [o for o in all_orders if in_range(o['created_at'])]
    line_counts = {r['bill_id']: r['cnt'] for r in c.execute('SELECT bill_id, COUNT(*) AS cnt FROM bill_line GROUP BY bill_id').fetchall()}
    tooth_counts = {r['order_id']: r['cnt'] for r in c.execute('SELECT order_id, COUNT(*) AS cnt FROM order_tooth GROUP BY order_id').fetchall()}
    event_counts = {r['order_id']: r['cnt'] for r in c.execute('SELECT order_id, COUNT(*) AS cnt FROM order_event GROUP BY order_id').fetchall()}

    anomalies = []
    checked_records = []
    ok_records = 0
    total_checked = len(period_bills) + len(period_orders)

    for b in period_bills:
        enc = enc_map.get(b.get('encounter_id'))
        pat = patients_map.get(enc['patient_id']) if enc else None
        has_lines = line_counts.get(b['id'], 0) > 0
        if enc and pat and has_lines:
            ok_records += 1
            checked_records.append({'type': '收费单', 'id': b['id'], 'no': b['bill_no'], 'patient': p_label(enc['patient_id']), 'status': '完整'})
        else:
            problems = []
            if not enc:
                problems.append('未关联诊疗记录')
            elif not pat:
                problems.append('未关联有效患者')
            if not has_lines:
                problems.append('缺少收费明细')
            prob = '、'.join(problems)
            anomalies.append({'type': '收费单', 'id': b['id'], 'no': b['bill_no'], 'problem': prob})
            checked_records.append({'type': '收费单', 'id': b['id'], 'no': b['bill_no'], 'patient': p_label(enc['patient_id']) if enc else '—', 'status': '异常：' + prob})

    for o in period_orders:
        enc = enc_map.get(o.get('encounter_id'))
        pat = patients_map.get(enc['patient_id']) if enc else None
        has_ev = event_counts.get(o['id'], 0) > 0
        has_teeth = True if o['stage'] == '草稿' else (tooth_counts.get(o['id'], 0) > 0)
        if enc and pat and has_ev and has_teeth:
            ok_records += 1
            checked_records.append({'type': '义齿订单', 'id': o['id'], 'no': o['order_no'], 'patient': p_label(enc['patient_id']), 'status': '完整'})
        else:
            problems = []
            if not enc:
                problems.append('未关联诊疗记录')
            elif not pat:
                problems.append('未关联有效患者')
            if not has_ev:
                problems.append('缺少订单进展记录')
            if not has_teeth:
                problems.append('非草稿订单缺少牙位')
            prob = '、'.join(problems)
            anomalies.append({'type': '义齿订单', 'id': o['id'], 'no': o['order_no'], 'problem': prob})
            checked_records.append({'type': '义齿订单', 'id': o['id'], 'no': o['order_no'], 'patient': p_label(enc['patient_id']) if enc else '—', 'status': '异常：' + prob})

    # 附加重复建档数据异常（报告 3.3）
    for dp in find_duplicate_patients(c):
        anomalies.append({'type': '患者档案', 'id': dp['id'], 'no': dp['patient_no'], 'problem': dp['reason']})

    complete_rate = ratio(ok_records, total_checked)

    all_metrics = [
        {
            'key': 'appointmentConfirmMedian', 'biz': '预约', 'name': '预约确认周期中位数',
            'value': '无可计算样本' if median_min is None else f'{median_min:.1f} 分钟',
            'sample': len(cyc_mins), 'small_sample': 0 < len(cyc_mins) < 5,
            'numerator': None, 'denominator': None,
        },
        {
            'key': 'fulfillment', 'biz': '预约', 'name': '预约兑现率',
            'value': pct(fulfillment), 'sample': len(closed_appts),
            'small_sample': 0 < len(closed_appts) < 5,
            'numerator': len(fulfilled_appts), 'denominator': len(closed_appts),
        },
        {
            'key': 'chairUtilization', 'biz': '预约', 'name': '椅位利用率',
            'value': pct(chair_rate), 'sample': len(segs),
            'small_sample': 0 < len(segs) < 5,
            'numerator': total_booked_min, 'denominator': total_sched_min, 'unit': '分钟',
        },
        {
            'key': 'recovery', 'biz': '收费', 'name': '欠款回收率',
            'value': pct(rec_rate), 'sample': len(opening_queue),
            'small_sample': 0 < len(opening_queue) < 5,
            'numerator': round(period_recovered, 2), 'denominator': round(opening_balance, 2),
            'new_debt': round(new_debt_amount, 2), 'new_debt_count': len(new_debt_bills),
        },
        {
            'key': 'onTime', 'biz': '订单', 'name': '订单按期交付率',
            'value': pct(on_time_rate), 'sample': len(sent_non_cancel),
            'small_sample': 0 < len(sent_non_cancel) < 5,
            'numerator': len(on_time_orders), 'denominator': len(sent_non_cancel),
        },
        {
            'key': 'completeness', 'biz': '全部', 'name': '记录关联完整度',
            'value': pct(complete_rate), 'sample': total_checked,
            'small_sample': 0 < total_checked < 5,
            'numerator': ok_records, 'denominator': total_checked,
        },
    ]
    if biz_type and biz_type != '全部':
        metrics = [m for m in all_metrics if m['biz'] in (biz_type, '全部')]
    else:
        metrics = all_metrics

    def order_view(o):
        enc = enc_map.get(o.get('encounter_id')) or {}
        return {
            'id': o['id'], 'order_no': o['order_no'], 'stage': o['stage'],
            'product_name': o.get('product_name') or '', 'lab_name': o.get('lab_name') or '',
            'promised_date': o.get('promised_date') or '', 'delivered_at': o.get('delivered_at') or '',
            'patient': p_label(enc.get('patient_id')),
        }

    trial_orders = [order_view(o) for o in all_orders if o['stage'] in ('试戴', '质量确认')]
    delivered_orders = [order_view(o) for o in all_orders if o['stage'] == '已交货']
    overdue_orders = [
        order_view(o) for o in all_orders
        if o.get('promised_date') and o['promised_date'] < today and o['stage'] not in ('已交货', '取消', '草稿')
    ]

    due_recalls = []
    for r in rows_to_dicts(c.execute(
        "SELECT * FROM recall WHERE stage IN ('待通知', '已通知') AND due_date <= ? ORDER BY due_date",
        (today,),
    ).fetchall()):
        enc = enc_map.get(r['encounter_id']) or {}
        if doc_filter and enc.get('doctor_id') != doc_filter:
            continue
        due_recalls.append({
            'id': r['id'], 'patient': p_label(r['patient_id']),
            'due_date': r['due_date'], 'stage': r['stage'], 'reason': r['reason'],
        })

    # 原始明细下钻（表 11 / 6.5：所有指标支持追溯至原始记录）
    drilldown = {
        'appointmentConfirmMedian': [
            {
                'no': a['appointment_no'], 'patient': p_label(a['patient_id']),
                'doctor': emp_map.get(a['doctor_id'], {}).get('name', ''),
                'created_at': a['created_at'], 'confirmed_at': a['confirmed_at'], 'stage': a['stage'],
            }
            for a in confirmed_appts
        ],
        'fulfillment': [
            {
                'no': a['appointment_no'], 'patient': p_label(a['patient_id']),
                'doctor': emp_map.get(a['doctor_id'], {}).get('name', ''),
                'starts_at': a['starts_at'], 'stage': a['stage'],
            }
            for a in closed_appts
        ],
        'chairUtilization': room_stats,
        'recovery': {'opening_queue': opening_queue, 'new_debt_bills': new_debt_bills},
        'onTime': [order_view(o) for o in sent_non_cancel],
        'completeness': {'checked': checked_records, 'anomalies': anomalies},
    }

    return {
        'start': start, 'end': end, 'doctor_id': doc_filter, 'biz_type': biz_type,
        'metrics': metrics,
        'rooms': room_stats,
        'doctors': doctors,
        'anomalies': anomalies,
        'trial': trial_orders,
        'delivered': delivered_orders,
        'overdue': overdue_orders,
        'dueRecalls': due_recalls,
        'drilldown': drilldown,
    }


# ---------------------------------------------------------------------
# HTTP 路由与事务处理
# ---------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    server_version = 'ClinicServer/2.0'

    def log_message(self, fmt, *args):
        if '/health' not in self.path:
            sys.stderr.write(f'[{datetime.now().strftime("%H:%M:%S")}] {fmt % args}\n')

    def _cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type,X-Token,Authorization')

    def _send(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _ok(self, data=None):
        self._send({'ok': True, 'data': data, 'error': None}, 200)

    def _err(self, message, status=400):
        self._send({'ok': False, 'data': None, 'error': message}, status)

    def _body(self):
        length = int(self.headers.get('Content-Length') or 0)
        if not length:
            return {}
        if length > 16 * 1024 * 1024:
            raise ApiError('请求体过大', 413)
        try:
            return json.loads(self.rfile.read(length).decode('utf-8'))
        except Exception:
            raise ApiError('请求 JSON 格式无效', 400)

    @staticmethod
    def _normalize(path):
        return path[4:] if path.startswith('/api/') else path

    def _require(self, allowed_roles=None):
        tok = self.headers.get('X-Token') or ''
        if not tok:
            auth = self.headers.get('Authorization') or ''
            if auth.startswith('Bearer '):
                tok = auth[7:].strip()
        user = verify_token(tok)
        if not user:
            raise ApiError('未登录或会话已失效，请重新登录', 401)
        # 实时核验账号及员工启用状态，停用后立即失效（表 14 安全性）
        with connect() as c:
            if user.get('account_id'):
                acc = c.execute('SELECT active, employee_id, role_code FROM sys_account WHERE id=?', (int(user['account_id']),)).fetchone()
                if not acc or not acc['active']:
                    raise ApiError('当前账号已停用，请重新登录', 401)
                if acc['employee_id']:
                    emp = c.execute('SELECT active FROM employee WHERE id=?', (int(acc['employee_id']),)).fetchone()
                    if not emp or not emp['active']:
                        raise ApiError('当前员工档案已停用，会话已失效', 401)
                user['role'] = acc['role_code']
            elif user.get('role') == 'patient' and user.get('patient_id'):
                if not c.execute('SELECT 1 FROM patient WHERE id=?', (int(user['patient_id']),)).fetchone():
                    raise ApiError('患者档案不存在，会话已失效', 401)
        if allowed_roles and user.get('role') not in allowed_roles:
            raise ApiError('当前角色无权执行此操作', 403)
        return user

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = self._normalize(parsed.path)
        q = parse_qs(parsed.query)
        try:
            if path in ('/', '/health'):
                with connect() as c:
                    tables = [
                        r[0] for r in c.execute(
                            "SELECT name FROM sqlite_master WHERE type='table' "
                            "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'sys_%'"
                        ).fetchall()
                    ]
                    counts = {t: c.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in tables}
                self._ok({
                    'service': '口腔诊所管理系统（25 表关系库）',
                    'tables': len(tables),
                    'rows': sum(counts.values()),
                    'time': now_str(),
                })
                return

            if path == '/bootstrap':
                user = self._require()
                with connect() as c:
                    self._ok(build_bootstrap(c, user))
                return

            if path == '/slots':
                user = self._require()
                doctor_id = int((q.get('doctor_id') or ['0'])[0] or 0)
                work_date = (q.get('date') or [''])[0]
                duration = int((q.get('duration_min') or ['30'])[0] or 30)
                exclude_id = (q.get('exclude_id') or [None])[0]
                with connect() as c:
                    self._ok(compute_slots(c, doctor_id, work_date, duration, exclude_id, user['role'] == 'patient'))
                return

            if path == '/reports':
                self._require({'manager', 'admin'})
                start = (q.get('start') or [''])[0]
                end = (q.get('end') or [''])[0]
                doctor_id = (q.get('doctor_id') or [''])[0]
                biz_type = (q.get('biz_type') or ['全部'])[0]
                with connect() as c:
                    self._ok(compute_reports(c, start, end, doctor_id, biz_type))
                return

            if path == '/orders/attachments/download':
                self._require({'doctor', 'receptionist', 'manager', 'admin'})
                att_id = int((q.get('id') or ['0'])[0] or 0)
                with connect() as c:
                    att = one_to_dict(c.execute('SELECT * FROM order_attachment WHERE id=?', (att_id,)).fetchone())
                if not att:
                    raise ApiError('附件不存在', 404)
                fp = (UPLOAD_DIR / att['storage_key']).resolve()
                if not str(fp).startswith(str(UPLOAD_DIR.resolve())) or not fp.exists():
                    raise ApiError('附件文件不存在于文件存储中', 404)
                raw = fp.read_bytes()
                self.send_response(200)
                self.send_header('Content-Type', att['mime_type'])
                self.send_header('Content-Length', str(len(raw)))
                self._cors_headers()
                self.end_headers()
                self.wfile.write(raw)
                return

            self._err('接口不存在', 404)
        except ApiError as e:
            self._err(e.message, e.status)
        except sqlite3.IntegrityError as e:
            self._err(f'数据约束校验未通过：{e}', 400)
        except Exception as e:
            self._err(f'服务器异常：{e}', 500)

    def do_POST(self):
        path = self._normalize(urlparse(self.path).path)
        try:
            body = self._body()

            # ---- 认证与患者短信验证码 ----
            if path == '/auth/sms-code':
                phone = str(body.get('phone') or '').strip()
                if not phone:
                    raise ApiError('请输入手机号')
                with connect() as c:
                    pat = c.execute('SELECT id, name FROM patient WHERE phone=? ORDER BY id LIMIT 1', (phone,)).fetchone()
                if not pat:
                    raise ApiError('未找到该手机号对应的患者档案，请先到店由前台登记')
                code = '123456' if phone == '13800000001' else f'{secrets.randbelow(900000) + 100000}'
                now_ts = time.time()
                with _lock:
                    for k in [k for k, v in _sms_codes.items() if v[1] < now_ts]:
                        _sms_codes.pop(k, None)
                    _sms_codes[phone] = (code, now_ts + 300)
                self._ok({'sent': True, 'phone': phone, 'demo_code': code, 'expires_in': 300})
                return

            if path == '/auth/login':
                mode = body.get('mode') or ''
                username = str(body.get('username') or body.get('phone') or '').strip()
                password = str(body.get('password') or body.get('code') or '').strip()
                if not username or not password:
                    raise ApiError('请输入账号/手机号与密码/验证码')
                with connect() as c:
                    # 患者手机号 + 短信验证码登录（UC-05）
                    sms_entry = _sms_codes.get(username)
                    if mode == 'patient_sms' or (sms_entry and sms_entry[1] >= time.time() and sms_entry[0] == password):
                        if not sms_entry or sms_entry[1] < time.time() or sms_entry[0] != password:
                            # 允许演示测试患者 13800000001 使用默认验证码 123456
                            if not (username == '13800000001' and password == '123456'):
                                raise ApiError('短信验证码无效或已过期，请重新获取', 401)
                        pat = c.execute('SELECT id, name, phone FROM patient WHERE phone=? ORDER BY id LIMIT 1', (username,)).fetchone()
                        if not pat:
                            raise ApiError('未找到对应患者档案', 401)
                        with _lock:
                            _sms_codes.pop(username, None)
                        payload = {
                            'account_id': 0, 'username': pat['phone'], 'role': 'patient',
                            'roles': ['PATIENT'], 'name': pat['name'],
                            'employee_id': None, 'patient_id': pat['id'],
                            'exp': int(time.time()) + 86400,
                        }
                        self._ok({**payload, 'patientId': pat['id'], 'token': sign_token(payload)})
                        return

                    # 内部账号密码登录
                    acc = c.execute('SELECT * FROM sys_account WHERE username=?', (username,)).fetchone()
                    if not acc or not acc['active'] or not verify_password(password, acc['password_hash']):
                        raise ApiError('账号或密码错误', 401)
                    roles = []
                    if acc['employee_id']:
                        emp = c.execute('SELECT active FROM employee WHERE id=?', (acc['employee_id'],)).fetchone()
                        if not emp or not emp['active']:
                            raise ApiError('该员工档案已停用，禁止登录', 403)
                        roles = [r['code'] for r in get_employee_roles(c, acc['employee_id'])]
                    payload = {
                        'account_id': acc['id'], 'username': acc['username'],
                        'role': acc['role_code'], 'roles': roles,
                        'name': acc['display_name'],
                        'employee_id': acc['employee_id'], 'patient_id': acc['patient_id'],
                        'exp': int(time.time()) + 86400,
                    }
                    self._ok({**payload, 'patientId': acc['patient_id'], 'token': sign_token(payload)})
                return

            # ---- 基础信息与账号维护（manager / admin） ----
            if path.startswith('/basic/'):
                self._handle_basic(path, body)
                return

            # ---- 患者管理 ----
            if path == '/patients':
                user = self._require({'receptionist', 'admin'})
                self._ok(self._create_patient(body, user))
                return
            if path == '/patients/update':
                user = self._require({'receptionist', 'admin'})
                self._ok(self._update_patient(body, user))
                return

            # ---- 排班管理 ----
            if path == '/schedules':
                user = self._require({'receptionist', 'admin'})
                self._ok(self._upsert_schedule(body, user))
                return
            if path == '/schedules/toggle':
                user = self._require({'receptionist', 'admin'})
                self._ok(self._toggle_schedule(body, user))
                return
            if path == '/schedules/delete':
                user = self._require({'receptionist', 'admin'})
                self._ok(self._delete_schedule(body, user))
                return

            # ---- 预约管理（UC-01 / UC-05） ----
            if path == '/appointments/book':
                user = self._require({'receptionist', 'admin', 'patient'})
                self._ok(self._book_appointment(body, user))
                return
            if path == '/appointments/reschedule':
                user = self._require({'receptionist', 'admin', 'patient'})
                self._ok(self._reschedule_appointment(body, user))
                return
            if path == '/appointments/stage':
                user = self._require({'receptionist', 'admin', 'patient'})
                self._ok(self._change_appointment_stage(body, user))
                return

            # ---- 诊疗记录与复诊召回 ----
            if path == '/encounters':
                user = self._require({'doctor', 'admin'})
                self._ok(self._create_encounter(body, user))
                return
            if path == '/recalls/stage':
                user = self._require({'receptionist', 'manager', 'admin'})
                self._ok(self._change_recall_stage(body, user))
                return

            # ---- 治疗计划（UC-06） ----
            if path == '/plans':
                user = self._require({'doctor', 'admin'})
                self._ok(self._create_plan(body, user))
                return
            if path == '/plans/confirm':
                user = self._require({'doctor', 'admin'})
                self._ok(self._confirm_plan(body, user))
                return
            if path == '/plans/close':
                user = self._require({'doctor', 'admin'})
                self._ok(self._close_plan(body, user))
                return
            if path == '/plans/terminate':
                user = self._require({'doctor', 'admin'})
                self._ok(self._terminate_plan(body, user))
                return
            if path == '/plans/items/add':
                user = self._require({'doctor', 'admin'})
                self._ok(self._add_plan_item(body, user))
                return
            if path == '/plans/items/cancel':
                user = self._require({'doctor', 'admin'})
                self._ok(self._cancel_plan_item(body, user))
                return
            if path == '/plans/items/execute':
                user = self._require({'doctor', 'admin'})
                self._ok(self._execute_plan_item(body, user))
                return
            if path == '/plans/items/lab-order':
                user = self._require({'doctor', 'admin'})
                self._ok(self._order_from_plan_item(body, user))
                return

            # ---- 收费、支付与欠款（UC-02） ----
            if path == '/bills':
                user = self._require({'cashier', 'admin'})
                self._ok(self._create_bill(body, user))
                return
            if path == '/bills/discount':
                user = self._require({'cashier', 'admin'})
                self._ok(self._apply_bill_discount(body, user))
                return
            if path == '/bills/collection':
                user = self._require({'cashier', 'admin'})
                self._ok(self._update_bill_collection(body, user))
                return
            if path == '/bills/void':
                user = self._require({'cashier', 'admin'})
                self._ok(self._void_bill(body, user))
                return
            if path == '/payments/create':
                user = self._require({'cashier', 'admin'})
                self._ok(self._create_payment(body, user))
                return
            if path == '/payments/verify':
                user = self._require({'cashier', 'admin'})
                self._ok(self._verify_payment(body, user))
                return
            if path == '/payments/refund':
                user = self._require({'cashier', 'admin'})
                self._ok(self._refund_payment(body, user))
                return

            # ---- 义齿订单（UC-03） ----
            if path == '/orders':
                user = self._require({'doctor', 'admin'})
                self._ok(self._create_order_draft(body, user))
                return
            if path == '/orders/update-draft':
                user = self._require({'doctor', 'admin'})
                self._ok(self._update_order_draft(body, user))
                return
            if path == '/orders/attachments/upload':
                user = self._require({'doctor', 'admin'})
                self._ok(self._upload_order_attachment(body, user))
                return
            if path == '/orders/attachments/delete':
                user = self._require({'doctor', 'admin'})
                self._ok(self._delete_order_attachment(body, user))
                return
            if path == '/orders/send':
                user = self._require({'doctor', 'admin'})
                self._ok(self._send_order(body, user))
                return
            if path == '/orders/receipt':
                user = self._require({'doctor', 'admin'})
                self._ok(self._order_receipt(body, user))
                return
            if path == '/orders/stage':
                user = self._require({'doctor', 'receptionist', 'manager', 'admin'})
                self._ok(self._order_stage(body, user))
                return

            # ---- 提醒（UC-04） ----
            if path == '/reminders/send':
                user = self._require({'receptionist', 'manager', 'admin'})
                self._ok(self._send_reminder(body, user))
                return
            if path == '/reminders/create':
                user = self._require({'receptionist', 'manager', 'admin'})
                self._ok(self._create_reminder(body, user))
                return

            self._err('接口不存在', 404)
        except ApiError as e:
            self._err(e.message, e.status)
        except sqlite3.IntegrityError as e:
            self._err(f'违反数据库唯一性或外键约束：{e}', 400)
        except Exception as e:
            self._err(f'服务器异常：{e}', 500)

    # -----------------------------------------------------------------
    # 基础信息维护实现
    # -----------------------------------------------------------------
    def _handle_basic(self, path, body):
        if path == '/basic/account':
            user = self._require({'admin'})
            with _lock, connect() as c:
                aid = body.get('id')
                username = str(body.get('username') or '').strip()
                role_code = str(body.get('role_code') or '').strip()
                display_name = str(body.get('display_name') or username).strip()
                active = 1 if body.get('active', True) else 0
                emp_id = int(body['employee_id']) if body.get('employee_id') else None
                pat_id = int(body['patient_id']) if body.get('patient_id') else None
                if not username or role_code not in ('receptionist', 'doctor', 'cashier', 'manager', 'admin', 'patient'):
                    raise ApiError('账号与角色必填且合法')
                if aid:
                    if body.get('password'):
                        c.execute(
                            'UPDATE sys_account SET username=?, password_hash=?, role_code=?, display_name=?, employee_id=?, patient_id=?, active=? WHERE id=?',
                            (username, hash_password(body['password']), role_code, display_name, emp_id, pat_id, active, int(aid)),
                        )
                    else:
                        c.execute(
                            'UPDATE sys_account SET username=?, role_code=?, display_name=?, employee_id=?, patient_id=?, active=? WHERE id=?',
                            (username, role_code, display_name, emp_id, pat_id, active, int(aid)),
                        )
                    audit(c, 'sys_account', aid, 'update', user, new_val={'username': username, 'role_code': role_code, 'active': active})
                else:
                    pw = str(body.get('password') or '').strip()
                    if not pw:
                        raise ApiError('新建账号必须设置初始密码')
                    cur = c.execute(
                        'INSERT INTO sys_account(username, password_hash, role_code, display_name, employee_id, patient_id, active) VALUES(?,?,?,?,?,?,?)',
                        (username, hash_password(pw), role_code, display_name, emp_id, pat_id, active),
                    )
                    aid = cur.lastrowid
                    audit(c, 'sys_account', aid, 'create', user, new_val={'username': username, 'role_code': role_code})
                self._ok(one_to_dict(c.execute(
                    'SELECT id, username, role_code, display_name, employee_id, patient_id, active, created_at FROM sys_account WHERE id=?', (aid,)
                ).fetchone()))
            return

        user = self._require({'manager', 'admin'})
        with _lock, connect() as c:
            if path == '/basic/option':
                oid = body.get('id')
                kind = str(body.get('kind') or '').strip()
                code = str(body.get('code') or '').strip()
                name = str(body.get('name') or '').strip()
                desc = str(body.get('description') or '').strip()
                sort_order = int(body.get('sort_order') or 1)
                active = 1 if body.get('active', True) else 0
                if not kind or not code or not name:
                    raise ApiError('类别、编码与名称必填')
                if oid:
                    old = c.execute('SELECT * FROM basic_option WHERE id=?', (int(oid),)).fetchone()
                    if old and old['kind'] == '岗位' and old['code'] in CORE_ROLE_CODES:
                        if kind != '岗位' or code != old['code'] or not active:
                            raise ApiError(f'系统内置岗位「{old["name"]}」不可停用或修改分类/编码')
                    c.execute(
                        'UPDATE basic_option SET kind=?, code=?, name=?, description=?, sort_order=?, active=? WHERE id=?',
                        (kind, code, name, desc, sort_order, active, int(oid)),
                    )
                else:
                    cur = c.execute(
                        'INSERT INTO basic_option(kind, code, name, description, sort_order, active) VALUES(?,?,?,?,?,?)',
                        (kind, code, name, desc, sort_order, active),
                    )
                    oid = cur.lastrowid
                self._ok(one_to_dict(c.execute('SELECT * FROM basic_option WHERE id=?', (oid,)).fetchone()))
                return

            if path == '/basic/option/toggle':
                oid = int(body.get('id') or 0)
                row = c.execute('SELECT kind, code, name, active FROM basic_option WHERE id=?', (oid,)).fetchone()
                if not row:
                    raise ApiError('选项不存在', 404)
                if row['kind'] == '岗位' and row['code'] in CORE_ROLE_CODES and row['active']:
                    raise ApiError(f'系统内置岗位「{row["name"]}」不可停用')
                c.execute('UPDATE basic_option SET active=? WHERE id=?', (0 if row['active'] else 1, oid))
                self._ok(one_to_dict(c.execute('SELECT * FROM basic_option WHERE id=?', (oid,)).fetchone()))
                return

            if path == '/basic/clinic':
                cid = body.get('id')
                code = str(body.get('clinic_code') or '').strip()
                name = str(body.get('name') or '').strip()
                if not code or not name:
                    raise ApiError('诊所编码与名称必填')
                ts = now_str()
                if cid:
                    c.execute(
                        'UPDATE clinic SET clinic_code=?, name=?, address=?, phone=?, active=?, updated_at=? WHERE id=?',
                        (code, name, body.get('address') or '', body.get('phone') or '', 1 if body.get('active', True) else 0, ts, int(cid)),
                    )
                else:
                    cur = c.execute(
                        'INSERT INTO clinic(clinic_code, name, address, phone, active, created_at, updated_at) VALUES(?,?,?,?,?,?,?)',
                        (code, name, body.get('address') or '', body.get('phone') or '', 1 if body.get('active', True) else 0, ts, ts),
                    )
                    cid = cur.lastrowid
                self._ok(one_to_dict(c.execute('SELECT * FROM clinic WHERE id=?', (cid,)).fetchone()))
                return

            if path == '/basic/room':
                rid = body.get('id')
                code = str(body.get('room_code') or '').strip()
                name = str(body.get('name') or '').strip()
                clinic_id = int(body.get('clinic_id') or 1)
                if not code or not name:
                    raise ApiError('诊室编码与名称必填')
                if rid:
                    c.execute(
                        'UPDATE clinic_room SET clinic_id=?, room_code=?, name=?, floor_note=?, active=? WHERE id=?',
                        (clinic_id, code, name, body.get('floor_note') or '', 1 if body.get('active', True) else 0, int(rid)),
                    )
                else:
                    cur = c.execute(
                        'INSERT INTO clinic_room(clinic_id, room_code, name, floor_note, active) VALUES(?,?,?,?,?)',
                        (clinic_id, code, name, body.get('floor_note') or '', 1 if body.get('active', True) else 0),
                    )
                    rid = cur.lastrowid
                self._ok(one_to_dict(c.execute('SELECT * FROM clinic_room WHERE id=?', (rid,)).fetchone()))
                return

            if path == '/basic/employee':
                eid = body.get('id')
                emp_no = str(body.get('employee_no') or '').strip()
                name = str(body.get('name') or '').strip()
                clinic_id = int(body.get('clinic_id') or 1)
                role_ids = [int(x) for x in (body.get('role_ids') or [])]
                if not emp_no or not name:
                    raise ApiError('员工工号与姓名必填')
                if not role_ids:
                    raise ApiError('请至少为员工分配一个岗位')
                for r_id in role_ids:
                    if not option_has_kind(c, r_id, '岗位', require_active=True):
                        raise ApiError('员工岗位必须引用启用中的「岗位」分类选项')
                if eid:
                    c.execute(
                        'UPDATE employee SET clinic_id=?, employee_no=?, name=?, phone=?, joined_on=?, left_on=?, active=? WHERE id=?',
                        (clinic_id, emp_no, name, body.get('phone') or '', body.get('joined_on') or None, body.get('left_on') or None,
                         1 if body.get('active', True) else 0, int(eid)),
                    )
                else:
                    cur = c.execute(
                        'INSERT INTO employee(clinic_id, employee_no, name, phone, joined_on, left_on, active) VALUES(?,?,?,?,?,?,?)',
                        (clinic_id, emp_no, name, body.get('phone') or '', body.get('joined_on') or None, body.get('left_on') or None,
                         1 if body.get('active', True) else 0),
                    )
                    eid = cur.lastrowid
                # 同步员工兼岗表（保留历史，撤岗填 revoked_at，重新赋岗清空 revoked_at）
                existing = {r['role_id']: r['revoked_at'] for r in c.execute('SELECT role_id, revoked_at FROM employee_role WHERE employee_id=?', (eid,)).fetchall()}
                ts = now_str()
                for r_id in role_ids:
                    if r_id in existing:
                        c.execute('UPDATE employee_role SET revoked_at=NULL WHERE employee_id=? AND role_id=?', (eid, r_id))
                    else:
                        c.execute('INSERT INTO employee_role(employee_id, role_id, assigned_at, revoked_at) VALUES(?,?,?,NULL)', (eid, r_id, ts))
                for old_rid in existing:
                    if old_rid not in role_ids and existing[old_rid] is None:
                        c.execute('UPDATE employee_role SET revoked_at=? WHERE employee_id=? AND role_id=?', (ts, eid, old_rid))
                audit(c, 'employee', eid, 'upsert', user, new_val={'employee_no': emp_no, 'role_ids': role_ids})
                self._ok(one_to_dict(c.execute('SELECT * FROM employee WHERE id=?', (eid,)).fetchone()))
                return

            if path == '/basic/appointment-type':
                tid = body.get('id')
                code = str(body.get('code') or '').strip()
                name = str(body.get('name') or '').strip()
                dur = int(body.get('duration_min') or 0)
                if not code or not name or dur <= 0:
                    raise ApiError('预约类型编码、名称与标准时长（>0）必填')
                if tid:
                    c.execute(
                        'UPDATE appointment_type SET code=?, name=?, duration_min=?, self_bookable=?, price_hint=?, sort_order=?, active=? WHERE id=?',
                        (code, name, dur, 1 if body.get('self_bookable') else 0, body.get('price_hint') or '',
                         int(body.get('sort_order') or 1), 1 if body.get('active', True) else 0, int(tid)),
                    )
                else:
                    cur = c.execute(
                        'INSERT INTO appointment_type(code, name, duration_min, self_bookable, price_hint, sort_order, active) VALUES(?,?,?,?,?,?,?)',
                        (code, name, dur, 1 if body.get('self_bookable') else 0, body.get('price_hint') or '',
                         int(body.get('sort_order') or 1), 1 if body.get('active', True) else 0),
                    )
                    tid = cur.lastrowid
                self._ok(one_to_dict(c.execute('SELECT * FROM appointment_type WHERE id=?', (tid,)).fetchone()))
                return

            if path == '/basic/price-item':
                pid = body.get('id')
                code = str(body.get('item_code') or '').strip()
                name = str(body.get('name') or '').strip()
                unit_id = int(body.get('unit_id') or 0)
                price = float(body.get('unit_price') or 0)
                if not code or not name or price < 0:
                    raise ApiError('价目编码、名称与非负单价必填')
                if not option_has_kind(c, unit_id, '单位'):
                    raise ApiError('单位必须引用「单位」分类基础选项')
                ts = now_str()
                if pid:
                    c.execute(
                        'UPDATE price_item SET unit_id=?, item_code=?, name=?, unit_price=?, active=?, updated_at=? WHERE id=?',
                        (unit_id, code, name, price, 1 if body.get('active', True) else 0, ts, int(pid)),
                    )
                else:
                    cur = c.execute(
                        'INSERT INTO price_item(unit_id, item_code, name, unit_price, active, updated_at) VALUES(?,?,?,?,?,?)',
                        (unit_id, code, name, price, 1 if body.get('active', True) else 0, ts),
                    )
                    pid = cur.lastrowid
                self._ok(one_to_dict(c.execute('SELECT * FROM price_item WHERE id=?', (pid,)).fetchone()))
                return

            if path == '/basic/product':
                pid = body.get('id')
                code = str(body.get('product_code') or '').strip()
                name = str(body.get('name') or '').strip()
                mat = str(body.get('material') or '').strip()
                unit_id = int(body.get('unit_id') or 0)
                if not code or not name or not mat:
                    raise ApiError('产品编码、名称与材料必填')
                if not option_has_kind(c, unit_id, '单位'):
                    raise ApiError('单位必须引用「单位」分类基础选项')
                if pid:
                    c.execute(
                        'UPDATE product SET unit_id=?, product_code=?, name=?, material=?, specification=?, requires_attachment=?, active=? WHERE id=?',
                        (unit_id, code, name, mat, body.get('specification') or '',
                         1 if body.get('requires_attachment') else 0, 1 if body.get('active', True) else 0, int(pid)),
                    )
                else:
                    cur = c.execute(
                        'INSERT INTO product(unit_id, product_code, name, material, specification, requires_attachment, active) VALUES(?,?,?,?,?,?,?)',
                        (unit_id, code, name, mat, body.get('specification') or '',
                         1 if body.get('requires_attachment') else 0, 1 if body.get('active', True) else 0),
                    )
                    pid = cur.lastrowid
                self._ok(one_to_dict(c.execute('SELECT * FROM product WHERE id=?', (pid,)).fetchone()))
                return

            if path == '/basic/dental-lab':
                lid = body.get('id')
                code = str(body.get('lab_code') or '').strip()
                name = str(body.get('name') or '').strip()
                contact = str(body.get('contact') or '').strip()
                phone = str(body.get('phone') or '').strip()
                if not code or not name or not contact or not phone:
                    raise ApiError('技工所编码、名称、联系人与电话必填')
                if lid:
                    c.execute(
                        'UPDATE dental_lab SET lab_code=?, name=?, contact=?, phone=?, address=?, interface_code=?, active=? WHERE id=?',
                        (code, name, contact, phone, body.get('address') or '', body.get('interface_code') or '',
                         1 if body.get('active', True) else 0, int(lid)),
                    )
                else:
                    cur = c.execute(
                        'INSERT INTO dental_lab(lab_code, name, contact, phone, address, interface_code, active) VALUES(?,?,?,?,?,?,?)',
                        (code, name, contact, phone, body.get('address') or '', body.get('interface_code') or '',
                         1 if body.get('active', True) else 0),
                    )
                    lid = cur.lastrowid
                self._ok(one_to_dict(c.execute('SELECT * FROM dental_lab WHERE id=?', (lid,)).fetchone()))
                return

            raise ApiError('不支持的基础信息接口', 404)

    # -----------------------------------------------------------------
    # 患者管理
    # -----------------------------------------------------------------
    def _create_patient(self, body, user):
        name = str(body.get('name') or '').strip()
        if not name:
            raise ApiError('患者姓名必填')
        note = str(body.get('important_note') or '').strip()
        if body.get('pending') and '【待核对】' not in note:
            note = ('【待核对】' + (' ' + note if note else '')).strip()
        with _lock, connect() as c:
            no = next_code(c, 'patient', 'patient_no', 'P')
            ts = now_str()
            cb = default_employee_id(c, user)
            cur = c.execute(
                '''INSERT INTO patient
                   (created_by, patient_no, name, birth_date, phone, contact_name, contact_phone, important_note, created_at, updated_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?)''',
                (cb, no, name, body.get('birth_date') or None, str(body.get('phone') or '').strip(),
                 str(body.get('contact_name') or '').strip(), str(body.get('contact_phone') or '').strip(),
                 note, ts, ts),
            )
            pid = cur.lastrowid
            row = one_to_dict(c.execute('SELECT * FROM patient WHERE id=?', (pid,)).fetchone())
            audit(c, 'patient', pid, 'create', user, new_val=row, reason='前台登记患者')
            return row

    def _update_patient(self, body, user):
        pid = int(body.get('id') or 0)
        name = str(body.get('name') or '').strip()
        if not pid or not name:
            raise ApiError('患者 ID 与姓名必填')
        note = str(body.get('important_note') or '').strip()
        note = note.replace('【待核对】', '').strip()
        if body.get('pending'):
            note = ('【待核对】' + (' ' + note if note else '')).strip()
        with _lock, connect() as c:
            old = one_to_dict(c.execute('SELECT * FROM patient WHERE id=?', (pid,)).fetchone())
            if not old:
                raise ApiError('患者档案不存在', 404)
            ts = now_str()
            c.execute(
                '''UPDATE patient SET name=?, birth_date=?, phone=?, contact_name=?, contact_phone=?,
                   important_note=?, updated_at=? WHERE id=?''',
                (name, body.get('birth_date') or None, str(body.get('phone') or '').strip(),
                 str(body.get('contact_name') or '').strip(), str(body.get('contact_phone') or '').strip(),
                 note, ts, pid),
            )
            new_row = one_to_dict(c.execute('SELECT * FROM patient WHERE id=?', (pid,)).fetchone())
            audit(c, 'patient', pid, 'update', user, old_val=old, new_val=new_row, reason=body.get('reason') or '更新患者资料')
            return new_row

    # -----------------------------------------------------------------
    # 排班管理（表 23：联合唯一 + 时长被切片整除 + 有效医生与诊室）
    # -----------------------------------------------------------------
    def _upsert_schedule(self, body, user):
        doctor_id = int(body.get('doctor_id') or 0)
        room_id = int(body.get('room_id') or 0)
        work_date = str(body.get('work_date') or '').strip()
        start_time = str(body.get('start_time') or '').strip()[:5]
        end_time = str(body.get('end_time') or '').strip()[:5]
        slot_minutes = int(body.get('slot_minutes') or 15)
        stage = body.get('stage') or '正常'
        note = str(body.get('note') or '').strip()
        st_m, en_m = parse_hm(start_time), parse_hm(end_time)
        if not work_date or st_m is None or en_m is None or en_m <= st_m:
            raise ApiError('出诊日期与有效起止时间必填（结束时间须晚于开始时间）')
        if slot_minutes <= 0 or (en_m - st_m) % slot_minutes != 0:
            raise ApiError(f'出诊总时长（{en_m - st_m} 分钟）必须能被切片时长（{slot_minutes} 分钟）整除')
        with _lock, connect() as c:
            if not is_active_doctor(c, doctor_id):
                raise ApiError('排班医生必须是启用中且具备医生岗位的员工')
            rm = c.execute('SELECT active FROM clinic_room WHERE id=?', (room_id,)).fetchone()
            if not rm or not rm['active']:
                raise ApiError('排班诊室不存在或已停用')
            # 防止同医生重叠排班，或非停诊时段同诊室被其他正常排班重叠占用
            sid = body.get('id')
            sql = 'SELECT id, doctor_id, room_id, start_time, end_time, stage FROM schedule WHERE work_date=? AND (doctor_id=? OR room_id=?)'
            params = [work_date, doctor_id, room_id]
            if sid:
                sql += ' AND id != ?'
                params.append(int(sid))
            for other in c.execute(sql, params).fetchall():
                os_m, oe_m = parse_hm(other['start_time']), parse_hm(other['end_time'])
                if st_m < oe_m and en_m > os_m:
                    if int(other['doctor_id']) == doctor_id:
                        raise ApiError(f'该医生在 {work_date} {other["start_time"]}-{other["end_time"]} 已有重叠排班')
                    if stage != '停诊' and other['stage'] != '停诊':
                        raise ApiError(f'该诊室在 {work_date} {other["start_time"]}-{other["end_time"]} 已被其他医生占用')
            if sid:
                c.execute(
                    'UPDATE schedule SET doctor_id=?, room_id=?, work_date=?, start_time=?, end_time=?, slot_minutes=?, stage=?, note=? WHERE id=?',
                    (doctor_id, room_id, work_date, start_time, end_time, slot_minutes, stage, note, int(sid)),
                )
            else:
                cur = c.execute(
                    'INSERT INTO schedule(doctor_id, room_id, created_by, work_date, start_time, end_time, slot_minutes, stage, note, created_at) '
                    'VALUES(?,?,?,?,?,?,?,?,?,?)',
                    (doctor_id, room_id, default_employee_id(c, user), work_date, start_time, end_time, slot_minutes, stage, note, now_str()),
                )
                sid = cur.lastrowid
            return one_to_dict(c.execute('SELECT * FROM schedule WHERE id=?', (sid,)).fetchone())

    def _toggle_schedule(self, body, user):
        sid = int(body.get('id') or 0)
        with _lock, connect() as c:
            s = one_to_dict(c.execute('SELECT * FROM schedule WHERE id=?', (sid,)).fetchone())
            if not s:
                raise ApiError('排班不存在', 404)
            new_stage = '正常' if s['stage'] == '停诊' else '停诊'
            if new_stage == '正常':
                if not is_active_doctor(c, s['doctor_id']):
                    raise ApiError('排班医生已停用或无医生岗位，无法恢复正常出诊')
                rm = c.execute('SELECT active FROM clinic_room WHERE id=?', (s['room_id'],)).fetchone()
                if not rm or not rm['active']:
                    raise ApiError('排班诊室已停用，无法恢复正常出诊')
                st_m, en_m = parse_hm(s['start_time']), parse_hm(s['end_time'])
                others = c.execute(
                    "SELECT id, start_time, end_time FROM schedule WHERE work_date=? AND room_id=? AND id != ? AND stage != '停诊'",
                    (s['work_date'], s['room_id'], sid),
                ).fetchall()
                for other in others:
                    os_m, oe_m = parse_hm(other['start_time']), parse_hm(other['end_time'])
                    if st_m < oe_m and en_m > os_m:
                        raise ApiError(f'无法恢复正常出诊：该诊室在 {s["work_date"]} {other["start_time"]}-{other["end_time"]} 已被其他正常排班占用')
            note = str(body.get('note') or '').strip() if new_stage == '停诊' else ''
            c.execute('UPDATE schedule SET stage=?, note=? WHERE id=?', (new_stage, note, sid))
            audit(c, 'schedule', sid, 'toggle_stage', user, old_val=s['stage'], new_val=new_stage, reason=note)
            return one_to_dict(c.execute('SELECT * FROM schedule WHERE id=?', (sid,)).fetchone())

    def _delete_schedule(self, body, user):
        sid = int(body.get('id') or 0)
        with _lock, connect() as c:
            s = one_to_dict(c.execute('SELECT * FROM schedule WHERE id=?', (sid,)).fetchone())
            if not s:
                raise ApiError('排班不存在', 404)
            s_start = f"{s['work_date']}T{s['start_time']}"
            s_end = f"{s['work_date']}T{s['end_time']}"
            used = c.execute(
                '''SELECT COUNT(*) FROM appointment
                   WHERE stage IN ('待确认', '已确认', '已到诊', '已完成')
                     AND (schedule_id=? OR (doctor_id=? AND starts_at < ? AND ends_at > ?))''',
                (sid, s['doctor_id'], s_end, s_start),
            ).fetchone()[0]
            if used > 0:
                raise ApiError('该排班时段已存在有效预约，禁止删除，请设为停诊')
            c.execute('UPDATE appointment SET schedule_id=NULL WHERE schedule_id=?', (sid,))
            c.execute('DELETE FROM schedule WHERE id=?', (sid,))
            return {'deleted': sid}

    # -----------------------------------------------------------------
    # 预约管理（UC-01 / UC-05，单一写事务）
    # -----------------------------------------------------------------
    def _book_appointment(self, body, user):
        is_patient = user['role'] == 'patient'
        is_addon = bool(body.get('is_addon')) and not is_patient
        with _lock, connect() as c:
            patient_id = int(user['patient_id']) if is_patient else int(body.get('patient_id') or 0)
            doctor_id = int(body.get('doctor_id') or 0)
            room_id = int(body.get('room_id') or 0)
            type_id = int(body.get('type_id') or 0)
            starts_at = str(body.get('starts_at') or '').strip()[:16]
            ends_at = str(body.get('ends_at') or '').strip()[:16]
            chief = str(body.get('chief_complaint') or '').strip()
            addon_reason = str(body.get('addon_reason') or '').strip()

            if not patient_id or not doctor_id or not type_id or not starts_at or not ends_at:
                raise ApiError('患者、医生、预约类型与预约起止时间必填')
            if starts_at >= ends_at:
                raise ApiError('预约结束时间必须晚于开始时间')

            pat = c.execute('SELECT * FROM patient WHERE id=?', (patient_id,)).fetchone()
            if not pat:
                raise ApiError('患者档案不存在')
            if not is_active_doctor(c, doctor_id):
                raise ApiError('只能预约启用中且具备医生岗位的员工')
            at = c.execute('SELECT * FROM appointment_type WHERE id=? AND active=1', (type_id,)).fetchone()
            if not at:
                raise ApiError('预约类型不存在或已停用')

            source = '患者自助' if is_patient else '前台'
            work_date = starts_at[:10]

            if is_patient:
                if not at['self_bookable']:
                    raise ApiError(f'「{at["name"]}」需医生评估，请到店或致电由前台排程')
                try:
                    wd = date.fromisoformat(work_date)
                except ValueError:
                    raise ApiError('预约日期格式无效')
                if wd < date.today() or wd > date.today() + timedelta(days=14):
                    raise ApiError('自助预约仅支持未来两周内（14 天内）的号源')
                if starts_at <= now_min():
                    raise ApiError('不能预约当前时刻之前的号源，请选择未来时段')
                since = (date.today() - timedelta(days=90)).isoformat()
                no_shows = c.execute(
                    "SELECT COUNT(*) FROM appointment WHERE patient_id=? AND stage='爽约' AND substr(starts_at,1,10) >= ?",
                    (patient_id, since),
                ).fetchone()[0]
                if no_shows >= 2:
                    raise ApiError(f'您近 90 天累计爽约 {no_shows} 次，自助预约权限已暂停 90 天，请联系诊所前台')

            schedule_id = None
            if is_addon:
                if not addon_reason:
                    raise ApiError('前台加号必须填写加号原因')
                if not room_id:
                    raise ApiError('前台加号必须指定启用中的诊室')
                rm = c.execute('SELECT active FROM clinic_room WHERE id=?', (room_id,)).fetchone()
                if not rm or not rm['active']:
                    raise ApiError('所选诊室不存在或已停用')
            else:
                # 校验排班、切片对齐、标准时长（表 8 / 表 12 / 8.7）
                any_segs = c.execute(
                    'SELECT stage, note FROM schedule WHERE doctor_id=? AND work_date=?',
                    (doctor_id, work_date),
                ).fetchall()
                if not any_segs:
                    raise ApiError('该医生当日未排班，无法预约')
                if all(s['stage'] == '停诊' for s in any_segs):
                    note = next((s['note'] for s in any_segs if s['note']), '')
                    raise ApiError('该医生当日已停诊' + ('：' + note if note else ''))
                seg = check_in_schedule_grid(c, doctor_id, room_id or None, starts_at, ends_at, at['duration_min'])
                if not seg:
                    raise ApiError('所选时段未落在医生正常出诊号源内，或未按切片与项目标准时长对齐')
                schedule_id = seg['id']
                room_id = seg['room_id']

            conflicts = check_overlap(c, doctor_id, room_id, starts_at, ends_at)
            if conflicts:
                raise ApiError('该医生或诊室在所选时段已被占用，请重新选号')

            stage = '待确认' if is_patient else (body.get('stage') if body.get('stage') in ('待确认', '已确认') else '已确认')
            ts = now_str()
            cb = default_employee_id(c, user)
            no = next_code(c, 'appointment', 'appointment_no', 'A')
            cur = c.execute(
                '''INSERT INTO appointment
                   (patient_id, doctor_id, room_id, type_id, created_by, schedule_id, appointment_no,
                    starts_at, ends_at, source, chief_complaint, stage, confirmed_at, created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                (patient_id, doctor_id, room_id, type_id, cb, schedule_id, no,
                 starts_at, ends_at, source, chief, stage, ts if stage == '已确认' else None, ts),
            )
            aid = cur.lastrowid
            ev_reason = f'前台加号：{addon_reason}' if is_addon else ('患者自助预约' if is_patient else '前台选号预约')
            c.execute(
                '''INSERT INTO appointment_event
                   (appointment_id, changed_by, occurred_at, old_start, new_start, old_end, new_end, old_stage, new_stage, reason)
                   VALUES(?,?,?,NULL,?,NULL,?,?,?,?)''',
                (aid, cb, ts, starts_at, ends_at, '新建', stage, ev_reason),
            )

            # 触发就诊前一日 09:00 预约提醒（若提醒时刻仍在未来）
            try:
                rem_dt = (datetime.fromisoformat(starts_at) - timedelta(days=1)).replace(hour=9, minute=0, second=0)
                if rem_dt > datetime.now() and pat['phone']:
                    schedule_reminder(
                        c, cb, '预约提醒', rem_dt.strftime('%Y-%m-%dT%H:%M:%S'),
                        pat['phone'],
                        f'您预约于 {starts_at.replace("T", " ")} 到诊（{at["name"]}），如需改约请提前联系诊所。',
                        appointment_id=aid,
                    )
            except Exception:
                pass

            # 自动闭环该患者待回访的复诊召回
            c.execute(
                "UPDATE recall SET stage='已预约', appointment_id=?, notified_at=COALESCE(notified_at, ?) "
                "WHERE patient_id=? AND stage IN ('待通知', '已通知')",
                (aid, ts, patient_id),
            )

            return one_to_dict(c.execute('SELECT * FROM appointment WHERE id=?', (aid,)).fetchone())

    def _reschedule_appointment(self, body, user):
        aid = int(body.get('id') or 0)
        starts_at = str(body.get('starts_at') or '').strip()[:16]
        ends_at = str(body.get('ends_at') or '').strip()[:16]
        reason = str(body.get('reason') or '改约').strip()
        is_patient = user['role'] == 'patient'
        if not aid or not starts_at or not ends_at or starts_at >= ends_at:
            raise ApiError('改约时间区间无效')
        with _lock, connect() as c:
            a = one_to_dict(c.execute('SELECT * FROM appointment WHERE id=?', (aid,)).fetchone())
            if not a:
                raise ApiError('预约不存在', 404)
            if is_patient and int(a['patient_id']) != int(user['patient_id']):
                raise ApiError('无权改约他人预约', 403)
            if a['stage'] not in ('待确认', '已确认'):
                raise ApiError(f'当前状态「{a["stage"]}」不允许改约')
            if not is_active_doctor(c, a['doctor_id']):
                raise ApiError('该预约医生已停用或无医生岗位，不能改约')
            at = c.execute('SELECT * FROM appointment_type WHERE id=?', (a['type_id'],)).fetchone()
            if is_patient:
                try:
                    wd = date.fromisoformat(starts_at[:10])
                except ValueError:
                    raise ApiError('改约日期格式无效')
                if wd < date.today() or wd > date.today() + timedelta(days=14):
                    raise ApiError('自助改约仅支持未来两周内号源')
                if starts_at <= now_min():
                    raise ApiError('不能改约至当前时刻之前的号源')
                since = (date.today() - timedelta(days=90)).isoformat()
                no_shows = c.execute(
                    "SELECT COUNT(*) FROM appointment WHERE patient_id=? AND stage='爽约' AND substr(starts_at,1,10) >= ?",
                    (a['patient_id'], since),
                ).fetchone()[0]
                if no_shows >= 2:
                    raise ApiError(f'您近 90 天累计爽约 {no_shows} 次，自助预约与改约权限已暂停 90 天，请联系诊所前台')
            req_room = int(body.get('room_id') or 0) or None
            seg = check_in_schedule_grid(c, a['doctor_id'], req_room, starts_at, ends_at, at['duration_min'])
            if not seg:
                raise ApiError('改约时段未落在医生有效出诊号源内或时长不匹配')
            new_room_id = seg['room_id']
            new_sched_id = seg['id']
            if check_overlap(c, a['doctor_id'], new_room_id, starts_at, ends_at, exclude_id=aid):
                raise ApiError('新时段医生或诊室已被占用，请重选')
            ts = now_str()
            cb = default_employee_id(c, user)
            c.execute(
                'UPDATE appointment SET starts_at=?, ends_at=?, room_id=?, schedule_id=? WHERE id=?',
                (starts_at, ends_at, new_room_id, new_sched_id, aid),
            )
            c.execute(
                '''INSERT INTO appointment_event
                   (appointment_id, changed_by, occurred_at, old_start, new_start, old_end, new_end, old_stage, new_stage, reason)
                   VALUES(?,?,?,?,?,?,?,?,?,?)''',
                (aid, cb, ts, a['starts_at'], starts_at, a['ends_at'], ends_at, a['stage'], a['stage'],
                 ('患者自助改约：' if is_patient else '') + reason),
            )
            # 改约后同步更新未发送的就诊前一日预约提醒
            c.execute("DELETE FROM reminder WHERE appointment_id=? AND kind='预约提醒' AND delivery_result='待发送'", (aid,))
            pat = c.execute('SELECT phone FROM patient WHERE id=?', (a['patient_id'],)).fetchone()
            try:
                rem_dt = (datetime.fromisoformat(starts_at) - timedelta(days=1)).replace(hour=9, minute=0, second=0)
                if rem_dt > datetime.now() and pat and pat['phone']:
                    schedule_reminder(
                        c, cb, '预约提醒', rem_dt.strftime('%Y-%m-%dT%H:%M:%S'),
                        pat['phone'],
                        f'您已改约至 {starts_at.replace("T", " ")} 到诊（{at["name"]}），如需调整请提前联系诊所。',
                        appointment_id=aid,
                    )
            except Exception:
                pass
            return one_to_dict(c.execute('SELECT * FROM appointment WHERE id=?', (aid,)).fetchone())

    def _change_appointment_stage(self, body, user):
        aid = int(body.get('id') or 0)
        dst = str(body.get('stage') or '').strip()
        reason = str(body.get('reason') or '').strip()
        is_patient = user['role'] == 'patient'
        with _lock, connect() as c:
            a = one_to_dict(c.execute('SELECT * FROM appointment WHERE id=?', (aid,)).fetchone())
            if not a:
                raise ApiError('预约不存在', 404)
            if is_patient:
                if int(a['patient_id']) != int(user['patient_id']):
                    raise ApiError('无权操作他人预约', 403)
                if dst != '已取消':
                    raise ApiError('患者仅可取消本人未到诊预约', 403)
            src = a['stage']
            if dst not in APPT_TRANSITIONS.get(src, []):
                raise ApiError(f'不允许的预约状态转换：{src} → {dst}')
            if dst in ('已取消', '爽约') and not reason:
                raise ApiError('取消或标记爽约必须填写原因')
            ts = now_str()
            cb = default_employee_id(c, user)
            updates = ['stage=?']
            params = [dst]
            if dst == '已确认':
                updates.append('confirmed_at=?'); params.append(ts)
            elif dst == '已到诊':
                updates.append('arrived_at=?'); params.append(ts)
            elif dst == '已完成':
                updates.append('completed_at=?'); params.append(ts)
            elif dst in ('已取消', '爽约'):
                updates.extend(['cancelled_at=?', 'cancel_reason=?']); params.extend([ts, reason])
            params.append(aid)
            c.execute(f"UPDATE appointment SET {', '.join(updates)} WHERE id=?", params)
            c.execute(
                '''INSERT INTO appointment_event
                   (appointment_id, changed_by, occurred_at, old_start, new_start, old_end, new_end, old_stage, new_stage, reason)
                   VALUES(?,?,?,?,?,?,?,?,?,?)''',
                (aid, cb, ts, a['starts_at'], a['starts_at'], a['ends_at'], a['ends_at'], src, dst, reason),
            )
            if dst in ('已取消', '爽约'):
                # 取消未发送的预约提醒，并重开因该预约自动闭环的复诊召回
                c.execute("DELETE FROM reminder WHERE appointment_id=? AND kind='预约提醒' AND delivery_result='待发送'", (aid,))
                c.execute("UPDATE recall SET stage='待通知', appointment_id=NULL WHERE appointment_id=? AND stage='已预约'", (aid,))
            return one_to_dict(c.execute('SELECT * FROM appointment WHERE id=?', (aid,)).fetchone())

    # -----------------------------------------------------------------
    # 诊疗记录与复诊召回
    # -----------------------------------------------------------------
    def _create_encounter(self, body, user):
        patient_id = int(body.get('patient_id') or 0)
        doctor_id = int(body.get('doctor_id') or 0)
        clinic_id = int(body.get('clinic_id') or 1)
        appt_id = int(body['appointment_id']) if body.get('appointment_id') else None
        occurred_at = str(body.get('occurred_at') or now_min()).strip()
        chief = str(body.get('chief_complaint') or '').strip()
        diagnosis = str(body.get('diagnosis') or '').strip()
        note = str(body.get('treatment_note') or '').strip()
        recall_months = int(body['recall_months']) if body.get('recall_months') else None
        if not patient_id or not doctor_id or not chief:
            raise ApiError('患者、医生与主诉必填')
        if recall_months is not None and recall_months <= 0:
            raise ApiError('建议复查月数必须大于 0')
        with _lock, connect() as c:
            if not is_active_doctor(c, doctor_id):
                raise ApiError('接诊医生必须是启用中且具备医生岗位的员工')
            if appt_id:
                apt = c.execute('SELECT * FROM appointment WHERE id=?', (appt_id,)).fetchone()
                if not apt:
                    raise ApiError('关联的预约不存在')
                if apt['stage'] in ('已取消', '爽约'):
                    raise ApiError(f'预约已处于「{apt["stage"]}」状态，不可关联建立诊疗记录')
                if int(apt['patient_id']) != patient_id or int(apt['doctor_id']) != doctor_id:
                    raise ApiError('诊疗记录与关联预约的患者和医生必须完全一致')
                dup = c.execute('SELECT 1 FROM encounter WHERE appointment_id=?', (appt_id,)).fetchone()
                if dup:
                    raise ApiError('该预约已关联诊疗记录，每次预约至多产生一条诊疗记录')
            no = next_code(c, 'encounter', 'encounter_no', 'EN')
            ts = now_str()
            cur = c.execute(
                '''INSERT INTO encounter
                   (patient_id, clinic_id, doctor_id, appointment_id, encounter_no, occurred_at,
                    chief_complaint, diagnosis, treatment_note, recall_months, completed_at, created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''',
                (patient_id, clinic_id, doctor_id, appt_id, no, occurred_at, chief, diagnosis, note, recall_months, ts, ts),
            )
            eid = cur.lastrowid
            # 按建议复查间隔自动生成复诊召回（表 5 / 表 23）
            if recall_months:
                base_d = date.fromisoformat(occurred_at[:10])
                due = add_months(base_d, recall_months).isoformat()
                reason = f'{diagnosis or chief} 后 {recall_months} 个月复查'
                c.execute(
                    '''INSERT INTO recall(patient_id, encounter_id, appointment_id, due_date, reason, stage, notified_at, note, created_at)
                       VALUES(?,?,NULL,?,?,'待通知',NULL,'',?)''',
                    (patient_id, eid, due, reason[:160], ts),
                )
            return one_to_dict(c.execute('SELECT * FROM encounter WHERE id=?', (eid,)).fetchone())

    def _change_recall_stage(self, body, user):
        rid = int(body.get('id') or 0)
        dst = str(body.get('stage') or '').strip()
        note = body.get('note')
        with _lock, connect() as c:
            r = one_to_dict(c.execute('SELECT * FROM recall WHERE id=?', (rid,)).fetchone())
            if not r:
                raise ApiError('召回记录不存在', 404)
            if dst not in RECALL_TRANSITIONS.get(r['stage'], []):
                raise ApiError(f'不允许的召回状态转换：{r["stage"]} → {dst}')
            ts = now_str()
            notified_at = r['notified_at']
            if dst in ('已通知', '已预约') and not notified_at:
                notified_at = ts
            appt_id = int(body['appointment_id']) if body.get('appointment_id') else r['appointment_id']
            new_note = str(note).strip() if note is not None else (r['note'] or '')
            c.execute(
                'UPDATE recall SET stage=?, notified_at=?, appointment_id=?, note=? WHERE id=?',
                (dst, notified_at, appt_id, new_note, rid),
            )
            return one_to_dict(c.execute('SELECT * FROM recall WHERE id=?', (rid,)).fetchone())

    # -----------------------------------------------------------------
    # 治疗计划（UC-06）
    # -----------------------------------------------------------------
    def _recalc_plan_quote(self, c, plan_id):
        total = c.execute(
            "SELECT COALESCE(SUM(quantity * unit_price), 0) FROM plan_item WHERE plan_id=? AND stage != '已取消'",
            (plan_id,),
        ).fetchone()[0]
        c.execute('UPDATE treatment_plan SET quoted_amount=? WHERE id=?', (round(float(total), 2), plan_id))

    def _create_plan(self, body, user):
        patient_id = int(body.get('patient_id') or 0)
        doctor_id = int(body.get('doctor_id') or 0)
        stage = body.get('stage') if body.get('stage') in ('拟定', '执行中') else '拟定'
        items = body.get('items') or []
        if not patient_id or not doctor_id:
            raise ApiError('患者与主治医生必填')
        if stage == '执行中' and not items:
            raise ApiError('确认执行中的治疗计划至少须包含一个计划项，请先添加计划项或保存为「拟定」状态')
        with _lock, connect() as c:
            if not is_active_doctor(c, doctor_id):
                raise ApiError('主治医生必须是启用中且具备医生岗位的员工')
            no = next_code(c, 'treatment_plan', 'plan_no', 'TP')
            ts = now_str()
            cb = default_employee_id(c, user)
            cur = c.execute(
                '''INSERT INTO treatment_plan
                   (patient_id, doctor_id, created_by, plan_no, chief_complaint, diagnosis,
                    stage, quoted_amount, accepted_at, closed_at, created_at)
                   VALUES(?,?,?,?,?,?,?,0,?,NULL,?)''',
                (patient_id, doctor_id, cb, no, str(body.get('chief_complaint') or '').strip(),
                 str(body.get('diagnosis') or '').strip(), stage, ts if stage == '执行中' else None, ts),
            )
            pid = cur.lastrowid
            for it in items:
                self._insert_plan_item(c, pid, it)
            self._recalc_plan_quote(c, pid)
            return one_to_dict(c.execute('SELECT * FROM treatment_plan WHERE id=?', (pid,)).fetchone())

    def _insert_plan_item(self, c, plan_id, it):
        tooth = str(it.get('tooth_code') or '').strip()
        if tooth and tooth not in VALID_FDI_TEETH:
            raise ApiError(f'牙位「{tooth}」不符合 FDI 国际标准编号（11-18, 21-28, 31-38, 41-48）')
        price_item_id = int(it['price_item_id']) if it.get('price_item_id') else None
        if not price_item_id:
            raise ApiError('请选择有效的收费价目项目')
        pi = c.execute('SELECT * FROM price_item WHERE id=? AND active=1', (price_item_id,)).fetchone()
        if not pi:
            raise ApiError('所选收费价目不存在或已停用')
        qty = float(it.get('quantity') or 1)
        if qty <= 0:
            raise ApiError('计划项数量必须大于 0')
        phase_no = max(1, int(it.get('phase_no') or 1))
        name = str(it.get('name') or pi['name']).strip()
        # 报价固化快照：使用当前价目单价
        unit_price = float(pi['unit_price'])
        cur = c.execute(
            '''INSERT INTO plan_item
               (plan_id, price_item_id, phase_no, tooth_code, name, quantity, unit_price, stage, planned_at)
               VALUES(?,?,?,?,?,?,?,'待执行',?)''',
            (plan_id, price_item_id, phase_no, tooth or None, name, qty, unit_price, now_str()),
        )
        return cur.lastrowid

    def _confirm_plan(self, body, user):
        pid = int(body.get('id') or 0)
        with _lock, connect() as c:
            p = one_to_dict(c.execute('SELECT * FROM treatment_plan WHERE id=?', (pid,)).fetchone())
            if not p:
                raise ApiError('治疗计划不存在', 404)
            if p['stage'] != '拟定':
                raise ApiError('仅「拟定」状态的治疗计划可确认')
            cnt = c.execute("SELECT COUNT(*) FROM plan_item WHERE plan_id=? AND stage != '已取消'", (pid,)).fetchone()[0]
            if cnt == 0:
                raise ApiError('请至少添加一个计划项后再确认方案')
            self._recalc_plan_quote(c, pid)
            c.execute("UPDATE treatment_plan SET stage='执行中', accepted_at=? WHERE id=?", (now_str(), pid))
            return one_to_dict(c.execute('SELECT * FROM treatment_plan WHERE id=?', (pid,)).fetchone())

    def _close_plan(self, body, user):
        pid = int(body.get('id') or 0)
        with _lock, connect() as c:
            p = one_to_dict(c.execute('SELECT * FROM treatment_plan WHERE id=?', (pid,)).fetchone())
            if not p:
                raise ApiError('治疗计划不存在', 404)
            if p['stage'] in ('已完成', '已终止'):
                raise ApiError('该计划已结束')
            left = c.execute("SELECT COUNT(*) FROM plan_item WHERE plan_id=? AND stage='待执行'", (pid,)).fetchone()[0]
            if left > 0:
                raise ApiError(f'存在 {left} 项未完成计划项，不可直接关闭')
            c.execute("UPDATE treatment_plan SET stage='已完成', closed_at=? WHERE id=?", (now_str(), pid))
            return one_to_dict(c.execute('SELECT * FROM treatment_plan WHERE id=?', (pid,)).fetchone())

    def _terminate_plan(self, body, user):
        pid = int(body.get('id') or 0)
        with _lock, connect() as c:
            p = one_to_dict(c.execute('SELECT * FROM treatment_plan WHERE id=?', (pid,)).fetchone())
            if not p:
                raise ApiError('治疗计划不存在', 404)
            if p['stage'] in ('已完成', '已终止'):
                raise ApiError('该计划已结束')
            c.execute("UPDATE plan_item SET stage='已取消' WHERE plan_id=? AND stage='待执行'", (pid,))
            self._recalc_plan_quote(c, pid)
            c.execute("UPDATE treatment_plan SET stage='已终止', closed_at=? WHERE id=?", (now_str(), pid))
            audit(c, 'treatment_plan', pid, 'terminate', user, reason=body.get('reason') or '终止计划')
            return one_to_dict(c.execute('SELECT * FROM treatment_plan WHERE id=?', (pid,)).fetchone())

    def _add_plan_item(self, body, user):
        plan_id = int(body.get('plan_id') or 0)
        with _lock, connect() as c:
            p = one_to_dict(c.execute('SELECT * FROM treatment_plan WHERE id=?', (plan_id,)).fetchone())
            if not p:
                raise ApiError('治疗计划不存在', 404)
            if p['stage'] in ('已完成', '已终止'):
                raise ApiError('已结束的治疗计划不可继续添加计划项')
            item_id = self._insert_plan_item(c, plan_id, body)
            self._recalc_plan_quote(c, plan_id)
            return one_to_dict(c.execute('SELECT * FROM plan_item WHERE id=?', (item_id,)).fetchone())

    def _cancel_plan_item(self, body, user):
        item_id = int(body.get('id') or 0)
        with _lock, connect() as c:
            it = one_to_dict(c.execute('SELECT * FROM plan_item WHERE id=?', (item_id,)).fetchone())
            if not it:
                raise ApiError('计划项不存在', 404)
            if it['stage'] != '待执行':
                raise ApiError('仅待执行计划项可取消（保留完整历史）')
            c.execute("UPDATE plan_item SET stage='已取消' WHERE id=?", (item_id,))
            self._recalc_plan_quote(c, it['plan_id'])
            audit(c, 'plan_item', item_id, 'cancel', user, old_val=it, reason=body.get('reason') or '调整治疗方案')
            return one_to_dict(c.execute('SELECT * FROM plan_item WHERE id=?', (item_id,)).fetchone())

    def _execute_plan_item(self, body, user):
        """UC-06 业务规则：计划项实际执行（关联诊疗记录）后自动触发收费单（按锁定报价快照）与可选技工单。"""
        item_id = int(body.get('id') or 0)
        encounter_id = int(body.get('encounter_id') or 0)
        if not encounter_id:
            raise ApiError('执行计划项必须关联本次诊疗记录')
        with _lock, connect() as c:
            it = one_to_dict(c.execute('SELECT * FROM plan_item WHERE id=?', (item_id,)).fetchone())
            if not it:
                raise ApiError('计划项不存在', 404)
            if it['stage'] != '待执行':
                raise ApiError(f'当前计划项状态为「{it["stage"]}」，不能重复执行')
            plan = one_to_dict(c.execute('SELECT * FROM treatment_plan WHERE id=?', (it['plan_id'],)).fetchone())
            if plan['stage'] not in ('已确认', '执行中'):
                raise ApiError(f'治疗计划当前为「{plan["stage"]}」状态，须先经患者确认方案后再执行计划项')
            if not it.get('price_item_id'):
                raise ApiError('该计划项未关联有效收费价目，无法自动生成收费单')
            enc = one_to_dict(c.execute('SELECT * FROM encounter WHERE id=?', (encounter_id,)).fetchone())
            if not enc:
                raise ApiError('关联的诊疗记录不存在')
            if int(enc['patient_id']) != int(plan['patient_id']):
                raise ApiError('诊疗记录所属患者与治疗计划患者不一致')

            ts = now_str()
            cb = default_employee_id(c, user)
            c.execute(
                "UPDATE plan_item SET stage='已执行', encounter_id=?, executed_at=? WHERE id=?",
                (encounter_id, ts, item_id),
            )
            if plan['stage'] == '已确认':
                c.execute(
                    "UPDATE treatment_plan SET stage='执行中', accepted_at=COALESCE(accepted_at, ?) WHERE id=?",
                    (ts, plan['id']),
                )

            # 自动触发可选技工单草稿
            created_order = None
            lab_cfg = body.get('lab_order')
            if lab_cfg and lab_cfg.get('product_id'):
                created_order = self._create_order_draft_in_tx(c, {
                    'encounter_id': encounter_id,
                    'plan_item_id': item_id,
                    'product_id': lab_cfg['product_id'],
                    'lab_id': lab_cfg.get('lab_id') or 1,
                    'color_id': lab_cfg.get('color_id') or 11,
                    'box_color_id': lab_cfg.get('box_color_id'),
                    'type_id': lab_cfg.get('type_id') or 16,
                    'unit_id': lab_cfg.get('unit_id') or 18,
                    'quantity': it['quantity'],
                    'promised_date': lab_cfg.get('promised_date') or (date.today() + timedelta(days=7)).isoformat(),
                    'repair_requirement': lab_cfg.get('repair_requirement') or it['name'],
                    'teeth': [{'tooth_code': it['tooth_code']}] if it.get('tooth_code') else [],
                }, user)
                c.execute('UPDATE plan_item SET lab_order_id=? WHERE id=?', (created_order['id'], item_id))

            # 自动触发待结算收费单（金额严格取计划项固化快照 unit_price，不受价目表后续调价影响；到期日留空由收费员视赊欠情况维护）
            unit_name = '次'
            u_row = c.execute(
                'SELECT bo.name FROM price_item pi JOIN basic_option bo ON bo.id = pi.unit_id WHERE pi.id=?',
                (it['price_item_id'],),
            ).fetchone()
            if u_row:
                unit_name = u_row['name']
            bill_no = next_code(c, 'bill', 'bill_no', 'B')
            amount = round(float(it['quantity']) * float(it['unit_price']), 2)
            bill_stage = '已结清' if amount <= 0 else '欠款中'
            cur_b = c.execute(
                '''INSERT INTO bill
                   (issued_by, encounter_id, plan_item_id, bill_no, issued_at, discount_amount, discount_reason,
                    due_date, debt_opened_at, settled_at, collection_note, stage)
                   VALUES(?,?,?,?,?,0,'',NULL,?,?,'计划执行自动生成',?)''',
                (cb, encounter_id, item_id, bill_no, ts,
                 ts if amount > 0 else None, ts if amount <= 0 else None, bill_stage),
            )
            bill_id = cur_b.lastrowid
            c.execute(
                '''INSERT INTO bill_line
                   (bill_id, price_item_id, dental_order_id, line_no, item_name, unit, quantity, unit_price, discount_amount, description)
                   VALUES(?,?,?,1,?,?,?,?,0,?)''',
                (bill_id, it['price_item_id'], created_order['id'] if created_order else None,
                 it['name'], unit_name, it['quantity'], it['unit_price'],
                 f'牙位 {it["tooth_code"]}' if it.get('tooth_code') else ''),
            )
            c.execute('UPDATE plan_item SET bill_id=? WHERE id=?', (bill_id, item_id))
            return {
                'item': one_to_dict(c.execute('SELECT * FROM plan_item WHERE id=?', (item_id,)).fetchone()),
                'bill_no': bill_no,
                'order_no': created_order['order_no'] if created_order else None,
            }

    def _order_from_plan_item(self, body, user):
        item_id = int(body.get('item_id') or 0)
        with _lock, connect() as c:
            it = one_to_dict(c.execute('SELECT * FROM plan_item WHERE id=?', (item_id,)).fetchone())
            if not it:
                raise ApiError('计划项不存在', 404)
            if it['stage'] != '已执行':
                raise ApiError('计划项实际执行后方生成技工单')
            if it.get('lab_order_id'):
                raise ApiError('该计划项已关联义齿订单')
            order = self._create_order_draft_in_tx(c, {
                'encounter_id': it['encounter_id'],
                'plan_item_id': item_id,
                'product_id': body.get('product_id'),
                'lab_id': body.get('lab_id'),
                'color_id': body.get('color_id'),
                'box_color_id': body.get('box_color_id'),
                'type_id': body.get('type_id'),
                'unit_id': body.get('unit_id'),
                'quantity': it['quantity'],
                'promised_date': body.get('promised_date'),
                'repair_requirement': body.get('repair_requirement') or it['name'],
                'teeth': [{'tooth_code': it['tooth_code']}] if it.get('tooth_code') else [],
            }, user)
            c.execute('UPDATE plan_item SET lab_order_id=? WHERE id=?', (order['id'], item_id))
            if it.get('bill_id'):
                c.execute(
                    'UPDATE bill_line SET dental_order_id=? WHERE bill_id=? AND dental_order_id IS NULL',
                    (order['id'], it['bill_id']),
                )
            return order

    # -----------------------------------------------------------------
    # 收费、支付与欠款（UC-02）
    # -----------------------------------------------------------------
    def _create_bill(self, body, user):
        encounter_id = int(body.get('encounter_id') or 0)
        plan_item_id = int(body['plan_item_id']) if body.get('plan_item_id') else None
        discount_amount = float(body.get('discount_amount') or 0)
        discount_reason = str(body.get('discount_reason') or '').strip()
        due_date = body.get('due_date') or None
        lines = body.get('lines') or []
        method_id = int(body.get('method_id') or 0)
        if not encounter_id:
            raise ApiError('必须选择关联的诊疗记录')
        if not lines:
            raise ApiError('至少添加一条收费明细')
        if discount_amount < 0:
            raise ApiError('整单折扣不能为负数')
        if discount_amount > 0 and not discount_reason:
            raise ApiError('使用整单折扣时必须填写折扣原因')
        with _lock, connect() as c:
            enc = c.execute('SELECT * FROM encounter WHERE id=?', (encounter_id,)).fetchone()
            if not enc:
                raise ApiError('关联诊疗记录不存在')
            pi_ref = None
            if plan_item_id:
                pi_ref = c.execute('SELECT * FROM plan_item WHERE id=?', (plan_item_id,)).fetchone()
                if not pi_ref:
                    raise ApiError('关联的治疗计划项不存在')
                if pi_ref['stage'] != '已执行':
                    raise ApiError('仅已执行的治疗计划项可开具收费单')
                if int(pi_ref['encounter_id'] or 0) != encounter_id:
                    raise ApiError('所选诊疗记录与治疗计划项执行的诊疗记录不一致')
                dup_pi = c.execute(
                    "SELECT bill_no FROM bill WHERE plan_item_id=? AND stage != '已作废'", (plan_item_id,)
                ).fetchone()
                if dup_pi:
                    raise ApiError(f'检测到重复收费：该计划项已存在收费单 {dup_pi["bill_no"]}')

            # 校验明细、价目快照（严格取价目表权威单价或计划项锁定快照，防绕过折扣审计）、跨表订单归属与行折扣
            prepared = []
            line_sum = 0.0
            item_ids_set = set()
            order_ids_seen = set()
            for idx, l in enumerate(lines, 1):
                pi_id = int(l.get('price_item_id') or 0)
                use_plan_snapshot = bool(pi_ref and int(pi_ref['price_item_id'] or 0) == pi_id)
                if use_plan_snapshot:
                    pi = c.execute(
                        '''SELECT p.*, bo.name AS unit_name
                           FROM price_item p JOIN basic_option bo ON bo.id = p.unit_id
                           WHERE p.id=?''',
                        (pi_id,),
                    ).fetchone()
                else:
                    pi = c.execute(
                        '''SELECT p.*, bo.name AS unit_name
                           FROM price_item p JOIN basic_option bo ON bo.id = p.unit_id
                           WHERE p.id=? AND p.active=1''',
                        (pi_id,),
                    ).fetchone()
                if not pi:
                    raise ApiError(f'第 {idx} 行价目项目不存在或已停用，请重新选择或交主管核对')
                qty = float(l.get('quantity') or 0)
                up = float(pi_ref['unit_price']) if use_plan_snapshot else float(pi['unit_price'])
                ldisc = float(l.get('discount_amount') or 0)
                if qty <= 0 or up < 0:
                    raise ApiError(f'第 {idx} 行数量须大于 0 且单价不可为负')
                orig = round(qty * up, 2)
                if ldisc < 0 or ldisc > orig:
                    raise ApiError(f'第 {idx} 行折扣（{ldisc}）不能超过行原价（{orig}）')
                order_id = int(l['dental_order_id']) if l.get('dental_order_id') else None
                if order_id:
                    if order_id in order_ids_seen:
                        raise ApiError(f'同一收费单不可重复关联同一义齿订单（#{order_id}）')
                    order_ids_seen.add(order_id)
                    od = c.execute('SELECT encounter_id FROM dental_order WHERE id=?', (order_id,)).fetchone()
                    if not od or int(od['encounter_id'] or 0) != encounter_id:
                        raise ApiError(f'第 {idx} 行引用的义齿订单不归属于同次诊疗')
                    dup_od = c.execute(
                        "SELECT b.bill_no FROM bill_line bl JOIN bill b ON b.id=bl.bill_id WHERE bl.dental_order_id=? AND b.stage != '已作废'",
                        (order_id,),
                    ).fetchone()
                    if dup_od:
                        raise ApiError(f'检测到重复收费：该义齿订单已关联有效收费单 {dup_od["bill_no"]}')
                line_sum += (orig - ldisc)
                item_ids_set.add(pi_id)
                prepared.append({
                    'line_no': idx, 'price_item_id': pi_id, 'dental_order_id': order_id,
                    'item_name': pi['name'], 'unit': pi['unit_name'],
                    'quantity': qty, 'unit_price': up, 'discount_amount': ldisc,
                    'description': str(l.get('description') or '').strip(),
                })

            line_sum = round(line_sum, 2)
            if discount_amount > line_sum:
                raise ApiError(f'整单折扣（{discount_amount}）不能超过行金额合计（{line_sum}）')

            # UC-02 扩展路径：检测同诊疗当日相同项目重复收费（含部分重叠）
            if not plan_item_id:
                same_day_bills = c.execute(
                    "SELECT id, bill_no FROM bill WHERE encounter_id=? AND substr(issued_at,1,10)=? AND stage != '已作废'",
                    (encounter_id, today_str()),
                ).fetchall()
                for sb in same_day_bills:
                    sb_items = {r[0] for r in c.execute('SELECT price_item_id FROM bill_line WHERE bill_id=?', (sb['id'],)).fetchall()}
                    if sb_items & item_ids_set:
                        raise ApiError(f'检测到重复收费（同次诊疗今日已开具相同项目的收费单 {sb["bill_no"]}），已拦截提交')

            receivable = round(max(0.0, line_sum - discount_amount), 2)
            pay_amt = body.get('initial_pay_amount')
            pay_amt = receivable if pay_amt is None or pay_amt == '' else float(pay_amt)
            if pay_amt < 0 or pay_amt > receivable:
                raise ApiError('本次发起支付金额须在 0 与应收金额之间')
            if pay_amt > 0 and not option_has_kind(c, method_id, '支付方式', require_active=True):
                raise ApiError('请选择有效的支付方式')

            ts = now_str()
            cb = default_employee_id(c, user)
            bill_no = next_code(c, 'bill', 'bill_no', 'B')
            stage = '已结清' if receivable <= 0 else '欠款中'
            cur = c.execute(
                '''INSERT INTO bill
                   (issued_by, encounter_id, plan_item_id, bill_no, issued_at,
                    discount_amount, discount_reason, due_date, debt_opened_at, settled_at,
                    collection_note, stage)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)''',
                (cb, encounter_id, plan_item_id, bill_no, ts, discount_amount, discount_reason,
                 due_date, ts if receivable > 0 else None, ts if receivable <= 0 else None, '', stage),
            )
            bill_id = cur.lastrowid
            for pl in prepared:
                c.execute(
                    '''INSERT INTO bill_line
                       (bill_id, price_item_id, dental_order_id, line_no, item_name, unit, quantity, unit_price, discount_amount, description)
                       VALUES(?,?,?,?,?,?,?,?,?,?)''',
                    (bill_id, pl['price_item_id'], pl['dental_order_id'], pl['line_no'],
                     pl['item_name'], pl['unit'], pl['quantity'], pl['unit_price'], pl['discount_amount'], pl['description']),
                )
            if plan_item_id:
                c.execute('UPDATE plan_item SET bill_id=? WHERE id=?', (bill_id, plan_item_id))

            req_no = None
            if pay_amt > 0:
                req_no = next_code(c, 'payment', 'request_no', 'REQ')
                c.execute(
                    '''INSERT INTO payment
                       (bill_id, method_id, refund_of_id, request_no, external_txn_no, requested_at, kind, result, amount)
                       VALUES(?,?,NULL,?,NULL,?,'收款','待确认',?)''',
                    (bill_id, method_id, req_no, ts, round(pay_amt, 2)),
                )
            bill = one_to_dict(c.execute(
                'SELECT b.*, v.receivable, v.received, v.debt FROM bill b JOIN v_bill_debt v ON v.bill_id=b.id WHERE b.id=?',
                (bill_id,),
            ).fetchone())
            bill['request_no'] = req_no
            return bill

    def _apply_bill_discount(self, body, user):
        """收银台对未发生有效/待确认支付的收费单（如计划执行自动生成单）录入合法整单折扣与原因。"""
        bid = int(body.get('id') or 0)
        discount_amount = round(float(body.get('discount_amount') or 0), 2)
        discount_reason = str(body.get('discount_reason') or '').strip()
        if not bid or discount_amount < 0:
            raise ApiError('收费单与非负折扣金额必填')
        if discount_amount > 0 and not discount_reason:
            raise ApiError('使用整单折扣时必须填写折扣原因')
        with _lock, connect() as c:
            b = one_to_dict(c.execute('SELECT * FROM bill WHERE id=?', (bid,)).fetchone())
            if not b:
                raise ApiError('收费单不存在', 404)
            if b['stage'] != '欠款中':
                raise ApiError(f'仅「欠款中」收费单可调整整单折扣（当前：{b["stage"]}）')
            pay_cnt = c.execute(
                "SELECT COUNT(*) FROM payment WHERE bill_id=? AND result IN ('成功', '待确认')",
                (bid,),
            ).fetchone()[0]
            if pay_cnt > 0:
                raise ApiError('该收费单已存在成功或待确认支付记录，不可再调整整单折扣')
            v = c.execute('SELECT line_sum FROM v_bill_debt WHERE bill_id=?', (bid,)).fetchone()
            line_sum = float(v['line_sum']) if v else 0.0
            if discount_amount > line_sum + 0.0001:
                raise ApiError(f'整单折扣（{discount_amount}）不能超过行金额合计（{line_sum}）')
            c.execute(
                'UPDATE bill SET discount_amount=?, discount_reason=? WHERE id=?',
                (discount_amount, discount_reason, bid),
            )
            sync_bill_stage(c, bid)
            audit(c, 'bill', bid, 'discount', user,
                  old_val={'discount_amount': b['discount_amount'], 'discount_reason': b['discount_reason']},
                  new_val={'discount_amount': discount_amount, 'discount_reason': discount_reason},
                  reason=discount_reason or '清除整单折扣')
            return one_to_dict(c.execute(
                'SELECT b.*, v.line_sum, v.receivable, v.received, v.debt FROM bill b JOIN v_bill_debt v ON v.bill_id=b.id WHERE b.id=?',
                (bid,),
            ).fetchone())

    def _create_payment(self, body, user):
        """分次收款与失败重试：为未结清收费单发起新的待确认支付尝试（报告 6.3）。"""
        bill_id = int(body.get('bill_id') or 0)
        method_id = int(body.get('method_id') or 0)
        amount = float(body.get('amount') or 0)
        if not bill_id or amount <= 0:
            raise ApiError('收费单与收款金额（>0）必填')
        with _lock, connect() as c:
            b = c.execute('SELECT * FROM bill WHERE id=?', (bill_id,)).fetchone()
            if not b:
                raise ApiError('收费单不存在', 404)
            if b['stage'] == '已作废':
                raise ApiError('已作废收费单不能发起支付')
            v = c.execute('SELECT * FROM v_bill_debt WHERE bill_id=?', (bill_id,)).fetchone()
            pending_sum = float(c.execute(
                "SELECT COALESCE(SUM(amount), 0) FROM payment WHERE bill_id=? AND kind='收款' AND result='待确认'",
                (bill_id,),
            ).fetchone()[0])
            available = round(max(0.0, float(v['debt']) - pending_sum), 2)
            if amount > available + 0.0001:
                if pending_sum > 0:
                    raise ApiError(f'支付金额（{amount}）超过可发起余额（当前欠款 {v["debt"]}，另有待确认支付 {pending_sum}，请先核对原支付请求）')
                raise ApiError(f'支付金额（{amount}）超过当前欠款余额（{v["debt"]}）')
            if not option_has_kind(c, method_id, '支付方式', require_active=True):
                raise ApiError('请选择有效的支付方式')
            req_no = next_code(c, 'payment', 'request_no', 'REQ')
            cur = c.execute(
                '''INSERT INTO payment
                   (bill_id, method_id, refund_of_id, request_no, external_txn_no, requested_at, kind, result, amount)
                   VALUES(?,?,NULL,?,NULL,?,'收款','待确认',?)''',
                (bill_id, method_id, req_no, now_str(), round(amount, 2)),
            )
            return one_to_dict(c.execute('SELECT * FROM payment WHERE id=?', (cur.lastrowid,)).fetchone())

    def _verify_payment(self, body, user):
        pid = int(body.get('id') or 0)
        result = str(body.get('result') or '').strip()
        ext_no = str(body.get('external_txn_no') or '').strip() or None
        fail_reason = str(body.get('failure_reason') or '').strip() or None
        if result not in ('成功', '失败', '待确认'):
            raise ApiError('支付核对结果不合法')
        with _lock, connect() as c:
            p = one_to_dict(c.execute('SELECT * FROM payment WHERE id=?', (pid,)).fetchone())
            if not p:
                raise ApiError('支付记录不存在', 404)
            if p['result'] != '待确认':
                raise ApiError(f'支付记录已为终态「{p["result"]}」，禁止覆写')
            if result == '成功':
                b = c.execute('SELECT stage FROM bill WHERE id=?', (p['bill_id'],)).fetchone()
                if b and b['stage'] == '已作废':
                    raise ApiError('关联收费单已作废，不能核对为成功')
                v = c.execute('SELECT receivable, received FROM v_bill_debt WHERE bill_id=?', (p['bill_id'],)).fetchone()
                if v and float(v['received']) + float(p['amount']) > float(v['receivable']) + 0.0001:
                    raise ApiError(f'核对失败：该笔金额将导致实收超过应收总额（应收 {v["receivable"]}，已收 {v["received"]}）')
                if not ext_no:
                    ext_no = 'TXN' + datetime.now().strftime('%Y%m%d%H%M%S') + f'{pid:03d}'
            if result == '失败' and not fail_reason:
                fail_reason = '第三方支付返回失败'
            ts = now_str()
            c.execute(
                '''UPDATE payment SET result=?, external_txn_no=?, failure_reason=?,
                   occurred_at=?, checked_at=? WHERE id=?''',
                (result, ext_no, fail_reason, ts if result in ('成功', '失败') else None, ts, pid),
            )
            sync_bill_stage(c, p['bill_id'])
            return one_to_dict(c.execute('SELECT * FROM payment WHERE id=?', (pid,)).fetchone())

    def _refund_payment(self, body, user):
        src_id = int(body.get('payment_id') or 0)
        amount = float(body.get('amount') or 0)
        reason = str(body.get('reason') or '').strip()
        if amount <= 0:
            raise ApiError('退款金额必须大于 0')
        with _lock, connect() as c:
            src = one_to_dict(c.execute('SELECT * FROM payment WHERE id=?', (src_id,)).fetchone())
            if not src or src['kind'] != '收款' or src['result'] != '成功':
                raise ApiError('仅可对成功的收款记录发起退款')
            refunded = float(c.execute(
                "SELECT COALESCE(SUM(amount), 0) FROM payment WHERE refund_of_id=? AND result='成功'",
                (src_id,),
            ).fetchone()[0])
            if refunded + amount > float(src['amount']) + 0.0001:
                raise ApiError(f'累计退款超过原收款金额（可退 {round(float(src["amount"]) - refunded, 2)}）')
            req_no = next_code(c, 'payment', 'request_no', 'REQ')
            ts = now_str()
            cur = c.execute(
                '''INSERT INTO payment
                   (bill_id, method_id, refund_of_id, request_no, external_txn_no, requested_at,
                    kind, result, amount, occurred_at, failure_reason, checked_at)
                   VALUES(?,?,?,?,NULL,?,'退款','成功',?,?,?,?)''',
                (src['bill_id'], src['method_id'], src_id, req_no, ts, round(amount, 2), ts, reason or '退费', ts),
            )
            sync_bill_stage(c, src['bill_id'])
            audit(c, 'payment', cur.lastrowid, 'refund', user, new_val={'refund_of_id': src_id, 'amount': amount}, reason=reason)
            return one_to_dict(c.execute('SELECT * FROM payment WHERE id=?', (cur.lastrowid,)).fetchone())

    def _update_bill_collection(self, body, user):
        bid = int(body.get('id') or 0)
        with _lock, connect() as c:
            old = one_to_dict(c.execute('SELECT * FROM bill WHERE id=?', (bid,)).fetchone())
            if not old:
                raise ApiError('收费单不存在', 404)
            note = str(body.get('collection_note') if body.get('collection_note') is not None else (old['collection_note'] or '')).strip()
            due = body.get('due_date') if 'due_date' in body else old['due_date']
            c.execute('UPDATE bill SET collection_note=?, due_date=? WHERE id=?', (note, due or None, bid))
            audit(c, 'bill', bid, 'update_collection', user,
                  old_val={'collection_note': old['collection_note'], 'due_date': old['due_date']},
                  new_val={'collection_note': note, 'due_date': due}, reason='更新催收信息')
            return one_to_dict(c.execute('SELECT * FROM bill WHERE id=?', (bid,)).fetchone())

    def _void_bill(self, body, user):
        bid = int(body.get('id') or 0)
        reason = str(body.get('void_reason') or '').strip()
        if not reason:
            raise ApiError('作废收费单必须填写作废原因')
        with _lock, connect() as c:
            b = one_to_dict(c.execute('SELECT * FROM bill WHERE id=?', (bid,)).fetchone())
            if not b:
                raise ApiError('收费单不存在', 404)
            if b['stage'] == '已作废':
                raise ApiError('收费单已作废')
            v = c.execute('SELECT received FROM v_bill_debt WHERE bill_id=?', (bid,)).fetchone()
            if v and float(v['received']) > 0.0001:
                raise ApiError('该收费单已有有效已收金额，请先全额退款后再作废')
            pending = c.execute("SELECT COUNT(*) FROM payment WHERE bill_id=? AND result='待确认'", (bid,)).fetchone()[0]
            if pending > 0:
                raise ApiError('该收费单存在待确认支付记录，请先核对支付结果后再作废')
            c.execute("UPDATE bill SET stage='已作废', voided_at=?, void_reason=? WHERE id=?", (now_str(), reason, bid))
            c.execute('UPDATE plan_item SET bill_id=NULL WHERE bill_id=?', (bid,))
            audit(c, 'bill', bid, 'void', user, old_val=b['stage'], new_val='已作废', reason=reason)
            return one_to_dict(c.execute('SELECT * FROM bill WHERE id=?', (bid,)).fetchone())

    # -----------------------------------------------------------------
    # 义齿订单（UC-03）
    # -----------------------------------------------------------------
    def _create_order_draft_in_tx(self, c, body, user):
        enc_id = int(body['encounter_id']) if body.get('encounter_id') else None
        plan_item_id = int(body['plan_item_id']) if body.get('plan_item_id') else None
        product_id = int(body.get('product_id') or 0)
        lab_id = int(body.get('lab_id') or 0)
        color_id = int(body.get('color_id') or 0)
        box_color_id = int(body['box_color_id']) if body.get('box_color_id') else None
        type_id = int(body.get('type_id') or 0)
        unit_id = int(body.get('unit_id') or 0)
        qty = float(body.get('quantity') or 0)
        promised = str(body.get('promised_date') or '').strip()
        req_text = str(body.get('repair_requirement') or '').strip()

        pr = c.execute('SELECT * FROM product WHERE id=? AND active=1', (product_id,)).fetchone()
        if not pr:
            raise ApiError('所选义齿产品不存在或已停用')
        lb = c.execute('SELECT * FROM dental_lab WHERE id=? AND active=1', (lab_id,)).fetchone()
        if not lb:
            raise ApiError('所选合作技工所不存在或已停用')
        if not option_has_kind(c, color_id, '颜色', require_active=True):
            raise ApiError('请选择有效的颜色')
        if box_color_id and not option_has_kind(c, box_color_id, '盒子颜色', require_active=True):
            raise ApiError('盒子颜色无效')
        if not option_has_kind(c, type_id, '订单类型', require_active=True):
            raise ApiError('请选择有效的订单类型')
        if not option_has_kind(c, unit_id, '单位', require_active=True):
            raise ApiError('请选择有效的单位')
        if qty <= 0 or not promised:
            raise ApiError('数量（>0）与承诺日期必填')

        teeth = body.get('teeth') or []
        clean_teeth = []
        seen_t = set()
        for t in teeth:
            tc = str(t.get('tooth_code') if isinstance(t, dict) else t).strip()
            if not tc:
                continue
            if tc not in VALID_FDI_TEETH:
                raise ApiError(f'牙位「{tc}」不符合 FDI 国际标准编号（11-18, 21-28, 31-38, 41-48）')
            if tc in seen_t:
                raise ApiError(f'同一订单不可重复录入牙位：{tc}')
            seen_t.add(tc)
            clean_teeth.append((tc, str(t.get('repair_note') or '').strip() if isinstance(t, dict) else ''))

        no = next_code(c, 'dental_order', 'order_no', 'DO')
        ts = now_str()
        cb = default_employee_id(c, user)
        cur = c.execute(
            '''INSERT INTO dental_order
               (product_id, lab_id, created_by, color_id, box_color_id, type_id, unit_id,
                encounter_id, plan_item_id, order_no, repair_requirement, quantity, promised_date,
                stage, dispatch_result, created_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'草稿','',?)''',
            (product_id, lab_id, cb, color_id, box_color_id, type_id, unit_id,
             enc_id, plan_item_id, no, req_text or pr['name'], qty, promised, ts),
        )
        oid = cur.lastrowid
        for tc, rn in clean_teeth:
            c.execute('INSERT INTO order_tooth(order_id, tooth_code, repair_note) VALUES(?,?,?)', (oid, tc, rn))
        c.execute(
            '''INSERT INTO order_event
               (order_id, changed_by, source, event_no, occurred_at, received_at, old_stage, new_stage, reason)
               VALUES(?,?,?,?,?,?,?,'草稿','建立草稿')''',
            (oid, cb, 'clinic', f'EVT-{uuid.uuid4().hex[:10]}', ts, ts, ''),
        )
        return one_to_dict(c.execute('SELECT * FROM dental_order WHERE id=?', (oid,)).fetchone())

    def _create_order_draft(self, body, user):
        with _lock, connect() as c:
            return self._create_order_draft_in_tx(c, body, user)

    def _update_order_draft(self, body, user):
        oid = int(body.get('id') or 0)
        with _lock, connect() as c:
            o = one_to_dict(c.execute('SELECT * FROM dental_order WHERE id=?', (oid,)).fetchone())
            if not o:
                raise ApiError('订单不存在', 404)
            if o['stage'] != '草稿':
                raise ApiError('仅草稿状态的订单可直接编辑，已发送/已交货订单禁止直接覆写')
            product_id = int(body.get('product_id') or o['product_id'])
            lab_id = int(body.get('lab_id') or o['lab_id'])
            color_id = int(body.get('color_id') or o['color_id'])
            box_color_id = (int(body['box_color_id']) if body.get('box_color_id') else None) if 'box_color_id' in body else o['box_color_id']
            type_id = int(body.get('type_id') or o['type_id'])
            unit_id = int(body.get('unit_id') or o['unit_id'])
            qty = float(body['quantity']) if ('quantity' in body and body.get('quantity') is not None) else float(o['quantity'])
            promised = str(body['promised_date'] if 'promised_date' in body else o['promised_date']).strip()
            req_text = str(body.get('repair_requirement') if body.get('repair_requirement') is not None else o['repair_requirement']).strip()
            if not c.execute('SELECT 1 FROM product WHERE id=? AND active=1', (product_id,)).fetchone():
                raise ApiError('产品不存在或已停用')
            if not c.execute('SELECT 1 FROM dental_lab WHERE id=? AND active=1', (lab_id,)).fetchone():
                raise ApiError('技工所不存在或已停用')
            if not option_has_kind(c, color_id, '颜色', require_active=True):
                raise ApiError('请选择有效的颜色')
            if box_color_id and not option_has_kind(c, box_color_id, '盒子颜色', require_active=True):
                raise ApiError('盒子颜色无效')
            if not option_has_kind(c, type_id, '订单类型', require_active=True):
                raise ApiError('请选择有效的订单类型')
            if not option_has_kind(c, unit_id, '单位', require_active=True):
                raise ApiError('请选择有效的单位')
            if qty <= 0 or not promised:
                raise ApiError('数量（>0）与承诺日期必填')
            c.execute(
                '''UPDATE dental_order SET product_id=?, lab_id=?, color_id=?, box_color_id=?,
                   type_id=?, unit_id=?, quantity=?, promised_date=?, repair_requirement=? WHERE id=?''',
                (product_id, lab_id, color_id, box_color_id, type_id, unit_id, qty, promised, req_text, oid),
            )
            if 'teeth' in body:
                c.execute('DELETE FROM order_tooth WHERE order_id=?', (oid,))
                seen_t = set()
                for t in (body.get('teeth') or []):
                    tc = str(t.get('tooth_code') if isinstance(t, dict) else t).strip()
                    if not tc:
                        continue
                    if tc not in VALID_FDI_TEETH:
                        raise ApiError(f'牙位「{tc}」不符合 FDI 国际标准编号')
                    if tc in seen_t:
                        raise ApiError(f'同一订单不可重复录入牙位：{tc}')
                    seen_t.add(tc)
                    c.execute('INSERT INTO order_tooth(order_id, tooth_code, repair_note) VALUES(?,?,?)',
                              (oid, tc, str(t.get('repair_note') or '').strip() if isinstance(t, dict) else ''))
            return one_to_dict(c.execute('SELECT * FROM dental_order WHERE id=?', (oid,)).fetchone())

    def _upload_order_attachment(self, body, user):
        oid = int(body.get('order_id') or 0)
        type_id = int(body.get('type_id') or 0)
        file_name = Path(str(body.get('file_name') or '').strip()).name
        mime_type = str(body.get('mime_type') or '').strip()
        b64 = str(body.get('content_base64') or '')
        if not oid or not file_name or not b64:
            raise ApiError('订单、文件名与文件内容必填')
        if mime_type not in ALLOWED_MIME:
            raise ApiError('附件格式仅允许 JPG、PNG、PDF')
        try:
            raw = base64.b64decode(b64.split(',')[-1])
        except Exception:
            raise ApiError('附件内容编码无效')
        if len(raw) <= 0 or len(raw) > MAX_UPLOAD_BYTES:
            raise ApiError('附件大小须大于 0 且不超过 10 MB')
        with _lock, connect() as c:
            o = c.execute('SELECT stage FROM dental_order WHERE id=?', (oid,)).fetchone()
            if not o:
                raise ApiError('订单不存在', 404)
            if o['stage'] in ('已交货', '取消'):
                raise ApiError('已交货或已取消订单不可新增附件')
            if not option_has_kind(c, type_id, '附件类型', require_active=True):
                raise ApiError('请选择有效的附件类型')
            if c.execute('SELECT 1 FROM order_attachment WHERE order_id=? AND file_name=?', (oid, file_name)).fetchone():
                raise ApiError(f'同一订单不能登记同名附件：{file_name}')
            ext = Path(file_name).suffix.lower() or '.bin'
            storage_key = f'order_{oid}_{uuid.uuid4().hex[:12]}{ext}'
            UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
            (UPLOAD_DIR / storage_key).write_bytes(raw)
            checksum = hashlib.sha256(raw).hexdigest()
            cur = c.execute(
                '''INSERT INTO order_attachment
                   (order_id, type_id, uploaded_by, file_name, storage_key, mime_type, byte_size, checksum, uploaded_at)
                   VALUES(?,?,?,?,?,?,?,?,?)''',
                (oid, type_id, default_employee_id(c, user), file_name, storage_key, mime_type, len(raw), checksum, now_str()),
            )
            return one_to_dict(c.execute('SELECT * FROM order_attachment WHERE id=?', (cur.lastrowid,)).fetchone())

    def _delete_order_attachment(self, body, user):
        att_id = int(body.get('id') or 0)
        with _lock, connect() as c:
            att = one_to_dict(c.execute('SELECT * FROM order_attachment WHERE id=?', (att_id,)).fetchone())
            if not att:
                raise ApiError('附件不存在', 404)
            o = c.execute('SELECT stage FROM dental_order WHERE id=?', (att['order_id'],)).fetchone()
            if o['stage'] != '草稿':
                raise ApiError('仅草稿状态订单允许删除附件')
            c.execute('DELETE FROM order_attachment WHERE id=?', (att_id,))
            try:
                (UPLOAD_DIR / att['storage_key']).unlink(missing_ok=True)
            except Exception:
                pass
            return {'deleted': att_id}

    def _send_order(self, body, user):
        oid = int(body.get('id') or 0)
        with _lock, connect() as c:
            o = one_to_dict(c.execute('SELECT * FROM dental_order WHERE id=?', (oid,)).fetchone())
            if not o:
                raise ApiError('订单不存在', 404)
            is_retry = (o['stage'] == '已发送' and o['dispatch_result'] == '待处理')
            if o['stage'] != '草稿' and not is_retry:
                raise ApiError('仅草稿（或技工所拒收待处理）订单可发送')
            pr = c.execute('SELECT * FROM product WHERE id=? AND active=1', (o['product_id'],)).fetchone()
            if not pr:
                raise ApiError('订单产品已停用，无法发送')
            if not c.execute('SELECT 1 FROM dental_lab WHERE id=? AND active=1', (o['lab_id'],)).fetchone():
                raise ApiError('合作技工所已停用，无法发送')
            teeth = c.execute('SELECT tooth_code FROM order_tooth WHERE order_id=?', (oid,)).fetchall()
            if not teeth:
                raise ApiError('发送前必须至少关联一个有效牙位（请先编辑草稿补填牙位）')
            for t in teeth:
                if t['tooth_code'] not in VALID_FDI_TEETH:
                    raise ApiError(f'存在无效 FDI 牙位：{t["tooth_code"]}')
            if pr['requires_attachment']:
                atts = c.execute('SELECT COUNT(*) FROM order_attachment WHERE order_id=?', (oid,)).fetchone()[0]
                if atts < 1:
                    raise ApiError(f'产品「{pr["name"]}」要求必须上传必要附件后方可发送')
            ts = now_str()
            cb = default_employee_id(c, user)
            c.execute("UPDATE dental_order SET stage='已发送', dispatch_result='已发送', sent_at=? WHERE id=?", (ts, oid))
            c.execute(
                '''INSERT INTO order_event
                   (order_id, changed_by, source, event_no, occurred_at, received_at, old_stage, new_stage, reason)
                   VALUES(?,?,?,?,?,?,?,?,?)''',
                (oid, cb, 'doctor', f'EVT-{uuid.uuid4().hex[:10]}', ts, ts, o['stage'], '已发送',
                 '重新发送至技工所' if is_retry else '医生确认发送'),
            )
            return one_to_dict(c.execute('SELECT * FROM dental_order WHERE id=?', (oid,)).fetchone())

    def _order_receipt(self, body, user):
        oid = int(body.get('id') or 0)
        source = str(body.get('source') or 'lab').strip()
        event_no = str(body.get('event_no') or '').strip()
        action = str(body.get('action') or 'advance').strip()
        new_stage = str(body.get('new_stage') or '').strip()
        reason = str(body.get('reason') or '').strip()
        ext_no = str(body.get('external_order_no') or '').strip() or None
        expected_at = str(body.get('expected_at') or '').strip() or None
        if not source or not event_no:
            raise ApiError('技工所回执必须包含来源（source）与事件号（event_no）')
        with _lock, connect() as c:
            o = one_to_dict(c.execute('SELECT * FROM dental_order WHERE id=?', (oid,)).fetchone())
            if not o:
                raise ApiError('订单不存在', 404)
            # 联合唯一 (order_id, source, event_no) 幂等去重（表 23 / 8.7）
            dup = c.execute(
                'SELECT * FROM order_event WHERE order_id=? AND source=? AND event_no=?',
                (oid, source, event_no),
            ).fetchone()
            if dup:
                return {'duplicate': True, 'order': o, 'event': dict(dup)}

            ts = now_str()
            cb = default_employee_id(c, user)
            # UC-03 扩展路径：技工所拒收 → 标记为待处理
            if action == 'reject':
                if o['stage'] != '已发送':
                    raise ApiError('仅已发送状态可登记技工所拒收')
                c.execute("UPDATE dental_order SET dispatch_result='待处理' WHERE id=?", (oid,))
                c.execute(
                    '''INSERT INTO order_event
                       (order_id, changed_by, source, event_no, occurred_at, received_at, old_stage, new_stage, reason, external_order_no)
                       VALUES(?,NULL,?,?,?,?,?,?,?,?)''',
                    (oid, source, event_no, ts, ts, o['stage'], o['stage'], f'技工所拒收：{reason or "需人工核对"}', ext_no),
                )
                return {'duplicate': False, 'order': one_to_dict(c.execute('SELECT * FROM dental_order WHERE id=?', (oid,)).fetchone())}

            if new_stage not in ORDER_TRANSITIONS.get(o['stage'], []):
                raise ApiError(f'不允许的订单状态转换：{o["stage"]} → {new_stage}')

            c.execute(
                '''INSERT INTO order_event
                   (order_id, changed_by, source, event_no, occurred_at, received_at, old_stage, new_stage, reason, external_order_no)
                   VALUES(?,NULL,?,?,?,?,?,?,?,?)''',
                (oid, source, event_no, ts, ts, o['stage'], new_stage, reason, ext_no),
            )
            updates = ['stage=?']
            params = [new_stage]
            if new_stage == '已接收':
                updates.extend(['accepted_at=?', "dispatch_result='已接收'"])
                params.append(ts)
                if expected_at:
                    updates.append('expected_at=?')
                    params.append(expected_at)
            elif new_stage == '试戴':
                updates.append('trial_at=?')
                params.append(ts)
            params.append(oid)
            c.execute(f"UPDATE dental_order SET {', '.join(updates)} WHERE id=?", params)

            # 排定提醒：接收时向诊所内部人员排定承诺交期到期提醒；试戴时向患者排定脱敏试戴提醒（绝不暴露内部订单号）
            pr_row = c.execute('SELECT name FROM product WHERE id=?', (o['product_id'],)).fetchone()
            prod_name = pr_row['name'] if pr_row else '定制修复体'
            if new_stage == '已接收' and o.get('promised_date'):
                staff_phone = ''
                emp_row = c.execute('SELECT phone FROM employee WHERE id=?', (o['created_by'],)).fetchone()
                if emp_row and emp_row['phone']:
                    staff_phone = emp_row['phone']
                else:
                    cl_row = c.execute('SELECT phone FROM clinic ORDER BY id LIMIT 1').fetchone()
                    staff_phone = (cl_row['phone'] if cl_row else '') or ''
                if staff_phone:
                    schedule_reminder(
                        c, cb, '到期提醒', f"{o['promised_date']}T09:00:00", staff_phone,
                        f'义齿订单 {o["order_no"]}（{prod_name}）承诺交期已至，请跟进技工所交付进度。', order_id=oid,
                    )
            elif new_stage == '试戴' and o.get('encounter_id'):
                prow = c.execute(
                    'SELECT p.phone FROM patient p JOIN encounter e ON e.patient_id=p.id WHERE e.id=?',
                    (o['encounter_id'],),
                ).fetchone()
                if prow and prow['phone']:
                    schedule_reminder(
                        c, cb, '试戴提醒', now_str(), prow['phone'],
                        f'您的定制修复体（{prod_name}）已到店待试戴，请预约到诊。', order_id=oid,
                    )

            return {'duplicate': False, 'order': one_to_dict(c.execute('SELECT * FROM dental_order WHERE id=?', (oid,)).fetchone())}

    def _order_stage(self, body, user):
        oid = int(body.get('id') or 0)
        action = str(body.get('action') or 'transition').strip()
        dst = str(body.get('stage') or '').strip()
        reason = str(body.get('reason') or '').strip()
        trial_result = str(body.get('trial_result') or '').strip() or None
        role = user['role']

        with _lock, connect() as c:
            o = one_to_dict(c.execute('SELECT * FROM dental_order WHERE id=?', (oid,)).fetchone())
            if not o:
                raise ApiError('订单不存在', 404)
            ts = now_str()
            cb = default_employee_id(c, user)

            # UC-04 扩展路径：线下渠道完成，由诊所负责人确认结单并记录原因
            if action == 'offline_close':
                if role not in ('manager', 'admin'):
                    raise ApiError('仅诊所负责人或管理员可执行线下渠道结单确认', 403)
                if o['stage'] in ('草稿', '已交货', '取消'):
                    raise ApiError(f'当前状态「{o["stage"]}」不可执行线下结单')
                if not reason:
                    raise ApiError('线下结单确认必须填写原因')
                c.execute("UPDATE dental_order SET stage='已交货', delivered_at=? WHERE id=?", (ts, oid))
                c.execute(
                    '''INSERT INTO order_event
                       (order_id, changed_by, source, event_no, occurred_at, received_at, old_stage, new_stage, reason)
                       VALUES(?,?,?,?,?,?,?,?,?)''',
                    (oid, cb, 'manager', f'EVT-{uuid.uuid4().hex[:10]}', ts, ts, o['stage'], '已交货', f'负责人线下结单确认：{reason}'),
                )
                return one_to_dict(c.execute('SELECT * FROM dental_order WHERE id=?', (oid,)).fetchone())

            # UC-03 业务规则：已交货订单更正记录（不直接覆盖历史）
            if action == 'correct':
                if role not in ('doctor', 'admin'):
                    raise ApiError('仅口腔医生或管理员可登记更正记录', 403)
                if o['stage'] != '已交货':
                    raise ApiError('仅已交货订单使用更正记录')
                if not reason:
                    raise ApiError('请填写更正说明')
                c.execute(
                    '''INSERT INTO order_event
                       (order_id, changed_by, source, event_no, occurred_at, received_at, old_stage, new_stage, reason)
                       VALUES(?,?,?,?,?,?,?,?,?)''',
                    (oid, cb, role, f'EVT-{uuid.uuid4().hex[:10]}', ts, ts, '已交货', '已交货', f'更正记录：{reason}'),
                )
                return one_to_dict(c.execute('SELECT * FROM dental_order WHERE id=?', (oid,)).fetchone())

            # 角色细粒度校验（表 18）
            if dst == '已交货':
                if role not in ('receptionist', 'doctor', 'admin'):
                    raise ApiError('仅前台接待或口腔医生可确认交货', 403)
            else:
                if role not in ('doctor', 'admin'):
                    raise ApiError('仅口腔医生可执行此订单状态操作', 403)

            src = o['stage']
            if dst not in ORDER_TRANSITIONS.get(src, []):
                hint = '（已交货订单不可直接回退，须通过返工或更正记录调整）' if src == '已交货' else ''
                raise ApiError(f'不允许的订单状态转换：{src} → {dst}{hint}')
            if dst in ('返工', '取消') and not reason:
                raise ApiError(f'订单「{dst}」必须填写原因')

            updates = ['stage=?']
            params = [dst]
            ev_reason = reason
            if dst == '质量确认':
                tr_val = trial_result or '合格'
                updates.extend(['trial_at=COALESCE(trial_at, ?)', 'trial_result=?'])
                params.extend([ts, tr_val])
                ev_reason = f'试戴结论：{tr_val}' + (f'；{reason}' if reason else '')
            elif dst == '返工' and src == '试戴':
                tr_val = trial_result or '不合格'
                updates.append('trial_result=?')
                params.append(tr_val)
                ev_reason = f'试戴结论：{tr_val}；返工原因：{reason}'
            elif dst == '已交货':
                updates.append('delivered_at=?')
                params.append(ts)
            elif dst == '取消':
                updates.extend(['cancelled_at=?', 'cancel_reason=?'])
                params.extend([ts, reason])
            params.append(oid)
            c.execute(f"UPDATE dental_order SET {', '.join(updates)} WHERE id=?", params)
            c.execute(
                '''INSERT INTO order_event
                   (order_id, changed_by, source, event_no, occurred_at, received_at, old_stage, new_stage, reason)
                   VALUES(?,?,?,?,?,?,?,?,?)''',
                (oid, cb, role, f'EVT-{uuid.uuid4().hex[:10]}', ts, ts, src, dst, ev_reason),
            )
            if dst == '已交货' and o.get('encounter_id'):
                prow = c.execute(
                    'SELECT p.phone FROM patient p JOIN encounter e ON e.patient_id=p.id WHERE e.id=?',
                    (o['encounter_id'],),
                ).fetchone()
                if prow and prow['phone']:
                    pr_row = c.execute('SELECT name FROM product WHERE id=?', (o['product_id'],)).fetchone()
                    prod_name = pr_row['name'] if pr_row else '定制修复体'
                    schedule_reminder(
                        c, cb, '取件提醒', ts, prow['phone'],
                        f'您的定制修复体（{prod_name}）已准备就绪可来院取件，请与诊所确认领取时间。', order_id=oid,
                    )
            return one_to_dict(c.execute('SELECT * FROM dental_order WHERE id=?', (oid,)).fetchone())

    # -----------------------------------------------------------------
    # 提醒（UC-04）
    # -----------------------------------------------------------------
    def _send_reminder(self, body, user):
        rid = int(body.get('id') or 0)
        sim_fail = bool(body.get('simulate_fail'))
        with _lock, connect() as c:
            r = one_to_dict(c.execute('SELECT * FROM reminder WHERE id=?', (rid,)).fetchone())
            if not r:
                raise ApiError('提醒记录不存在', 404)
            if r['delivery_result'] == '已发送':
                raise ApiError('该提醒已发送，防止重复推送')
            ts = now_str()
            if sim_fail:
                c.execute(
                    "UPDATE reminder SET delivery_result='失败', attempt_count=attempt_count+1, "
                    "last_attempt_at=?, failure_reason=? WHERE id=?",
                    (ts, str(body.get('failure_reason') or '通道暂时不可用，可重试'), rid),
                )
            else:
                c.execute(
                    "UPDATE reminder SET delivery_result='已发送', attempt_count=attempt_count+1, "
                    "last_attempt_at=?, sent_at=?, failure_reason=NULL WHERE id=?",
                    (ts, ts, rid),
                )
            return one_to_dict(c.execute('SELECT * FROM reminder WHERE id=?', (rid,)).fetchone())

    def _create_reminder(self, body, user):
        order_id = int(body['order_id']) if body.get('order_id') else None
        appt_id = int(body['appointment_id']) if body.get('appointment_id') else None
        if (order_id is None and appt_id is None) or (order_id is not None and appt_id is not None):
            raise ApiError('每条提醒必须且仅能关联一个预约或一张义齿订单')
        channel_id = int(body.get('channel_id') or 0)
        kind = str(body.get('kind') or '').strip()
        scheduled_at = str(body.get('scheduled_at') or '').strip()
        recipient = str(body.get('recipient') or '').strip()
        content = str(body.get('content') or '').strip()
        if not kind or not scheduled_at or not recipient or not content:
            raise ApiError('提醒类型、计划时间、收件人与内容必填')
        with _lock, connect() as c:
            if not option_has_kind(c, channel_id, '通知渠道', require_active=True):
                raise ApiError('请选择有效的通知渠道')
            cur = c.execute(
                '''INSERT INTO reminder
                   (channel_id, created_by, order_id, appointment_id, kind, scheduled_at, recipient,
                    content, attempt_count, delivery_result)
                   VALUES(?,?,?,?,?,?,?,?,0,'待发送')''',
                (channel_id, default_employee_id(c, user), order_id, appt_id, kind, scheduled_at, recipient, content),
            )
            return one_to_dict(c.execute('SELECT * FROM reminder WHERE id=?', (cur.lastrowid,)).fetchone())


def main():
    init_db()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    srv.daemon_threads = True
    print(f'Clinic relational server listening on {HOST}:{PORT} (db={DB_PATH})', flush=True)
    try:
        srv.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == '__main__':
    main()
