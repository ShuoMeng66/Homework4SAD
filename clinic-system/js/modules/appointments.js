/* 预约管理 F4 / UC-01：按医生排班号源预约、状态流转、改约留痕
 * 号源由服务器按排班切片推导，前端只选择，不自行编造时段（BR-09） */
window.Modules = window.Modules || {};
window.Modules.appointments = function (set) {
  const session = API.session();
  const isPatient = !!session && session.role === 'patient';
  const patientId = session && session.patientId ? Number(session.patientId) : 0;

  let scope = isPatient ? 'all' : 'today', start = '', end = '';

  const typeName = id => (API.typeOf(id) || {}).name || '';
  const doctorName = id => (API.raw().employees.find(e => e.id == id) || {}).name || '';
  const roomName = id => (API.raw().rooms.find(r => r.id == id) || {}).name || '';

  function visibleList() {
    let list = API.listAppointments(scope === 'period' ? { start, end } : { scope });
    if (isPatient) list = list.filter(a => a.patient_id == patientId);
    if (scope === 'pending') list = list.filter(a => a.stage === '待确认');
    return list;
  }

  function render() {
    const list = visibleList();
    const tabs = isPatient
      ? [['all', '全部'], ['pending', '待确认']]
      : [['today', '今日'], ['tomorrow', '明日'], ['period', '期间'], ['pending', '待确认'], ['all', '全部']];
    set(`
      <div class="page-head"><div><div class="page-title">${isPatient ? '我的预约' : '预约管理'}</div>
        <div class="page-desc">${isPatient
          ? 'F4 / UC-01 · 按医生出诊号源预约，提交后由诊所确认'
          : 'F4 / UC-01 · 排班号源、状态流转与改约留痕'}</div></div>
        <button class="btn" id="a-add">${isPatient ? '+ 预约诊疗' : '+ 新建预约'}</button></div>
      <div class="card">
        <div class="note">${isPatient
          ? '可预约项目与时段以诊所排班号源为准；补牙、根管、种植等项目需医生评估，请致电或到店由前台安排。'
          : 'BR-09：预约从医生排班号源中选取，停诊时段不可约；人数超出号源时由前台加号并说明原因。BR-01：同一医生或诊室同一时段不能有两个有效预约。'}</div>
        <div class="tabs">
          ${tabs.map(([k, l]) => `<div class="tab ${scope === k ? 'active' : ''}" data-scope="${k}">${l}</div>`).join('')}
        </div>
        ${scope === 'period' ? `<div class="toolbar">
          <div class="field"><label>开始</label><input id="a-start" type="date" value="${start}"></div>
          <div class="field"><label>结束</label><input id="a-end" type="date" value="${end}"></div>
          <button class="btn ghost" id="a-query">查询</button></div>` : ''}
        <div class="table-wrap"><table class="tbl"><thead><tr><th>预约编号</th><th>患者</th><th>项目</th><th>医生</th><th>诊室</th><th>时间</th><th>来源</th><th>状态</th><th>操作</th></tr></thead><tbody>
          ${list.length ? list.map(a => {
            const p = API.raw().patients.find(x => x.id == a.patient_id);
            return `<tr><td>${App.esc(a.appointment_no)}</td><td>${App.esc(p ? p.name : '')}</td>
              <td>${App.esc(typeName(a.type_id))}</td><td>${App.esc(doctorName(a.doctor_id))}</td><td>${App.esc(roomName(a.room_id))}</td>
              <td>${App.esc(a.starts_at)} ~ ${App.esc(String(a.ends_at).slice(11))}</td>
              <td><span class="tag ${a.source === '患者自助' ? 'blue' : 'gray'}">${App.esc(a.source || '前台')}</span></td>
              <td>${App.tag(a.stage)}</td>
              <td class="actions">${isPatient ? '' : `<button class="btn ghost sm" data-stage="${a.id}">状态</button> `}
                <button class="btn ghost sm" data-resched="${a.id}">改约</button>
                <button class="btn ghost sm" data-hist="${a.id}">留痕</button></td></tr>`;
          }).join('') : `<tr><td colspan="9"><div class="empty">该范围暂无预约</div></td></tr>`}
        </tbody></table></div>
      </div>`);
    bind();
  }

  function bind() {
    document.getElementById('a-add').onclick = () => create();
    document.querySelectorAll('[data-scope]').forEach(el =>
      el.onclick = () => { scope = el.dataset.scope; render(); });
    const q = document.getElementById('a-query');
    if (q) q.onclick = () => {
      start = document.getElementById('a-start').value;
      end = document.getElementById('a-end').value; render();
    };
    document.querySelectorAll('[data-stage]').forEach(b =>
      b.onclick = () => changeStage(API.raw().appointments.find(a => a.id == b.dataset.stage)));
    document.querySelectorAll('[data-resched]').forEach(b =>
      b.onclick = () => reschedule(API.raw().appointments.find(a => a.id == b.dataset.resched)));
    document.querySelectorAll('[data-hist]').forEach(b =>
      b.onclick = () => history(API.raw().appointments.find(a => a.id == b.dataset.hist)));
  }

  // 号源面板：按医生 + 日期 + 项目时长向服务器取号源，返回选中的号
  function slotPicker(root, onPick) {
    const box = root.querySelector('#slot-box');
    let picked = null;
    async function paint() {
      const doctor = Number(root.querySelector('#f-doctor').value);
      const date = root.querySelector('#f-date').value;
      const type = API.typeOf(Number(root.querySelector('#f-type').value));
      picked = null;
      if (onPick) onPick(null);
      if (!doctor || !date) { box.innerHTML = '<div class="note">请选择医生与日期。</div>'; return; }
      box.innerHTML = '<div class="note">正在查询号源…</div>';
      const r = await API.slots(doctor, date, type ? type.duration_min : 30);
      if (!r.ok) { box.innerHTML = `<div class="note error">号源查询失败：${App.esc(r.error || '服务器不可用')}</div>`; return; }
      const d = r.data || {};
      if (!d.slots || !d.slots.length) {
        box.innerHTML = `<div class="note warn">${App.esc(d.note || '当日暂无可约号源')}，请换一天或换医生。</div>`;
        return;
      }
      const free = d.slots.filter(s => s.state === '可预约').length;
      box.innerHTML = `
        <div class="slot-head">可选 ${free} 个号源 · 每格 ${type ? type.duration_min : 30} 分钟${d.note ? ' · ' + App.esc(d.note) : ''}</div>
        <div class="slot-grid">${d.slots.map(s => `
          <button type="button" class="slot ${s.state === '已占用' ? 'busy' : ''}" data-slot="${App.esc(s.starts_at)}"
            data-end="${App.esc(s.ends_at)}" data-room="${s.room_id || ''}" data-sched="${s.schedule_id || ''}"
            ${s.state === '已占用' ? 'disabled title="已被 ' + App.esc(s.appointment_no || '') + ' 占用"' : ''}>${App.esc(String(s.starts_at).slice(11))}</button>`).join('')}
        </div>
        <div class="slot-foot">灰色为已占用号源，不可选择。</div>`;
      box.querySelectorAll('.slot:not(.busy)').forEach(btn => btn.onclick = () => {
        box.querySelectorAll('.slot').forEach(x => x.classList.remove('on'));
        btn.classList.add('on');
        picked = { starts_at: btn.dataset.slot, ends_at: btn.dataset.end,
                   room_id: Number(btn.dataset.room) || null, schedule_id: Number(btn.dataset.sched) || null };
        if (onPick) onPick(picked);
      });
    }
    root.querySelector('#f-doctor').onchange = paint;
    root.querySelector('#f-date').onchange = paint;
    root.querySelector('#f-type').onchange = paint;
    return { paint, get picked() { return picked; } };
  }

  function create() {
    const db = API.raw();
    const patients = db.patients.map(p => ({ value: p.id, label: `${p.patient_no} ${p.name}` }));
    const doctors = db.employees.filter(e => e.role === 'doctor' && e.active)
      .map(e => ({ value: e.id, label: e.name }));
    const types = API.listTypes().filter(t => !isPatient || t.self_bookable)
      .map(t => ({ value: t.id, label: `${t.name} · ${t.duration_min} 分钟` }));
    if (!types.length || !doctors.length) { App.toast('缺少预约类型或医生配置', 'err'); return; }
    const today = new Date().toISOString().slice(0, 10);
    const me = db.patients.find(p => p.id == patientId);
    const body = `<div class="note">${isPatient
      ? '选择项目 → 选择医生与日期 → 从出诊号源中选一个时段 → 提交，由诊所确认后生效。'
      : '前台排程：选择患者与项目 → 选择医生与日期 → 从出诊号源中选号；号源已满时可加号并说明原因。'}</div>
      <div class="form-grid">
        ${isPatient
          ? `<div class="kpi" style="grid-column:1/-1;padding:10px 14px"><div class="label">就诊人</div>
             <div class="value" style="font-size:16px;margin:4px 0 0">${App.esc(me ? me.name : '当前患者')}</div></div>`
          : App.fieldRow('患者', App.selectHtml('f-patient', patients, patients[0] ? patients[0].value : ''))}
        ${App.fieldRow('预约项目', App.selectHtml('f-type', types, types[0].value))}
        ${App.fieldRow('医生', App.selectHtml('f-doctor', doctors, doctors[0].value))}
        ${App.fieldRow('就诊日期', `<input id="f-date" type="date" value="${today}">`)}
        ${App.fieldRow('主诉（选填）', `<input id="f-complaint" placeholder="如：右下后牙酸痛三天">`, true)}
      </div>
      <div id="slot-box"></div>`;
    const m = App.modal(isPatient ? '预约诊疗' : '新建预约', body,
      `<button class="btn ghost" id="m-cancel">取消</button>
       <button class="btn" id="m-addon">加号</button>
       <button class="btn success" id="m-save" disabled>提交预约</button>`);
    const saveBtn = m.el.querySelector('#m-save');
    const picker = slotPicker(m.el, p => { saveBtn.disabled = !p; });
    m.el.querySelector('#m-cancel').onclick = m.close;
    m.el.querySelector('#m-addon').style.display = isPatient ? 'none' : '';
    picker.paint();

    m.el.querySelector('#m-save').onclick = async () => {
      const p = picker.picked;
      if (!p) { App.toast('请先在号源中选择一个时段', 'err'); return; }
      const payload = {
        patient_id: isPatient ? patientId : Number(m.el.querySelector('#f-patient').value),
        type_id: Number(m.el.querySelector('#f-type').value),
        doctor_id: Number(m.el.querySelector('#f-doctor').value),
        room_id: p.room_id, schedule_id: p.schedule_id,
        starts_at: p.starts_at, ends_at: p.ends_at,
        chief_complaint: m.el.querySelector('#f-complaint').value.trim(),
        stage: isPatient ? '待确认' : '已确认',
        source: isPatient ? '患者自助' : '前台',
        created_by: isPatient ? 1 : 1,
      };
      const r = await API.book(payload);
      if (!r.ok) { App.toast('服务器拒绝：' + r.error, 'err'); picker.paint(); return; }
      m.close();
      App.toast(`预约已保存：${r.data.appointment_no}` + (isPatient ? '，等待诊所确认' : ''), 'ok');
      render();
    };

    // 前台加号：排班号源已满时，按项目时长临时插入，需说明原因
    m.el.querySelector('#m-addon').onclick = async () => {
      const type = API.typeOf(Number(m.el.querySelector('#f-type').value));
      const date = m.el.querySelector('#f-date').value;
      const doctor = Number(m.el.querySelector('#f-doctor').value);
      const time = prompt('加号开始时间（HH:MM，例如 12:30）');
      if (!time || !/^\d{2}:\d{2}$/.test(time)) return;
      const reason = prompt('加号原因（如：老患者复诊、急诊外伤）');
      if (!reason) { App.toast('加号须填写原因', 'err'); return; }
      const s = `${date}T${time}`;
      const dt = new Date(s); dt.setMinutes(dt.getMinutes() + (type ? type.duration_min : 30));
      const e = dt.toISOString().slice(0, 16);
      const r = await API.book({
        patient_id: Number(m.el.querySelector('#f-patient').value),
        type_id: Number(m.el.querySelector('#f-type').value),
        doctor_id: doctor, room_id: null, schedule_id: null,
        starts_at: s, ends_at: e, chief_complaint: reason,
        stage: '已确认', source: '前台', created_by: 1,
      });
      if (!r.ok) { App.toast('加号失败：' + r.error, 'err'); return; }
      m.close(); App.toast(`已加号：${r.data.appointment_no}`, 'ok'); render();
    };
  }

  function changeStage(a) {
    if (!a) return;
    const stages = window.SEED.ENUM.appointmentStage.filter(s => s !== a.stage);
    const body = `<div class="note">当前状态：${App.tag(a.stage)}。状态变更将写入变更历史（保留原值、新值、操作人、时间与原因）。</div>
      <div class="form-grid">
        ${App.fieldRow('新状态', App.selectHtml('f-stage', stages, stages[0]))}
        ${App.fieldRow('原因', `<input id="f-reason" placeholder="变更原因（取消/爽约必填）">`, true)}
      </div>`;
    const m = App.modal('变更预约状态', body,
      `<button class="btn ghost" id="m-cancel">取消</button><button class="btn" id="m-save">保存</button>`);
    m.el.querySelector('#m-cancel').onclick = m.close;
    m.el.querySelector('#m-save').onclick = async () => {
      const st = m.el.querySelector('#f-stage').value;
      const reason = m.el.querySelector('#f-reason').value.trim();
      if (['已取消', '爽约'].includes(st) && !reason) { App.toast('取消/爽约须填写原因', 'err'); return; }
      const r = await API.changeAppointmentStage(a.id, st, reason);
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('状态已更新', 'ok'); render();
    };
  }

  function reschedule(a) {
    if (!a) return;
    const type = API.typeOf(a.type_id);
    const body = `<div class="note">改约从该医生的出诊号源中重选时段；原时段、原阶段、原因与操作人全部留痕（UC-01 扩展 6a）。</div>
      <div class="form-grid">
        ${App.fieldRow('项目', `<input value="${App.esc(type ? type.name + ' · ' + type.duration_min + ' 分钟' : '')}" disabled>`)}
        ${App.fieldRow('医生', `<input value="${App.esc(doctorName(a.doctor_id))}" disabled>`)}
        ${App.fieldRow('新日期', `<input id="f-date" type="date" value="${App.esc(String(a.starts_at).slice(0, 10))}">`)}
        ${App.fieldRow('改约原因', `<input id="f-reason" value="患者要求改约">`, true)}
      </div>
      <input type="hidden" id="f-doctor" value="${a.doctor_id}">
      <input type="hidden" id="f-type" value="${a.type_id}">
      <div id="slot-box"></div>`;
    const m = App.modal('改约 · ' + a.appointment_no, body,
      `<button class="btn ghost" id="m-cancel">取消</button><button class="btn success" id="m-save" disabled>保存改约</button>`);
    const saveBtn = m.el.querySelector('#m-save');
    const picker = slotPicker(m.el, p => { saveBtn.disabled = !p; });
    m.el.querySelector('#m-cancel').onclick = m.close;
    picker.paint();
    m.el.querySelector('#m-save').onclick = async () => {
      const p = picker.picked;
      if (!p) { App.toast('请先选择新号源', 'err'); return; }
      const r = await API.reschedule(a.id, p.starts_at, p.ends_at,
        m.el.querySelector('#f-reason').value.trim());
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('改约成功，已保留历史', 'ok'); render();
    };
  }

  function history(a) {
    if (!a) return;
    const list = API.appointmentHistory(a.id);
    const body = list.length ? `<ul class="timeline">${list.map(e => `<li>
      <div class="t-time">${App.esc(e.occurred_at)} · 操作人 #${e.changed_by}</div>
      <div class="t-title">${App.esc(e.old_start || '—')} → ${App.esc(e.new_start)}</div>
      <div>阶段 ${App.esc(e.old_stage || '—')} → ${App.esc(e.new_stage)}${e.reason ? ' · 原因：' + App.esc(e.reason) : ''}</div>
    </li>`).join('')}</ul>` : '<div class="empty">暂无变更记录</div>';
    App.modal('预约变更历史 · ' + a.appointment_no, body, `<button class="btn ghost" id="m-close">关闭</button>`);
    document.getElementById('m-close').onclick = () => document.getElementById('modal-root').innerHTML = '';
  }

  render();
};
