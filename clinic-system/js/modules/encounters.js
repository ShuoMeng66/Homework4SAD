/* 诊疗记录：医生录入主诉、诊断、处理措施与建议复查月数，可选关联预约，并自动触发复诊召回 */
window.Modules = window.Modules || {};
window.Modules.encounters = function (set) {
  const session = API.session() || {};
  const canWrite = ['doctor', 'admin'].includes(session.role);

  function render() {
    const db = API.raw();
    const list = db.encounters || [];
    set(`
      <div class="page-head">
        <div>
          <div class="page-title">诊疗记录</div>
          <div class="page-desc">医生录入主诉、诊断与处理措施，作为治疗计划执行、收费与义齿委托的临床依据</div>
        </div>
        ${canWrite ? '<button class="btn" id="e-add">+ 录入诊疗</button>' : ''}
      </div>
      <div class="card">
        <div class="note">每条诊疗记录归属一名患者和一名在岗医生，支持无预约现场就诊；关联预约时须保证两者的患者与医生完全一致。填写建议复查月数后系统自动生成复诊召回任务。</div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>诊疗编号</th><th>患者</th><th>医生</th><th>关联预约</th><th>就诊时间</th><th>诊断</th><th>建议复查</th><th>操作</th>
        </tr></thead><tbody>
          ${list.length ? list.map(e => {
            const p = (db.patients || []).find(x => x.id == e.patient_id);
            const doc = (db.employees || []).find(x => x.id == e.doctor_id);
            const apt = (db.appointments || []).find(x => x.id == e.appointment_id);
            return `<tr>
              <td>${App.esc(e.encounter_no)}</td>
              <td>${App.esc(p ? p.name : '—')}</td>
              <td>${App.esc(doc ? doc.name : '—')}</td>
              <td>${apt ? App.esc(apt.appointment_no) : '现场无预约'}</td>
              <td>${App.esc(String(e.occurred_at || '').slice(0, 16).replace('T', ' '))}</td>
              <td>${App.esc(e.diagnosis || '—')}</td>
              <td>${e.recall_months ? `<span class="tag blue">${e.recall_months} 个月后</span>` : '—'}</td>
              <td class="actions"><button class="btn ghost sm" data-detail="${e.id}">详情</button></td>
            </tr>`;
          }).join('') : '<tr><td colspan="8"><div class="empty">暂无诊疗记录</div></td></tr>'}
        </tbody></table></div>
      </div>`);

    const add = document.getElementById('e-add');
    if (add) add.onclick = create;
    document.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => detail((API.raw().encounters || []).find(e => e.id == b.dataset.detail)));
  }

  function create() {
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

    const body = `<div class="form-grid">
      ${App.fieldRow('关联预约（可选）', App.selectHtml('f-apt', appts, ''), true)}
      ${App.fieldRow('患者', App.selectHtml('f-patient', patients, patients[0] ? patients[0].value : ''))}
      ${App.fieldRow('接诊医生', App.selectHtml('f-doctor', doctors, defaultDoc))}
      ${App.fieldRow('就诊时间', `<input id="f-occurred" type="datetime-local" value="${API.localNowMin()}">`)}
      ${App.fieldRow('建议复查间隔（月，选填）', '<input id="f-recall" type="number" min="1" max="36" placeholder="填正整数则自动生成复诊召回">')}
      ${App.fieldRow('主诉（必填）', '<input id="f-complaint" placeholder="如：左下后牙冷热痛">', true)}
      ${App.fieldRow('诊断', '<input id="f-diag" placeholder="如：36 深龋">', true)}
      ${App.fieldRow('处理措施', '<textarea id="f-note" rows="3" placeholder="具体处置与医嘱"></textarea>', true)}
    </div>`;
    const m = App.modal('录入诊疗记录', body, '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">保存</button>', 'lg');

    // 选择预约后自动同步患者、医生与主诉，确保跨表一致
    m.el.querySelector('#f-apt').onchange = () => {
      const aid = Number(m.el.querySelector('#f-apt').value);
      const apt = (db.appointments || []).find(a => a.id == aid);
      if (apt) {
        m.el.querySelector('#f-patient').value = String(apt.patient_id);
        m.el.querySelector('#f-doctor').value = String(apt.doctor_id);
        if (apt.chief_complaint && !m.el.querySelector('#f-complaint').value) {
          m.el.querySelector('#f-complaint').value = apt.chief_complaint;
        }
      }
    };

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
      <tr><th style="width:120px">诊疗编号</th><td>${App.esc(e.encounter_no)}</td></tr>
      <tr><th>患者 / 医生</th><td>${App.esc(p ? p.name : '—')} / ${App.esc(d ? d.name : '—')}</td></tr>
      <tr><th>就诊时间</th><td>${App.esc(String(e.occurred_at).replace('T', ' '))}</td></tr>
      <tr><th>主诉</th><td>${App.esc(e.chief_complaint)}</td></tr>
      <tr><th>诊断</th><td>${App.esc(e.diagnosis || '—')}</td></tr>
      <tr><th>处理措施</th><td>${App.esc(e.treatment_note || '—')}</td></tr>
      <tr><th>建议复查间隔</th><td>${e.recall_months ? e.recall_months + ' 个月后复查' : '无'}</td></tr>
    </tbody></table>`;
    const m = App.modal('诊疗详情 · ' + e.encounter_no, body, '<button class="btn ghost" id="m-c">关闭</button>');
    m.el.querySelector('#m-c').onclick = m.close;
  }

  render();
};
