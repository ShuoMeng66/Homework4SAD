/* 复诊召回 F4-2：诊疗完成后按建议复查间隔到期提醒，推动患者回诊（BR-12） */
window.Modules = window.Modules || {};
window.Modules.recall = function (set) {
  const today = () => new Date().toISOString().slice(0, 10);
  let tab = '待通知';

  const days = (a, b) => Math.round((new Date(b + 'T00:00') - new Date(a + 'T00:00')) / 86400000);

  function render() {
    const db = API.raw();
    const all = API.listRecalls();
    const t = today();
    const overdue = all.filter(r => ['待通知', '已通知'].includes(r.stage) && r.due_date < t);
    const counts = {
      '待通知': all.filter(r => r.stage === '待通知').length,
      '已通知': all.filter(r => r.stage === '已通知').length,
      '已预约': all.filter(r => r.stage === '已预约').length,
      '已关闭': all.filter(r => r.stage === '已关闭').length,
    };
    const list = tab === '全部' ? all : all.filter(r => r.stage === tab);

    set(`
      <div class="page-head"><div><div class="page-title">复诊召回</div>
        <div class="page-desc">F4-2 · 按诊疗建议复查间隔到期提醒，患者约诊后自动闭环</div></div></div>
      <div class="grid cols-4" style="margin-bottom:16px">
        ${[['待通知', counts['待通知'], '需联系'], ['已通知', counts['已通知'], '等患者约诊'],
           ['已预约', counts['已预约'], '已回诊'], ['逾期', overdue.length, '已过到期日']]
          .map(([l, v, s]) => `<div class="kpi"><div class="label">${l}</div>
            <div class="value">${v}</div><div class="kpi-foot">${s}</div></div>`).join('')}
      </div>
      <div class="card">
        <div class="note">BR-12：诊疗记录填写“建议复查间隔”后，系统按 occurred_at + 间隔生成召回；到期未回诊视为逾期。患者在已通知状态下完成约诊，召回自动标记为已预约，不需要人工核对。</div>
        <div class="tabs">
          ${['待通知', '已通知', '已预约', '已关闭', '全部'].map(k =>
            `<div class="tab ${tab === k ? 'active' : ''}" data-tab="${k}">${k}</div>`).join('')}
        </div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>患者</th><th>联系电话</th><th>到期日</th><th>状态</th><th>召回原因</th><th>操作</th>
        </tr></thead><tbody>
          ${list.length ? list.map(r => {
            const p = db.patients.find(x => x.id == r.patient_id);
            const gap = days(t, r.due_date);
            const late = ['待通知', '已通知'].includes(r.stage) && gap < 0;
            return `<tr><td>${App.esc(p ? p.name : '')}</td><td>${App.esc(p ? p.phone : '')}</td>
              <td>${App.esc(r.due_date)} ${late
                ? `<span class="tag red">逾期 ${-gap} 天</span>`
                : `<span class="muted">${gap >= 0 ? gap + ' 天后' : ''}</span>`}</td>
              <td>${App.tag(r.stage)}</td><td>${App.esc(r.reason || '')}</td>
              <td class="actions">
                ${r.stage === '待通知' ? `<button class="btn ghost sm" data-notify="${r.id}">通知患者</button> ` : ''}
                ${r.stage === '已预约' && r.appointment_id
                  ? `<button class="btn ghost sm" data-goto="${r.id}">查看预约</button> ` : ''}
                ${['待通知', '已通知'].includes(r.stage)
                  ? `<button class="btn ghost sm" data-close="${r.id}">关闭</button>` : ''}
                ${r.stage === '已关闭' ? '<span class="muted">已结束</span>' : ''}
              </td></tr>`;
          }).join('') : `<tr><td colspan="6"><div class="empty">该状态暂无召回记录</div></td></tr>`}
        </tbody></table></div>
      </div>`);

    document.querySelectorAll('[data-tab]').forEach(el =>
      el.onclick = () => { tab = el.dataset.tab; render(); });
    document.querySelectorAll('[data-notify]').forEach(b => b.onclick = () => notify(Number(b.dataset.notify)));
    document.querySelectorAll('[data-close]').forEach(b => b.onclick = async () => {
      const r = await API.setRecallStage(Number(b.dataset.close), '已关闭');
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      App.toast('召回已关闭', 'ok'); render();
    });
    document.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => App.navigate('appointments'));
  }

  async function notify(id) {
    const db = API.raw();
    const r = db.recalls.find(x => x.id == id);
    if (!r) return;
    const p = db.patients.find(x => x.id == r.patient_id) || {};
    const res = await API.setRecallStage(id, '已通知');
    if (!res.ok) { App.toast(res.error, 'err'); return; }
    await API.pushReminder({
      kind: '复诊召回', scheduled_at: r.due_date + 'T09:00',
      recipient: p.phone || '', content: `复查提醒：${r.reason || '建议复诊'}，请预约到诊。`,
    });
    await API.flush();
    App.toast('已生成召回提醒并标记为已通知', 'ok');
    render();
  }

  render();
};
