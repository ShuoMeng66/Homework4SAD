/* 预约管理（UC-01 / UC-05）：一体化登记与选号预约、前台加号、状态流转、改约留痕与预约单打印 */
window.Modules = window.Modules || {};
window.Modules.appointments = function (set) {
  const session = API.session() || {};
  const isPatient = session.role === 'patient';
  const canWrite = ['receptionist', 'admin'].includes(session.role);
  const canBook = canWrite || isPatient;

  let scope = isPatient ? 'all' : 'today';
  let start = '', end = '';

  const typeName = id => (API.typeOf(id) || {}).name || '';
  const doctorName = id => ((API.raw().employees || []).find(e => e.id == id) || {}).name || '';
  const roomName = id => ((API.raw().rooms || []).find(r => r.id == id) || {}).name || '';

  const LEGAL_NEXT = {
    '待确认': ['已确认', '已取消'],
    '已确认': ['已到诊', '已取消', '爽约'],
    '已到诊': ['已完成'],
    '已完成': [],
    '已取消': [],
    '爽约': [],
  };

  function visibleList() {
    if (scope === 'period') return API.listAppointments({ start, end });
    return API.listAppointments({ scope });
  }

  function render() {
    const db = API.raw();
    const list = visibleList();
    const tabs = isPatient
      ? [['all', '全部预约'], ['pending', '待确认']]
      : [['today', '今日'], ['tomorrow', '明日'], ['period', '期间查询'], ['pending', '待确认'], ['all', '全部']];
    const complexNames = API.listTypes(true).filter(t => !t.self_bookable).map(t => t.name).join('、');

    set(`
      <div class="page-head">
        <div>
          <div class="page-title">${isPatient ? '我的预约' : '预约管理'}</div>
          <div class="page-desc">${isPatient
            ? '按医生未来两周出诊号源自助预约标准项目，提交后经前台确认正式生效'
            : '按排班号源选号预约、资源冲突拦截、状态流转与改约变更留痕'}</div>
        </div>
        ${canBook ? `<button class="btn" id="a-add">${isPatient ? '+ 自助预约' : '+ 登记并预约'}</button>` : ''}
      </div>
      <div class="card">
        <div class="note">${isPatient
          ? `自助预约仅开放标准项目且限于未来两周内号源；${complexNames ? `「${complexNames}」等需医生评估的复杂项目请到店或致电由前台排程。` : ''}近 90 天累计爽约两次将暂停自助预约权限 90 天。`
          : '预约须落在医生出诊时段内并按切片对齐，同一医生或诊室同一时段仅允许一个有效预约；号源已满时可由前台加号并记录原因。'}</div>
        <div class="tabs">
          ${tabs.map(([k, l]) => `<div class="tab ${scope === k ? 'active' : ''}" data-scope="${k}">${l}</div>`).join('')}
        </div>
        ${scope === 'period' ? `<div class="toolbar">
          <div class="field"><label>开始日期</label><input id="a-start" type="date" value="${start}"></div>
          <div class="field"><label>结束日期</label><input id="a-end" type="date" value="${end}"></div>
          <button class="btn ghost" id="a-query">查询</button>
        </div>` : ''}
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>预约编号</th><th>患者</th><th>预约类型</th><th>医生</th><th>诊室</th><th>时段</th><th>来源</th><th>状态</th><th>操作</th>
        </tr></thead><tbody>
          ${list.length ? list.map(a => {
            const p = (db.patients || []).find(x => x.id == a.patient_id);
            const activeForChange = ['待确认', '已确认'].includes(a.stage);
            const hasNext = (LEGAL_NEXT[a.stage] || []).length > 0;
            return `<tr>
              <td>${App.esc(a.appointment_no)}</td>
              <td>${App.esc(p ? p.name : '—')}</td>
              <td>${App.esc(typeName(a.type_id))}</td>
              <td>${App.esc(doctorName(a.doctor_id))}</td>
              <td>${App.esc(roomName(a.room_id))}</td>
              <td>${App.esc(String(a.starts_at).replace('T', ' '))} ~ ${App.esc(String(a.ends_at).slice(11, 16))}</td>
              <td><span class="tag ${a.source === '患者自助' ? 'blue' : 'gray'}">${App.esc(a.source)}</span></td>
              <td>${App.tag(a.stage)}</td>
              <td class="actions">
                ${canWrite && hasNext ? `<button class="btn ghost sm" data-stage="${a.id}">状态</button> ` : ''}
                ${(canWrite || isPatient) && activeForChange ? `<button class="btn ghost sm" data-resched="${a.id}">改约</button> ` : ''}
                ${isPatient && activeForChange ? `<button class="btn ghost sm" data-pcancel="${a.id}">取消</button> ` : ''}
                ${!isPatient ? `<button class="btn ghost sm" data-hist="${a.id}">留痕</button> ` : ''}
                ${canWrite ? `<button class="btn ghost sm" data-print="${a.id}">打印</button>` : ''}
              </td></tr>`;
          }).join('') : '<tr><td colspan="9"><div class="empty">当前范围暂无预约记录</div></td></tr>'}
        </tbody></table></div>
      </div>`);

    bind();
  }

  function bind() {
    const add = document.getElementById('a-add');
    if (add) add.onclick = create;
    document.querySelectorAll('[data-scope]').forEach(el => {
      el.onclick = () => { scope = el.dataset.scope; render(); };
    });
    const q = document.getElementById('a-query');
    if (q) q.onclick = () => {
      start = document.getElementById('a-start').value;
      end = document.getElementById('a-end').value;
      render();
    };
    const db = API.raw();
    document.querySelectorAll('[data-stage]').forEach(b => b.onclick = () => changeStage(db.appointments.find(a => a.id == b.dataset.stage)));
    document.querySelectorAll('[data-resched]').forEach(b => b.onclick = () => reschedule(db.appointments.find(a => a.id == b.dataset.resched)));
    document.querySelectorAll('[data-pcancel]').forEach(b => b.onclick = () => patientCancel(db.appointments.find(a => a.id == b.dataset.pcancel)));
    document.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => history(db.appointments.find(a => a.id == b.dataset.hist)));
    document.querySelectorAll('[data-print]').forEach(b => b.onclick = () => printSlip(db.appointments.find(a => a.id == b.dataset.print)));
  }

  function slotPicker(root, onPick, excludeId = null) {
    const box = root.querySelector('#slot-box');
    let picked = null;
    async function paint() {
      const doctor = Number(root.querySelector('#f-doctor').value);
      const date = root.querySelector('#f-date').value;
      const type = API.typeOf(Number(root.querySelector('#f-type').value));
      picked = null;
      if (onPick) onPick(null);
      if (!doctor || !date) { box.innerHTML = '<div class="note">请选择医生与日期。</div>'; return; }
      box.innerHTML = '<div class="note">正在实时查询排班号源…</div>';
      const r = await API.slots(doctor, date, type ? type.duration_min : 30, excludeId);
      if (!r.ok) { box.innerHTML = `<div class="note error">号源查询失败：${App.esc(r.error)}</div>`; return; }
      const d = r.data || {};
      if (!d.slots || !d.slots.length) {
        box.innerHTML = `<div class="note warn">${App.esc(d.note || '当日暂无可约号源')}，请切换日期或医生。</div>`;
        return;
      }
      const free = d.slots.filter(s => s.state === '可预约').length;
      box.innerHTML = `
        <div class="slot-head">剩余 ${free} 个可选号源 · 每号 ${d.duration_min} 分钟</div>
        <div class="slot-grid">${d.slots.map(s => `
          <button type="button" class="slot ${s.state === '已占用' ? 'busy' : ''}"
            data-slot="${App.esc(s.starts_at)}" data-end="${App.esc(s.ends_at)}"
            data-room="${s.room_id || ''}" data-sched="${s.schedule_id || ''}"
            ${s.state === '已占用' ? `disabled title="已占用${s.appointment_no ? '（' + App.esc(s.appointment_no) + '）' : ''}"` : ''}>
            ${App.esc(String(s.starts_at).slice(11, 16))}
          </button>`).join('')}
        </div>
        <div class="slot-foot">灰色为已占用号源，不可重复选择。</div>`;
      box.querySelectorAll('.slot:not(.busy)').forEach(btn => btn.onclick = () => {
        box.querySelectorAll('.slot').forEach(x => x.classList.remove('on'));
        btn.classList.add('on');
        picked = {
          starts_at: btn.dataset.slot,
          ends_at: btn.dataset.end,
          room_id: Number(btn.dataset.room) || null,
          schedule_id: Number(btn.dataset.sched) || null,
        };
        if (onPick) onPick(picked);
      });
    }
    root.querySelector('#f-doctor').onchange = paint;
    root.querySelector('#f-date').onchange = paint;
    root.querySelector('#f-type').onchange = paint;
    return { paint, get picked() { return picked; } };
  }

  // UC-01 一体化登记患者与选号预约 / UC-05 患者自助预约
  function create() {
    const db = API.raw();
    const doctors = API.doctors(true).map(e => ({ value: e.id, label: e.name }));
    const types = API.listTypes(true).filter(t => !isPatient || t.self_bookable)
      .map(t => ({ value: t.id, label: `${t.name} · ${t.duration_min} 分钟${t.price_hint ? '（' + t.price_hint + '）' : ''}` }));
    const complexTypes = isPatient ? API.listTypes(true).filter(t => !t.self_bookable) : [];
    if (!types.length || !doctors.length) { App.toast('缺少启用中的预约类型或医生', 'err'); return; }

    const today = API.localToday(0);
    const maxDate = isPatient ? API.localToday(14) : '';
    const me = (db.patients || [])[0];
    let selectedPatientId = isPatient ? (session.patientId || (me && me.id)) : (db.patients[0] ? db.patients[0].id : 0);

    const patientSection = isPatient
      ? `<div class="kpi" style="grid-column:1/-1;padding:10px 14px"><div class="label">就诊人</div>
           <div class="value" style="font-size:16px;margin:4px 0 0">${App.esc(me ? `${me.name}（${me.patient_no}）` : session.name)}</div></div>`
      : `<div class="field full" style="background:var(--bg);padding:10px 12px;border-radius:8px;border:1px solid var(--border)">
           <label>1. 检索已有患者档案或就地新建（UC-01）</label>
           <div style="display:flex;gap:8px;margin-top:4px">
             <input id="p-search" placeholder="输入姓名或手机号检索已有档案…" style="flex:1">
             <button class="btn ghost sm" type="button" id="p-quick-new">+ 新建/待核对档案</button>
           </div>
           <div style="margin-top:8px">
             ${App.selectHtml('f-patient', (db.patients || []).map(p => ({ value: p.id, label: `${p.patient_no} ${p.name} ${p.phone || ''}` })), selectedPatientId)}
           </div>
           <div id="p-new-box" style="display:none;margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)">
             <div class="form-grid">
               ${App.fieldRow('新患者姓名', '<input id="np-name" placeholder="必填">')}
               ${App.fieldRow('手机号', '<input id="np-phone" placeholder="联系电话">')}
               ${App.fieldRow('出生日期', '<input id="np-birth" type="date">')}
               ${App.fieldRow('身份核对', App.selectHtml('np-pending', [{ value: '0', label: '确认新患者' }, { value: '1', label: '身份存疑·建立待核对档案' }], '0'))}
               ${App.fieldRow('重要健康提示', '<input id="np-note" placeholder="如：过敏史">', true)}
             </div>
             <div style="margin-top:8px"><button class="btn sm" type="button" id="np-create">保存档案并选用</button></div>
           </div>
         </div>`;

    const complexHints = (isPatient && complexTypes.length)
      ? `<div class="field full" style="background:var(--bg);padding:8px 12px;border-radius:8px;border:1px dashed var(--border)">
           <label>需医生评估的复杂项目（暂不支持自助选号，点击查看指引）</label>
           <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
             ${complexTypes.map(t => `<button type="button" class="btn ghost sm" data-complex-type="${App.esc(t.name)}">${App.esc(t.name)} · 需医生评估</button>`).join('')}
           </div>
         </div>`
      : '';

    const body = `
      <div class="form-grid">
        ${patientSection}
        ${App.fieldRow('预约项目', App.selectHtml('f-type', types, types[0].value))}
        ${App.fieldRow('医生', App.selectHtml('f-doctor', doctors, doctors[0].value))}
        ${App.fieldRow('就诊日期', `<input id="f-date" type="date" value="${today}" ${isPatient ? `min="${today}" max="${maxDate}"` : ''}>`)}
        ${App.fieldRow('主诉（选填）', `<input id="f-complaint" placeholder="如：右下后牙酸痛三天">`, true)}
        ${complexHints}
      </div>
      <div id="slot-box" style="margin-top:10px"></div>`;

    const m = App.modal(isPatient ? '患者自助预约' : '登记患者并预约诊疗', body,
      `<button class="btn ghost" id="m-cancel">取消</button>
       ${canWrite ? '<button class="btn ghost" id="m-addon">号源已满 · 前台加号</button>' : ''}
       <button class="btn success" id="m-save" disabled>提交预约</button>`, 'lg');

    const saveBtn = m.el.querySelector('#m-save');
    const picker = slotPicker(m.el, p => { saveBtn.disabled = !p; });
    m.el.querySelector('#m-cancel').onclick = m.close;
    m.el.querySelectorAll('[data-complex-type]').forEach(btn => {
      btn.onclick = () => App.toast(`「${btn.dataset.complexType}」需医生面诊评估，请到店或致电诊所由前台排程`, 'err');
    });
    picker.paint();

    if (!isPatient) {
      const pSearch = m.el.querySelector('#p-search');
      const pSel = m.el.querySelector('#f-patient');
      pSearch.oninput = () => {
        const kw = pSearch.value.trim().toLowerCase();
        const filtered = (API.raw().patients || []).filter(p =>
          !kw || [p.name, p.phone, p.patient_no].some(v => String(v || '').toLowerCase().includes(kw))
        );
        pSel.innerHTML = filtered.length
          ? filtered.map(p => `<option value="${p.id}">${App.esc(`${p.patient_no} ${p.name} ${p.phone || ''}`)}</option>`).join('')
          : '<option value="">无匹配档案，可点击右侧新建</option>';
      };
      m.el.querySelector('#p-quick-new').onclick = () => {
        const box = m.el.querySelector('#p-new-box');
        box.style.display = box.style.display === 'none' ? 'block' : 'none';
      };
      m.el.querySelector('#np-create').onclick = async () => {
        const name = m.el.querySelector('#np-name').value.trim();
        if (!name) { App.toast('请输入新患者姓名', 'err'); return; }
        const r = await API.addPatient({
          name,
          phone: m.el.querySelector('#np-phone').value.trim(),
          birth_date: m.el.querySelector('#np-birth').value || null,
          important_note: m.el.querySelector('#np-note').value.trim(),
          pending: m.el.querySelector('#np-pending').value === '1',
        });
        if (!r.ok) { App.toast(r.error, 'err'); return; }
        const pat = r.data;
        pSel.innerHTML = (API.raw().patients || []).map(p =>
          `<option value="${p.id}" ${p.id == pat.id ? 'selected' : ''}>${App.esc(`${p.patient_no} ${p.name} ${p.phone || ''}`)}</option>`
        ).join('');
        m.el.querySelector('#p-new-box').style.display = 'none';
        App.toast(`已建立档案：${pat.patient_no}`, 'ok');
      };
    }

    saveBtn.onclick = async () => {
      const p = picker.picked;
      if (!p) { App.toast('请先在号源池中选择一个时段', 'err'); return; }
      const pid = isPatient ? session.patientId : Number(m.el.querySelector('#f-patient').value);
      if (!pid) { App.toast('请选择或先新建患者档案', 'err'); return; }
      const r = await API.bookAppointment({
        patient_id: pid,
        type_id: Number(m.el.querySelector('#f-type').value),
        doctor_id: Number(m.el.querySelector('#f-doctor').value),
        room_id: p.room_id,
        schedule_id: p.schedule_id,
        starts_at: p.starts_at,
        ends_at: p.ends_at,
        chief_complaint: m.el.querySelector('#f-complaint').value.trim(),
        stage: isPatient ? '待确认' : '已确认',
      });
      if (!r.ok) { App.toast(r.error, 'err'); picker.paint(); return; }
      m.close();
      App.toast(`预约成功：${r.data.appointment_no}${isPatient ? '（已提交前台待确认）' : ''}`, 'ok');
      render();
    };

    // 前台加号（独立表单，选诊室、本地时间计算、原因记入变更历史）
    const addonBtn = m.el.querySelector('#m-addon');
    if (addonBtn) {
      addonBtn.onclick = () => {
        const pid = Number(m.el.querySelector('#f-patient').value);
        const typeId = Number(m.el.querySelector('#f-type').value);
        const doctorId = Number(m.el.querySelector('#f-doctor').value);
        const dateVal = m.el.querySelector('#f-date').value;
        const complaint = m.el.querySelector('#f-complaint').value.trim();
        const type = API.typeOf(typeId);
        const rooms = (API.raw().rooms || []).filter(r => r.active).map(r => ({ value: r.id, label: r.name }));
        if (!pid) { App.toast('请先选择患者', 'err'); return; }
        const am = App.modal('前台加号（纳入预约变更历史）', `
          <div class="note">加号将按项目标准时长（${type ? type.duration_min : 30} 分钟）占用指定诊室，并校验医生与诊室资源冲突。</div>
          <div class="form-grid">
            ${App.fieldRow('诊室', App.selectHtml('ad-room', rooms, rooms[0] ? rooms[0].value : ''))}
            ${App.fieldRow('开始时间', '<input id="ad-time" type="time" value="12:00">')}
            ${App.fieldRow('加号原因（必填）', '<input id="ad-reason" placeholder="如：急诊牙痛加号、老患者复诊">', true)}
          </div>`,
          '<button class="btn ghost" id="ad-c">取消</button><button class="btn" id="ad-s">确认加号</button>', 'sm');
        am.el.querySelector('#ad-c').onclick = am.close;
        am.el.querySelector('#ad-s').onclick = async () => {
          const time = am.el.querySelector('#ad-time').value;
          const reason = am.el.querySelector('#ad-reason').value.trim();
          if (!time || !reason) { App.toast('加号时间与原因必填', 'err'); return; }
          const s = `${dateVal}T${time}`;
          const e = API.addMinutesLocal(s, type ? type.duration_min : 30);
          const r = await API.bookAppointment({
            patient_id: pid,
            type_id: typeId,
            doctor_id: doctorId,
            room_id: Number(am.el.querySelector('#ad-room').value),
            starts_at: s,
            ends_at: e,
            chief_complaint: complaint,
            is_addon: true,
            addon_reason: reason,
            stage: '已确认',
          });
          if (!r.ok) { App.toast(r.error, 'err'); return; }
          am.close(); m.close(); App.toast(`已加号：${r.data.appointment_no}`, 'ok'); render();
        };
      };
    }
  }

  function changeStage(a) {
    if (!a) return;
    const nexts = LEGAL_NEXT[a.stage] || [];
    if (!nexts.length) { App.toast('该预约已处于终态，不可继续变更', 'err'); return; }
    const body = `<div class="note">当前状态：${App.tag(a.stage)}。状态变更将完整记录原阶段、新阶段、操作人与原因。</div>
      <div class="form-grid">
        ${App.fieldRow('目标状态', App.selectHtml('f-stage', nexts, nexts[0]))}
        ${App.fieldRow('变更原因（取消/爽约必填）', '<input id="f-reason" placeholder="请输入原因">', true)}
      </div>`;
    const m = App.modal('预约状态流转 · ' + a.appointment_no, body,
      '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">确认变更</button>', 'sm');
    m.el.querySelector('#m-c').onclick = m.close;
    m.el.querySelector('#m-s').onclick = async () => {
      const st = m.el.querySelector('#f-stage').value;
      const reason = m.el.querySelector('#f-reason').value.trim();
      if (['已取消', '爽约'].includes(st) && !reason) { App.toast('取消或爽约必须填写原因', 'err'); return; }
      const r = await API.changeAppointmentStage(a.id, st, reason);
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('状态已更新', 'ok'); render();
    };
  }

  function patientCancel(a) {
    if (!a) return;
    const m = App.modal('取消预约 · ' + a.appointment_no,
      App.fieldRow('取消原因（必填）', '<input id="f-reason" placeholder="如：临时有事需改期">', true),
      '<button class="btn ghost" id="m-c">返回</button><button class="btn danger" id="m-s">确认取消</button>', 'sm');
    m.el.querySelector('#m-c').onclick = m.close;
    m.el.querySelector('#m-s').onclick = async () => {
      const reason = m.el.querySelector('#f-reason').value.trim();
      if (!reason) { App.toast('请填写取消原因', 'err'); return; }
      const r = await API.changeAppointmentStage(a.id, '已取消', reason);
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('预约已取消', 'ok'); render();
    };
  }

  function reschedule(a) {
    if (!a) return;
    const type = API.typeOf(a.type_id);
    const today = API.localToday(0);
    const maxDate = isPatient ? API.localToday(14) : '';
    const body = `<div class="note">改约按医生出诊号源重选时段，原时段、原阶段、原因与操作人全部保留至变更历史。</div>
      <div class="form-grid">
        ${App.fieldRow('预约类型', `<input value="${App.esc(type ? `${type.name} · ${type.duration_min} 分钟` : '')}" disabled>`)}
        ${App.fieldRow('医生', `<input value="${App.esc(doctorName(a.doctor_id))}" disabled>`)}
        ${App.fieldRow('新日期', `<input id="f-date" type="date" value="${App.esc(String(a.starts_at).slice(0, 10))}" ${isPatient ? `min="${today}" max="${maxDate}"` : ''}>`)}
        ${App.fieldRow('改约原因', '<input id="f-reason" value="患者要求改约">', true)}
      </div>
      <input type="hidden" id="f-doctor" value="${a.doctor_id}">
      <input type="hidden" id="f-type" value="${a.type_id}">
      <div id="slot-box" style="margin-top:10px"></div>`;
    const m = App.modal('改约 · ' + a.appointment_no, body,
      '<button class="btn ghost" id="m-c">取消</button><button class="btn success" id="m-s" disabled>保存改约</button>', 'lg');
    const saveBtn = m.el.querySelector('#m-s');
    const picker = slotPicker(m.el, p => { saveBtn.disabled = !p; }, a.id);
    m.el.querySelector('#m-c').onclick = m.close;
    picker.paint();
    saveBtn.onclick = async () => {
      const p = picker.picked;
      if (!p) { App.toast('请先选择新号源', 'err'); return; }
      const r = await API.rescheduleAppointment({
        id: a.id,
        starts_at: p.starts_at,
        ends_at: p.ends_at,
        room_id: p.room_id,
        reason: m.el.querySelector('#f-reason').value.trim() || '改约',
      });
      if (!r.ok) { App.toast(r.error, 'err'); picker.paint(); return; }
      m.close(); App.toast('改约成功，已保留原预约历史', 'ok'); render();
    };
  }

  function history(a) {
    if (!a) return;
    const db = API.raw();
    const list = API.appointmentHistory(a.id);
    const empName = id => ((db.employees || []).find(e => e.id == id) || {}).name || ('#' + id);
    const body = list.length ? `<ul class="timeline">${list.map(e => `<li>
      <div class="t-time">${App.esc(String(e.occurred_at).slice(0, 19).replace('T', ' '))} · 操作人 ${App.esc(empName(e.changed_by))}</div>
      <div class="t-title">${App.esc(e.old_start || '—')} → ${App.esc(e.new_start || '—')}</div>
      <div>状态 ${App.esc(e.old_stage || '—')} → ${App.esc(e.new_stage)}${e.reason ? ' · 原因：' + App.esc(e.reason) : ''}</div>
    </li>`).join('')}</ul>` : '<div class="empty">暂无变更记录</div>';
    const m = App.modal('预约变更历史 · ' + a.appointment_no, body, '<button class="btn ghost" id="m-c">关闭</button>');
    m.el.querySelector('#m-c').onclick = m.close;
  }

  function printSlip(a) {
    if (!a) return;
    const db = API.raw();
    const p = (db.patients || []).find(x => x.id == a.patient_id) || {};
    const row = (k, v) => `<tr><th>${k}</th><td>${App.esc(v == null ? '' : v)}</td></tr>`;
    const html = `<table>
      ${row('预约编号', a.appointment_no)}
      ${row('患者', `${p.name || ''}（${p.patient_no || ''}）`)}
      ${row('联系电话', p.phone || '')}
      ${row('预约类型', typeName(a.type_id))}
      ${row('接诊医生', doctorName(a.doctor_id))}
      ${row('诊室', roomName(a.room_id))}
      ${row('就诊时间', `${String(a.starts_at).replace('T', ' ')} - ${String(a.ends_at).slice(11, 16)}`)}
      ${row('来源 / 状态', `${a.source} / ${a.stage}`)}
      ${row('主诉', a.chief_complaint || '')}
      ${row('重要健康提示', p.important_note || '')}
    </table>`;
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>预约单 ${App.esc(a.appointment_no)}</title>
      <style>body{font-family:system-ui,sans-serif;padding:24px;color:#142A26}h1{font-size:20px;margin-bottom:14px}
      table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left;font-size:13px}
      th{background:#f3f1eb;width:120px}</style></head><body>
      <h1>口腔诊所预约单 · ${App.esc(a.appointment_no)}</h1>${html}
      <p style="margin-top:16px;font-size:12px;color:#666">请按预约时间提前 10 分钟到诊；如需改约或取消请提前联系诊所。</p>
      <script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }

  render();
};
