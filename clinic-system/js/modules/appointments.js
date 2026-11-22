/* 预约管理 F4 / UC-01：登记、冲突检查、今日/明日/期间查询、状态流转、改约留痕 */
window.Modules = window.Modules || {};
window.Modules.appointments = function (set) {
  const session = API.session();
  const isPatient = !!session && session.role === 'patient';
  const patientId = session && session.patientId ? Number(session.patientId) : 0;
  let scope = isPatient ? 'all' : 'today', start = '', end = '';

  // 服务器是 BR-01 的唯一权威：前端只展示服务器返回的冲突与候选时段
  function conflictResult(res) {
    if (!res || !res.ok) {
      return { ok: false, error: (res && res.error) || '服务器计算不可用', conflicts: [], candidates: [] };
    }
    const d = res.data || {};
    return {
      ok: !!d.ok,
      error: d.error || null,
      conflicts: d.conflicts || [],
      candidates: d.candidates || [],
    };
  }

  function paintConflict(box, state, onPick) {
    if (state.error) {
      box.innerHTML = `<div class="note error">系统检查不可用：${App.esc(state.error)}</div>`;
      return;
    }
    if (state.ok) {
      box.innerHTML = '<div class="note" style="background:#e4f6ee;border-color:var(--success);color:#137a52">✓ 系统已检查：医生与诊室在该时段均可用。</div>';
      return;
    }
    const occupied = state.conflicts.map(c => c.appointment_no).join('、') || '已有预约';
    box.innerHTML = `<div class="note error">✗ 系统检测到时段冲突：${App.esc(occupied)} 已占用医生或诊室。<br>系统建议时段：${
      state.candidates.length
        ? state.candidates.map(c => `<button class="btn ghost sm" data-cand="${App.esc(c)}" style="margin:3px">${App.esc(String(c).slice(11))}</button>`).join('')
        : '当日暂无可建议时段'
    }</div>`;
    box.querySelectorAll('[data-cand]').forEach(b => b.onclick = () => onPick(b.dataset.cand));
  }

  function render() {
    const db = API.raw();
    let list = API.listAppointments(scope === 'period' ? { start, end } : { scope });
    if (isPatient) list = list.filter(a => a.patient_id == patientId);
    set(`
      <div class="page-head"><div><div class="page-title">${isPatient ? '我的预约' : '预约管理'}</div><div class="page-desc">${isPatient ? '患者视角 · 预约与改约演示' : 'F4 / UC-01 · 冲突检查、状态流转与改约留痕'}</div></div>
        <button class="btn" id="a-add">${isPatient ? '+ 预约诊疗' : '+ 新建预约'}</button></div>
      <div class="card">
        <div class="note">${isPatient
          ? `当前仅显示您的预约；同一医生或诊室同一时段不能重复预约。`
          : `BR-01：同一医生或诊室同一时段不能有两个有效预约。预约时段含开始、不含结束；取消与爽约不占用未来时段（表22、6.2）。`}</div>
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
              <td class="actions">${isPatient ? '' : `<button class="btn ghost sm" data-stage="${a.id}">状态</button> `}<button class="btn ghost sm" data-resched="${a.id}">改约</button> <button class="btn ghost sm" data-hist="${a.id}">留痕</button></td></tr>`;
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
    const body = `<div class="note">${isPatient
      ? '选择医生、诊室和时段后，系统实时检查冲突；有冲突时直接给出建议时段。'
      : '步骤 UC-01：提交主诉 → 检查患者 → 提交医生/诊室/日期时段 → 系统实时检查冲突并反馈可用时段 → 确认预约 → 保存编号。'}</div>
      <div class="form-grid">
        ${isPatient ? `<div class="kpi" style="grid-column:1/-1;padding:10px 14px"><div class="label">预约患者</div><div class="value" style="font-size:16px;margin:4px 0 0">${App.esc(db.patients.find(p => p.id == patientId)?.name || '演示患者')}</div></div>`
        : App.fieldRow('患者', App.selectHtml('f-patient', patients, patients[0]?.value))}
        ${App.fieldRow('预约类型', App.selectHtml('f-type', types, types[0]?.value))}
        ${App.fieldRow('医生', App.selectHtml('f-doctor', doctors, doctors[0]?.value))}
        ${App.fieldRow('诊室', App.selectHtml('f-room', rooms, rooms[0]?.value))}
        ${App.fieldRow('开始时间', `<input id="f-start" type="datetime-local" value="${defStart}">`)}
        ${App.fieldRow('结束时间', `<input id="f-end" type="datetime-local" value="${now.toISOString().slice(0,10)+'T09:30'}">`)}
        ${App.fieldRow('主诉', `<input id="f-complaint" placeholder="患者主诉">`, true)}
      </div>
      <div id="conflict-box"></div>`;
    const m = App.modal('新建预约', body,
      `<button class="btn ghost" id="m-cancel">取消</button><button class="btn success" id="m-save" disabled>确认预约</button>`);
    const saveBtn = m.el.querySelector('#m-save');
    const box = m.el.querySelector('#conflict-box');
    m.el.querySelector('#m-cancel').onclick = m.close;
    const readForm = () => ({
      patient_id: isPatient ? patientId : Number(m.el.querySelector('#f-patient').value),
      doctor_id: Number(m.el.querySelector('#f-doctor').value),
      room_id: Number(m.el.querySelector('#f-room').value),
      type_id: Number(m.el.querySelector('#f-type').value),
      starts_at: m.el.querySelector('#f-start').value,
      ends_at: m.el.querySelector('#f-end').value,
      chief_complaint: m.el.querySelector('#f-complaint').value.trim(),
    });
    let checked = false, seq = 0, timer = null;
    const autoCheck = async () => {
      const mine = ++seq;
      const f = readForm();
      checked = false; saveBtn.disabled = true;
      if (!f.starts_at || !f.ends_at || f.starts_at >= f.ends_at) {
        box.innerHTML = '<div class="note warn">请选择有效的开始与结束时间。</div>';
        return;
      }
      box.innerHTML = '<div class="note">系统正在检查医生与诊室时段…</div>';
      const res = await API.compute.conflict(f.doctor_id, f.room_id, f.starts_at, f.ends_at);
      if (mine !== seq) return;
      const state = conflictResult(res);
      checked = state.ok;
      saveBtn.disabled = !checked;
      paintConflict(box, state, cand => {
        m.el.querySelector('#f-start').value = cand;
        const datePart = cand.slice(0, 10);
        const hh = Number(cand.slice(11, 13));
        const mm = cand.slice(14, 16);
        const endH = String(mm === '30' ? hh + 1 : hh).padStart(2, '0');
        const endM = mm === '30' ? '00' : '30';
        m.el.querySelector('#f-end').value = `${datePart}T${endH}:${endM}`;
        autoCheck();
      });
    };
    const scheduleCheck = () => { clearTimeout(timer); timer = setTimeout(autoCheck, 220); };
    m.el.querySelectorAll('input,select').forEach(el => {
      el.addEventListener('input', scheduleCheck);
      el.addEventListener('change', scheduleCheck);
    });
    m.el.querySelector('#m-save').onclick = async () => {
      if (!checked) { App.toast('系统尚未确认该时段可用', 'err'); return; }
      const f = readForm();
      const state = conflictResult(await API.compute.conflict(f.doctor_id, f.room_id, f.starts_at, f.ends_at));
      if (!state.ok) {
        checked = false; saveBtn.disabled = true;
        paintConflict(box, state, cand => {
          m.el.querySelector('#f-start').value = cand;
          const dt = new Date(cand); dt.setMinutes(dt.getMinutes() + 30);
          m.el.querySelector('#f-end').value = dt.toISOString().slice(0, 16);
          autoCheck();
        });
        App.toast('时段在提交前被占用，请选择系统建议时段', 'err');
        return;
      }
      const row = API.addAppointment(Object.assign({}, f, { stage:'待确认', created_by:1 }));
      m.close(); App.toast(`预约已保存：${row.appointment_no}`,'ok'); render();
    };
    autoCheck();
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
    const body = `<div class="note">改约将保留原时段、原阶段、原因、操作人及发生时间；系统实时检查新时段冲突（UC-01 扩展6a）。</div>
      <div class="form-grid">
        ${App.fieldRow('新开始', `<input id="f-start" type="datetime-local" value="${App.esc(a.starts_at)}">`)}
        ${App.fieldRow('新结束', `<input id="f-end" type="datetime-local" value="${App.esc(a.ends_at)}">`)}
        ${App.fieldRow('改约原因', `<input id="f-reason" value="患者要求改约">`, true)}
      </div>
      <div id="conflict-box"></div>`;
    const m = App.modal('改约', body,
      `<button class="btn ghost" id="m-cancel">取消</button><button class="btn" id="m-save" disabled>保存改约</button>`);
    const saveBtn = m.el.querySelector('#m-save');
    const box = m.el.querySelector('#conflict-box');
    m.el.querySelector('#m-cancel').onclick = m.close;
    let checked = false, seq = 0, timer = null;
    const autoCheck = async () => {
      const mine = ++seq;
      const s = m.el.querySelector('#f-start').value, e = m.el.querySelector('#f-end').value;
      checked = false; saveBtn.disabled = true;
      if (!s || !e || s >= e) { box.innerHTML = '<div class="note warn">请选择有效的新时段。</div>'; return; }
      box.innerHTML = '<div class="note">系统正在检查新时段…</div>';
      const res = await API.compute.conflict(a.doctor_id, a.room_id, s, e, a.id);
      if (mine !== seq) return;
      const state = conflictResult(res);
      checked = state.ok; saveBtn.disabled = !checked;
      paintConflict(box, state, cand => {
        m.el.querySelector('#f-start').value = cand;
        const datePart = cand.slice(0, 10);
        const hh = Number(cand.slice(11, 13));
        const mm = cand.slice(14, 16);
        const endH = String(mm === '30' ? hh + 1 : hh).padStart(2, '0');
        const endM = mm === '30' ? '00' : '30';
        m.el.querySelector('#f-end').value = `${datePart}T${endH}:${endM}`;
        autoCheck();
      });
    };
    const scheduleCheck = () => { clearTimeout(timer); timer = setTimeout(autoCheck, 220); };
    ['#f-start', '#f-end'].forEach(id => {
      const el = m.el.querySelector(id);
      el.addEventListener('input', scheduleCheck);
      el.addEventListener('change', scheduleCheck);
    });
    m.el.querySelector('#m-save').onclick = async () => {
      if (!checked) { App.toast('系统尚未确认新时段可用', 'err'); return; }
      const s = m.el.querySelector('#f-start').value, e = m.el.querySelector('#f-end').value;
      const state = conflictResult(await API.compute.conflict(a.doctor_id, a.room_id, s, e, a.id));
      if (!state.ok) { autoCheck(); App.toast('新时段在提交前被占用', 'err'); return; }
      const r = API.reschedule(a.id, s, e, m.el.querySelector('#f-reason').value.trim());
      if (!r.ok) { App.toast(r.error,'err'); return; }
      m.close(); App.toast('改约成功，已保留历史','ok'); render();
    };
    autoCheck();
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
