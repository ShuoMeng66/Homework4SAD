/* 预约管理 F4 / UC-01：登记、冲突检查、今日/明日/期间查询、状态流转、改约留痕 */
window.Modules = window.Modules || {};
window.Modules.appointments = function (set) {
  let scope = 'today', start = '', end = '';

  function render() {
    const db = API.raw();
    const list = API.listAppointments(scope === 'period' ? { start, end } : { scope });
    set(`
      <div class="page-head"><div><div class="page-title">预约管理</div><div class="page-desc">F4 / UC-01 · 冲突检查、状态流转与改约留痕</div></div>
        <button class="btn" id="a-add">+ 新建预约</button></div>
      <div class="card">
        <div class="note">BR-01：同一医生或诊室同一时段不能有两个有效预约。预约时段含开始、不含结束；取消与爽约不占用未来时段（表22、6.2）。</div>
        <div class="tabs">
          ${[['today','今日'],['tomorrow','明日'],['period','期间'],['all','全部']].map(([k,l])=>`<div class="tab ${scope===k?'active':''}" data-scope="${k}">${l}</div>`).join('')}
        </div>
        ${scope==='period'?`<div class="toolbar">
          <div class="field"><label>开始</label><input id="a-start" type="date" value="${start}"></div>
          <div class="field"><label>结束</label><input id="a-end" type="date" value="${end}"></div>
          <button class="btn ghost" id="a-query">查询</button></div>`:''}
        <div class="table-wrap"><table class="tbl"><thead><tr><th>预约编号</th><th>患者</th><th>医生</th><th>诊室</th><th>时间</th><th>类型</th><th>状态</th><th>操作</th></tr></thead><tbody>
          ${list.length ? list.map(a => {
            const p = db.patients.find(x=>x.id==a.patient_id);
            const doc = db.employees.find(x=>x.id==a.doctor_id);
            const room = db.rooms.find(x=>x.id==a.room_id);
            const type = db.basicOptions.find(x=>x.id==a.type_id);
            return `<tr><td>${App.esc(a.appointment_no)}</td><td>${App.esc(p?.name||'')}</td><td>${App.esc(doc?.name||'')}</td><td>${App.esc(room?.name||'')}</td>
              <td>${App.esc(a.starts_at)} ~ ${App.esc(String(a.ends_at).slice(11))}</td><td>${App.esc(type?.name||'')}</td><td>${App.tag(a.stage)}</td>
              <td class="actions"><button class="btn ghost sm" data-stage="${a.id}">状态</button> <button class="btn ghost sm" data-resched="${a.id}">改约</button> <button class="btn ghost sm" data-hist="${a.id}">留痕</button></td></tr>`;
          }).join('') : `<tr><td colspan="8"><div class="empty">该范围暂无预约</div></td></tr>`}
        </tbody></table></div>
      </div>`);
    bind();
  }

  function bind() {
    document.getElementById('a-add').onclick = () => create();
    document.querySelectorAll('[data-scope]').forEach(el => el.onclick = () => { scope = el.dataset.scope; render(); });
    const q = document.getElementById('a-query');
    if (q) q.onclick = () => { start = document.getElementById('a-start').value; end = document.getElementById('a-end').value; render(); };
    document.querySelectorAll('[data-stage]').forEach(b => b.onclick = () => changeStage(API.raw().appointments.find(a=>a.id==b.dataset.stage)));
    document.querySelectorAll('[data-resched]').forEach(b => b.onclick = () => reschedule(API.raw().appointments.find(a=>a.id==b.dataset.resched)));
    document.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => history(API.raw().appointments.find(a=>a.id==b.dataset.hist)));
  }

  function create() {
    const db = API.raw();
    const patients = db.patients.map(p=>({value:p.id,label:`${p.patient_no} ${p.name}`}));
    const doctors = db.employees.filter(e=>e.role==='doctor').map(e=>({value:e.id,label:e.name}));
    const rooms = db.rooms.filter(r=>r.active).map(r=>({value:r.id,label:r.name}));
    const types = API.listOptions('预约类型').map(o=>({value:o.id,label:o.name}));
    const now = new Date();
    const defStart = now.toISOString().slice(0,10)+'T09:00';
    const body = `<div class="note">步骤 UC-01：提交主诉 → 检查患者 → 提交医生/诊室/日期时段 → 系统检查冲突 → 确认预约 → 保存编号。</div>
      <div class="form-grid">
        ${App.fieldRow('患者', App.selectHtml('f-patient', patients, patients[0]?.value))}
        ${App.fieldRow('预约类型', App.selectHtml('f-type', types, types[0]?.value))}
        ${App.fieldRow('医生', App.selectHtml('f-doctor', doctors, doctors[0]?.value))}
        ${App.fieldRow('诊室', App.selectHtml('f-room', rooms, rooms[0]?.value))}
        ${App.fieldRow('开始时间', `<input id="f-start" type="datetime-local" value="${defStart}">`)}
        ${App.fieldRow('结束时间', `<input id="f-end" type="datetime-local" value="${now.toISOString().slice(0,10)+'T09:30'}">`)}
        ${App.fieldRow('主诉', `<input id="f-complaint" placeholder="患者主诉">`, true)}
      </div>
      <div id="conflict-box"></div>`;
    const m = App.modal('新建预约', body,
      `<button class="btn ghost" id="m-cancel">取消</button><button class="btn" id="m-check">检查冲突</button><button class="btn success" id="m-save">确认预约</button>`);
    m.el.querySelector('#m-cancel').onclick = m.close;
    const readForm = () => ({
      patient_id: Number(m.el.querySelector('#f-patient').value),
      doctor_id: Number(m.el.querySelector('#f-doctor').value),
      room_id: Number(m.el.querySelector('#f-room').value),
      type_id: Number(m.el.querySelector('#f-type').value),
      starts_at: m.el.querySelector('#f-start').value,
      ends_at: m.el.querySelector('#f-end').value,
      chief_complaint: m.el.querySelector('#f-complaint').value.trim(),
    });
    let checked = false;
    m.el.querySelector('#m-check').onclick = () => {
      const f = readForm();
      if (!f.starts_at || !f.ends_at || f.starts_at >= f.ends_at) { App.toast('时间区间无效（starts_at 须早于 ends_at）','err'); return; }
      const r = API.checkConflict(f.doctor_id, f.room_id, f.starts_at, f.ends_at);
      checked = r.ok;
      const box = m.el.querySelector('#conflict-box');
      if (r.ok) box.innerHTML = '<div class="note" style="background:#e4f6ee;border-color:var(--success);color:#137a52">✓ 该时段医生与诊室均可用，可以确认预约。</div>';
      else box.innerHTML = `<div class="note error">✗ 冲突：${r.conflicts.map(c=>c.appointment_no).join('、')} 在该时段占用资源。
        <br>候选时段：${r.candidates.length?r.candidates.map(c=>`<button class="btn ghost sm" data-cand="${c}" style="margin:3px">${c.slice(11)}</button>`).join(''):'无'}</div>`;
      box.querySelectorAll('[data-cand]').forEach(b => b.onclick = () => {
        m.el.querySelector('#f-start').value = b.dataset.cand;
        const dt = new Date(b.dataset.cand); dt.setMinutes(dt.getMinutes()+30);
        m.el.querySelector('#f-end').value = dt.toISOString().slice(0,16);
        App.toast('已填入候选时段，请重新检查','ok');
      });
    };
    m.el.querySelector('#m-save').onclick = () => {
      if (!checked) { App.toast('请先通过冲突检查','err'); return; }
      const f = readForm();
      const r = API.checkConflict(f.doctor_id, f.room_id, f.starts_at, f.ends_at);
      if (!r.ok) { App.toast('时段已被占用，请重新选择','err'); return; }
      const row = API.addAppointment(Object.assign({}, f, { stage:'待确认', created_by:1 }));
      m.close(); App.toast(`预约已保存：${row.appointment_no}`,'ok'); render();
    };
  }

  function changeStage(a) {
    if (!a) return;
    const stages = window.SEED.ENUM.appointmentStage.filter(s=>s!==a.stage);
    const body = `<div class="note">当前状态：${App.tag(a.stage)}。状态变更将写入变更历史（保留原值、新值、操作人、时间与原因）。</div>
      <div class="form-grid">
        ${App.fieldRow('新状态', App.selectHtml('f-stage', stages, stages[0]))}
        ${App.fieldRow('原因', `<input id="f-reason" placeholder="变更原因（取消/爽约必填）">`, true)}
      </div>`;
    const m = App.modal('变更预约状态', body,
      `<button class="btn ghost" id="m-cancel">取消</button><button class="btn" id="m-save">保存</button>`);
    m.el.querySelector('#m-cancel').onclick = m.close;
    m.el.querySelector('#m-save').onclick = () => {
      const st = m.el.querySelector('#f-stage').value;
      const reason = m.el.querySelector('#f-reason').value.trim();
      if (['已取消','爽约'].includes(st) && !reason) { App.toast('取消/爽约须填写原因','err'); return; }
      API.changeAppointmentStage(a.id, st, reason);
      m.close(); App.toast('状态已更新','ok'); render();
    };
  }

  function reschedule(a) {
    if (!a) return;
    const body = `<div class="note">改约将保留原时段、原阶段、原因、操作人及发生时间（UC-01 扩展6a）。</div>
      <div class="form-grid">
        ${App.fieldRow('新开始', `<input id="f-start" type="datetime-local" value="${App.esc(a.starts_at)}">`)}
        ${App.fieldRow('新结束', `<input id="f-end" type="datetime-local" value="${App.esc(a.ends_at)}">`)}
        ${App.fieldRow('改约原因', `<input id="f-reason" value="患者要求改约">`, true)}
      </div>`;
    const m = App.modal('改约', body,
      `<button class="btn ghost" id="m-cancel">取消</button><button class="btn" id="m-save">保存改约</button>`);
    m.el.querySelector('#m-cancel').onclick = m.close;
    m.el.querySelector('#m-save').onclick = () => {
      const s = m.el.querySelector('#f-start').value, e = m.el.querySelector('#f-end').value;
      const r = API.reschedule(a.id, s, e, m.el.querySelector('#f-reason').value.trim());
      if (!r.ok) { App.toast(r.error,'err'); return; }
      m.close(); App.toast('改约成功，已保留历史','ok'); render();
    };
  }

  function history(a) {
    if (!a) return;
    const list = API.appointmentHistory(a.id);
    const body = list.length ? `<ul class="timeline">${list.map(e=>`<li>
      <div class="t-time">${App.esc(e.occurred_at)} · 操作人 #${e.changed_by}</div>
      <div class="t-title">${e.old_start} → ${e.new_start}</div>
      <div>阶段 ${App.esc(e.old_stage)} → ${App.esc(e.new_stage)}${e.reason?' · 原因：'+App.esc(e.reason):''}</div>
    </li>`).join('')}</ul>` : '<div class="empty">暂无变更记录</div>';
    App.modal('预约变更历史 · '+a.appointment_no, body, `<button class="btn ghost" id="m-close">关闭</button>`);
    document.getElementById('m-close').onclick = () => document.getElementById('modal-root').innerHTML='';
  }

  render();
};
