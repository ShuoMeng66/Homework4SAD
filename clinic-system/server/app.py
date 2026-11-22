# -*- coding: utf-8 -*-
"""口腔诊所管理系统 后端 API (FastAPI + SQLite)
依据：报告 PDF 表6/表20~24、BR-01~BR-08、UC-01~04
"""
import os, sqlite3, hashlib, json
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Optional
from fastapi import FastAPI, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, 'clinic.db')

app = FastAPI(title="口腔诊所管理系统 API", version="1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# 账号（PDF 表5 + 用户指定：默认口令 password）
USERS = {
    'receptionist': ('password', 'receptionist', '前台接待'),
    'doctor':       ('password', 'doctor', '口腔医生'),
    'cashier':      ('password', 'cashier', '收费员'),
    'manager':      ('password', 'manager', '诊所负责人'),
    'admin':        ('password', 'admin', '管理员'),
}
ROLE_MODULES = {
    'receptionist': ['dashboard','patients','appointments','orders','encounters'],
    'doctor': ['dashboard','appointments','encounters','orders'],
    'cashier': ['dashboard','billing'],
    'manager': ['dashboard','basic','billing','orders','reports'],
    'admin': ['dashboard','basic','patients','appointments','encounters','billing','orders','reports'],
}
TOKENS = {}

def now(): return datetime.now().strftime('%Y-%m-%dT%H:%M')
def today(): return datetime.now().strftime('%Y-%m-%d')

@contextmanager
def db():
    c = sqlite3.connect(DB_PATH, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys=ON')
    try:
        yield c
        c.commit()
    except Exception:
        c.rollback(); raise
    finally:
        c.close()

def rows(cur): return [dict(r) for r in cur.fetchall()]
def one(cur):
    r = cur.fetchone(); return dict(r) if r else None

def ok(data=None, error=None): return {'ok': error is None, 'data': data, 'error': error}
def require(role):
    def dep(x_role: Optional[str] = Header(None, alias='X-Role'),
            x_token: Optional[str] = Header(None, alias='X-Token')):
        if x_token not in TOKENS or TOKENS[x_token] != x_role:
            raise HTTPException(401, '未登录或会话失效')
        if role and x_role not in role and x_role != 'admin':
            raise HTTPException(403, '角色无权访问')
    return dep

def init_seed(c):
    """写入初始化基础数据（首次启动），与前端 seed.js 同口径"""
    if c.execute('SELECT COUNT(*) FROM clinic').fetchone()[0] > 0: return
    c.execute("INSERT INTO clinic(clinic_code,name) VALUES('CLINIC01','口腔诊所')")
    for code,name in [('预约类型','初诊'),('预约类型','复诊'),('支付方式','现金'),('支付方式','刷卡'),
                      ('支付方式','在线支付'),('通知渠道','短信'),('通知渠道','邮件'),
                      ('颜色','A1'),('颜色','A2'),('颜色','B1'),('盒子颜色','白色'),('盒子颜色','粉色'),
                      ('订单类型','牙冠'),('订单类型','义桥'),('单位','颗'),('单位','套'),
                      ('附件类型','口内照片'),('附件类型','牙模')]:
        c.execute("INSERT INTO basic_option(kind,code,name,sort_order) VALUES(?,?,?,?)",
                  (code, name[:6].upper(), name, 1))
    for no,name,role in [('E001','王前台','receptionist'),('E002','李医生','doctor'),
                         ('E003','张收费','cashier'),('E004','陈负责','manager')]:
        c.execute("INSERT INTO employee(clinic_id,employee_no,name) VALUES(1,?,?)",(no,name))
    c.execute("INSERT INTO clinic_room(clinic_id,room_code,name) VALUES(1,'R1','诊室一')")
    c.execute("INSERT INTO clinic_room(clinic_id,room_code,name) VALUES(1,'R2','诊室二')")
    for code,name,price in [('EXAM','口腔检查',50),('CLEAN','洁牙',200),('FILL','补牙',300),
                            ('CROWN','全瓷冠',1800),('EXTRACT','拔牙',150)]:
        c.execute("INSERT INTO price_item(item_code,name,unit_id,unit_price) VALUES(?,?,15,?)",(code,name,price))
    c.execute("INSERT INTO product(product_code,name,material,unit_id,requires_attachment) VALUES('P-CROWN','全瓷冠','二氧化锆',15,1)")
    c.execute("INSERT INTO product(product_code,name,material,unit_id,requires_attachment) VALUES('P-BRIDGE','固定桥','钴铬合金',15,1)")
    c.execute("INSERT INTO dental_lab(lab_code,name,contact,phone) VALUES('LAB01','合作技工所','刘工','13800000009')")
    for no,name,phone,note in [('P0001','张伟','13800000001','青霉素过敏'),
                                ('P0002','李娜','13800000002',''),
                                ('P0003','王强','13800000003','需复诊根管'),
                                ('P0004','赵敏','13800000004','')]:
        c.execute("INSERT INTO patient(patient_no,name,phone,important_note,created_by) VALUES(?,?,?,?,1)",
                  (no,name,phone,note))

@app.on_event('startup')
def startup():
    with db() as c:
        c.executescript(open(os.path.join(BASE,'schema.sql'),encoding='utf-8').read())
        init_seed(c)

@app.get('/')
def index(): return ok({'service':'口腔诊所管理系统 API','version':'1.0','docs':'/docs'})

@app.get('/api/health')
def health():
    with db() as c:
        counts = {t: c.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in
                  ['clinic','patient','appointment','encounter','bill','payment','dental_order','order_event','reminder']}
    return ok({'tables':20,'counts':counts})

# ---------------- 鉴权 ----------------
class LoginIn(BaseModel):
    username: str
    password: str

@app.post('/api/auth/login')
def login(body: LoginIn):
    u = USERS.get(body.username)
    if not u or u[0] != body.password:
        return ok(error='账号或密码错误')
    token = hashlib.sha256((body.username+now()+os.urandom(4).hex()).encode()).hexdigest()[:24]
    TOKENS[token] = u[1]
    return ok({'token':token,'username':body.username,'role':u[1],'name':u[2]})

# ---------------- 基础信息 ----------------
@app.get('/api/basic-options')
def list_options(kind: Optional[str] = None, _=require([])):
    with db() as c:
        q = 'SELECT * FROM basic_option WHERE active=1'
        p = []
        if kind: q += ' AND kind=?'; p.append(kind)
        q += ' ORDER BY kind, sort_order'
        return ok(rows(c.execute(q,p)))

@app.get('/api/basic/{table}')
def list_basic(table: str, _=require(['manager'])):
    allowed = {'clinic','clinic_room','employee','price_item','product','dental_lab','basic_option'}
    if table not in allowed: raise HTTPException(400,'不支持的表')
    with db() as c: return ok(rows(c.execute(f'SELECT * FROM {table}')))

# ---------------- 患者 / UC-01 ----------------
@app.get('/api/patients')
def list_patients(keyword: Optional[str]=None, start: Optional[str]=None, end: Optional[str]=None,
                  _=require(['receptionist','doctor'])):
    with db() as c:
        q='SELECT * FROM patient WHERE 1=1'; p=[]
        if keyword: q+=' AND (name LIKE ? OR phone LIKE ? OR patient_no LIKE ?)'; p += [f'%{keyword}%']*3
        if start: q+=' AND substr(created_at,1,10)>=?'; p.append(start)
        if end: q+=' AND substr(created_at,1,10)<=?'; p.append(end)
        q+=' ORDER BY id DESC'
        return ok(rows(c.execute(q,p)))

class PatientIn(BaseModel):
    name: str; phone: Optional[str]=None; birth_date: Optional[str]=None
    contact_name: Optional[str]=None; contact_phone: Optional[str]=None
    important_note: Optional[str]=None; pending: bool=False

@app.post('/api/patients')
def add_patient(body: PatientIn, _=require(['receptionist'])):
    with db() as c:
        mx = c.execute("SELECT MAX(CAST(REPLACE(patient_no,'P','') AS INTEGER)) m FROM patient").fetchone()['m'] or 0
        no = f'P{mx+1:04d}'
        cur = c.execute("""INSERT INTO patient(patient_no,name,phone,birth_date,contact_name,contact_phone,important_note,created_by)
                           VALUES(?,?,?,?,?,?,?,1)""",
                        (no,body.name,body.phone,body.birth_date,body.contact_name,body.contact_phone,body.important_note))
        return ok({'id':cur.lastrowid,'patient_no':no})

# ---------------- 预约 / UC-01 ----------------
@app.get('/api/appointments')
def list_appointments(scope: Optional[str]=None, start: Optional[str]=None, end: Optional[str]=None,
                      _=require(['receptionist','doctor'])):
    with db() as c:
        q='SELECT * FROM appointment WHERE 1=1'; p=[]
        if scope=='today': q+=' AND substr(starts_at,1,10)=?'; p.append(today())
        if scope=='tomorrow': q+=' AND substr(starts_at,1,10)=?'; p.append((datetime.now()+timedelta(days=1)).strftime('%Y-%m-%d'))
        if start: q+=' AND substr(starts_at,1,10)>=?'; p.append(start)
        if end: q+=' AND substr(starts_at,1,10)<=?'; p.append(end)
        q+=' ORDER BY starts_at'
        return ok(rows(c.execute(q,p)))

class ApptIn(BaseModel):
    patient_id:int; doctor_id:int; room_id:int; type_id:int
    starts_at:str; ends_at:str; chief_complaint:Optional[str]=None; stage:str='待确认'

@app.post('/api/appointments')
def add_appointment(body: ApptIn, _=require(['receptionist'])):
    """BR-01：同医生/诊室同秒段不能有两个有效预约（重叠判定），事务内检查"""
    with db() as c:
        if body.starts_at >= body.ends_at: return ok(error='starts_at 必须早于 ends_at')
        conflict = c.execute("""SELECT appointment_no FROM appointment
            WHERE stage IN ('待确认','已确认','已到诊') AND starts_at<? AND ends_at>?
              AND (doctor_id=? OR room_id=?)""",
            (body.ends_at, body.starts_at, body.doctor_id, body.room_id)).fetchall()
        if conflict: return ok(error='时段冲突：'+','.join(r['appointment_no'] for r in conflict))
        mx = c.execute("SELECT MAX(CAST(REPLACE(appointment_no,'A','') AS INTEGER)) m FROM appointment").fetchone()['m'] or 0
        no=f'A{mx+1:04d}'
        cur=c.execute("""INSERT INTO appointment(appointment_no,patient_id,doctor_id,room_id,type_id,
            chief_complaint,starts_at,ends_at,stage,created_by,confirmed_at)
            VALUES(?,?,?,?,?,?,?,?,?,1,?)""",
            (no,body.patient_id,body.doctor_id,body.room_id,body.type_id,body.chief_complaint,
             body.starts_at,body.ends_at,body.stage, now() if body.stage=='已确认' else None))
        return ok({'id':cur.lastrowid,'appointment_no':no})

class StageIn(BaseModel):
    stage:str; reason:Optional[str]=None

@app.patch('/api/appointments/{aid}')
def appointment_stage(aid:int, body:StageIn, _=require(['receptionist'])):
    with db() as c:
        a=one(c.execute('SELECT * FROM appointment WHERE id=?',(aid,)))
        if not a: return ok(error='预约不存在')
        field={'已确认':'confirmed_at','已到诊':'arrived_at','已完成':'completed_at',
               '已取消':'cancelled_at','爽约':'cancelled_at'}.get(body.stage)
        sets='stage=?'; p=[body.stage]
        if field: sets+=f',{field}=?'; p.append(now())
        if body.stage in ('已取消','爽约'): sets+=',cancel_reason=?'; p.append(body.reason or '')
        p.append(aid)
        c.execute(f'UPDATE appointment SET {sets} WHERE id=?',p)
        c.execute("""INSERT INTO appointment_event(appointment_id,changed_by,old_start,new_start,old_end,new_end,old_stage,new_stage,reason,occurred_at)
                     SELECT id,1,starts_at,starts_at,ends_at,ends_at,?,?,?,? FROM appointment WHERE id=?""",
                  (a['stage'],body.stage,body.reason or '',now(),aid))
        return ok({'id':aid,'stage':body.stage})

@app.get('/api/appointments/{aid}/history')
def appointment_history(aid:int, _=require(['receptionist','doctor'])):
    with db() as c: return ok(rows(c.execute('SELECT * FROM appointment_event WHERE appointment_id=?',(aid,))))

# ---------------- 诊疗 ----------------
@app.get('/api/encounters')
def list_encounters(_=require(['doctor'])):
    with db() as c: return ok(rows(c.execute('SELECT * FROM encounter ORDER BY id DESC')))

class EncounterIn(BaseModel):
    patient_id:int; doctor_id:int; appointment_id:Optional[int]=None
    occurred_at:str; chief_complaint:str; diagnosis:Optional[str]=None; treatment_note:Optional[str]=None

@app.post('/api/encounters')
def add_encounter(body: EncounterIn, _=require(['doctor'])):
    with db() as c:
        # 跨表一致性：诊疗关联预约时，患者/医生必须一致（8.7）
        if body.appointment_id:
            a=one(c.execute('SELECT * FROM appointment WHERE id=?',(body.appointment_id,)))
            if a and (a['patient_id']!=body.patient_id or a['doctor_id']!=body.doctor_id):
                return ok(error='关联预约的患者/医生与诊疗不一致')
        mx=c.execute("SELECT MAX(CAST(REPLACE(encounter_no,'EN','') AS INTEGER)) m FROM encounter").fetchone()['m'] or 0
        no=f'EN{mx+1:04d}'
        cur=c.execute("""INSERT INTO encounter(encounter_no,patient_id,clinic_id,doctor_id,appointment_id,
            occurred_at,chief_complaint,diagnosis,treatment_note,completed_at)
            VALUES(?,?,1,?,?,?,?,?,?,?)""",
            (no,body.patient_id,body.doctor_id,body.appointment_id,body.occurred_at,
             body.chief_complaint,body.diagnosis,body.treatment_note,body.occurred_at))
        return ok({'id':cur.lastrowid,'encounter_no':no})

# ---------------- 收费 / UC-02 ----------------
@app.get('/api/bills')
def list_bills(_=require(['cashier','manager'])):
    with db() as c: return ok(rows(c.execute('SELECT * FROM bill ORDER BY id DESC')))

def calc_bill(c, bid):
    b=one(c.execute('SELECT * FROM bill WHERE id=?',(bid,)))
    if not b: return None
    lines=rows(c.execute('SELECT * FROM bill_line WHERE bill_id=?',(bid,)))
    line_sum=sum(float(l['quantity'])*float(l['unit_price'])-float(l['discount_amount']) for l in lines)
    receivable=max(0,line_sum-float(b['discount_amount']))
    pays=rows(c.execute('SELECT * FROM payment WHERE bill_id=?',(bid,)))
    received=0
    for p in pays:
        if p['result']!='成功': continue
        received += float(p['amount']) * (1 if p['kind']=='收款' else -1)
    return {'receivable':receivable,'received':received,'debt':max(0,receivable-received),
            'lines':lines,'pays':pays,'bill':b}

class LineIn(BaseModel):
    price_item_id:int; item_name:str; quantity:float; unit_price:float
    discount_amount:float=0; dental_order_id:Optional[int]=None; unit:str='颗'
class BillIn(BaseModel):
    encounter_id:int; discount_amount:float=0; discount_reason:Optional[str]=None
    due_date:Optional[str]=None; lines:list[LineIn]

@app.post('/api/bills')
def add_bill(body: BillIn, _=require(['cashier'])):
    with db() as c:
        mx=c.execute("SELECT MAX(CAST(REPLACE(bill_no,'B','') AS INTEGER)) m FROM bill").fetchone()['m'] or 0
        no=f'B{mx+1:04d}'
        cur=c.execute("""INSERT INTO bill(bill_no,encounter_id,issued_by,discount_amount,discount_reason,due_date,stage)
                         VALUES(?,?,3,?,?,?,'欠款中')""",
                      (no,body.encounter_id,body.discount_amount,body.discount_reason,body.due_date))
        bid=cur.lastrowid
        for i,l in enumerate(body.lines,1):
            c.execute("""INSERT INTO bill_line(bill_id,line_no,price_item_id,dental_order_id,item_name,unit,quantity,unit_price,discount_amount)
                         VALUES(?,?,?,?,?,?,?,?,?)""",
                      (bid,i,l.price_item_id,l.dental_order_id,l.item_name,l.unit,l.quantity,l.unit_price,l.discount_amount))
        calc=calc_bill(c,bid)
        if calc['debt']>0: c.execute('UPDATE bill SET debt_opened_at=? WHERE id=?',(now(),bid))
        return ok({'id':bid,'bill_no':no,'calc':{k:calc[k] for k in ('receivable','received','debt')}})

@app.get('/api/bills/{bid}')
def bill_detail(bid:int, _=require(['cashier','manager'])):
    with db() as c:
        calc=calc_bill(c,bid)
        if not calc: return ok(error='收费单不存在')
        patient=one(c.execute("""SELECT p.* FROM patient p JOIN encounter e ON e.patient_id=p.id
                                 JOIN bill b ON b.encounter_id=e.id WHERE b.id=?""",(bid,)))
        return ok({**calc,'patient':patient})

class PayResultIn(BaseModel):
    result:str; external_txn_no:Optional[str]=None; failure_reason:Optional[str]=None; amount:Optional[float]=None

@app.post('/api/payments')
def add_payment(bill_id:int, body:PayResultIn, _=require(['cashier'])):
    with db() as c:
        mx=c.execute("SELECT MAX(CAST(REPLACE(request_no,'REQ','') AS INTEGER)) m FROM payment").fetchone()['m'] or 0
        no=f'REQ{mx+1:04d}'
        amount=body.amount if body.amount is not None else calc_bill(c,bill_id)['debt']
        cur=c.execute("""INSERT INTO payment(bill_id,request_no,method_id,kind,result,amount,external_txn_no,
                         failure_reason,occurred_at,checked_at) VALUES(?,?,3,'收款',?,?,?,?,?,?)""",
                      (bill_id,no,body.result,amount,body.external_txn_no,body.failure_reason,
                       now() if body.result=='成功' else None,now()))
        sync_bill(c,bill_id)
        return ok({'id':cur.lastrowid,'request_no':no})

def sync_bill(c,bid):
    calc=calc_bill(c,bid)
    if calc['debt']<=0:
        c.execute("UPDATE bill SET stage='已结清',settled_at=? WHERE id=?",(now(),bid))
    else:
        c.execute("UPDATE bill SET stage='欠款中',settled_at=NULL WHERE id=?",(bid,))

@app.patch('/api/payments/{pid}')
def payment_result(pid:int, body:PayResultIn, _=require(['cashier'])):
    with db() as c:
        p=one(c.execute('SELECT * FROM payment WHERE id=?',(pid,)))
        if not p: return ok(error='支付记录不存在')
        c.execute("""UPDATE payment SET result=?,external_txn_no=?,failure_reason=?,occurred_at=?,checked_at=? WHERE id=?""",
                  (body.result,body.external_txn_no or p['external_txn_no'],body.failure_reason,now(),now(),pid))
        sync_bill(c,p['bill_id'])
        return ok({'id':pid,'result':body.result})

@app.get('/api/debts')
def list_debts(_=require(['cashier','manager'])):
    with db() as c:
        result=[]
        for b in rows(c.execute("SELECT * FROM bill WHERE stage!='已作废' ORDER BY id DESC")):
            calc=calc_bill(c,b['id'])
            if calc['debt']>0:
                patient=one(c.execute("""SELECT p.* FROM patient p JOIN encounter e ON e.patient_id=p.id
                                         JOIN bill b ON b.encounter_id=e.id WHERE b.id=?""",(b['id'],)))
                result.append({'bill':b,'receivable':calc['receivable'],'received':calc['received'],
                               'debt':calc['debt'],'patient':patient})
        return ok(result)

# ---------------- 义齿订单 / UC-03 ----------------
LEGAL = {'草稿':['已发送','已取消'],'已发送':['已接收','已取消'],'已接收':['试戴'],
         '试戴':['质量确认','返工'],'返工':['试戴'],'质量确认':['已交货'],
         '已交货':['返工'],'取消':[]}

@app.get('/api/orders')
def list_orders(scope: Optional[str]=None, _=require(['doctor','receptionist','manager'])):
    with db() as c:
        q='SELECT * FROM dental_order WHERE 1=1'; p=[]
        if scope=='trial': q+=" AND stage IN ('试戴','质量确认')"
        if scope=='delivered': q+=" AND stage='已交货'"
        if scope=='overdue': q+=" AND promised_date<? AND stage NOT IN ('已交货','取消')"; p.append(today())
        q+=' ORDER BY id DESC'
        return ok(rows(c.execute(q,p)))

class OrderIn(BaseModel):
    encounter_id:int; product_id:int; lab_id:int; color_id:int; type_id:int; unit_id:int
    box_color_id:Optional[int]=None; quantity:float; repair_requirement:str
    promised_date:str; teeth:list[str]=[]; attachments:list[dict]=[]

@app.post('/api/orders')
def create_order(body: OrderIn, _=require(['doctor'])):
    with db() as c:
        mx=c.execute("SELECT MAX(CAST(REPLACE(order_no,'DO','') AS INTEGER)) m FROM dental_order").fetchone()['m'] or 0
        no=f'DO{mx+1:04d}'
        cur=c.execute("""INSERT INTO dental_order(order_no,encounter_id,product_id,lab_id,created_by,color_id,
            box_color_id,type_id,unit_id,quantity,repair_requirement,promised_date,stage)
            VALUES(?,?,?,?,2,?,?,?,?,?,?,?,'草稿')""",
            (no,body.encounter_id,body.product_id,body.lab_id,body.color_id,body.box_color_id,
             body.type_id,body.unit_id,body.quantity,body.repair_requirement,body.promised_date))
        oid=cur.lastrowid
        for t in body.teeth:
            c.execute('INSERT INTO order_tooth(order_id,tooth_code) VALUES(?,?)',(oid,t))
        import uuid
        for i,a in enumerate(body.attachments):
            c.execute("""INSERT INTO order_attachment(order_id,type_id,uploaded_by,file_name,storage_key,mime_type,byte_size)
                         VALUES(?,?,2,?,?,?,?)""",
                      (oid,a.get('type_id',17),a.get('file_name','附件'),f"att/{oid}/{uuid.uuid4().hex}",
                       'application/octet-stream',1024))
        c.execute("""INSERT INTO order_event(order_id,source,event_no,changed_by,old_stage,new_stage,reason,occurred_at,received_at)
                     VALUES(?,'system',?,2,'','草稿','建立草稿',?,?)""",(oid,'EV'+uuid.uuid4().hex[:10],now(),now()))
        return ok({'id':oid,'order_no':no})

@app.post('/api/orders/{oid}/send')
def send_order(oid:int, _=require(['doctor'])):
    with db() as c:
        o=one(c.execute('SELECT * FROM dental_order WHERE id=?',(oid,)))
        if not o: return ok(error='订单不存在')
        if o['stage']!='草稿': return ok(error='仅草稿可发送')
        teeth=c.execute('SELECT COUNT(*) n FROM order_tooth WHERE order_id=?',(oid,)).fetchone()['n']
        if teeth<1: return ok(error='发送前至少一个有效牙位')
        prod=one(c.execute('SELECT * FROM product WHERE id=?',(o['product_id'],)))
        atts=c.execute('SELECT COUNT(*) n FROM order_attachment WHERE order_id=?',(oid,)).fetchone()['n']
        if prod and prod['requires_attachment'] and atts<1: return ok(error='该产品必须附带必要附件')
        c.execute("UPDATE dental_order SET stage='已发送',sent_at=? WHERE id=?",(now(),oid))
        import uuid
        c.execute("""INSERT INTO order_event(order_id,source,event_no,changed_by,old_stage,new_stage,reason,occurred_at,received_at)
                     VALUES(?,'doctor',?,2,'草稿','已发送','医生确认发送',?,?)""",(oid,'EV'+uuid.uuid4().hex[:10],now(),now()))
        return ok({'id':oid,'stage':'已发送'})

class EventIn(BaseModel):
    source:str='lab'; event_no:Optional[str]=None; new_stage:str
    reason:Optional[str]=None; external_order_no:Optional[str]=None; trial_result:Optional[str]=None

@app.post('/api/orders/{oid}/events')
def order_event(oid:int, body:EventIn, _=require(['doctor'])):
    """技工所回执：来源+事件号去重；状态机校验；事务内更新"""
    import uuid
    with db() as c:
        o=one(c.execute('SELECT * FROM dental_order WHERE id=?',(oid,)))
        if not o: return ok(error='订单不存在')
        ev=body.event_no or 'EV'+uuid.uuid4().hex[:10]
        if c.execute('SELECT 1 FROM order_event WHERE order_id=? AND source=? AND event_no=?',
                     (oid,body.source,ev)).fetchone():
            return ok(error='重复回执，已忽略')
        old=o['stage']
        if body.new_stage not in LEGAL.get(old,[]):
            return ok(error=f'不允许的状态转换：{old} → {body.new_stage}')
        c.execute("""INSERT INTO order_event(order_id,source,event_no,changed_by,old_stage,new_stage,reason,external_order_no,occurred_at,received_at)
                     VALUES(?,?,?,NULL,?,?,?,?,?,?)""",
                  (oid,body.source,ev,old,body.new_stage,body.reason,body.external_order_no,now(),now()))
        sets='stage=?'; p=[body.new_stage]
        if body.new_stage=='已接收': sets+=',accepted_at=?,dispatch_result=?'; p += [now(),'已接收']
        if body.new_stage=='试戴': sets+=',trial_at=?,trial_result=?'; p += [now(),body.trial_result or o['trial_result']]
        p.append(oid)
        c.execute(f'UPDATE dental_order SET {sets} WHERE id=?',p)
        return ok({'id':oid,'stage':body.new_stage})

@app.patch('/api/orders/{oid}/stage')
def order_stage(oid:int, body:StageIn, _=require(['doctor','receptionist'])):
    import uuid
    with db() as c:
        o=one(c.execute('SELECT * FROM dental_order WHERE id=?',(oid,)))
        if not o: return ok(error='订单不存在')
        old=o['stage']
        if body.stage not in LEGAL.get(old,[]):
            return ok(error=f'不允许的状态转换：{old} → {body.stage}')
        sets='stage=?'; p=[body.stage]
        if body.stage=='试戴': sets+=',trial_at=?'; p.append(now())
        if body.stage=='已交货': sets+=',delivered_at=?'; p.append(now())
        if body.stage=='取消': sets+=',cancelled_at=?,cancel_reason=?'; p += [now(),body.reason or '']
        p.append(oid)
        c.execute(f'UPDATE dental_order SET {sets} WHERE id=?',p)
        c.execute("""INSERT INTO order_event(order_id,source,event_no,changed_by,old_stage,new_stage,reason,occurred_at,received_at)
                     VALUES(?,'doctor',?,2,?,?,?,?,?)""",
                  (oid,'EV'+uuid.uuid4().hex[:10],old,body.stage,body.reason,now(),now()))
        return ok({'id':oid,'stage':body.stage})

@app.get('/api/orders/{oid}/events')
def get_order_events(oid:int, _=require(['doctor','receptionist','manager'])):
    with db() as c: return ok(rows(c.execute('SELECT * FROM order_event WHERE order_id=? ORDER BY occurred_at',(oid,))))

# ---------------- 提醒 / UC-04 ----------------
@app.get('/api/reminders')
def list_reminders(_=require(['manager','receptionist'])):
    with db() as c: return ok(rows(c.execute('SELECT * FROM reminder ORDER BY scheduled_at')))

@app.post('/api/reminders/{rid}/send')
def send_reminder(rid:int, _=require(['receptionist','manager'])):
    with db() as c:
        r=one(c.execute('SELECT * FROM reminder WHERE id=?',(rid,)))
        if not r: return ok(error='提醒不存在')
        if r['delivery_result']=='已发送': return ok(error='该提醒已发送')
        c.execute("""UPDATE reminder SET delivery_result='已发送',attempt_count=attempt_count+1,sent_at=?,last_attempt_at=? WHERE id=?""",
                  (now(),now(),rid))
        return ok({'id':rid,'delivery_result':'已发送'})

# ---------------- 统计 / UC-04（表24 口径） ----------------
@app.get('/api/reports/summary')
def report_summary(start:str, end:str, _=require(['manager'])):
    with db() as c:
        # 预约兑现率
        appts=rows(c.execute("SELECT * FROM appointment WHERE substr(starts_at,1,10)>=? AND substr(starts_at,1,10)<=?",(start,end)))
        closed=[a for a in appts if a['stage'] in ('已确认','已到诊','已完成','爽约')]
        fulfilled=[a for a in appts if a['stage'] in ('已到诊','已完成')]
        fulfill=len(fulfilled)/len(closed) if closed else None
        # 确认周期中位数
        conf=rows(c.execute("SELECT created_at,confirmed_at FROM appointment WHERE confirmed_at IS NOT NULL AND substr(confirmed_at,1,10)>=? AND substr(confirmed_at,1,10)<=?",(start,end)))
        def mins(a,b):
            return (datetime.fromisoformat(b)-datetime.fromisoformat(a)).total_seconds()/60
        cyc=sorted(mins(a['created_at'],a['confirmed_at']) for a in conf)
        median=cyc[len(cyc)//2] if cyc else None
        # 欠款回收率（期初队列）
        bills=rows(c.execute("SELECT * FROM bill WHERE debt_opened_at IS NOT NULL AND substr(debt_opened_at,1,10)<=?",(end,)))
        initial=0; recovered=0
        for b in bills:
            calc=calc_bill(c,b['id']); initial+=calc['receivable']
            pays=rows(c.execute("""SELECT * FROM payment WHERE bill_id=? AND result='成功'
                                   AND substr(COALESCE(occurred_at,requested_at),1,10)>=? AND substr(COALESCE(occurred_at,requested_at),1,10)<=?""",
                                (b['id'],start,end)))
            got=sum(float(p['amount'])*(1 if p['kind']=='收款' else -1) for p in pays)
            recovered+=max(0,got)
        recovery=recovered/initial if initial else None
        # 订单按期交付率
        due=rows(c.execute("""SELECT * FROM dental_order WHERE promised_date>=? AND promised_date<=? AND promised_date<?
                              AND stage IN ('已发送','已接收','试戴','质量确认','返工')""",(start,end,today())))
        done=rows(c.execute("""SELECT * FROM dental_order WHERE promised_date>=? AND promised_date<=? AND stage='已交货'""",(start,end)))
        ontime=[o for o in done if o['delivered_at'] and o['delivered_at'][:10]<=o['promised_date']]
        ontime_rate=len(ontime)/(len(done)+len(due)) if (done or due) else None
        # 关联完整度
        bill_ids=[r['id'] for r in c.execute('SELECT id FROM bill')]
        order_ids=[r['id'] for r in c.execute('SELECT id FROM dental_order')]
        checks=[('收费单',i,bool(c.execute("""SELECT 1 FROM bill b JOIN encounter e ON e.id=b.encounter_id
                 JOIN patient p ON p.id=e.patient_id WHERE b.id=?""",(i,)).fetchone())) for i in bill_ids]
        checks += [('义齿订单',i,bool(c.execute("""SELECT 1 FROM dental_order o JOIN encounter e ON e.id=o.encounter_id
                 JOIN patient p ON p.id=e.patient_id WHERE o.id=?""",(i,)).fetchone())
                    and c.execute('SELECT 1 FROM order_event WHERE order_id=? LIMIT 1',(i,)).fetchone() is not None)
                   for i in order_ids]
        complete=sum(1 for _,_,v in checks if v)/len(checks) if checks else None
        NA='无可计算样本'
        def pct(v): return NA if v is None else f'{v*100:.1f}%'
        metrics=[
            {'key':'appointmentConfirmMedian','name':'预约确认周期中位数','value':NA if median is None else f'{median:.1f} 分钟','sample':len(cyc)},
            {'key':'fulfillment','name':'预约兑现率','value':pct(fulfill),'sample':len(closed),'numerator':len(fulfilled),'denominator':len(closed)},
            {'key':'recovery','name':'欠款回收率','value':pct(recovery),'sample':len(bills),'numerator':round(recovered,2),'denominator':round(initial,2)},
            {'key':'onTime','name':'订单按期交付率','value':pct(ontime_rate),'sample':len(done)+len(due),'numerator':len(ontime),'denominator':len(done)+len(due)},
            {'key':'completeness','name':'记录关联完整度','value':pct(complete),'sample':len(checks),'numerator':sum(1 for _,_,v in checks if v),'denominator':len(checks)},
        ]
        anomalies=[{'type':t,'id':i,'problem':'无法关联有效患者或必要明细'} for t,i,v in checks if not v]
        overdue=rows(c.execute("SELECT * FROM dental_order WHERE promised_date<? AND stage NOT IN ('已交货','取消')",(today(),)))
        trial=rows(c.execute("SELECT * FROM dental_order WHERE stage IN ('试戴','质量确认')"))
        delivered=rows(c.execute("SELECT * FROM dental_order WHERE stage='已交货'"))
        return ok({'start':start,'end':end,'metrics':metrics,'anomalies':anomalies,
                   'overdue':overdue,'trial':trial,'delivered':delivered})
