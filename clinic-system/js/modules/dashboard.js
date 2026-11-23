/* 工作台：按岗位的一天组织成待办队列，而不是统计大屏
 * 把差错挡在发生之前：该确认的没确认、该回访的没回访、该收的没收 */
window.Modules = window.Modules || {};
window.Modules.dashboard = function (set) {
  const session = API.session() || {};
  const db = API.raw();
  const q = API.queues();
  const isDoctor = session.role === 'doctor';
  const myId = 2;                      // 医生账号对应员工李医生

  const dateText = new Date().toLocaleDateString('zh-CN',
    { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  const apptTitle = isDoctor ? '我的今日患者' : '今日到诊';
  const todayList = isDoctor ? q.today.filter(a => a.doctor_id == myId) : q.today;

  const patientName = id => {
    const p = db.patients.find(x => x.id == id);
    return p ? p.name : '—';
  };
  const hm = s => String(s).slice(11, 16);

  const queues = [
    {
      title: '待确认预约', module: 'appointments',
      roles: ['receptionist', 'manager', 'admin', 'doctor'],
      rows: q.pendingConfirm.slice(0, 4),
      hint: '患者自助提交的预约须前台确认后才生效',
      render: a => `${patientName(a.patient_id)} · ${App.esc(String(a.starts_at).slice(5, 10).replace('-', '/'))} ${hm(a.starts_at)}`,
      empty: '没有待确认的预约',
    },
    {
      title: apptTitle, module: 'appointments',
      roles: ['receptionist', 'doctor', 'admin'],
      rows: todayList.slice(0, 4),
      hint: '已确认未到诊的，到点及时签到或标记爽约',
      render: a => `${hm(a.starts_at)} · ${patientName(a.patient_id)}`,
      empty: '今天没有安排',
    },
    {
      title: '召回到期', module: 'recall',
      roles: ['receptionist', 'doctor', 'manager', 'admin'],
      rows: q.recallDue.slice(0, 4),
      hint: '到期未回访的复诊召回，越早联系越容易约回来',
      render: r => `${patientName(r.patient_id)} · ${App.esc(r.due_date)}`,
      empty: '没有到期的召回',
    },
    {
      title: '欠费到期', module: 'billing',
      roles: ['cashier', 'manager', 'admin'],
      rows: q.debtDue.slice(0, 4),
      hint: '已过应收日期的未结清收费单',
      render: b => {
        const p = API.patientOfBill(b.id);
        const c = API.calcBill(b.id);
        return `${p ? p.name : '—'} · 欠 ¥${c.debt.toFixed(0)}`;
      },
      empty: '没有到期的欠款',
    },
    {
      title: '待试戴 / 可取件', module: 'orders',
      roles: ['receptionist', 'doctor', 'admin'],
      rows: q.toTry.concat(q.toPick).slice(0, 4),
      hint: '到店的修复体要主动通知患者，别等人来问',
      render: o => {
        const p = API.patientOfOrder(o.id);
        return `${p ? p.name : '—'} · ${API.applianceOf(o).text}`;
      },
      empty: '没有待处理的修复体',
    },
  ].filter(x => x.roles.includes(session.role));

  const kpi = [
    { label: '待确认', value: q.pendingConfirm.length, tone: 'var(--accent)' },
    { label: apptTitle, value: todayList.length, tone: 'var(--ink)' },
    { label: '召回到期', value: q.recallDue.length, tone: 'var(--warn)' },
    { label: '欠费到期', value: q.debtDue.length, tone: 'var(--danger)' },
  ];

  set(`
    <div class="page-head">
      <div><div class="page-title">今日队列</div>
        <div class="page-desc">${dateText} · 按岗位列出今天必须处理的事</div></div>
    </div>

    <div class="grid cols-4">
      ${kpi.map(k => `<div class="kpi"><div class="label">${k.label}</div>
        <div class="value" style="color:${k.tone}">${k.value}</div></div>`).join('')}
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
            <div class="queue-count ${x.rows.length ? 'hot' : ''}">${x.rows.length}</div>
          </div>
          <div class="queue-body">
            ${x.rows.length
              ? x.rows.map(r => `<div class="queue-row">${x.render(r)}</div>`).join('')
              : `<div class="queue-empty">${x.empty}</div>`}
          </div>
          <div class="queue-foot">
            <button class="btn ghost sm" data-go="${x.module}">去处理</button>
          </div>
        </div>`).join('')}
    </div>`);

  document.querySelectorAll('[data-go]').forEach(b => {
    b.onclick = () => App.navigate(b.dataset.go);
  });
};
