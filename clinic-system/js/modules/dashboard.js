/* 今日队列：按岗位汇总待确认预约、今日到诊、到期召回、到期欠费及待试戴取件事项，支持一键直达处理 */
window.Modules = window.Modules || {};
window.Modules.dashboard = function (set) {
  const session = API.session() || {};
  const db = API.raw();
  const q = API.queues();
  const isDoctor = session.role === 'doctor';
  const myEmpId = session.employee_id;

  const dateText = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });

  const apptTitle = isDoctor ? '我的今日患者' : '今日到诊';
  const todayList = isDoctor && myEmpId ? q.today.filter(a => a.doctor_id == myEmpId) : q.today;

  const patientName = id => {
    const p = (db.patients || []).find(x => x.id == id);
    return p ? p.name : '—';
  };
  const docName = id => ((db.employees || []).find(e => e.id == id) || {}).name || '';
  const hm = s => String(s || '').slice(11, 16);

  const queues = [
    {
      key: 'pending', title: '待确认预约', module: 'appointments', opts: { scope: 'pending' },
      roles: ['receptionist', 'admin'], ico: 'clock', icoTone: 'warn',
      count: q.pendingConfirm.length, tone: 'var(--warn)',
      rows: q.pendingConfirm.slice(0, 5),
      hint: '患者自助提交的待确认预约',
      render: a => `<span class="av-cell">${App.avatar(patientName(a.patient_id))}<span><b>${App.esc(patientName(a.patient_id))}</b><div class="muted">${App.esc(String(a.starts_at).slice(5, 10))} ${hm(a.starts_at)} · ${App.esc(docName(a.doctor_id))}</div></span></span>${App.tag('待确认')}`,
      empty: '暂无待确认预约',
    },
    {
      key: 'today', title: apptTitle, module: 'appointments', opts: { scope: 'today' },
      roles: ['receptionist', 'doctor', 'admin'], ico: 'calendar', icoTone: '',
      count: todayList.length, tone: 'var(--primary)',
      rows: todayList.slice(0, 5),
      hint: '今日排程到诊与就诊安排',
      render: a => `<span class="av-cell">${App.avatar(patientName(a.patient_id))}<span><b>${hm(a.starts_at)} · ${App.esc(patientName(a.patient_id))}</b>${!isDoctor ? `<div class="muted">${App.esc(docName(a.doctor_id))}</div>` : ''}</span></span>${App.tag(a.stage)}`,
      empty: '今日暂无预约安排',
    },
    {
      key: 'recall', title: '到期召回', module: 'recall', opts: {},
      roles: ['receptionist', 'manager', 'admin'], ico: 'bell', icoTone: 'warn',
      count: q.recallDue.length, tone: 'var(--warn)',
      rows: q.recallDue.slice(0, 5),
      hint: '到达建议复查日期待跟进患者',
      render: r => `<span class="av-cell">${App.avatar(patientName(r.patient_id))}<span><b>${App.esc(patientName(r.patient_id))}</b><div class="muted">到期 ${App.esc(r.due_date)}</div></span></span>${App.tag(r.stage)}`,
      empty: '暂无到期复诊召回',
    },
    {
      key: 'debt', title: '到期欠费', module: 'billing', opts: {},
      roles: ['cashier', 'admin'], ico: 'wallet', icoTone: 'danger',
      count: q.debtDue.length, tone: 'var(--danger)',
      rows: q.debtDue.slice(0, 5),
      hint: '已过约定到期日待催收账单',
      render: b => {
        const p = API.patientOfBill(b.id);
        return `<span class="av-cell">${App.avatar(p ? p.name : '—')}<span><b>${App.esc(p ? p.name : '—')}</b><div class="muted">${App.esc(b.bill_no)}</div></span></span><span class="tag red">欠 ¥${Number(b.debt || 0).toFixed(2)}</span>`;
      },
      empty: '暂无到期欠费',
    },
    {
      key: 'orders', title: '待试戴 / 待取件', module: 'orders', opts: {},
      roles: ['receptionist', 'doctor', 'manager', 'admin'], ico: 'box', icoTone: 'blue',
      count: q.toTry.length + q.toPick.length, tone: 'var(--primary)',
      rows: q.toTry.concat(q.toPick).slice(0, 5),
      hint: '已到店试戴或已交货待通知取件',
      render: o => {
        const p = API.patientOfOrder(o.id);
        return `<span class="av-cell">${App.avatar(p ? p.name : '—')}<span><b>${App.esc(p ? p.name : '—')}</b><div class="muted">${App.esc(o.order_no)}</div></span></span>${App.tag(o.stage)}`;
      },
      empty: '暂无待试戴或待取件订单',
    },
  ].filter(x => x.roles.includes(session.role) && API.can(x.module));

  const quickActionsByRole = {
    receptionist: [
      { label: '+ 登记并预约', mod: 'appointments', opts: { autoCreate: true }, primary: true },
      { label: '+ 登记新患者', mod: 'patients', opts: { autoCreate: true } },
      { label: '排班号源', mod: 'schedule', opts: {} },
      { label: '订单提醒', mod: 'reports', opts: {} },
    ],
    doctor: [
      { label: '诊疗记录', mod: 'encounters', opts: {}, primary: true },
      { label: '治疗计划', mod: 'plans', opts: {} },
      { label: '义齿订单', mod: 'orders', opts: {} },
    ],
    cashier: [
      { label: '进入收费收银', mod: 'billing', opts: {}, primary: true },
    ],
    manager: [
      { label: '经营统计报表', mod: 'reports', opts: {}, primary: true },
      { label: '复诊召回', mod: 'recall', opts: {} },
      { label: '基础信息维护', mod: 'basic', opts: {} },
    ],
    admin: [
      { label: '+ 登记并预约', mod: 'appointments', opts: { autoCreate: true }, primary: true },
      { label: '经营统计', mod: 'reports', opts: {} },
      { label: '基础信息与账号', mod: 'basic', opts: {} },
    ],
  };
  const quickActions = (quickActionsByRole[session.role] || []).filter(a => API.can(a.mod));
  const roleLabel = window.SEED.ROLE_LABEL[session.role] || '';
  const totalTodo = queues.reduce((s, x) => s + x.count, 0);

  const kpiCols = queues.length <= 2 ? 'cols-2' : (queues.length === 3 ? 'cols-3' : 'cols-4');
  const queueGridClass = queues.length === 1 ? 'cols-1' : (queues.length === 3 ? 'cols-3' : '');

  set(`
    <div class="hero-banner">
      <div>
        <h2>${App.esc(session.name || roleLabel)}，欢迎回到${App.esc(roleLabel)}工作台</h2>
        <p>${dateText} · 当前共有 <b>${totalTodo}</b> 项待处理事项</p>
      </div>
      ${quickActions.length ? `<div class="quick-bar">
        ${quickActions.map((a, idx) => `<button class="quick-pill ${a.primary ? 'primary' : ''}" data-qact="${idx}">${App.esc(a.label)}</button>`).join('')}
      </div>` : ''}
    </div>

    <div class="grid ${kpiCols}" style="margin-bottom:20px">
      ${queues.slice(0, 4).map((k, idx) => `<div class="kpi" data-kgo="${idx}" style="cursor:pointer" title="点击进入处理">
        <div class="kpi-top">
          <div>
            <div class="label">${App.esc(k.title)}</div>
            <div class="value" style="color:${k.count > 0 ? k.tone : 'var(--ink)'}">${k.count}</div>
          </div>
          <span class="kpi-ico ${k.icoTone || ''}">${App.icon(k.ico)}</span>
        </div>
        <div class="kpi-foot">${App.esc(k.hint)}</div>
      </div>`).join('')}
    </div>

    <div class="queue-grid ${queueGridClass}">
      ${queues.map((x, idx) => `
        <div class="card queue-card">
          <div class="queue-head">
            <div>
              <div class="queue-title">${App.esc(x.title)}</div>
              <div class="queue-hint">${App.esc(x.hint)}</div>
            </div>
            <div class="queue-count ${x.count ? 'hot' : ''}">${x.count}</div>
          </div>
          <div class="queue-body">
            ${x.rows.length
              ? x.rows.map(r => `<div class="queue-row">${x.render(r)}</div>`).join('')
              : `<div class="queue-empty">${x.empty}</div>`}
          </div>
          <div class="queue-foot">
            <button class="btn soft sm" data-go="${idx}">去处理 →</button>
          </div>
        </div>`).join('')}
    </div>`);

  document.querySelectorAll('[data-qact]').forEach(b => {
    const a = quickActions[Number(b.dataset.qact)];
    b.onclick = () => App.navigate(a.mod, a.opts);
  });
  document.querySelectorAll('[data-kgo]').forEach(el => {
    const qItem = queues[Number(el.dataset.kgo)];
    el.onclick = () => App.navigate(qItem.module, qItem.opts);
  });
  document.querySelectorAll('[data-go]').forEach(b => {
    const qItem = queues[Number(b.dataset.go)];
    b.onclick = () => App.navigate(qItem.module, qItem.opts);
  });
};
