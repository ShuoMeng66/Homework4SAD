/* ============================================================
 * api.js — 数据访问层与业务规则引擎
 * 强制服务器模式：数据只存服务器 SQLite，浏览器仅持内存读缓存；
 * 登录经服务器校验；需要全局一致视角的规则（BR-01/03/04/06、表24）
 * 由后端 /api/compute/* 权威计算，其余简单 CRUD 在前端完成。
 * ============================================================ */
(function () {
  const SESSION = 'clinic_session_v1';
  const REMOTE_BASE = (window.CLINIC_CONFIG && window.CLINIC_CONFIG.apiBase) ||
    'https://api.smart-oscc-ai.top/clinic-api';

  let DB = null;                 // 内存读缓存，来源始终是服务器
  let writeChain = Promise.resolve();
  let writeTimer = null;
  let writeError = null;

  function enqueueWrite() {
    writeTimer = null;
    writeChain = writeChain.then(async () => {
      const res = await fetch(REMOTE_BASE + '/db', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(DB),
      });
      const r = await res.json();
      if (!r.ok) throw new Error(r.error || '保存失败');
      writeError = null;
    }).catch(e => {
      writeError = e;
      if (window.App && App.toast) App.toast('数据保存到服务器失败：' + e.message, 'err');
    });
  }

  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
  function now() { return new Date().toISOString().slice(0, 16); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function load() {
    if (!DB) throw new Error('数据尚未从服务器加载，请重新登录');
    return DB;
  }
  // 所有写操作：先更新内存，再异步、串行地把整库表数据 PUT 回服务器
  function save(db) {
    DB = db;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(enqueueWrite, 100);
  }
  function nextId(arr) { return arr.length ? Math.max(...arr.map(x => Number(x.id) || 0)) + 1 : 1; }
  function nextNo(arr, field, prefix) {
    const max = arr.reduce((m, x) => {
      const n = parseInt(String(x[field] || '').replace(/\D/g, ''), 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    return prefix + String(max + 1).padStart(4, '0');
  }

  // 期间筛选：[start,end] 对日期时间字符串按前缀比较
  function inRange(value, start, end) {
    if (!value) return false;
    const v = String(value).slice(0, 10);
    if (start && v < start) return false;
    if (end && v > end) return false;
    return true;
  }

  const API = {
    /* ---------- 会话（服务器校验） ---------- */
    async login(username, password) {
      try {
        const res = await fetch(REMOTE_BASE + '/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const r = await res.json();
        if (!r.ok) return { ok: false, error: r.error || '服务器拒绝登录' };
        const d = r.data;
        const session = { username: d.username, role: d.role, name: d.name,
                          patientId: d.patientId,
                          token: d.token, loginAt: now() };
        localStorage.setItem(SESSION, JSON.stringify(session));
        return { ok: true, data: session };
      } catch (e) {
        return { ok: false, error: '无法连接服务器：' + e.message };
      }
    },
    logout() { localStorage.removeItem(SESSION); DB = null; },
    session() {
      try { return JSON.parse(localStorage.getItem(SESSION)); } catch (e) { return null; }
    },
    can(module) {
      const s = this.session();
      if (!s) return false;
      return (window.SEED.ROLE_MODULES[s.role] || []).includes(module);
    },

    // 启动时从服务器拉取整库；服务器为空则推送种子数据完成初始化
    async connect() {
      try {
        const res = await fetch(REMOTE_BASE + '/db', { cache: 'no-store' });
        const r = await res.json();
        if (!r.ok) throw new Error(r.error || '读取服务器数据失败');
        DB = r.data;
        if (!DB || !Object.keys(DB).length) {
          DB = window.SEED.clone();
          const put = await fetch(REMOTE_BASE + '/db', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(DB),
          });
          const pr = await put.json();
          if (!pr.ok) throw new Error(pr.error || '初始化服务器数据失败');
        }
        return { ok: true, tables: Object.keys(DB).length };
      } catch (e) {
        return { ok: false, error: '无法连接服务器：' + e.message };
      }
    },
    // 等待所有挂起的写入真正落库
    async flush() {
      if (writeTimer) { clearTimeout(writeTimer); enqueueWrite(); }
      await writeChain;
      return !writeError;
    },
    raw() { return load(); },

    /* ---------- 基础信息 ---------- */
    listOptions(kind) {
      const db = load();
      return db.basicOptions.filter(o => (!kind || o.kind === kind) && o.active)
        .sort((a, b) => a.sort_order - b.sort_order);
    },
    allOptions() { return load().basicOptions.slice(); },
    upsertOption(opt) {
      const db = load();
      if (opt.id) {
        const i = db.basicOptions.findIndex(o => o.id === opt.id);
        if (i >= 0) db.basicOptions[i] = Object.assign({}, db.basicOptions[i], opt);
      } else {
        opt.id = nextId(db.basicOptions);
        db.basicOptions.push(opt);
      }
      save(db); return opt;
    },
    toggleOption(id) {
      const db = load();
      const o = db.basicOptions.find(x => x.id === id);
      if (o) { o.active = !o.active; save(db); }
      return o;
    },
    listSimple(table) { return (load()[table] || []).slice(); },
    upsertSimple(table, row) {
      const db = load();
      if (!db[table]) db[table] = [];
      if (row.id) {
        const i = db[table].findIndex(o => o.id === row.id);
        if (i >= 0) db[table][i] = Object.assign({}, db[table][i], row);
        else db[table].push(row);
      } else { row.id = nextId(db[table]); db[table].push(row); }
      save(db); return row;
    },

    /* ---------- 患者 F2 / UC-01 ---------- */
    listPatients(q = {}) {
      const db = load();
      return db.patients.filter(p => {
        if (q.keyword) {
          const k = q.keyword.toLowerCase();
          if (![p.name, p.phone, p.patient_no].some(v => String(v || '').toLowerCase().includes(k))) return false;
        }
        if (q.start && String(p.created_at).slice(0, 10) < q.start) return false;
        if (q.end && String(p.created_at).slice(0, 10) > q.end) return false;
        return true;
      }).sort((a, b) => b.id - a.id);
    },
    addPatient(p) {
      const db = load();
      const row = Object.assign({}, p, {
        id: nextId(db.patients),
        patient_no: nextNo(db.patients, 'patient_no', 'P'),
        created_at: now(), updated_at: now(), created_by: this.session()?.username === 'doctor' ? 2 : 1,
        pending: !!p.pending,
      });
      db.patients.push(row); save(db); return row;
    },
    updatePatient(id, patch) {
      const db = load(); const p = db.patients.find(x => x.id === id);
      if (!p) return null; Object.assign(p, patch, { updated_at: now() }); save(db); return p;
    },

    /* ---------- 预约 F4 / UC-01 ---------- */
    listAppointments(q = {}) {
      const db = load();
      let list = db.appointments.slice();
      const t = today();
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      if (q.scope === 'today') list = list.filter(a => String(a.starts_at).slice(0, 10) === t);
      if (q.scope === 'tomorrow') list = list.filter(a => String(a.starts_at).slice(0, 10) === tomorrow);
      if (q.start && q.end) list = list.filter(a => inRange(a.starts_at, q.start, q.end));
      if (q.doctor_id) list = list.filter(a => a.doctor_id == q.doctor_id);
      return list.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
    },
    // BR-01：医生/诊室同一时段不能有两个有效预约（重叠：newStart<oldEnd 且 newEnd>oldStart）
    checkConflict(doctor_id, room_id, starts_at, ends_at, excludeId) {
      const db = load();
      const activeStages = ['待确认', '已确认', '已到诊'];
      const conflicts = db.appointments.filter(a =>
        a.id !== excludeId && activeStages.includes(a.stage) &&
        ((doctor_id && a.doctor_id == doctor_id) || (room_id && a.room_id == room_id)) &&
        (starts_at < a.ends_at && ends_at > a.starts_at)
      );
      if (!conflicts.length) return { ok: true, candidates: [] };
      // 候选时段：同医生同诊室当日 30 分钟空档
      const date = String(starts_at).slice(0, 10);
      const dayApts = db.appointments.filter(a => String(a.starts_at).slice(0, 10) === date && activeStages.includes(a.stage));
      const candidates = [];
      for (let h = 8; h <= 17; h++) for (const m of ['00', '30']) {
        const s = `${date}T${String(h).padStart(2, '0')}:${m}`;
        const e = `${date}T${String(h + (m === '30' ? 1 : 0)).padStart(2, '0')}:${m === '30' ? '00' : '30'}`;
        const busy = dayApts.some(a => s < a.ends_at && e > a.starts_at);
        if (!busy) candidates.push(s);
      }
      return { ok: false, conflicts, candidates: candidates.slice(0, 6) };
    },
    addAppointment(a) {
      const db = load();
      const row = Object.assign({}, a, {
        id: nextId(db.appointments),
        appointment_no: nextNo(db.appointments, 'appointment_no', 'A'),
        created_at: now(), confirmed_at: a.stage === '已确认' ? now() : null,
        arrived_at: null, completed_at: null, cancelled_at: null, cancel_reason: a.cancel_reason || null,
      });
      db.appointments.push(row); save(db); return row;
    },
    changeAppointmentStage(id, newStage, reason) {
      const db = load(); const a = db.appointments.find(x => x.id === id);
      if (!a) return { ok: false, error: '预约不存在' };
      const old = a.stage;
      a.stage = newStage;
      if (newStage === '已确认') a.confirmed_at = now();
      if (newStage === '已到诊') a.arrived_at = now();
      if (newStage === '已完成') a.completed_at = now();
      if (newStage === '已取消' || newStage === '爽约') { a.cancelled_at = now(); a.cancel_reason = reason || ''; }
      db.appointmentEvents.push({
        id: nextId(db.appointmentEvents), appointment_id: a.id,
        changed_by: 1, old_start: a.starts_at, new_start: a.starts_at,
        old_end: a.ends_at, new_end: a.ends_at, old_stage: old, new_stage: newStage,
        reason: reason || '', occurred_at: now(),
      });
      save(db); return { ok: true, data: a };
    },
    reschedule(id, starts_at, ends_at, reason) {
      const db = load(); const a = db.appointments.find(x => x.id === id);
      if (!a) return { ok: false, error: '预约不存在' };
      // 冲突已由调用方通过 /compute/conflict 在服务器侧判定，这里只记录变更并落库
      db.appointmentEvents.push({
        id: nextId(db.appointmentEvents), appointment_id: a.id, changed_by: 1,
        old_start: a.starts_at, new_start: starts_at, old_end: a.ends_at, new_end: ends_at,
        old_stage: a.stage, new_stage: a.stage, reason: reason || '改约', occurred_at: now(),
      });
      a.starts_at = starts_at; a.ends_at = ends_at; save(db); return { ok: true, data: a };
    },
    appointmentHistory(id) { return load().appointmentEvents.filter(e => e.appointment_id == id); },

    /* ---------- 诊疗 ---------- */
    listEncounters() { return load().encounters.slice().sort((a, b) => b.id - a.id); },
    addEncounter(e) {
      const db = load();
      const row = Object.assign({}, e, {
        id: nextId(db.encounters), encounter_no: nextNo(db.encounters, 'encounter_no', 'EN'),
        created_at: now(), completed_at: e.completed_at || null,
      });
      db.encounters.push(row); save(db); return row;
    },

    /* ---------- 收费 F3 / UC-02 ---------- */
    listBills() { return load().bills.slice().sort((a, b) => b.id - a.id); },
    billLines(billId) { return load().billLines.filter(l => l.bill_id == billId); },
    payments(billId) { return load().payments.filter(p => p.bill_id == billId); },
    // BR-03：应收=行合计(数量*单价-行折扣)-整单折扣；有效已收=成功收款-成功退款
    calcBill(billId) {
      const db = load();
      const bill = db.bills.find(b => b.id == billId);
      if (!bill) return null;
      const lines = db.billLines.filter(l => l.bill_id == billId);
      const lineSum = lines.reduce((s, l) => s + (Number(l.quantity) * Number(l.unit_price) - Number(l.discount_amount || 0)), 0);
      const receivable = Math.max(0, lineSum - Number(bill.discount_amount || 0));
      const pays = db.payments.filter(p => p.bill_id == billId);
      let received = 0;
      pays.forEach(p => {
        if (p.result !== '成功') return;
        if (p.kind === '收款') received += Number(p.amount);
        if (p.kind === '退款') received -= Number(p.amount);
      });
      return { receivable, received, debt: Math.max(0, receivable - received), lines, pays };
    },
    addBill(payload) {
      const db = load();
      // 3a 重复收费：同诊疗+同项目金额+当日 拒绝
      const dup = db.bills.find(b => b.encounter_id == payload.encounter_id &&
        String(b.issued_at).slice(0, 10) === today() && b.stage !== '已作废');
      if (dup && payload.strictDup) return { ok: false, error: '检测到重复收费，已拒绝提交' };
      const bill = {
        id: nextId(db.bills), bill_no: nextNo(db.bills, 'bill_no', 'B'),
        encounter_id: Number(payload.encounter_id), issued_by: 3,
        discount_amount: Number(payload.discount_amount || 0), discount_reason: payload.discount_reason || '',
        issued_at: now(), due_date: payload.due_date || null, debt_opened_at: null, settled_at: null,
        collection_note: '', stage: '欠款中', voided_at: null, void_reason: null,
      };
      db.bills.push(bill);
      (payload.lines || []).forEach((l, i) => {
        db.billLines.push({
          id: nextId(db.billLines), bill_id: bill.id, line_no: i + 1,
          price_item_id: Number(l.price_item_id), dental_order_id: l.dental_order_id || null,
          item_name: l.item_name, unit: l.unit || '颗',
          quantity: Number(l.quantity || 1), unit_price: Number(l.unit_price || 0),
          discount_amount: Number(l.discount_amount || 0), description: l.description || '',
        });
      });
      if (payload.payment && Number(payload.payment.amount) > 0) {
        db.payments.push({
          id: nextId(db.payments), bill_id: bill.id,
          request_no: nextNo(db.payments, 'request_no', 'REQ'), external_txn_no: null,
          method_id: Number(payload.payment.method_id || 3), refund_of_id: null,
          kind: '收款', result: payload.payment.result || '待确认',
          amount: Number(payload.payment.amount), requested_at: now(), occurred_at: null,
          failure_reason: null, checked_at: null,
        });
      }
      // debt_opened_at：首次欠款形成时刻
      const calc = this.calcBill(bill.id);
      if (calc.debt > 0) bill.debt_opened_at = now();
      save(db); return { ok: true, data: bill };
    },
    recordPaymentResult(paymentId, result, externalTxnNo, failureReason) {
      const db = load(); const p = db.payments.find(x => x.id == paymentId);
      if (!p) return { ok: false, error: '支付记录不存在' };
      p.result = result; p.occurred_at = now(); p.checked_at = now();
      p.external_txn_no = externalTxnNo || p.external_txn_no;
      p.failure_reason = failureReason || null;
      const bill = db.bills.find(b => b.id == p.bill_id);
      const calc = this.calcBill(p.bill_id);
      if (calc.debt <= 0 && bill) { bill.stage = '已结清'; bill.settled_at = now(); }
      else if (bill) { bill.stage = '欠款中'; bill.settled_at = null; }
      save(db); return { ok: true, data: p };
    },
    listDebts() {
      const db = load();
      return db.bills.map(b => {
        const c = this.calcBill(b.id);
        const patient = this.patientOfBill(b.id);
        return { bill: b, ...c, patient };
      }).filter(x => x.debt > 0);
    },
    patientOfBill(billId) {
      const db = load();
      const b = db.bills.find(x => x.id == billId);
      if (!b) return null;
      const enc = db.encounters.find(e => e.id == b.encounter_id);
      if (!enc) return null;
      return db.patients.find(p => p.id == enc.patient_id) || null;
    },
    traceBill(billId) {
      const db = load();
      const b = db.bills.find(x => x.id == billId);
      const enc = db.encounters.find(e => e.id == b?.encounter_id);
      const patient = db.patients.find(p => p.id == enc?.patient_id);
      return { bill: b, encounter: enc, patient, lines: this.billLines(billId), payments: this.payments(billId), calc: this.calcBill(billId) };
    },

    /* ---------- 义齿订单 F5 / UC-03 ---------- */
    listOrders(q = {}) {
      const db = load(); let list = db.orders.slice();
      if (q.stage) list = list.filter(o => o.stage === q.stage);
      if (q.scope === 'trial') list = list.filter(o => ['试戴', '质量确认'].includes(o.stage));
      if (q.scope === 'delivered') list = list.filter(o => o.stage === '已交货');
      if (q.scope === 'overdue') list = list.filter(o => o.promised_date && o.promised_date < today() && o.stage !== '已交货' && o.stage !== '取消');
      return list.sort((a, b) => b.id - a.id);
    },
    patientOfOrder(orderId) {
      const db = load(); const o = db.orders.find(x => x.id == orderId);
      const enc = db.encounters.find(e => e.id == o?.encounter_id);
      return db.patients.find(p => p.id == enc?.patient_id) || null;
    },
    orderTeeth(id) { return load().orderTooths.filter(t => t.order_id == id); },
    orderEvents(id) { return load().orderEvents.filter(e => e.order_id == id).sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at))); },
    orderAttachments(id) { return load().orderAttachments.filter(a => a.order_id == id); },
    createOrderDraft(payload) {
      const db = load();
      const row = Object.assign({}, payload, {
        id: nextId(db.orders), order_no: nextNo(db.orders, 'order_no', 'DO'),
        stage: '草稿', dispatch_result: '', expected_at: null,
        sent_at: null, accepted_at: null, trial_at: null, trial_result: null,
        delivered_at: null, cancelled_at: null, cancel_reason: null, created_at: now(),
        created_by: 2,
      });
      db.orders.push(row);
      (payload.teeth || []).forEach(t => db.orderTooths.push({ order_id: row.id, tooth_code: t.tooth_code, repair_note: t.repair_note || '' }));
      (payload.attachments || []).forEach(a => db.orderAttachments.push({
        id: nextId(db.orderAttachments), order_id: row.id,
        type_id: Number(a.type_id || 17), uploaded_by: 2, file_name: a.file_name || '附件',
        storage_key: 'att/' + row.id + '/' + Date.now(), mime_type: a.mime_type || 'application/octet-stream',
        byte_size: Number(a.byte_size || 1024), checksum: null, uploaded_at: now(),
      }));
      // 草稿建立即记首条进展（PDF 6.4）
      db.orderEvents.push({
        id: nextId(db.orderEvents), order_id: row.id, source: 'system', event_no: 'EVT' + Date.now(),
        changed_by: 2, old_stage: '', new_stage: '草稿', reason: '建立草稿', external_order_no: '',
        occurred_at: now(), received_at: now(),
      });
      save(db); return { ok: true, data: row };
    },
    // 表17：草稿→已发送 条件
    sendOrder(id) {
      const db = load(); const o = db.orders.find(x => x.id == id);
      if (!o) return { ok: false, error: '订单不存在' };
      if (o.stage !== '草稿') return { ok: false, error: '仅草稿可发送' };
      const teeth = db.orderTooths.filter(t => t.order_id == id);
      if (!o.product_id || !o.quantity || teeth.length < 1) return { ok: false, error: '需先选择产品、数量和至少一个牙位' };
      const prod = db.products.find(p => p.id == o.product_id);
      const atts = db.orderAttachments.filter(a => a.order_id == id);
      if (prod?.requires_attachment && atts.length < 1) return { ok: false, error: '该产品必须附带必要附件' };
      o.stage = '已发送'; o.sent_at = now();
      db.orderEvents.push({
        id: nextId(db.orderEvents), order_id: id, source: 'doctor', event_no: 'EVT' + Date.now(),
        changed_by: 2, old_stage: '草稿', new_stage: '已发送', reason: '医生确认发送',
        external_order_no: '', occurred_at: now(), received_at: now(),
      });
      save(db); return { ok: true, data: o };
    },
    // 技工所回执：来源+事件号去重（表17 / 8.7）
    receiveOrderEvent(orderId, payload) {
      const db = load(); const o = db.orders.find(x => x.id == orderId);
      if (!o) return { ok: false, error: '订单不存在' };
      const dup = db.orderEvents.find(e => e.order_id == orderId && e.source === payload.source && e.event_no === payload.event_no);
      if (dup) return { ok: false, error: '重复回执，已忽略' };
      const newStage = payload.new_stage;
      const old = o.stage;
      const allowed = this.canTransition(old, newStage);
      if (!allowed.ok) return allowed;
      db.orderEvents.push({
        id: nextId(db.orderEvents), order_id: orderId, source: payload.source || 'lab',
        event_no: payload.event_no || 'EVT' + Date.now(), changed_by: null,
        old_stage: old, new_stage: newStage, reason: payload.reason || '',
        external_order_no: payload.external_order_no || '', occurred_at: now(), received_at: now(),
      });
      o.stage = newStage;
      if (newStage === '已接收') { o.accepted_at = now(); o.dispatch_result = '已接收'; o.expected_at = payload.expected_at || o.expected_at; }
      if (newStage === '试戴') { o.trial_at = now(); o.trial_result = payload.trial_result || o.trial_result; }
      save(db); return { ok: true, data: o };
    },
    // BR-06 + 表17 状态机
    canTransition(from, to) {
      const legal = {
        '草稿': ['已发送', '已取消'],
        '已发送': ['已接收', '已取消'],
        '已接收': ['试戴'],
        '试戴': ['质量确认', '返工'],
        '返工': ['试戴'],
        '质量确认': ['已交货'],
        '已交货': ['返工'],   // 已交货不得直接回退到已接收
        '取消': [],
      };
      if (!(legal[from] || []).includes(to)) {
        return { ok: false, error: `不允许的状态转换：${from} → ${to}${from === '已交货' ? '（已交货不得直接回退）' : ''}` };
      }
      return { ok: true };
    },
    changeOrderStage(id, newStage, reason) {
      const db = load(); const o = db.orders.find(x => x.id == id);
      if (!o) return { ok: false, error: '订单不存在' };
      const check = this.canTransition(o.stage, newStage);
      if (!check.ok) return check;
      const old = o.stage; o.stage = newStage;
      if (newStage === '试戴') o.trial_at = now();
      if (newStage === '已交货') o.delivered_at = now();
      if (newStage === '取消') { o.cancelled_at = now(); o.cancel_reason = reason || ''; }
      db.orderEvents.push({
        id: nextId(db.orderEvents), order_id: id, source: 'doctor', event_no: 'EVT' + Date.now(),
        changed_by: 2, old_stage: old, new_stage: newStage, reason: reason || '',
        external_order_no: '', occurred_at: now(), received_at: now(),
      });
      save(db); return { ok: true, data: o };
    },

    /* ---------- 提醒 ---------- */
    listReminders() { return load().reminders.slice().sort((a, b) => String(a.scheduled_at).localeCompare(String(b.scheduled_at))); },
    sendReminder(id) {
      const db = load(); const r = db.reminders.find(x => x.id == id);
      if (!r) return { ok: false, error: '提醒不存在' };
      if (r.delivery_result === '已发送') return { ok: false, error: '该提醒已发送' };
      r.delivery_result = '已发送'; r.attempt_count = (r.attempt_count || 0) + 1;
      r.sent_at = now(); r.last_attempt_at = now(); save(db); return { ok: true, data: r };
    },

    /* ---------- 统计（表24） ---------- */
    reports(start, end) {
      const db = load();
      const appts = db.appointments.filter(a => inRange(a.starts_at, start, end));
      const closed = appts.filter(a => ['已确认', '已到诊', '已完成', '爽约'].includes(a.stage));
      const fulfilled = appts.filter(a => ['已到诊', '已完成'].includes(a.stage));
      const fulfillment = closed.length ? fulfilled.length / closed.length : null;

      const confirmed = db.appointments.filter(a => a.confirmed_at && inRange(a.confirmed_at, start, end));
      const cyc = confirmed.map(a => (new Date(a.confirmed_at) - new Date(a.created_at)) / 60000).sort((x, y) => x - y);
      const median = cyc.length ? (cyc.length % 2 ? cyc[(cyc.length - 1) / 2] : (cyc[cyc.length / 2 - 1] + cyc[cyc.length / 2]) / 2) : null;

      const openedBills = db.bills.filter(b => b.debt_opened_at && String(b.debt_opened_at).slice(0, 10) <= (end || today()));
      let 期初 = 0, 回收 = 0;
      openedBills.forEach(b => {
        const c = this.calcBill(b.id);
        期初 += c.receivable;
        const inPeriod = db.payments.filter(p => p.bill_id == b.id && p.result === '成功' && inRange(p.occurred_at || p.requested_at, start, end));
        let got = 0; inPeriod.forEach(p => { got += p.kind === '收款' ? Number(p.amount) : -Number(p.amount); });
        回收 += Math.max(0, got);
      });
      const recovery = 期初 ? 回收 / 期初 : null;

      const dueOrders = db.orders.filter(o => o.promised_date && o.promised_date >= (start || '') && o.promised_date <= (end || '9999') && o.promised_date < today() && ['已发送', '已接收', '试戴', '质量确认', '返工'].includes(o.stage));
      const doneOrders = db.orders.filter(o => o.promised_date && o.promised_date >= (start || '') && o.promised_date <= (end || '9999') && o.stage === '已交货');
      const onTime = doneOrders.filter(o => o.delivered_at && String(o.delivered_at).slice(0, 10) <= o.promised_date);
      const onTimeRate = (doneOrders.length + dueOrders.length) ? onTime.length / (doneOrders.length + dueOrders.length) : null;

      const checked = [...db.bills.map(b => ({ type: '收费单', id: b.id, ok: !!this.patientOfBill(b.id) })),
                       ...db.orders.map(o => ({ type: '义齿订单', id: o.id, ok: !!this.patientOfOrder(o.id) && this.orderEvents(o.id).length > 0 }))];
      const complete = checked.length ? checked.filter(x => x.ok).length / checked.length : null;

      const NA = '无可计算样本';
      const fmt = v => v == null ? NA : (v * 100).toFixed(1) + '%';
      return {
        start, end,
        metrics: [
          { key: 'appointmentConfirmMedian', name: '预约确认周期中位数', value: median == null ? NA : median.toFixed(1) + ' 分钟', sample: cyc.length, numerator: null, denominator: null },
          { key: 'fulfillment', name: '预约兑现率', value: fmt(fulfillment), sample: closed.length, numerator: fulfilled.length, denominator: closed.length },
          { key: 'recovery', name: '欠款回收率', value: fmt(recovery), sample: openedBills.length, numerator: 回收.toFixed(2), denominator: 期初.toFixed(2) },
          { key: 'onTime', name: '订单按期交付率', value: fmt(onTimeRate), sample: doneOrders.length + dueOrders.length, numerator: onTime.length, denominator: doneOrders.length + dueOrders.length },
          { key: 'completeness', name: '记录关联完整度', value: fmt(complete), sample: checked.length, numerator: checked.filter(x => x.ok).length, denominator: checked.length },
        ],
        anomalies: checked.filter(x => !x.ok),
        overdue: db.orders.filter(o => o.promised_date && o.promised_date < today() && !['已交货', '取消'].includes(o.stage)),
        trial: db.orders.filter(o => ['试戴', '质量确认'].includes(o.stage)),
        delivered: db.orders.filter(o => o.stage === '已交货'),
      };
    },
  };

  /* ---------- 后端权威计算：需要全局一致视角的规则放服务器 ----------
   * BR-01 预约冲突与候选时段 / BR-03-04 欠款 / BR-06 表17 状态机 / 表24 统计
   */
  API.REMOTE_BASE = REMOTE_BASE;
  API.compute = {
    async post(path, body) {
      try {
        const res = await fetch(REMOTE_BASE + '/compute/' + path, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body || {}),
        });
        return await res.json();
      } catch (e) { return { ok: false, error: '服务器计算不可用：' + e.message }; }
    },
    conflict(doctor_id, room_id, starts_at, ends_at, exclude_id) {
      return this.post('conflict', { doctor_id, room_id, starts_at, ends_at, exclude_id });
    },
    bill(lines, discount_amount) {
      return this.post('bill', { lines, discount_amount });
    },
    transition(from, to) {
      return this.post('transition', { from, to });
    },
    async reports(start, end) {
      try {
        const res = await fetch(REMOTE_BASE + '/compute/reports?start=' +
          encodeURIComponent(start || '') + '&end=' + encodeURIComponent(end || ''));
        return await res.json();
      } catch (e) { return { ok: false, error: '服务器统计不可用：' + e.message }; }
    },
  };

  window.API = API;
})();
