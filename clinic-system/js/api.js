/* ============================================================
 * api.js — 服务端认证 API 客户端（全写操作走后端关系事务与 RBAC 鉴权）
 * ============================================================ */
(function () {
  const SESSION_KEY = 'clinic_session_v2';
  const REMOTE_BASE = (window.CLINIC_CONFIG && window.CLINIC_CONFIG.apiBase) ||
    'https://api.smart-oscc-ai.top/clinic-api';

  let DB = null;

  function pad2(n) { return String(n).padStart(2, '0'); }
  function localToday(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function localNowMin() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  function addMinutesLocal(isoStr, mins) {
    const [datePart, timePart] = String(isoStr).split('T');
    const [h, m] = timePart.split(':').map(Number);
    const total = h * 60 + m + Number(mins || 0);
    const nh = Math.floor(total / 60);
    const nm = total % 60;
    return `${datePart}T${pad2(nh)}:${pad2(nm)}`;
  }

  const TOOTH_CN = ['中切牙', '侧切牙', '尖牙', '第一前磨牙', '第二前磨牙', '第一磨牙', '第二磨牙', '第三磨牙'];
  function toothName(code) {
    const c = String(code || '').trim();
    if (c.length !== 2) return c ? c + ' 号牙' : '';
    const q = Number(c[0]), n = Number(c[1]);
    if (![1, 2, 3, 4].includes(q) || n < 1 || n > 8) return c + ' 号牙';
    const vh = (q === 1 || q === 2) ? '上' : '下';
    const lr = (q === 1 || q === 4) ? '右' : '左';
    return lr + vh + TOOTH_CN[n - 1];
  }

  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
  }

  async function req(method, path, body, auth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      const s = getSession();
      if (s && s.token) headers['X-Token'] = s.token;
    }
    try {
      const res = await fetch(REMOTE_BASE + path, {
        method,
        headers,
        cache: 'no-store',
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const r = await res.json();
      if (res.status === 401 && auth) {
        localStorage.removeItem(SESSION_KEY);
        DB = null;
        if (window.App && App.onUnauthorized) App.onUnauthorized();
      }
      return r;
    } catch (e) {
      return { ok: false, error: '无法连接服务器：' + e.message };
    }
  }

  async function mutate(path, body) {
    const r = await req('POST', path, body, true);
    if (r.ok) {
      await API.refresh();
    }
    return r;
  }

  function ensureDB() {
    if (!DB) return {
      clinics: [], rooms: [], basicOptions: [], appointmentTypes: [],
      employees: [], employeeRoles: [], priceItems: [], products: [], dentalLabs: [],
      patients: [], schedules: [], appointments: [], appointmentEvents: [],
      encounters: [], recalls: [], treatmentPlans: [], planItems: [],
      orders: [], orderTooths: [], orderEvents: [], orderAttachments: [],
      bills: [], billLines: [], payments: [], reminders: [], appliances: [],
      accounts: [], auditLogs: [], duplicatePatients: [],
    };
    return DB;
  }

  const API = {
    REMOTE_BASE,
    localToday,
    localNowMin,
    addMinutesLocal,
    toothName,

    async health() { return req('GET', '/health', undefined, false); },
    async requestSmsCode(phone) { return req('POST', '/auth/sms-code', { phone }, false); },
    async login(username, password, mode = '') {
      const r = await req('POST', '/auth/login', { username, password, mode }, false);
      if (!r.ok) return r;
      const d = r.data;
      const session = {
        username: d.username,
        role: d.role,
        roles: d.roles || [],
        name: d.name,
        employee_id: d.employee_id || null,
        patientId: d.patientId || d.patient_id || null,
        token: d.token,
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      const rf = await this.refresh();
      if (!rf.ok) {
        localStorage.removeItem(SESSION_KEY);
        return rf;
      }
      return { ok: true, data: session };
    },
    async refresh() {
      const r = await req('GET', '/bootstrap', undefined, true);
      if (r.ok) DB = r.data;
      return r;
    },
    logout() {
      localStorage.removeItem(SESSION_KEY);
      DB = null;
    },
    session: getSession,
    can(mod) {
      const s = getSession();
      if (!s) return false;
      return (window.SEED.ROLE_MODULES[s.role] || []).includes(mod);
    },
    raw: ensureDB,

    // 基础选项与主数据辅助查询
    listOptions(kind) {
      return (ensureDB().basicOptions || [])
        .filter(o => (!kind || o.kind === kind) && o.active)
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    },
    optionName(id) {
      const o = (ensureDB().basicOptions || []).find(x => x.id == id);
      return o ? o.name : '';
    },
    doctors(onlyActive = true) {
      return (ensureDB().employees || []).filter(e => e.is_doctor && (!onlyActive || e.active));
    },
    listTypes(onlyActive = true) {
      return (ensureDB().appointmentTypes || [])
        .filter(t => !onlyActive || t.active)
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    },
    typeOf(id) { return (ensureDB().appointmentTypes || []).find(t => t.id == id) || null; },

    // 基础信息写操作
    saveOption: (row) => mutate('/basic/option', row),
    toggleOption: (id) => mutate('/basic/option/toggle', { id }),
    saveClinic: (row) => mutate('/basic/clinic', row),
    saveRoom: (row) => mutate('/basic/room', row),
    saveEmployee: (row) => mutate('/basic/employee', row),
    saveAppointmentType: (row) => mutate('/basic/appointment-type', row),
    savePriceItem: (row) => mutate('/basic/price-item', row),
    saveProduct: (row) => mutate('/basic/product', row),
    saveDentalLab: (row) => mutate('/basic/dental-lab', row),
    saveAccount: (row) => mutate('/basic/account', row),

    // 患者管理
    listPatients(q = {}) {
      return (ensureDB().patients || []).filter(p => {
        if (q.keyword) {
          const k = q.keyword.toLowerCase();
          if (![p.name, p.phone, p.patient_no].some(v => String(v || '').toLowerCase().includes(k))) return false;
        }
        if (q.start && String(p.created_at || '').slice(0, 10) < q.start) return false;
        if (q.end && String(p.created_at || '').slice(0, 10) > q.end) return false;
        return true;
      });
    },
    addPatient: (row) => mutate('/patients', row),
    updatePatient: (row) => mutate('/patients/update', row),

    // 排班与号源
    listSchedules(q = {}) {
      let list = (ensureDB().schedules || []).slice();
      if (q.doctor_id) list = list.filter(s => s.doctor_id == q.doctor_id);
      if (q.start) list = list.filter(s => s.work_date >= q.start);
      if (q.end) list = list.filter(s => s.work_date <= q.end);
      return list.sort((a, b) => (a.work_date + a.start_time).localeCompare(b.work_date + b.start_time));
    },
    saveSchedule: (row) => mutate('/schedules', row),
    toggleSchedule: (id, note) => mutate('/schedules/toggle', { id, note }),
    deleteSchedule: (id) => mutate('/schedules/delete', { id }),
    async slots(doctor_id, date, duration_min, exclude_id) {
      let qs = `doctor_id=${encodeURIComponent(doctor_id)}&date=${encodeURIComponent(date)}&duration_min=${encodeURIComponent(duration_min || 30)}`;
      if (exclude_id) qs += `&exclude_id=${encodeURIComponent(exclude_id)}`;
      return req('GET', '/slots?' + qs, undefined, true);
    },
    async doctorDates(doctor_id, start = '', end = '') {
      let qs = `doctor_id=${encodeURIComponent(doctor_id)}`;
      if (start) qs += `&start=${encodeURIComponent(start)}`;
      if (end) qs += `&end=${encodeURIComponent(end)}`;
      return req('GET', '/doctor-dates?' + qs, undefined, true);
    },

    // 预约管理（UC-01 / UC-05）
    listAppointments(q = {}) {
      let list = (ensureDB().appointments || []).slice();
      const t = localToday(0);
      const tom = localToday(1);
      if (q.scope === 'today') list = list.filter(a => String(a.starts_at).slice(0, 10) === t);
      if (q.scope === 'tomorrow') list = list.filter(a => String(a.starts_at).slice(0, 10) === tom);
      if (q.scope === 'pending') list = list.filter(a => a.stage === '待确认');
      if (q.start) list = list.filter(a => String(a.starts_at).slice(0, 10) >= q.start);
      if (q.end) list = list.filter(a => String(a.starts_at).slice(0, 10) <= q.end);
      return list.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
    },
    bookAppointment: (payload) => mutate('/appointments/book', payload),
    rescheduleAppointment: (payload) => mutate('/appointments/reschedule', payload),
    changeAppointmentStage: (id, stage, reason) => mutate('/appointments/stage', { id, stage, reason: reason || '' }),
    appointmentHistory(id) {
      return (ensureDB().appointmentEvents || []).filter(e => e.appointment_id == id);
    },

    // 诊疗与复诊召回
    addEncounter: (payload) => mutate('/encounters', payload),
    setRecallStage: (id, stage, extra) => mutate('/recalls/stage', Object.assign({ id, stage }, extra || {})),

    // 治疗计划（UC-06）
    listPlans(q = {}) {
      let list = (ensureDB().treatmentPlans || []).slice();
      if (q.patient_id) list = list.filter(p => p.patient_id == q.patient_id);
      if (q.stage) list = list.filter(p => p.stage === q.stage);
      return list;
    },
    itemsOf(planId) {
      return (ensureDB().planItems || []).filter(i => i.plan_id == planId)
        .sort((a, b) => (a.phase_no - b.phase_no) || (a.id - b.id));
    },
    planProgress(planId) {
      const all = this.itemsOf(planId);
      const valid = all.filter(i => i.stage !== '已取消');
      const done = valid.filter(i => i.stage === '已执行').length;
      const amount = valid.reduce((s, i) => s + Number(i.quantity || 0) * Number(i.unit_price || 0), 0);
      return { items: all, valid, done, total: valid.length, amount };
    },
    createPlan: (payload) => mutate('/plans', payload),
    confirmPlan: (id) => mutate('/plans/confirm', { id }),
    closePlan: (id) => mutate('/plans/close', { id }),
    terminatePlan: (id, reason) => mutate('/plans/terminate', { id, reason }),
    addPlanItem: (payload) => mutate('/plans/items/add', payload),
    cancelPlanItem: (id, reason) => mutate('/plans/items/cancel', { id, reason }),
    executePlanItem: (payload) => mutate('/plans/items/execute', payload),
    orderFromPlanItem: (payload) => mutate('/plans/items/lab-order', payload),

    // 收费、支付与欠款（UC-02）
    billLines(billId) { return (ensureDB().billLines || []).filter(l => l.bill_id == billId); },
    payments(billId) { return (ensureDB().payments || []).filter(p => p.bill_id == billId); },
    patientOfBill(billId) {
      const db = ensureDB();
      const b = (db.bills || []).find(x => x.id == billId);
      if (!b) return null;
      const enc = (db.encounters || []).find(e => e.id == b.encounter_id);
      return enc ? (db.patients || []).find(p => p.id == enc.patient_id) || null : null;
    },
    createBill: (payload) => mutate('/bills', payload),
    applyBillDiscount: (payload) => mutate('/bills/discount', payload),
    updateBillCollection: (payload) => mutate('/bills/collection', payload),
    voidBill: (id, void_reason) => mutate('/bills/void', { id, void_reason }),
    createPayment: (payload) => mutate('/payments/create', payload),
    verifyPayment: (payload) => mutate('/payments/verify', payload),
    refundPayment: (payment_id, amount, reason) => mutate('/payments/refund', { payment_id, amount, reason }),

    // 义齿订单（UC-03）
    patientOfOrder(orderId) {
      const db = ensureDB();
      const o = (db.orders || []).find(x => x.id == orderId);
      if (!o) return null;
      const enc = (db.encounters || []).find(e => e.id == o.encounter_id);
      return enc ? (db.patients || []).find(p => p.id == enc.patient_id) || null : null;
    },
    orderTeeth(id) { return (ensureDB().orderTooths || []).filter(t => t.order_id == id); },
    orderEvents(id) { return (ensureDB().orderEvents || []).filter(e => e.order_id == id); },
    orderAttachments(id) { return (ensureDB().orderAttachments || []).filter(a => a.order_id == id); },
    createOrderDraft: (payload) => mutate('/orders', payload),
    updateOrderDraft: (payload) => mutate('/orders/update-draft', payload),
    uploadOrderAttachment: (payload) => mutate('/orders/attachments/upload', payload),
    deleteOrderAttachment: (id) => mutate('/orders/attachments/delete', { id }),
    sendOrder: (id) => mutate('/orders/send', { id }),
    orderReceipt: (payload) => mutate('/orders/receipt', payload),
    orderStage: (payload) => mutate('/orders/stage', payload),
    async downloadAttachment(att) {
      const s = getSession();
      const res = await fetch(`${REMOTE_BASE}/orders/attachments/download?id=${att.id}`, {
        headers: s && s.token ? { 'X-Token': s.token } : {},
      });
      if (!res.ok) {
        if (window.App) App.toast('下载附件失败', 'err');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = att.file_name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    },

    // 查询统计与提醒（UC-04）
    async reports(params = {}) {
      const qs = new URLSearchParams();
      if (params.start) qs.set('start', params.start);
      if (params.end) qs.set('end', params.end);
      if (params.doctor_id) qs.set('doctor_id', params.doctor_id);
      if (params.biz_type) qs.set('biz_type', params.biz_type);
      return req('GET', '/reports?' + qs.toString(), undefined, true);
    },
    sendReminder: (id, simulate_fail = false) => mutate('/reminders/send', { id, simulate_fail }),
    createReminder: (payload) => mutate('/reminders/create', payload),

    // 今日队列汇总（按角色权限过滤后呈现）
    queues() {
      const db = ensureDB();
      const t = localToday(0);
      const active = ['待确认', '已确认', '已到诊'];
      const appts = db.appointments || [];
      return {
        pendingConfirm: appts.filter(a => a.stage === '待确认' && String(a.starts_at).slice(0, 10) >= t),
        today: appts.filter(a => String(a.starts_at).slice(0, 10) === t && active.includes(a.stage)),
        recallDue: (db.recalls || []).filter(r => ['待通知', '已通知'].includes(r.stage) && r.due_date <= t),
        debtDue: (db.bills || []).filter(b => b.stage !== '已作废' && Number(b.debt || 0) > 0 && b.due_date && b.due_date <= t),
        toTry: (db.orders || []).filter(o => o.stage === '试戴'),
        toPick: (db.orders || []).filter(o => o.stage === '已交货' && String(o.delivered_at || '').slice(0, 10) >= localToday(-3)),
      };
    },
  };

  window.API = API;
})();
