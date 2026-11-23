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
  // 事务端点提交前，先把简单 CRUD 的待写队列冲刷完，避免旧缓存覆盖服务器事务结果
  async function flushWrites() {
    if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; enqueueWrite(); }
    await writeChain;
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


  /* ---------- 对外投影：内部单据翻译成患者语言 ----------
   * 患者不接触订单号、技工所、八态状态机与返工原因，只看到"做到哪一步"
   */
  const TOOTH_CN = ['中切牙', '侧切牙', '尖牙', '第一前磨牙', '第二前磨牙',
                    '第一磨牙', '第二磨牙', '第三磨牙'];
  function toothName(code) {
    const c = String(code || '');
    if (c.length !== 2) return c ? c + ' 号牙' : '';
    const q = Number(c[0]), n = Number(c[1]);
    if (!q || !n || n < 1 || n > 8) return c + ' 号牙';
    const vh = (q === 1 || q === 2) ? '上' : '下';
    const lr = (q === 1 || q === 4) ? '右' : '左';
    return lr + vh + TOOTH_CN[n - 1];
  }
  const PROGRESS = {
    '草稿':     ['制作中', '正在准备制作资料', 'gray'],
    '已发送':   ['制作中', '已送技工所制作', 'blue'],
    '已接收':   ['制作中', '技工所已接收，正在制作', 'blue'],
    '返工':     ['制作中', '重新制作中', 'orange'],
    '试戴':     ['待试戴', '已到店，请预约试戴', 'orange'],
    '质量确认': ['待试戴', '试戴完成，等待最终确认', 'orange'],
    '已交货':   ['可取件', '已到店，可来院取件', 'green'],
    '取消':     ['已取消', '', 'gray'],
  };

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
                          patientId: d.patientId || null,
                          token: d.token, loginAt: now() };
        localStorage.setItem(SESSION, JSON.stringify(session));
        return { ok: true, data: session };
      } catch (e) {
        return { ok: false, error: '无法连接服务器：' + e.message };
      }
    },
    // 后端事务提交：所有需要全局一致性的写操作统一走这里，提交后重新读取权威数据
    async commit(endpoint, payload) {
      try {
        await flushWrites();
        const res = await fetch(REMOTE_BASE + '/commit/' + endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload || {}),
        });
        const r = await res.json();
        if (!r.ok) return { ok: false, error: r.error || '服务器事务提交失败' };
        const fresh = await fetch(REMOTE_BASE + '/db', { cache: 'no-store' });
        const fr = await fresh.json();
        if (fr.ok) DB = fr.data;
        return { ok: true, data: r.data };
      } catch (e) {
        return { ok: false, error: '服务器事务提交失败：' + e.message };
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
    async addAppointment(a) {
      const r = await this.commit('appointment', Object.assign({}, a, { stage: a.stage || '待确认' }));
      return r.ok ? { ok: true, data: r.data } : r;
    },
    async changeAppointmentStage(id, newStage, reason) {
      return this.commit('appointment/stage', { id, stage: newStage, reason: reason || '', changed_by: 1 });
    },
    async reschedule(id, starts_at, ends_at, reason) {
      return this.commit('appointment/reschedule',
        { id, starts_at, ends_at, reason: reason || '改约', changed_by: 1 });
    },
    appointmentHistory(id) { return load().appointmentEvents.filter(e => e.appointment_id == id); },

    /* ---------- 对外投影 ---------- */
    toothName(code) { return toothName(code); },
    progressOf(order) {
      const p = PROGRESS[order && order.stage] || ['处理中', '', 'gray'];
      return { label: p[0], hint: p[1], tone: p[2] };
    },
    // 一件修复体的患者可见描述：右上第一磨牙 · 全瓷冠
    applianceOf(order) {
      const db = load();
      const teeth = db.orderTooths.filter(t => t.order_id == order.id).map(t => toothName(t.tooth_code));
      const prod = db.products.find(x => x.id == order.product_id);
      const name = prod ? prod.name : '修复体';
      return { teeth: teeth.join('、'), name, text: (teeth.length ? teeth.join('、') + ' · ' : '') + name };
    },
    // 患者视角的治疗时间线：就诊 → 产生的修复件 → 该次费用
    patientTreatment(patientId) {
      const db = load();
      const encs = db.encounters.filter(e => e.patient_id == patientId)
        .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
      return encs.map(e => {
        const orders = db.orders.filter(o => o.encounter_id == e.id);
        const bills = db.bills.filter(b => b.encounter_id == e.id && b.stage !== '已作废');
        const doctor = db.employees.find(x => x.id == e.doctor_id);
        const fee = bills.reduce((acc, b) => {
          const c = this.calcBill(b.id);
          acc.receivable += c.receivable; acc.paid += c.received; acc.due += c.debt;
          return acc;
        }, { receivable: 0, paid: 0, due: 0 });
        return { encounter: e, doctor, orders, fee };
      });
    },

    /* ---------- 排班与号源（BR-09） ---------- */
    listTypes() {
      return load().appointmentTypes.filter(t => t.active !== false)
        .sort((a, b) => a.sort_order - b.sort_order);
    },
    typeOf(id) { return load().appointmentTypes.find(t => t.id == id) || null; },
    listSchedules(q = {}) {
      const db = load();
      let list = (db.schedules || []).slice();
      if (q.doctor_id) list = list.filter(s => s.doctor_id == q.doctor_id);
      if (q.date) list = list.filter(s => s.work_date === q.date);
      if (q.start && q.end) list = list.filter(s => s.work_date >= q.start && s.work_date <= q.end);
      return list.sort((a, b) =>
        (a.work_date + a.start_time).localeCompare(b.work_date + b.start_time));
    },
    // 号源由服务器按排班切片实时推导，前端只展示结果
    async slots(doctor_id, date, duration_min, exclude_id) {
      try {
        let qs = 'doctor_id=' + doctor_id + '&date=' + encodeURIComponent(date) +
                 '&duration_min=' + (duration_min || 30);
        if (exclude_id) qs += '&exclude_id=' + exclude_id;
        const res = await fetch(REMOTE_BASE + '/slots?' + qs, { cache: 'no-store' });
        return await res.json();
      } catch (e) { return { ok: false, error: '号源查询失败：' + e.message }; }
    },
    async book(payload) {
      const r = await this.commit('booking', payload);
      return r.ok ? { ok: true, data: r.data } : r;
    },
    upsertSchedule(row) {
      const db = load();
      if (row.id) {
        const s = db.schedules.find(x => x.id == row.id);
        if (s) Object.assign(s, row);
      } else {
        db.schedules.push(Object.assign({
          id: nextId(db.schedules), stage: '正常', slot_minutes: 15,
          created_at: now(), created_by: 1,
        }, row));
      }
      save(db); return { ok: true };
    },
    removeSchedule(id) {
      const db = load();
      const used = db.appointments.some(a => a.schedule_id == id &&
        ['待确认', '已确认', '已到诊'].includes(a.stage));
      if (used) return { ok: false, error: '该排班段已有有效预约，不能删除，请改为停诊' };
      db.schedules = db.schedules.filter(s => s.id != id);
      save(db); return { ok: true };
    },

    /* ---------- 今日队列：把差错挡在发生之前 ---------- */
    queues() {
      const db = load();
      const t = today();
      const active = ['待确认', '已确认', '已到诊'];
      const appts = db.appointments || [];
      return {
        pendingConfirm: appts.filter(a => a.stage === '待确认' && String(a.starts_at).slice(0, 10) >= t),
        today: appts.filter(a => String(a.starts_at).slice(0, 10) === t && active.includes(a.stage)),
        noShowRisk: appts.filter(a => a.stage === '已确认'
          && a.starts_at < new Date().toISOString().slice(0, 16)),
        recallDue: (db.recalls || []).filter(r => ['待通知', '已通知'].includes(r.stage) && r.due_date <= t),
        debtDue: (db.bills || []).filter(b => {
          if (b.stage === '已作废') return false;
          const c = this.calcBill(b.id);
          return c.debt > 0 && b.due_date && b.due_date <= t;
        }),
        toTry: (db.orders || []).filter(o => o.stage === '试戴'),
        toPick: (db.orders || []).filter(o => o.stage === '已交货' && o.delivered_at
          && String(o.delivered_at).slice(0, 10) >= t),
      };
    },

    /* ---------- 治疗计划（P1）：计划项是收费、技工单与执行记录的共同锚点 ---------- */
    listPlans(q = {}) {
      const db = load();
      let list = (db.treatmentPlans || []).slice();
      if (q.patient_id) list = list.filter(p => p.patient_id == q.patient_id);
      if (q.stage) list = list.filter(p => p.stage === q.stage);
      if (q.doctor_id) list = list.filter(p => p.doctor_id == q.doctor_id);
      return list.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    },
    planOf(id) { return (load().treatmentPlans || []).find(p => p.id == id) || null; },
    itemsOf(planId) {
      return (load().planItems || []).filter(i => i.plan_id == planId)
        .sort((a, b) => (a.phase_no - b.phase_no) || (a.id - b.id));
    },
    createPlan(payload) {
      const db = load();
      const row = Object.assign({
        id: nextId(db.treatmentPlans),
        plan_no: nextNo(db.treatmentPlans, 'plan_no', 'TP'),
        stage: '拟定', quoted_amount: 0, accepted_at: null, closed_at: null,
        created_at: now(), created_by: (this.session() || {}).role === 'doctor' ? 2 : 1,
      }, payload);
      db.treatmentPlans.push(row); save(db); return row;
    },
    updatePlan(id, patch) {
      const db = load(); const p = db.treatmentPlans.find(x => x.id == id);
      if (!p) return null; Object.assign(p, patch); save(db); return p;
    },
    addPlanItem(payload) {
      const db = load();
      const row = Object.assign({
        id: nextId(db.planItems), phase_no: 1, quantity: 1,
        stage: '待执行', encounter_id: null, bill_id: null, lab_order_id: null,
        planned_at: now(), executed_at: null,
      }, payload);
      db.planItems.push(row);
      const plan = db.treatmentPlans.find(p => p.id == row.plan_id);
      if (plan) plan.quoted_amount = this.itemsOf(row.plan_id).reduce(
        (a, i) => a + Number(i.unit_price || 0) * Number(i.quantity || 0), 0);
      save(db); return row;
    },
    executePlanItem(id, encounterId) {
      const db = load(); const i = db.planItems.find(x => x.id == id);
      if (!i) return { ok: false, error: '计划项不存在' };
      i.stage = '已执行'; i.encounter_id = encounterId || i.encounter_id;
      i.executed_at = now();
      const plan = db.treatmentPlans.find(p => p.id == i.plan_id);
      if (plan && plan.stage === '拟定') plan.stage = '执行中';
      save(db); return { ok: true, data: i };
    },
    closePlan(id) {
      const db = load(); const p = db.treatmentPlans.find(x => x.id == id);
      if (!p) return { ok: false, error: '计划不存在' };
      const left = this.itemsOf(id).filter(i => i.stage === '待执行');
      if (left.length) return { ok: false, error: `还有 ${left.length} 项未执行，不能关闭` };
      p.stage = '已完成'; p.closed_at = now(); save(db); return { ok: true, data: p };
    },
    // 计划项的对外状态：已执行再看技工单进度，未执行就是待安排
    planItemView(item) {
      const db = load();
      if (item.stage === '已取消') return { label: '已取消', tone: 'gray' };
      const order = (db.orders || []).find(o => o.id == item.lab_order_id);
      if (order) {
        const pg = this.progressOf(order);
        if (pg.label !== '已取消') return pg;
      }
      return item.stage === '已执行'
        ? { label: '已完成', tone: 'green' }
        : { label: '待安排', tone: 'gray' };
    },
    planProgress(planId) {
      const items = this.itemsOf(planId);
      const done = items.filter(i => i.stage === '已执行').length;
      const amount = items.reduce((a, i) => a + Number(i.unit_price || 0) * Number(i.quantity || 0), 0);
      return { items, done, total: items.length, amount };
    },

    /* ---------- 复诊召回（BR-12） ---------- */
    listRecalls(q = {}) {
      const db = load();
      let list = (db.recalls || []).slice();
      if (q.stage) list = list.filter(r => r.stage === q.stage);
      if (q.patient_id) list = list.filter(r => r.patient_id == q.patient_id);
      if (q.due_before) list = list.filter(r => String(r.due_date) <= q.due_before);
      return list.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
    },
    async setRecallStage(id, stage, extra) {
      return this.commit('recall', Object.assign({ id, stage }, extra || {}));
    },
    pushReminder(row) {
      const db = load();
      const full = Object.assign({
        id: nextId(db.reminders), order_id: null, appointment_id: null,
        channel_id: 6, created_by: 1, delivery_result: '待发送', attempt_count: 0,
        last_attempt_at: null, sent_at: null, failure_reason: null,
      }, row);
      db.reminders.push(full);
      save(db);
      return full;
    },

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
    async addBill(payload) {
      return this.commit('bill', {
        encounter_id: Number(payload.encounter_id),
        discount_amount: Number(payload.discount_amount || 0),
        discount_reason: payload.discount_reason || '',
        due_date: payload.due_date || null,
        method_id: Number(payload.method_id || (payload.payment && payload.payment.method_id) || 3),
        strictDup: !!payload.strictDup,
        lines: payload.lines || [],
      });
    },
    // UC-02 步骤5-7：请求支付服务 → 返回结果 → 在同一事务内核对并更新欠款
    async requestPayment(paymentId, mockResult) {
      const p = load().payments.find(x => x.id == paymentId);
      if (!p) return { ok: false, error: '支付记录不存在' };
      try {
        const res = await fetch(REMOTE_BASE + '/compute/pay', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request_no: p.request_no, mock_result: mockResult || '成功' }),
        });
        const r = await res.json();
        if (!r.ok) return r;
        return this.commit('payment/result', {
          id: paymentId, result: r.data.result,
          external_txn_no: r.data.external_txn_no,
          failure_reason: r.data.failure_reason,
        });
      } catch (e) {
        return { ok: false, error: '支付服务不可用：' + e.message };
      }
    },
    async recordPaymentResult(paymentId, result, externalTxnNo, failureReason) {
      return this.commit('payment/result', {
        id: paymentId, result, external_txn_no: externalTxnNo, failure_reason: failureReason,
      });
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
    async sendOrder(id) {
      const db = load(); const o = db.orders.find(x => x.id == id);
      if (!o) return { ok: false, error: '订单不存在' };
      const teeth = db.orderTooths.filter(t => t.order_id == id);
      const prod = db.products.find(p => p.id == o.product_id);
      const atts = db.orderAttachments.filter(a => a.order_id == id);
      if (!o.product_id || !o.quantity || teeth.length < 1) return { ok: false, error: '需先选择产品、数量和至少一个牙位' };
      if (prod?.requires_attachment && atts.length < 1) return { ok: false, error: '该产品必须附带必要附件' };
      return this.commit('order/transition', { id, to: '已发送', reason: '医生确认发送', source: 'doctor' });
    },
    // 技工所回执：来源+事件号去重（表17 / 8.7）
    async receiveOrderEvent(orderId, payload) {
      const o = load().orders.find(x => x.id == orderId);
      if (!o) return { ok: false, error: '订单不存在' };
      const r = await this.commit('order/receipt', {
        id: orderId, new_stage: payload.new_stage,
        source: payload.source || 'lab', event_no: payload.event_no,
        external_order_no: payload.external_order_no || '',
        trial_result: payload.trial_result || '', reason: payload.reason || '',
        expected_finish_date: payload.expected_finish_date || payload.expected_at || null,
      });
      if (r.ok && r.data && r.data.duplicate) return { ok: false, error: '重复回执，已忽略' };
      if (r.ok && r.data && r.data.order) r.data = r.data.order;
      return r;
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
    async changeOrderStage(id, newStage, reason) {
      return this.commit('order/transition', {
        id, to: newStage, reason: reason || '', source: 'doctor',
      });
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

      // 表24：固定期初欠款队列；分母为期初未收余额，分子为该队列期间回收（扣退款）
      const queueBills = db.bills.filter(b => b.debt_opened_at && String(b.debt_opened_at).slice(0, 10) < (start || end || '9999'));
      let 期初 = 0, 回收 = 0;
      queueBills.forEach(b => {
        const c = this.calcBill(b.id);
        let before = 0;
        db.payments.filter(p => p.bill_id == b.id && p.result === '成功').forEach(p => {
          const signed = (p.kind === '收款' ? 1 : -1) * Number(p.amount);
          const d = String(p.occurred_at || p.requested_at || '').slice(0, 10);
          if (start && d < start) before += signed;
          if (inRange(p.occurred_at || p.requested_at, start, end)) 回收 += signed;
        });
        期初 += Math.max(0, c.receivable - before);
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
          { key: 'recovery', name: '欠款回收率', value: fmt(recovery), sample: queueBills.length, numerator: 回收.toFixed(2), denominator: 期初.toFixed(2) },
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
