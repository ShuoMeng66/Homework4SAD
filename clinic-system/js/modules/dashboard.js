/* 工作台：今日预约、待处理订单、欠款、提醒概览 + 快捷入口 */
window.Modules = window.Modules || {};
window.Modules.dashboard = function (set) {
  const todayList = API.listAppointments({ scope: 'today' });
  const overdue = API.listOrders({ scope: 'overdue' });
  const trial = API.listOrders({ scope: 'trial' });
  const debts = API.listDebts();
  const debtSum = debts.reduce((s, d) => s + d.debt, 0);
  const reminders = API.listReminders().filter(r => r.delivery_result === '待发送');

  const quick = [
    ['patients', '♙', '登记患者'], ['appointments', '▤', '新建预约'],
    ['billing', '¥', '录入收费'], ['orders', '⬡', '建立订单'],
  ].filter(([m]) => API.can(m));

  set(`
    <div class="page-head">
      <div><div class="page-title">工作台</div><div class="page-desc">${new Date().toLocaleDateString('zh-CN', { year:'numeric',month:'long',day:'numeric',weekday:'long' })} · 诊所经营概览</div></div>
    </div>
    <div class="grid cols-4">
      <div class="kpi"><div class="label">今日预约</div><div class="value">${todayList.length}</div><div class="foot">已确认 ${todayList.filter(a=>a.stage==='已确认').length} · 已到诊 ${todayList.filter(a=>a.stage==='已到诊').length}</div></div>
      <div class="kpi"><div class="label">待处理订单</div><div class="value" style="color:var(--warn)">${trial.length + overdue.length}</div><div class="foot">试戴中 ${trial.length} · 逾期 ${overdue.length}</div></div>
      <div class="kpi"><div class="label">当前欠款</div><div class="value" style="color:var(--danger)">¥${debtSum.toFixed(2)}</div><div class="foot">${debts.length} 张收费单未结清</div></div>
      <div class="kpi"><div class="label">待发提醒</div><div class="value" style="color:var(--accent)">${reminders.length}</div><div class="foot">试戴 / 取件通知</div></div>
    </div>
    <div style="height:18px"></div>
    <div class="card">
      <h3><span class="bar"></span>快捷操作</h3>
      <div class="toolbar">
        ${quick.map(([m, ico, label]) => `<button class="btn ghost" data-go="${m}">${ico} ${label}</button>`).join('')}
      </div>
    </div>
    <div class="grid cols-2">
      <div class="card">
        <h3><span class="bar"></span>今日预约安排</h3>
        ${todayList.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>时间</th><th>患者</th><th>医生</th><th>诊室</th><th>状态</th></tr></thead><tbody>
          ${todayList.map(a => {
            const p = API.raw().patients.find(x => x.id == a.patient_id);
            const doc = API.raw().employees.find(x => x.id == a.doctor_id);
            const room = API.raw().rooms.find(x => x.id == a.room_id);
            return `<tr><td>${App.esc(String(a.starts_at).slice(11))}</td><td>${App.esc(p?.name||'')}</td><td>${App.esc(doc?.name||'')}</td><td>${App.esc(room?.name||'')}</td><td>${App.tag(a.stage)}</td></tr>`;
          }).join('')}
        </tbody></table></div>` : '<div class="empty">今日暂无预约</div>'}
      </div>
      <div class="card">
        <h3><span class="bar"></span>待处理订单</h3>
        ${(trial.concat(overdue)).length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>订单号</th><th>患者</th><th>状态</th><th>承诺日</th></tr></thead><tbody>
          ${trial.concat(overdue).slice(0,8).map(o => {
            const p = API.patientOfOrder(o.id);
            return `<tr><td>${App.esc(o.order_no)}</td><td>${App.esc(p?.name||'')}</td><td>${App.tag(o.stage)}</td><td>${App.esc(o.promised_date||'')}${o.promised_date < new Date().toISOString().slice(0,10) && o.stage!=='已交货' ? ' <span class="tag red">逾期</span>':''}</td></tr>`;
          }).join('')}
        </tbody></table></div>` : '<div class="empty">暂无待处理订单</div>'}
      </div>
    </div>
    <div class="card">
      <h3><span class="bar"></span>近期欠款</h3>
      ${debts.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>收费单</th><th>患者</th><th>应收</th><th>已收</th><th>欠款</th><th>欠款形成</th></tr></thead><tbody>
        ${debts.slice(0,6).map(d => `<tr><td>${App.esc(d.bill.bill_no)}</td><td>${App.esc(d.patient?.name||'—')}</td><td>¥${d.receivable.toFixed(2)}</td><td>¥${d.received.toFixed(2)}</td><td style="color:var(--danger);font-weight:600">¥${d.debt.toFixed(2)}</td><td>${App.esc(String(d.bill.debt_opened_at||'').slice(0,10))}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">暂无欠款</div>'}
    </div>`);

  document.querySelectorAll('[data-go]').forEach(b => {
    b.onclick = () => App.navigate(b.dataset.go);
  });
};
