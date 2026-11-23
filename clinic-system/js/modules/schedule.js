/* 排班 F4-1：医生出诊段落维护，决定患者端可选号源（BR-09） */
window.Modules = window.Modules || {};
window.Modules.schedule = function (set) {
  const today = () => new Date().toISOString().slice(0, 10);
  let doctorId = 0, from = today();

  const shift = (dateStr, n) => {
    const d = new Date(dateStr + 'T00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const weekday = s => ['日', '一', '二', '三', '四', '五', '六'][new Date(s + 'T00:00').getDay()];
  const hm = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

  function stats(seg) {
    const db = API.raw();
    const step = Number(seg.slot_minutes) || 15;
    const total = Math.max(0, Math.floor((hm(seg.end_time) - hm(seg.start_time)) / step));
    const booked = db.appointments.filter(a =>
      a.doctor_id == seg.doctor_id && String(a.starts_at).slice(0, 10) === seg.work_date &&
      ['待确认', '已确认', '已到诊'].includes(a.stage) &&
      hm(String(a.starts_at).slice(11, 16)) >= hm(seg.start_time) &&
      hm(String(a.starts_at).slice(11, 16)) < hm(seg.end_time)).length;
    return { total, booked };
  }

  function render() {
    const db = API.raw();
    const doctors = db.employees.filter(e => e.role === 'doctor' && e.active);
    const to = shift(from, 13);
    const rows = API.listSchedules({
      doctor_id: doctorId || undefined, start: from, end: to,
    });
    const byDate = {};
    rows.forEach(r => { (byDate[r.work_date] = byDate[r.work_date] || []).push(r); });

    set(`
      <div class="page-head"><div><div class="page-title">排班管理</div>
        <div class="page-desc">F4-1 · 医生出诊段落决定号源；停诊时段对患者端不可见</div></div>
        <button class="btn" id="s-add">+ 新增排班</button></div>
      <div class="card">
        <div class="note">BR-09：预约只能落在出诊段落内并按切片起点对齐；停诊段不计入号源。修改排班会影响患者端可选时段，已产生的预约不受影响。</div>
        <div class="toolbar">
          <div class="field"><label>医生</label>
            ${App.selectHtml('s-doctor', [{ value: 0, label: '全部医生' },
              ...doctors.map(d => ({ value: d.id, label: d.name }))], doctorId)}</div>
          <div class="field"><label>起始日期</label><input id="s-from" type="date" value="${from}"></div>
          <button class="btn ghost" id="s-query">查看两周</button>
        </div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>日期</th><th>医生</th><th>诊室</th><th>出诊时段</th><th>切片</th><th>号源</th><th>已约</th><th>状态</th><th>操作</th>
        </tr></thead><tbody>
          ${rows.length ? rows.map(r => {
            const st = stats(r);
            const doc = db.employees.find(e => e.id == r.doctor_id);
            const room = db.rooms.find(x => x.id == r.room_id);
            return `<tr><td>${App.esc(r.work_date)} <span class="muted">周${weekday(r.work_date)}</span></td>
              <td>${App.esc(doc ? doc.name : '')}</td><td>${App.esc(room ? room.name : '—')}</td>
              <td>${App.esc(r.start_time)}–${App.esc(r.end_time)}</td><td>${r.slot_minutes} 分钟</td>
              <td>${r.stage === '停诊' ? '—' : st.total}</td><td>${st.booked}</td>
              <td>${r.stage === '停诊' ? '<span class="tag red">停诊</span>' : '<span class="tag green">正常</span>'}</td>
              <td class="actions"><button class="btn ghost sm" data-stop="${r.id}">${r.stage === '停诊' ? '恢复' : '停诊'}</button>
                <button class="btn ghost sm" data-del="${r.id}">删除</button></td></tr>`;
          }).join('') : `<tr><td colspan="9"><div class="empty">该范围内暂无排班，可新增或等待系统自动补足两周</div></td></tr>`}
        </tbody></table></div>
      </div>`);

    document.getElementById('s-add').onclick = create;
    document.getElementById('s-doctor').onchange = ev => {
      doctorId = Number(ev.target.value); render();
    };
    document.getElementById('s-query').onclick = () => {
      from = document.getElementById('s-from').value || today(); render();
    };
    document.querySelectorAll('[data-stop]').forEach(b => b.onclick = () => {
      const r = API.raw().schedules.find(x => x.id == b.dataset.stop);
      const toStop = r.stage !== '停诊';
      let note = r.note || '';
      if (toStop) {
        note = prompt('停诊原因（患者端会显示）', '外出学习');
        if (note === null) return;
      }
      API.upsertSchedule({ id: r.id, stage: toStop ? '停诊' : '正常', note: toStop ? note : '' });
      App.toast(toStop ? '已设为停诊' : '已恢复出诊', 'ok'); render();
    });
    document.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      const r = API.removeSchedule(Number(b.dataset.del));
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      App.toast('排班已删除', 'ok'); render();
    });
  }

  function create() {
    const db = API.raw();
    const doctors = db.employees.filter(e => e.role === 'doctor' && e.active)
      .map(e => ({ value: e.id, label: e.name }));
    const rooms = db.rooms.filter(r => r.active).map(r => ({ value: r.id, label: r.name }));
    if (!doctors.length || !rooms.length) { App.toast('缺少医生或诊室配置', 'err'); return; }
    const body = `<div class="form-grid">
      ${App.fieldRow('医生', App.selectHtml('f-doctor', doctors, doctors[0].value))}
      ${App.fieldRow('诊室', App.selectHtml('f-room', rooms, rooms[0].value))}
      ${App.fieldRow('日期', `<input id="f-date" type="date" value="${from}">`)}
      ${App.fieldRow('切片（分钟）', App.selectHtml('f-step', [15, 20, 30], 15))}
      ${App.fieldRow('开始', `<input id="f-start" type="time" value="09:00">`)}
      ${App.fieldRow('结束', `<input id="f-end" type="time" value="12:00">`)}
      ${App.fieldRow('备注', `<input id="f-note" placeholder="如：上午仅接诊复诊">`, true)}
    </div>`;
    const m = App.modal('新增排班', body,
      `<button class="btn ghost" id="m-cancel">取消</button><button class="btn" id="m-save">保存</button>`);
    m.el.querySelector('#m-cancel').onclick = m.close;
    m.el.querySelector('#m-save').onclick = () => {
      const s = m.el.querySelector('#f-start').value;
      const e = m.el.querySelector('#f-end').value;
      if (!s || !e || s >= e) { App.toast('出诊时段无效', 'err'); return; }
      API.upsertSchedule({
        doctor_id: Number(m.el.querySelector('#f-doctor').value),
        room_id: Number(m.el.querySelector('#f-room').value),
        work_date: m.el.querySelector('#f-date').value,
        start_time: s, end_time: e,
        slot_minutes: Number(m.el.querySelector('#f-step').value),
        stage: '正常', note: m.el.querySelector('#f-note').value.trim(),
      });
      m.close(); App.toast('排班已保存', 'ok'); render();
    };
  }

  render();
};
