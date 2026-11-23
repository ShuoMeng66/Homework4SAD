/* 我的治疗（患者视角）：按治疗计划讲进度，不暴露订单与内部状态
 * 一份计划 = 一个治疗目标；计划项只有「待安排 / 已完成 / 制作中 / 待试戴 / 可取件」 */
window.Modules = window.Modules || {};
window.Modules.treatment = function (set) {
  const session = API.session();
  const patientId = session && session.patientId ? Number(session.patientId) : 0;

  function render() {
    const db = API.raw();
    const patient = db.patients.find(p => p.id == patientId);
    const plans = API.listPlans({ patient_id: patientId });

    const bills = (db.bills || []).filter(b => {
      const p = API.patientOfBill(b.id);
      return p && p.id == patientId && b.stage !== '已作废';
    });
    const fee = bills.reduce((a, b) => {
      const c = API.calcBill(b.id);
      a.receivable += c.receivable; a.paid += c.received; a.due += c.debt;
      return a;
    }, { receivable: 0, paid: 0, due: 0 });

    const todo = [];
    plans.forEach(p => API.planProgress(p.id).items.forEach(i => {
      const v = API.planItemView(i);
      const t = i.tooth_code ? API.toothName(i.tooth_code) + ' ' : '';
      if (v.label === '待试戴') todo.push(`${t}${i.name} 已到店，请预约试戴`);
      if (v.label === '可取件') todo.push(`${t}${i.name} 可以来院取件`);
    }));
    if (fee.due > 0) todo.push(`待付费用 ¥${fee.due.toFixed(2)}`);

    set(`
      <div class="page-head"><div>
        <div class="page-title">我的治疗</div>
        <div class="page-desc">每个治疗目标做到哪一步，一目了然</div>
      </div></div>

      ${todo.length ? `<div class="card" style="border-left:3px solid var(--accent)">
        ${todo.map(t => `<div style="font-size:13px;margin:3px 0">· ${App.esc(t)}</div>`).join('')}
      </div>` : ''}

      <div class="grid cols-3" style="margin-bottom:16px">
        <div class="kpi"><div class="label">治疗计划</div><div class="value">${plans.length}</div><div class="kpi-foot">份</div></div>
        <div class="kpi"><div class="label">累计应收</div><div class="value" style="font-size:22px">¥${fee.receivable.toFixed(0)}</div><div class="kpi-foot">已付 ¥${fee.paid.toFixed(0)}</div></div>
        <div class="kpi"><div class="label">待付</div><div class="value" style="color:${fee.due > 0 ? 'var(--danger)' : 'var(--success)'}">¥${fee.due.toFixed(0)}</div><div class="kpi-foot">含未结清</div></div>
      </div>

      ${plans.length ? plans.map(plan => {
        const pg = API.planProgress(plan.id);
        const rows = pg.items.map(i => {
          const v = API.planItemView(i);
          const when = i.executed_at ? String(i.executed_at).slice(0, 10) : '';
          return `<div class="appliance">
            <div class="appliance-main">
              <b>${i.tooth_code ? App.esc(API.toothName(i.tooth_code)) + ' · ' : ''}${App.esc(i.name)}</b>
              <span class="tag ${v.tone}">${App.esc(v.label)}</span>
            </div>
            <div class="appliance-hint">第 ${i.phase_no} 期${when ? ' · 完成于 ' + App.esc(when) : ''}</div>
          </div>`;
        }).join('');
        return `<div class="card">
          <div class="visit-head">
            <div>
              <div class="visit-date">${App.esc(plan.diagnosis || '治疗计划')}</div>
              <div class="visit-doc">${App.esc(plan.plan_no)} · 已完成 ${pg.done}/${pg.total} 项</div>
            </div>
            <div class="visit-fee"><span>${App.tag(plan.stage)}</span><span>报价 ¥${pg.amount.toFixed(0)}</span></div>
          </div>
          <div class="appliance-list">${rows}</div>
        </div>`;
      }).join('') : `<div class="card"><div class="empty">暂无治疗计划。医生制定计划后，这里会显示还要做几步、每一步做到哪。</div></div>`}

      <div class="card">
        <div class="note">修复类项目在制作期间只显示“制作中”，返工等内部处理不再单独打扰你，时间变化会通过提醒通知。
        ${patient && patient.important_note ? `<br><b>就诊提示</b>　${App.esc(patient.important_note)}` : ''}</div>
      </div>`);
  }

  render();
};
