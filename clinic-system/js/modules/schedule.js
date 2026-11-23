/* 排班号源：管理医生出诊时段、切片时长、停诊设置与实时号源余量 */
window.Modules = window.Modules || {};
window.Modules.schedule = function (set) {
  let doctorId = 0;
  let from = API.localToday(0);

  function shiftDate(dateStr, days) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d + days);
    const pad = n => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  }
  const weekday = s => {
    const [y, m, d] = s.split('-').map(Number);
    return ['日', '一', '二', '三', '四', '五', '六'][new Date(y, m - 1, d).getDay()];
  };
  const hm = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

  function stats(seg) {
    const db = API.raw();
    const step = Number(seg.slot_minutes) || 15;
    const total = Math.max(0, Math.floor((hm(seg.end_time) - hm(seg.start_time)) / step));
    const booked = (db.appointments || []).filter(a =>
      a.doctor_id == seg.doctor_id &&
      String(a.starts_at).slice(0, 10) === seg.work_date &&
      ['待确认', '已确认', '已到诊', '已完成'].includes(a.stage) &&
      hm(String(a.starts_at).slice(11, 16)) >= hm(seg.start_time) &&
      hm(String(a.starts_at).slice(11, 16)) < hm(seg.end_time)
    ).length;
    return { total, booked, free: Math.max(0, total - booked) };
  }

  function render() {
    const db = API.raw();
    const doctors = API.doctors(true);
    const to = shiftDate(from, 13);
    const rows = API.listSchedules({ doctor_id: doctorId || undefined, start: from, end: to });

    set(`
      <div class="page-head">
        <div>
          <div class="page-title">排班号源</div>
          <div class="page-desc">按医生出诊时段与切片时长实时推导号源余量，停诊时段不释放号源</div>
        </div>
        <button class="btn" id="s-add">+ 新增排班</button>
      </div>
      <div class="card">
        <div class="note">同一医生同一日期同一开始时间不可重复排班；出诊总时长必须能被切片时长整除；已有有效预约的排班段不可删除，仅可设为停诊。</div>
        <div class="toolbar">
          <div class="field"><label>医生</label>
            ${App.selectHtml('s-doctor', [{ value: 0, label: '全部医生' }, ...doctors.map(d => ({ value: d.id, label: d.name }))], doctorId)}</div>
          <div class="field"><label>起始日期</label><input id="s-from" type="date" value="${from}"></div>
          <button class="btn ghost" id="s-query">查看未来两周</button>
        </div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>日期</th><th>医生</th><th>诊室</th><th>出诊时段</th><th>切片</th><th>总切片</th><th>已约</th><th>状态</th><th>备注</th><th>操作</th>
        </tr></thead><tbody>
          ${rows.length ? rows.map(r => {
            const st = stats(r);
            const doc = (db.employees || []).find(e => e.id == r.doctor_id);
            const room = (db.rooms || []).find(x => x.id == r.room_id);
            return `<tr>
              <td>${App.esc(r.work_date)} <span class="muted">周${weekday(r.work_date)}</span></td>
              <td>${App.esc(doc ? doc.name : '')}</td>
              <td>${App.esc(room ? room.name : '—')}</td>
              <td>${App.esc(r.start_time)}–${App.esc(r.end_time)}</td>
              <td>${r.slot_minutes} 分钟</td>
              <td>${r.stage === '停诊' ? '—' : st.total}</td>
              <td>${st.booked}</td>
              <td>${App.tag(r.stage)}</td>
              <td class="muted">${App.esc(r.note || '—')}</td>
              <td class="actions">
                <button class="btn ghost sm" data-stop="${r.id}">${r.stage === '停诊' ? '恢复出诊' : '设为停诊'}</button>
                <button class="btn ghost sm" data-del="${r.id}">删除</button>
              </td></tr>`;
          }).join('') : '<tr><td colspan="10"><div class="empty">该两周范围内暂无排班，请点击右上角新增</div></td></tr>'}
        </tbody></table></div>
      </div>`);

    document.getElementById('s-add').onclick = create;
    document.getElementById('s-doctor').onchange = ev => { doctorId = Number(ev.target.value); render(); };
    document.getElementById('s-query').onclick = () => { from = document.getElementById('s-from').value || API.localToday(0); render(); };
    document.querySelectorAll('[data-stop]').forEach(b => b.onclick = async () => {
      const r = (API.raw().schedules || []).find(x => x.id == b.dataset.stop);
      if (!r) return;
      let note = '';
      if (r.stage !== '停诊') {
        note = prompt('请输入停诊原因（预约查询时向患者和前台展示）', '外出培训停诊');
        if (note === null) return;
      }
      const res = await API.toggleSchedule(r.id, note);
      if (!res.ok) { App.toast(res.error, 'err'); return; }
      App.toast(r.stage === '停诊' ? '已恢复出诊' : '已设为停诊', 'ok'); render();
    });
    document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const res = await API.deleteSchedule(Number(b.dataset.del));
      if (!res.ok) { App.toast(res.error, 'err'); return; }
      App.toast('排班已删除', 'ok'); render();
    });
  }

  function create() {
    const doctors = API.doctors(true).map(e => ({ value: e.id, label: e.name }));
    const rooms = (API.raw().rooms || []).filter(r => r.active).map(r => ({ value: r.id, label: r.name }));
    if (!doctors.length || !rooms.length) { App.toast('缺少启用中的医生或诊室', 'err'); return; }
    const body = `<div class="form-grid">
      ${App.fieldRow('医生', App.selectHtml('f-doctor', doctors, doctors[0].value))}
      ${App.fieldRow('诊室', App.selectHtml('f-room', rooms, rooms[0].value))}
      ${App.fieldRow('出诊日期', `<input id="f-date" type="date" value="${from}">`)}
      ${App.fieldRow('切片时长（分钟）', App.selectHtml('f-step', [15, 20, 30], 15))}
      ${App.fieldRow('开始时间', `<input id="f-start" type="time" value="09:00">`)}
      ${App.fieldRow('结束时间', `<input id="f-end" type="time" value="12:00">`)}
      ${App.fieldRow('备注', `<input id="f-note" placeholder="选填">`, true)}
    </div>`;
    const m = App.modal('新增医生排班', body, '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">保存</button>');
    m.el.querySelector('#m-c').onclick = m.close;
    m.el.querySelector('#m-s').onclick = async () => {
      const s = m.el.querySelector('#f-start').value;
      const e = m.el.querySelector('#f-end').value;
      const step = Number(m.el.querySelector('#f-step').value);
      if (!s || !e || hm(e) <= hm(s)) { App.toast('结束时间必须晚于开始时间', 'err'); return; }
      if ((hm(e) - hm(s)) % step !== 0) { App.toast(`出诊时长（${hm(e) - hm(s)} 分钟）须能被切片（${step} 分钟）整除`, 'err'); return; }
      const r = await API.saveSchedule({
        doctor_id: Number(m.el.querySelector('#f-doctor').value),
        room_id: Number(m.el.querySelector('#f-room').value),
        work_date: m.el.querySelector('#f-date').value,
        start_time: s, end_time: e, slot_minutes: step,
        stage: '正常', note: m.el.querySelector('#f-note').value.trim(),
      });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('排班已保存', 'ok'); render();
    };
  }

  render();
};
