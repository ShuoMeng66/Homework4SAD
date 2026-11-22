/* 诊疗记录（配套用例）：医生录入诊疗，关联患者/预约 */
window.Modules = window.Modules || {};
window.Modules.encounters = function (set) {
  function render() {
    const db = API.raw();
    const list = API.listEncounters();
    set(`
      <div class="page-head"><div><div class="page-title">诊疗记录</div><div class="page-desc">配套用例 · 医生录入诊疗内容，可选关联预约（表20、6.2）</div></div>
        <button class="btn" id="e-add">+ 录入诊疗</button></div>
      <div class="card">
        <div class="note">每条诊疗记录归属一名患者和一名医生，可以不关联预约。诊疗关联预约时，两者的患者和医生必须一致（8.7 跨表一致性）。</div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>诊疗编号</th><th>患者</th><th>医生</th><th>关联预约</th><th>日期</th><th>诊断</th><th>操作</th></tr></thead><tbody>
          ${list.length ? list.map(e => {
            const p = db.patients.find(x=>x.id==e.patient_id);
            const doc = db.employees.find(x=>x.id==e.doctor_id);
            const apt = db.appointments.find(x=>x.id==e.appointment_id);
            return `<tr><td>${App.esc(e.encounter_no)}</td><td>${App.esc(p?.name||'')}</td><td>${App.esc(doc?.name||'')}</td>
              <td>${apt?App.esc(apt.appointment_no):'—'}</td><td>${App.esc(String(e.occurred_at).slice(0,16))}</td>
              <td>${App.esc(e.diagnosis||'')}</td>
              <td class="actions"><button class="btn ghost sm" data-detail="${e.id}">详情</button></td></tr>`;
          }).join('') : `<tr><td colspan="7"><div class="empty">暂无诊疗记录</div></td></tr>`}
        </tbody></table></div>
      </div>`);
    document.getElementById('e-add').onclick = create;
    document.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => detail(API.raw().encounters.find(e=>e.id==b.dataset.detail)));
  }

  function create() {
    const db = API.raw();
    const patients = db.patients.map(p=>({value:p.id,label:`${p.patient_no} ${p.name}`}));
    const doctors = db.employees.filter(e=>e.role==='doctor').map(e=>({value:e.id,label:e.name}));
    const appts = [{value:'',label:'不关联预约'}].concat(db.appointments.map(a=>({value:a.id,label:`${a.appointment_no} ${a.starts_at}`})));
    const body = `<div class="form-grid">
      ${App.fieldRow('患者', App.selectHtml('f-patient', patients, patients[0]?.value))}
      ${App.fieldRow('医生', App.selectHtml('f-doctor', doctors, doctors[0]?.value))}
      ${App.fieldRow('关联预约', App.selectHtml('f-apt', appts, ''))}
      ${App.fieldRow('日期时间', `<input id="f-occurred" type="datetime-local" value="${new Date().toISOString().slice(0,16)}">`)}
      ${App.fieldRow('主诉', `<input id="f-complaint">`, true)}
      ${App.fieldRow('诊断', `<input id="f-diag">`, true)}
      ${App.fieldRow('处理记录', `<textarea id="f-note" rows="3"></textarea>`, true)}
    </div>`;
    const m = App.modal('录入诊疗', body,
      `<button class="btn ghost" id="m-cancel">取消</button><button class="btn" id="m-save">保存</button>`);
    m.el.querySelector('#m-cancel').onclick = m.close;
    m.el.querySelector('#m-save').onclick = () => {
      const patientId = Number(m.el.querySelector('#f-patient').value);
      const aptVal = m.el.querySelector('#f-apt').value;
      // 跨表一致性：预约的患者/医生须一致
      if (aptVal) {
        const apt = db.appointments.find(a=>a.id==aptVal);
        if (apt && (apt.patient_id != patientId || apt.doctor_id != Number(m.el.querySelector('#f-doctor').value))) {
          App.toast('关联预约的患者/医生与本次诊疗不一致','err'); return;
        }
      }
      API.addEncounter({
        patient_id: patientId, clinic_id: 1,
        doctor_id: Number(m.el.querySelector('#f-doctor').value),
        appointment_id: aptVal ? Number(aptVal) : null,
        occurred_at: m.el.querySelector('#f-occurred').value,
        chief_complaint: m.el.querySelector('#f-complaint').value.trim(),
        diagnosis: m.el.querySelector('#f-diag').value.trim(),
        treatment_note: m.el.querySelector('#f-note').value.trim(),
      });
      m.close(); App.toast('诊疗记录已保存','ok'); render();
    };
  }

  function detail(e) {
    if (!e) return;
    const body = `<table class="tbl"><tbody>
      <tr><th style="width:110px">诊疗编号</th><td>${App.esc(e.encounter_no)}</td></tr>
      <tr><th>日期</th><td>${App.esc(e.occurred_at)}</td></tr>
      <tr><th>主诉</th><td>${App.esc(e.chief_complaint||'')}</td></tr>
      <tr><th>诊断</th><td>${App.esc(e.diagnosis||'')}</td></tr>
      <tr><th>处理记录</th><td>${App.esc(e.treatment_note||'')}</td></tr>
    </tbody></table>`;
    App.modal('诊疗详情', body, `<button class="btn ghost" id="m-close">关闭</button>`);
    document.getElementById('m-close').onclick = () => document.getElementById('modal-root').innerHTML='';
  }

  render();
};
