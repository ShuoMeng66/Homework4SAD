/* 今日队列：按岗位汇总待确认预约、今日到诊、到期召回、到期欠费及待试戴取件事项，支持一键跳转处理 */
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
  const hm = s => String(s || '').slice(11, 16);

  // 所有队列严格按当前岗位权限过滤，且只保留可跳转的合法模块
  const queues = [
    {
      key: 'pending', title: '待确认预约', module: 'appointments',
      roles: ['receptionist', 'admin'],
      count: q.pendingConfirm.length, tone: 'var(--accent)',
      rows: q.pendingConfirm.slice(0, 5),
      hint: '患者自助提交的预约须经前台确认后正式生效',
      render: a => `${App.esc(patientName(a.patient_id))} · ${App.esc(String(a.starts_at).slice(5, 10))} ${hm(a.starts_at)}`,
      empty: '暂无待确认预约',
    },
    {
      key: 'today', title: apptTitle, module: 'appointments',
      roles: ['receptionist', 'doctor', 'admin'],
      count: todayList.length, tone: 'var(--ink)',
      rows: todayList.slice(0, 5),
      hint: '今日排程到诊与就诊安排，已确认未到诊可及时签到或标记爽约',
      render: a => `${hm(a.starts_at)} · ${App.esc(patientName(a.patient_id))} · ${App.tag(a.stage)}`,
      empty: '今日暂无预约安排',
    },
    {
      key: 'recall', title: '到期召回', module: 'recall',
      roles: ['receptionist', 'manager', 'admin'],
      count: q.recallDue.length, tone: 'var(--warn)',
      rows: q.recallDue.slice(0, 5),
      hint: '已到达建议复查日期且尚未闭环的复诊召回任务',
      render: r => `${App.esc(patientName(r.patient_id))} · 到期 ${App.esc(r.due_date)} · ${App.tag(r.stage)}`,
      empty: '暂无到期复诊召回',
    },
    {
      key: 'debt', title: '到期欠费', module: 'billing',
      roles: ['cashier', 'admin'],
      count: q.debtDue.length, tone: 'var(--danger)',
      rows: q.debtDue.slice(0, 5),
      hint: '已过约定到期日且尚未结清的欠款收费单',
      render: b => {
        const p = API.patientOfBill(b.id);
        return `${App.esc(b.bill_no)} · ${App.esc(p ? p.name : '—')} · 欠 ¥${Number(b.debt || 0).toFixed(2)}`;
      },
      empty: '暂无到期欠费',
    },
    {
      key: 'orders', title: '待试戴 / 待取件', module: 'orders',
      roles: ['receptionist', 'doctor', 'manager', 'admin'],
      count: q.toTry.length + q.toPick.length, tone: 'var(--accent)',
      rows: q.toTry.concat(q.toPick).slice(0, 5),
      hint: '处于试戴或已交货待取件阶段的义齿修复订单',
      render: o => {
        const p = API.patientOfOrder(o.id);
        return `${App.esc(o.order_no)} · ${App.esc(p ? p.name : '—')} · ${App.tag(o.stage)}`;
      },
      empty: '暂无待试戴或待取件订单',
    },
  ].filter(x => x.roles.includes(session.role) && API.can(x.module));

  const colsClass = queues.length <= 2 ? 'cols-2' : (queues.length === 3 ? 'cols-3' : 'cols-4');

  set(`
    <div class="page-head">
      <div>
        <div class="page-title">今日队列</div>
        <div class="page-desc">${dateText} · 按岗位汇总当日待办事项</div>
      </div>
    </div>

    <div class="grid ${colsClass}">
      ${queues.slice(0, 4).map(k => `<div class="kpi">
        <div class="label">${k.title}</div>
        <div class="value" style="color:${k.tone}">${k.count}</div>
      </div>`).join('')}
    </div>
    <div style="height:18px"></div>

    <div class="queue-grid">
      ${queues.map(x => `
        <div class="card queue-card">
          <div class="queue-head">
            <div>
              <div class="queue-title">${x.title}</div>
              <div class="queue-hint">${x.hint}</div>
            </div>
            <div class="queue-count ${x.count ? 'hot' : ''}">${x.count}</div>
          </div>
          <div class="queue-body">
            ${x.rows.length
              ? x.rows.map(r => `<div class="queue-row">${x.render(r)}</div>`).join('')
              : `<div class="queue-empty">${x.empty}</div>`}
          </div>
          <div class="queue-foot">
            <button class="btn ghost sm" data-go="${x.module}">一键去处理</button>
          </div>
        </div>`).join('')}
    </div>`);

  document.querySelectorAll('[data-go]').forEach(b => {
    b.onclick = () => App.navigate(b.dataset.go);
  });
};
