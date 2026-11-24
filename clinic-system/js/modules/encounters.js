/* 诊疗记录：医生录入主诉、诊断、处理措施与建议复查月数，支持预约一键带入，并直连治疗计划/义齿订单/收费开单 */
window.Modules = window.Modules || {};
window.Modules.encounters = function (set, opts) {
  const session = API.session() || {};
  const canWrite = ['doctor', 'admin'].includes(session.role);
  const canPlan = canWrite && API.can('plans');
  const canOrder = canWrite && API.can('orders');
  const canBill = ['cashier', 'admin'].includes(session.role) && API.can('billing');
  let keyword = '';

  function filteredList() {
    const db = API.raw();
    let list = db.encounters || [];
    if (keyword) {
      const kw = keyword.toLowerCase();
      list = list.filter(e => {
        const p = (db.patients || []).find(x => x.id == e.patient_id);
        const doc = (db.employees || []).find(x => x.id == e.doctor_id);
        return [e.encounter_no, p ? p.name : '', doc ? doc.name : '', e.chief_complaint, e.diagnosis]
          .some(v => String(v || '').toLowerCase().includes(kw));
      });
    }
    return list;
  }

  function renderRows(list) {
    const db = API.raw();
    return list.length ? list.map(e => {
      const p = (db.patients || []).find(x => x.id == e.patient_id);
      const doc = (db.employees || []).find(x => x.id == e.doctor_id);
      const apt = (db.appointments || []).find(x => x.id == e.appointment_id);
      return `<tr>
        <td><b>${App.esc(e.encounter_no)}</b></td>
        <td><span class="av-cell">${App.avatar(p ? p.name : '—')}<b>${App.esc(p ? p.name : '—')}</b></span></td>
        <td>${App.esc(doc ? doc.name : '—')}</td>
        <td>${apt ? `<span class="tag teal">${App.esc(apt.appointment_no)}</span>` : '<span class="muted">现场无预约</span>'}</td>
        <td><b>${App.esc(String(e.occurred_at || '').slice(0, 10))}</b> <span class="muted">${App.esc(String(e.occurred_at || '').slice(11, 16))}</span></td>
        <td>${App.esc(e.diagnosis || e.chief_complaint || '—')}</td>
        <td>${e.recall_months ? `<span class="tag blue">${e.recall_months} 个月后</span>` : '—'}</td>
        <td class="actions">
          <button class="btn ghost sm" data-detail="${e.id}">详情</button>
          ${canPlan ? `<button class="btn soft sm" data-go-plan="${e.id}">+ 治疗计划</button>` : ''}
          ${canOrder ? `<button class="btn ghost sm" data-go-ord="${e.id}">+ 义齿单</button>` : ''}
          ${canBill ? `<button class="btn soft sm" data-go-bill="${e.id}">+ 收费</button>` : ''}
        </td>
      </tr>`;
    }).join('') : '<tr><td colspan="8"><div class="empty">暂无匹配的诊疗记录</div></td></tr>';
  }

  function bindRowActions() {
    const encs = API.raw().encounters || [];
    document.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => detail(encs.find(e => e.id == b.dataset.detail)));
    document.querySelectorAll('[data-go-plan]').forEach(b => b.onclick = () => App.navigate('plans', { autoCreate: true, encounterId: Number(b.dataset.goPlan) }));
    document.querySelectorAll('[data-go-ord]').forEach(b => b.onclick = () => App.navigate('orders', { autoCreate: true, encounterId: Number(b.dataset.goOrd) }));
    document.querySelectorAll('[data-go-bill]').forEach(b => b.onclick = () => App.navigate('billing', { autoCreate: true, encounterId: Number(b.dataset.goBill) }));
  }

  function render() {
    const list = filteredList();
    set(`
      <div class="page-head">
        <div>
          <div class="page-title">诊疗记录</div>
          <div class="page-desc">医生录入主诉、诊断与处理措施，并可一键衔接制定治疗计划、下达义齿委托或发起收费</div>
        </div>
        ${canWrite ? '<button class="btn" id="e-add">+ 录入诊疗</button>' : ''}
      </div>
      <div class="card">
        <div class="note">每条诊疗记录归属一名患者和一名在岗医生，支持无预约现场就诊；关联预约时自动同步患者与医生。填写建议复查月数后自动生成复诊召回任务。</div>
        <div class="toolbar" style="justify-content:space-between;align-items:center">
          ${App.searchBoxHtml('e-kw', '检索诊疗号、患者、医生或诊断…', keyword)}
          <span class="muted">共 <b id="e-cnt">${list.length}</b> 条诊疗记录</span>
        </div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>诊疗编号</th><th>患者</th><th>医生</th><th>关联预约</th><th>就诊时间</th><th>诊断 / 主诉</th><th>建议复查</th><th>操作</th>
        </tr></thead><tbody id="e-tbody">${renderRows(list)}</tbody></table></div>
      </div>`);

    const add = document.getElementById('e-add');
    if (add) add.onclick = () => create({});
    App.bindSearchBox(document, 'e-kw', v => {
      keyword = v;
      const listNow = filteredList();
      const tb = document.getElementById('e-tbody');
      const cnt = document.getElementById('e-cnt');
      if (tb) { tb.innerHTML = renderRows(listNow); bindRowActions(); }
      if (cnt) cnt.textContent = listNow.length;
    });
    bindRowActions();
  }

  function create(preset = {}) {
    const db = API.raw();
    const patients = (db.patients || []).map(p => ({ value: p.id, label: `${p.patient_no} ${p.name}` }));
    const doctors = API.doctors(true).map(e => ({ value: e.id, label: e.name }));
    const usedApptIds = new Set((db.encounters || []).map(e => e.appointment_id).filter(Boolean));
    const appts = [{ value: '', label: '不关联预约（现场就诊）' }].concat(
      (db.appointments || [])
        .filter(a => !usedApptIds.has(a.id) && !['已取消', '爽约'].includes(a.stage))
        .map(a => {
          const p = (db.patients || []).find(x => x.id == a.patient_id);
          const d = (db.employees || []).find(x => x.id == a.doctor_id);
          return { value: a.id, label: `${a.appointment_no} · ${p ? p.name : ''} · ${d ? d.name : ''} · ${String(a.starts_at).slice(0, 16)}` };
        })
    );
    const defaultDoc = (session.employee_id && doctors.some(d => d.value == session.employee_id))
      ? session.employee_id : (doctors[0] ? doctors[0].value : '');
    const initAptId = preset.appointmentId ? String(preset.appointmentId) : '';

    const body = `<div class="form-grid">
      ${App.fieldRow('关联预约（可选，选中后自动同步患者与医生）', App.selectHtml('f-apt', appts, initAptId), true)}
      ${App.fieldRow('患者', App.selectHtml('f-patient', patients, patients[0] ? patients[0].value : ''))}
      ${App.fieldRow('接诊医生', App.selectHtml('f-doctor', doctors, defaultDoc))}
      ${App.fieldRow('就诊时间', `<input id="f-occurred" type="datetime-local" value="${API.localNowMin()}">`)}
      ${App.fieldRow('建议复查间隔（月，选填）', '<input id="f-recall" type="number" min="1" max="36" placeholder="如 3 或 6，自动生成复诊召回">')}
      ${App.fieldRow('主诉（必填）', '<input id="f-complaint" placeholder="如：左下后牙冷热痛">', true)}
      ${App.fieldRow('诊断', '<input id="f-diag" placeholder="如：36 深龋 / 牙髓炎">', true)}
      ${App.fieldRow('处理措施', '<textarea id="f-note" rows="3" placeholder="具体处置与医嘱"></textarea>', true)}
    </div>`;
    const m = App.modal('录入诊疗记录', body, '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">保存诊疗记录</button>', 'lg');

    function syncFromAppt() {
      const aid = Number(m.el.querySelector('#f-apt').value);
      const apt = (db.appointments || []).find(a => a.id == aid);
      if (apt) {
        m.el.querySelector('#f-patient').value = String(apt.patient_id);
        m.el.querySelector('#f-doctor').value = String(apt.doctor_id);
        if (apt.chief_complaint && !m.el.querySelector('#f-complaint').value) {
          m.el.querySelector('#f-complaint').value = apt.chief_complaint;
        }
      }
    }
    m.el.querySelector('#f-apt').onchange = syncFromAppt;
    if (initAptId) syncFromAppt();

    m.el.querySelector('#m-c').onclick = m.close;
    m.el.querySelector('#m-s').onclick = async () => {
      const chief = m.el.querySelector('#f-complaint').value.trim();
      if (!chief) { App.toast('请填写患者主诉', 'err'); return; }
      const recallVal = m.el.querySelector('#f-recall').value.trim();
      const r = await API.addEncounter({
        patient_id: Number(m.el.querySelector('#f-patient').value),
        doctor_id: Number(m.el.querySelector('#f-doctor').value),
        appointment_id: m.el.querySelector('#f-apt').value ? Number(m.el.querySelector('#f-apt').value) : null,
        occurred_at: m.el.querySelector('#f-occurred').value,
        chief_complaint: chief,
        diagnosis: m.el.querySelector('#f-diag').value.trim(),
        treatment_note: m.el.querySelector('#f-note').value.trim(),
        recall_months: recallVal ? Number(recallVal) : null,
      });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close();
      App.toast(`诊疗已保存：${r.data.encounter_no}${recallVal ? '（已自动生成复诊召回）' : ''}`, 'ok');
      render();
    };
  }

  function detail(e) {
    if (!e) return;
    const db = API.raw();
    const p = (db.patients || []).find(x => x.id == e.patient_id);
    const d = (db.employees || []).find(x => x.id == e.doctor_id);
    const body = `<table class="tbl"><tbody>
      <tr><th style="width:120px">诊疗编号</th><td><b>${App.esc(e.encounter_no)}</b></td></tr>
      <tr><th>患者 / 医生</th><td>${App.esc(p ? p.name : '—')} / ${App.esc(d ? d.name : '—')}</td></tr>
      <tr><th>就诊时间</th><td>${App.esc(String(e.occurred_at).replace('T', ' '))}</td></tr>
      <tr><th>主诉</th><td>${App.esc(e.chief_complaint)}</td></tr>
      <tr><th>诊断</th><td>${App.esc(e.diagnosis || '—')}</td></tr>
      <tr><th>处理措施</th><td>${App.esc(e.treatment_note || '—')}</td></tr>
      <tr><th>建议复查间隔</th><td>${e.recall_months ? e.recall_months + ' 个月后复查' : '无'}</td></tr>
    </tbody></table>`;
    const foot = `
      ${canPlan ? `<button class="btn soft" id="dt-plan">+ 制定治疗计划</button>` : ''}
      ${canOrder ? `<button class="btn ghost" id="dt-ord">+ 建立义齿订单</button>` : ''}
      ${canBill ? `<button class="btn soft" id="dt-bill">+ 开具收费单</button>` : ''}
      <button class="btn ghost" id="m-c">关闭</button>`;
    const m = App.modal('诊疗详情 · ' + e.encounter_no, body, foot);
    m.el.querySelector('#m-c').onclick = m.close;
    const bp = m.el.querySelector('#dt-plan');
    if (bp) bp.onclick = () => { m.close(); App.navigate('plans', { autoCreate: true, encounterId: e.id }); };
    const bo = m.el.querySelector('#dt-ord');
    if (bo) bo.onclick = () => { m.close(); App.navigate('orders', { autoCreate: true, encounterId: e.id }); };
    const bb = m.el.querySelector('#dt-bill');
    if (bb) bb.onclick = () => { m.close(); App.navigate('billing', { autoCreate: true, encounterId: e.id }); };
  }

  render();
  if (opts && opts.autoCreate && canWrite) {
    setTimeout(() => create({ appointmentId: opts.appointmentId }), 40);
  }
};
