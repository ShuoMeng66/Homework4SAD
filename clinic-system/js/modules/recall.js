/* 复诊召回：按诊疗建议复查间隔自动生成召回任务、到期提醒、回访状态跟踪与约诊闭环 */
window.Modules = window.Modules || {};
window.Modules.recall = function (set) {
  const session = API.session() || {};
  const canBook = ['receptionist', 'admin'].includes(session.role);
  const today = () => API.localToday(0);
  let tab = '待通知';

  const daysDiff = (a, b) => {
    const [y1, m1, d1] = a.split('-').map(Number);
    const [y2, m2, d2] = b.split('-').map(Number);
    return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
  };

  function render() {
    const db = API.raw();
    const all = (db.recalls || []).slice().sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
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
      <div class="page-head"><div>
        <div class="page-title">复诊召回</div>
        <div class="page-desc">患者定期复查提醒与回访约诊</div>
      </div></div>
      <div class="grid cols-4" style="margin-bottom:16px">
        ${[['待通知', counts['待通知'], '需联系回访'], ['已通知', counts['已通知'], '等待约诊'],
           ['已预约', counts['已预约'], '已安排复诊'], ['已逾期', overdue.length, '超过建议复查日']]
          .map(([l, v, s]) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div><div class="kpi-foot">${s}</div></div>`).join('')}
      </div>
      <div class="card">
        <div class="tabs">
          ${['待通知', '已通知', '已预约', '已关闭', '全部'].map(k => {
            const c = k === '全部' ? all.length : counts[k];
            return `<div class="tab ${tab === k ? 'active' : ''}" data-tab="${k}">${k}<span class="tab-badge">${c}</span></div>`;
          }).join('')}
        </div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>患者</th><th>联系电话</th><th>到期日</th><th>状态</th><th>召回原因</th><th>回访备注</th><th>操作</th>
        </tr></thead><tbody>
          ${list.length ? list.map(r => {
            const p = (db.patients || []).find(x => x.id == r.patient_id);
            const gap = daysDiff(t, r.due_date);
            const late = ['待通知', '已通知'].includes(r.stage) && gap < 0;
            const apt = (db.appointments || []).find(a => a.id == r.appointment_id);
            return `<tr>
              <td><span class="av-cell">${App.avatar(p ? p.name : '—')}<b>${App.esc(p ? p.name : '—')}</b></span></td>
              <td>${App.esc(p ? p.phone || '—' : '—')}</td>
              <td><b>${App.esc(r.due_date)}</b> ${late
                ? `<span class="tag red">逾期 ${-gap} 天</span>`
                : `<span class="muted">${gap >= 0 ? gap + ' 天后' : ''}</span>`}</td>
              <td>${App.tag(r.stage)}</td>
              <td>${App.esc(r.reason)}</td>
              <td class="muted">${App.esc(r.note || (apt ? '已关联预约 ' + apt.appointment_no : '—'))}</td>
              <td class="actions">
                ${canBook && ['待通知', '已通知'].includes(r.stage) ? `<button class="btn soft sm" data-book-rc="${r.id}">立即约诊</button>` : ''}
                ${r.stage === '待通知' ? `<button class="btn ghost sm" data-notify="${r.id}">登记通知</button>` : ''}
                ${['待通知', '已通知'].includes(r.stage) ? `<button class="btn ghost sm" data-close="${r.id}">关闭</button>` : ''}
                ${r.stage === '已预约' && apt ? `<span class="muted">${App.esc(apt.appointment_no)}</span>` : ''}
                ${r.stage === '已关闭' ? '<span class="muted">已终结</span>' : ''}
              </td></tr>`;
          }).join('') : '<tr><td colspan="7"><div class="empty">当前状态暂无复诊召回</div></td></tr>'}
        </tbody></table></div>
      </div>`);

    document.querySelectorAll('[data-tab]').forEach(el => { el.onclick = () => { tab = el.dataset.tab; render(); }; });
    document.querySelectorAll('[data-book-rc]').forEach(b => b.onclick = () => {
      const r = all.find(x => x.id == b.dataset.bookRc);
      if (!r) return;
      App.navigate('appointments', { autoCreate: true, patientId: r.patient_id, chiefComplaint: r.reason });
    });
    document.querySelectorAll('[data-notify]').forEach(b => b.onclick = () => markNotify(Number(b.dataset.notify)));
    document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => markClose(Number(b.dataset.close)));
  }

  function markNotify(id) {
    const r = (API.raw().recalls || []).find(x => x.id == id);
    if (!r) return;
    const m = App.modal('登记回访通知', App.fieldRow('回访记录', `<input id="f-note" value="已电话联系患者提醒按期复查">`, true),
      '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">确认已通知</button>', 'sm');
    m.el.querySelector('#m-c').onclick = m.close;
    m.el.querySelector('#m-s').onclick = async () => {
      const res = await API.setRecallStage(id, '已通知', { note: m.el.querySelector('#f-note').value.trim() });
      if (!res.ok) { App.toast(res.error, 'err'); return; }
      m.close(); App.toast('已登记通知', 'ok'); render();
    };
  }

  function markClose(id) {
    const m = App.modal('关闭复诊召回',
      `<div class="note warn">已关闭的召回任务不可回退。</div>${App.fieldRow('关闭原因', '<input id="f-note" placeholder="如：患者明确暂不复查">', true)}`,
      '<button class="btn ghost" id="m-c">取消</button><button class="btn danger" id="m-s">确认关闭</button>', 'sm');
    m.el.querySelector('#m-c').onclick = m.close;
    m.el.querySelector('#m-s').onclick = async () => {
      const res = await API.setRecallStage(id, '已关闭', { note: m.el.querySelector('#f-note').value.trim() });
      if (!res.ok) { App.toast(res.error, 'err'); return; }
      m.close(); App.toast('召回已关闭', 'ok'); render();
    };
  }

  render();
};
