/* 我的治疗（患者视角）：把就诊记录、修复体进度和费用合成一条时间线
 * 只呈现患者能理解的结果，不暴露订单号、技工所与内部状态机 */
window.Modules = window.Modules || {};
window.Modules.treatment = function (set) {
  const session = API.session();
  const patientId = session && session.patientId ? Number(session.patientId) : 0;

  function render() {
    const db = API.raw();
    const patient = db.patients.find(p => p.id == patientId);
    const timeline = API.patientTreatment(patientId);
    const allOrders = timeline.flatMap(t => t.orders);
    const toTry = allOrders.filter(o => API.progressOf(o).label === '待试戴');
    const toPick = allOrders.filter(o => API.progressOf(o).label === '可取件');
    const dueSum = timeline.reduce((a, t) => a + t.fee.due, 0);

    const todo = [];
    if (toTry.length) todo.push(`有 ${toTry.length} 件修复体已到店，请预约试戴`);
    if (toPick.length) todo.push(`有 ${toPick.length} 件修复体可来院取件`);
    if (dueSum > 0) todo.push(`待付费用 ¥${dueSum.toFixed(2)}`);

    set(`
      <div class="page-head"><div>
        <div class="page-title">我的治疗</div>
        <div class="page-desc">就诊记录、修复进度与费用对账，按时间从新到旧</div>
      </div></div>

      ${todo.length ? `<div class="card" style="border-left:3px solid var(--accent)">
        <div class="note" style="background:transparent;border:0;padding:0">
          ${todo.map(t => `<div style="margin:2px 0">· ${App.esc(t)}</div>`).join('')}
        </div></div>` : ''}

      <div class="grid cols-3" style="margin-bottom:16px">
        <div class="kpi"><div class="label">就诊次数</div><div class="value">${timeline.length}</div><div class="kpi-foot">累计</div></div>
        <div class="kpi"><div class="label">修复体</div><div class="value">${allOrders.length}</div><div class="kpi-foot">件</div></div>
        <div class="kpi"><div class="label">待付费用</div><div class="value">¥${dueSum.toFixed(2)}</div><div class="kpi-foot">含未结清</div></div>
      </div>

      ${timeline.length ? timeline.map(t => {
        const e = t.encounter;
        const items = t.orders.map(o => {
          const pg = API.progressOf(o);
          const ap = API.applianceOf(o);
          const picked = pg.label === '可取件';
          const eta = picked
            ? (o.delivered_at ? String(o.delivered_at).slice(0, 10) : (o.expected_at ? String(o.expected_at).slice(0, 10) : ''))
            : (o.expected_at ? String(o.expected_at).slice(0, 10) : (o.promised_date || ''));
          const etaLabel = picked ? '到店 ' : '预计 ';
          return `<div class="appliance">
            <div class="appliance-main"><b>${App.esc(ap.text)}</b>
              <span class="tag ${pg.tone}">${App.esc(pg.label)}</span></div>
            <div class="appliance-hint">${App.esc(pg.hint)}${eta ? ' · ' + etaLabel + App.esc(eta) : ''}</div>
          </div>`;
        }).join('');
        return `<div class="card">
          <div class="visit-head">
            <div>
              <div class="visit-date">${App.esc(String(e.occurred_at).slice(0, 10))}</div>
              <div class="visit-doc">${App.esc(t.doctor ? t.doctor.name : '')} · ${App.esc(e.diagnosis || '门诊')}</div>
            </div>
            <div class="visit-fee">
              <span>应收 ¥${t.fee.receivable.toFixed(2)}</span>
              <span>已付 ¥${t.fee.paid.toFixed(2)}</span>
              <span class="${t.fee.due > 0 ? 'due' : ''}">${t.fee.due > 0 ? '待付 ¥' + t.fee.due.toFixed(2) : '已结清'}</span>
            </div>
          </div>
          ${e.chief_complaint || e.treatment_note ? `<div class="note" style="margin:10px 0 0">
            ${e.chief_complaint ? `<div><b>主诉</b>　${App.esc(e.chief_complaint)}</div>` : ''}
            ${e.treatment_note ? `<div><b>处理</b>　${App.esc(e.treatment_note)}</div>` : ''}
          </div>` : ''}
          ${items ? `<div class="appliance-list">${items}</div>` : ''}
        </div>`;
      }).join('') : `<div class="card"><div class="empty">暂无就诊记录。就诊后这里会显示治疗过程与修复进度。</div></div>`}

      <div class="card">
        <div class="note">修复体进度只有三种对你的状态：制作中、待试戴、可取件。返工等内部处理不会再单独打扰你，时间变化会通过提醒通知。
        ${patient && patient.important_note ? `<br><b>就诊提示</b>　${App.esc(patient.important_note)}` : ''}</div>
      </div>`);
  }

  render();
};
