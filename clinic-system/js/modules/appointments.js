/* 预约管理（UC-01 / UC-05）：
 * - 患者端隐藏冗余姓名列与就诊人卡片，严格隔离他人数据
 * - 现代医疗三步渐进式预约向导：① 选择医生 → ② 交互式年月日历与项目 → ③ 上午/下午分组时间段
 * - 前台端精简工作台：状态统计胶囊、实时搜索、一键快捷状态流转（确认/到诊/完成）、改约、加号、留痕与打印
 */
window.Modules = window.Modules || {};
window.Modules.appointments = function (set, opts) {
  const session = API.session() || {};
  const isPatient = session.role === 'patient';
  const canWrite = ['receptionist', 'admin'].includes(session.role);
  const canBook = canWrite || isPatient;

  let scope = (opts && opts.scope) || (isPatient ? 'all' : 'today');
  let start = '', end = '', keyword = '';

  const typeName = id => (API.typeOf(id) || {}).name || '';
  const doctorName = id => ((API.raw().employees || []).find(e => e.id == id) || {}).name || '';
  const roomName = id => ((API.raw().rooms || []).find(r => r.id == id) || {}).name || '';
  const pad2 = n => String(n).padStart(2, '0');

  const WEEKDAYS_CN = ['日', '一', '二', '三', '四', '五', '六'];
  function weekdayCn(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return WEEKDAYS_CN[new Date(y, m - 1, d).getDay()] || '';
  }

  const LEGAL_NEXT = {
    '待确认': ['已确认', '已取消'],
    '已确认': ['已到诊', '已取消', '爽约'],
    '已到诊': ['已完成'],
    '已完成': [],
    '已取消': [],
    '爽约': [],
  };

  function visibleList() {
    let list = scope === 'period' ? API.listAppointments({ start, end }) : API.listAppointments({ scope });
    if (keyword) {
      const db = API.raw();
      const kw = keyword.toLowerCase();
      list = list.filter(a => {
        const p = (db.patients || []).find(x => x.id == a.patient_id);
        return [a.appointment_no, p ? p.name : '', p ? p.phone : '', doctorName(a.doctor_id), typeName(a.type_id)]
          .some(v => String(v || '').toLowerCase().includes(kw));
      });
    }
    return list;
  }

  function render() {
    const db = API.raw();
    const allAppts = db.appointments || [];
    const today = API.localToday(0);
    const tomorrow = API.localToday(1);
    const list = visibleList();

    const cntToday = allAppts.filter(a => String(a.starts_at).slice(0, 10) === today).length;
    const cntTom = allAppts.filter(a => String(a.starts_at).slice(0, 10) === tomorrow).length;
    const cntPending = allAppts.filter(a => a.stage === '待确认').length;
    const cntUpcoming = allAppts.filter(a => ['待确认', '已确认'].includes(a.stage) && String(a.starts_at).slice(0, 10) >= today).length;
    const cntDone = allAppts.filter(a => a.stage === '已完成').length;

    const tabs = isPatient
      ? [['all', '全部预约', allAppts.length], ['pending', '待确认', cntPending]]
      : [
          ['today', '今日', cntToday],
          ['tomorrow', '明日', cntTom],
          ['pending', '待确认', cntPending],
          ['period', '期间查询', null],
          ['all', '全部', allAppts.length],
        ];
    const complexNames = API.listTypes(true).filter(t => !t.self_bookable).map(t => t.name).join('、');

    set(`
      <div class="page-head">
        <div>
          <div class="page-title">${isPatient ? '我的预约' : '预约管理'}</div>
          <div class="page-desc">${isPatient
            ? '按「选医生 → 选日期 → 选时间段」自助预约标准项目，提交后由前台确认生效'
            : '按排班号源选号预约、资源冲突拦截、快捷状态流转与改约变更留痕'}</div>
        </div>
        ${canBook ? `<button class="btn" id="a-add">${isPatient ? '+ 自助预约' : '+ 登记并预约'}</button>` : ''}
      </div>

      ${isPatient ? `<div class="grid cols-3" style="margin-bottom:18px">
        <div class="kpi"><div class="label">即将到诊</div><div class="value" style="color:var(--primary)">${cntUpcoming}</div><div class="kpi-foot">含已确认与待确认预约</div></div>
        <div class="kpi"><div class="label">待前台确认</div><div class="value" style="color:${cntPending > 0 ? 'var(--warn)' : 'var(--ink)'}">${cntPending}</div><div class="kpi-foot">自助提交后由诊所确认</div></div>
        <div class="kpi"><div class="label">已完成就诊</div><div class="value" style="color:var(--success)">${cntDone}</div><div class="kpi-foot">累计历史预约 ${allAppts.length} 次</div></div>
      </div>` : ''}

      <div class="card">
        <div class="note">${isPatient
          ? `自助预约仅开放标准项目且限于未来两周内号源；${complexNames ? `「${complexNames}」等需医生评估的复杂项目请到店或致电由前台排程。` : ''}近 90 天累计爽约两次将暂停自助预约权限 90 天。`
          : '预约须落在医生出诊时段内并按切片对齐，同一医生或诊室同一时段仅允许一个有效预约；号源已满时可在预约弹窗中使用前台加号。'}</div>

        <div class="toolbar" style="justify-content:space-between;align-items:center">
          <div class="tabs" style="margin-bottom:0">
            ${tabs.map(([k, l, cnt]) => `<div class="tab ${scope === k ? 'active' : ''}" data-scope="${k}">${l}${cnt !== null ? `<span class="tab-badge">${cnt}</span>` : ''}</div>`).join('')}
          </div>
          ${!isPatient ? `<div style="display:flex;gap:8px;align-items:center">
            <input id="a-kw" placeholder="搜索患者、医生或预约号…" value="${App.esc(keyword)}" style="height:36px;padding:0 12px;border:1.5px solid var(--line);border-radius:8px;width:220px;font-size:13px">
          </div>` : ''}
        </div>

        ${scope === 'period' ? `<div class="toolbar">
          <div class="field"><label>开始日期</label><input id="a-start" type="date" value="${start}"></div>
          <div class="field"><label>结束日期</label><input id="a-end" type="date" value="${end}"></div>
          <button class="btn ghost" id="a-query">查询</button>
        </div>` : ''}

        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>预约编号</th>${isPatient ? '' : '<th>患者</th>'}<th>预约类型</th><th>医生</th><th>诊室</th><th>就诊时段</th><th>来源</th><th>状态</th><th>操作</th>
        </tr></thead><tbody>
          ${list.length ? list.map(a => {
            const p = (db.patients || []).find(x => x.id == a.patient_id);
            const activeForChange = ['待确认', '已确认'].includes(a.stage);
            const hasNext = (LEGAL_NEXT[a.stage] || []).length > 0;
            const quickNext = a.stage === '待确认' ? ['已确认', '确认']
              : (a.stage === '已确认' ? ['已到诊', '签到']
                : (a.stage === '已到诊' ? ['已完成', '完成'] : null));
            return `<tr>
              <td><b>${App.esc(a.appointment_no)}</b></td>
              ${isPatient ? '' : `<td><b>${App.esc(p ? p.name : '—')}</b>${p && p.phone ? `<div class="muted">${App.esc(p.phone)}</div>` : ''}</td>`}
              <td>${App.esc(typeName(a.type_id))}</td>
              <td>${App.esc(doctorName(a.doctor_id))}</td>
              <td>${App.esc(roomName(a.room_id))}</td>
              <td><b>${App.esc(String(a.starts_at).slice(0, 10))}</b> <span class="muted">${App.esc(String(a.starts_at).slice(11, 16))} ~ ${App.esc(String(a.ends_at).slice(11, 16))}</span></td>
              <td><span class="tag ${a.source === '患者自助' ? 'blue' : 'gray'}">${App.esc(a.source)}</span></td>
              <td>${App.tag(a.stage)}</td>
              <td class="actions">
                ${canWrite && quickNext ? `<button class="btn soft sm" data-qstage="${a.id}" data-qto="${quickNext[0]}">${quickNext[1]}</button>` : ''}
                ${(canWrite || isPatient) && activeForChange ? `<button class="btn ghost sm" data-resched="${a.id}">改约</button>` : ''}
                ${canWrite && hasNext && activeForChange ? `<button class="btn ghost sm" data-stage="${a.id}">取消/爽约</button>` : ''}
                ${isPatient && activeForChange ? `<button class="btn ghost sm" data-pcancel="${a.id}">取消</button>` : ''}
                ${!isPatient ? `<button class="btn ghost sm" data-hist="${a.id}">留痕</button>` : ''}
                ${canWrite ? `<button class="btn ghost sm" data-print="${a.id}">打印</button>` : ''}
              </td></tr>`;
          }).join('') : `<tr><td colspan="${isPatient ? 8 : 9}"><div class="empty">当前范围暂无预约记录</div></td></tr>`}
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
    const kwInp = document.getElementById('a-kw');
    if (kwInp) {
      kwInp.oninput = () => {
        keyword = kwInp.value.trim();
        render();
        const nextInp = document.getElementById('a-kw');
        if (nextInp) { nextInp.focus(); nextInp.setSelectionRange(nextInp.value.length, nextInp.value.length); }
      };
    }
    const q = document.getElementById('a-query');
    if (q) q.onclick = () => {
      start = document.getElementById('a-start').value;
      end = document.getElementById('a-end').value;
      render();
    };
    const db = API.raw();
    document.querySelectorAll('[data-qstage]').forEach(b => b.onclick = async () => {
      const r = await API.changeAppointmentStage(Number(b.dataset.qstage), b.dataset.qto, '');
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      App.toast(`预约已更新为「${b.dataset.qto}」`, 'ok'); render();
    });
    document.querySelectorAll('[data-stage]').forEach(b => b.onclick = () => changeStage(db.appointments.find(a => a.id == b.dataset.stage)));
    document.querySelectorAll('[data-resched]').forEach(b => b.onclick = () => reschedule(db.appointments.find(a => a.id == b.dataset.resched)));
    document.querySelectorAll('[data-pcancel]').forEach(b => b.onclick = () => patientCancel(db.appointments.find(a => a.id == b.dataset.pcancel)));
    document.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => history(db.appointments.find(a => a.id == b.dataset.hist)));
    document.querySelectorAll('[data-print]').forEach(b => b.onclick = () => printSlip(db.appointments.find(a => a.id == b.dataset.print)));
  }

  /* =====================================================================
   * 现代医疗三步渐进式选号向导（① 选医生 → ② 选年月日历 → ③ 选上午/下午时段）
   * 供「患者自助预约」「前台登记并预约」「改约」共用，逻辑校验完全走后端事务
   * ===================================================================== */
  function buildBookingWizard(container, cfg) {
    const today = API.localToday(0);
    const maxDate = isPatient ? API.localToday(14) : '';
    const doctors = API.doctors(true);
    const bookableTypes = API.listTypes(true).filter(t => !isPatient || t.self_bookable);
    const complexTypes = isPatient ? API.listTypes(true).filter(t => !t.self_bookable) : [];

    const nowDate = new Date();
    const initDate = cfg.initialDate || today;
    const initParts = initDate.split('-').map(Number);

    const state = {
      step: cfg.lockedDoctorId ? 2 : 1,
      doctorId: cfg.lockedDoctorId || 0,
      typeId: cfg.lockedTypeId || (bookableTypes[0] ? bookableTypes[0].id : 0),
      calYear: initParts[0] || nowDate.getFullYear(),
      calMonth: initParts[1] || (nowDate.getMonth() + 1),
      dateMap: {},
      dateLoading: false,
      selectedDate: '',
      slotsData: null,
      slotsLoading: false,
      pickedSlot: null,
    };

    function notify() {
      if (cfg.onChange) cfg.onChange(state);
    }

    async function loadMonthDates() {
      if (!state.doctorId) return;
      state.dateLoading = true;
      paint();
      const firstDay = `${state.calYear}-${pad2(state.calMonth)}-01`;
      const lastNum = new Date(state.calYear, state.calMonth, 0).getDate();
      const lastDay = `${state.calYear}-${pad2(state.calMonth)}-${pad2(lastNum)}`;
      const r = await API.doctorDates(state.doctorId, firstDay, lastDay);
      state.dateMap = (r.ok && r.data && r.data.dates) ? r.data.dates : {};
      state.dateLoading = false;
      paint();
    }

    async function loadSlots() {
      if (!state.doctorId || !state.selectedDate) return;
      const type = API.typeOf(state.typeId);
      state.slotsLoading = true;
      state.pickedSlot = null;
      notify();
      paint();
      const r = await API.slots(state.doctorId, state.selectedDate, type ? type.duration_min : 30, cfg.excludeId || null);
      state.slotsData = r.ok ? r.data : { slots: [], note: r.error || '号源查询失败', error: true };
      state.slotsLoading = false;
      notify();
      paint();
    }

    function renderStepper() {
      const docLabel = state.doctorId ? doctorName(state.doctorId) : '未选择';
      const dateLabel = state.selectedDate ? `${state.selectedDate} 周${weekdayCn(state.selectedDate)}` : '未选择';
      const slotLabel = state.pickedSlot
        ? `${String(state.pickedSlot.starts_at).slice(11, 16)} - ${String(state.pickedSlot.ends_at).slice(11, 16)}`
        : '未选择';

      const s1Done = !!state.doctorId && state.step > 1;
      const s2Done = !!state.selectedDate && state.step > 2;
      const s3Done = !!state.pickedSlot;

      return `<div class="booking-stepper">
        <div class="step-node ${state.step === 1 ? 'active' : (s1Done ? 'done' : '')} ${cfg.lockedDoctorId ? 'disabled' : ''}" data-step="1">
          <span class="step-num">${s1Done ? '✓' : '1'}</span>
          <div class="step-meta"><b>选择医生</b><small>${App.esc(docLabel)}</small></div>
        </div>
        <div class="step-line ${s1Done ? 'done' : ''}"></div>
        <div class="step-node ${state.step === 2 ? 'active' : (s2Done ? 'done' : '')} ${!state.doctorId ? 'disabled' : ''}" data-step="2">
          <span class="step-num">${s2Done ? '✓' : '2'}</span>
          <div class="step-meta"><b>选择年月日</b><small>${App.esc(dateLabel)}</small></div>
        </div>
        <div class="step-line ${s2Done ? 'done' : ''}"></div>
        <div class="step-node ${state.step === 3 ? 'active' : (s3Done ? 'done' : '')} ${!state.selectedDate ? 'disabled' : ''}" data-step="3">
          <span class="step-num">${s3Done ? '✓' : '3'}</span>
          <div class="step-meta"><b>选择时间段</b><small>${App.esc(slotLabel)}</small></div>
        </div>
      </div>`;
    }

    function renderStep1() {
      return `<div class="step-panel">
        <div class="step-heading">
          <h4>第一步：请选择接诊医生</h4>
          <span>选定医生后将弹出该医生的可约出诊日历</span>
        </div>
        <div class="doctor-grid">
          ${doctors.map(d => `
            <button type="button" class="doctor-card ${state.doctorId == d.id ? 'selected' : ''}" data-pick-doc="${d.id}">
              <div class="doctor-avatar">${App.esc(String(d.name || '医').slice(0, 1))}</div>
              <div class="doctor-meta">
                <b>${App.esc(d.name)}</b>
                <span>口腔医生 · 点击查看排班日期</span>
              </div>
            </button>`).join('')}
        </div>
      </div>`;
    }

    function renderTypeSelector() {
      if (cfg.lockedTypeId) return '';
      return `
        <div style="margin-bottom:14px">
          <div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:7px">就诊项目（不同项目标准时长不同）</div>
          <div class="type-pills">
            ${bookableTypes.map(t => `<button type="button" class="type-pill ${state.typeId == t.id ? 'selected' : ''}" data-pick-type="${t.id}">
              ${App.esc(t.name)}<small>${t.duration_min}分钟${t.price_hint ? ' · ' + App.esc(t.price_hint) : ''}</small>
            </button>`).join('')}
          </div>
          ${complexTypes.length ? `<div class="complex-banner">
            <div class="complex-banner-title">需医生评估的复杂项目（暂不支持自助选号，点击查看指引）</div>
            <div class="complex-banner-chips">
              ${complexTypes.map(t => `<button type="button" class="btn ghost sm" data-complex="${App.esc(t.name)}">${App.esc(t.name)} · 需医生评估</button>`).join('')}
            </div>
          </div>` : ''}
        </div>`;
    }

    function renderStep2() {
      const y = state.calYear, m = state.calMonth;
      const firstWeekday = new Date(y, m - 1, 1).getDay();
      const daysInMonth = new Date(y, m, 0).getDate();
      const cells = [];
      for (let i = 0; i < firstWeekday; i++) {
        cells.push('<div class="cal-day empty-cell"></div>');
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const iso = `${y}-${pad2(m)}-${pad2(d)}`;
        const info = state.dateMap[iso];
        const outOfRange = isPatient && (iso < today || iso > maxDate);
        const cls = [
          'cal-day',
          iso === today ? 'is-today' : '',
          state.selectedDate === iso ? 'selected' : '',
          outOfRange ? 'disabled' : (info ? (info.status === 'open' ? 'is-open' : 'is-stopped') : ''),
        ].filter(Boolean).join(' ');
        const sub = outOfRange ? '' : (info ? (info.status === 'open' ? '有号' : '停诊') : '无排');
        cells.push(`<button type="button" class="${cls}" data-pick-date="${iso}" ${outOfRange ? 'disabled' : ''}>
          <span class="dn">${d}</span>
          <span class="ds">${sub}</span>
        </button>`);
      }

      return `<div class="step-panel">
        <div class="step-heading">
          <h4>第二步：选择 ${App.esc(doctorName(state.doctorId))} 的就诊日期（年 / 月 / 日）</h4>
          <span>${!cfg.lockedDoctorId ? '<a href="#" id="wiz-back-doc">← 更换医生</a>' : '选择日期后将弹出当日可选时间段'}</span>
        </div>
        ${renderTypeSelector()}
        <div class="cal-box">
          <div class="cal-head">
            <div class="cal-month">${y} 年 ${m} 月 ${state.dateLoading ? '<span class="muted" style="font-weight:400;margin-left:6px">加载出诊日历…</span>' : ''}</div>
            <div class="cal-nav">
              <button type="button" class="btn ghost sm" id="cal-prev">‹ 上月</button>
              <button type="button" class="btn ghost sm" id="cal-today">本月</button>
              <button type="button" class="btn ghost sm" id="cal-next">下月 ›</button>
            </div>
          </div>
          <div class="cal-weekdays">${WEEKDAYS_CN.map(w => `<div>周${w}</div>`).join('')}</div>
          <div class="cal-grid">${cells.join('')}</div>
          <div class="cal-legend">
            <span><i class="cal-dot" style="background:var(--primary)"></i>有出诊号源</span>
            <span><i class="cal-dot" style="background:var(--danger)"></i>医生停诊（点击查看原因）</span>
            <span><i class="cal-dot" style="background:#CBD5DC"></i>当日未排班</span>
            ${isPatient ? '<span style="margin-left:auto;color:var(--primary-dk)">仅开放未来 14 天内号源</span>' : ''}
          </div>
        </div>
      </div>`;
    }

    function renderStep3() {
      const type = API.typeOf(state.typeId);
      const d = state.slotsData || {};
      const allSlots = d.slots || [];
      const freeCount = allSlots.filter(s => s.state === '可预约').length;
      const amSlots = allSlots.filter(s => String(s.starts_at).slice(11, 16) < '12:00');
      const pmSlots = allSlots.filter(s => String(s.starts_at).slice(11, 16) >= '12:00');

      const slotBtn = s => {
        const st = String(s.starts_at).slice(11, 16);
        const en = String(s.ends_at).slice(11, 16);
        const isPicked = state.pickedSlot && state.pickedSlot.starts_at === s.starts_at && state.pickedSlot.room_id == s.room_id;
        return `<button type="button" class="slot ${s.state === '已占用' ? 'busy' : ''} ${isPicked ? 'on' : ''}"
          data-slot="${App.esc(s.starts_at)}" data-end="${App.esc(s.ends_at)}"
          data-room="${s.room_id || ''}" data-sched="${s.schedule_id || ''}"
          ${s.state === '已占用' ? `disabled title="已占用${s.appointment_no ? '（' + App.esc(s.appointment_no) + '）' : ''}"` : ''}>
          <span>${st} - ${en}</span>
          <small>${s.state === '已占用' ? '已占用' : App.esc(roomName(s.room_id) || '可预约')}</small>
        </button>`;
      };

      let bodyHtml = '';
      if (state.slotsLoading) {
        bodyHtml = '<div class="note">正在实时查询该医生当日号源与占用状态…</div>';
      } else if (!allSlots.length) {
        bodyHtml = `<div class="note ${d.error ? 'error' : 'warn'}">${App.esc(d.note || '当日暂无可约号源')}，请返回日历切换日期或医生。</div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button type="button" class="btn ghost sm" id="wiz-reselect-date">← 重选日期</button>
            ${!cfg.lockedDoctorId ? '<button type="button" class="btn ghost sm" id="wiz-reselect-doc">← 更换医生</button>' : ''}
          </div>`;
      } else {
        bodyHtml = `
          <div class="slot-summary">
            <span>${App.esc(state.selectedDate)}（周${weekdayCn(state.selectedDate)}）· ${App.esc(doctorName(state.doctorId))} · ${App.esc(type ? type.name : '')}</span>
            <span>剩余 ${freeCount} 个可选号源 · 每号 ${d.duration_min} 分钟</span>
          </div>
          ${amSlots.length ? `<div class="slot-section">
            <div class="slot-section-title">上午时段（${amSlots.filter(s => s.state === '可预约').length} 个可选）</div>
            <div class="slot-grid">${amSlots.map(slotBtn).join('')}</div>
          </div>` : ''}
          ${pmSlots.length ? `<div class="slot-section">
            <div class="slot-section-title">下午时段（${pmSlots.filter(s => s.state === '可预约').length} 个可选）</div>
            <div class="slot-grid">${pmSlots.map(slotBtn).join('')}</div>
          </div>` : ''}
          <div class="slot-foot">灰色划线时段已被占用，不可重复选择。</div>`;
      }

      return `<div class="step-panel">
        <div class="step-heading">
          <h4>第三步：选择就诊时间段</h4>
          <span><a href="#" id="wiz-back-date">← 更换日期</a>${!cfg.lockedDoctorId ? ' ｜ <a href="#" id="wiz-back-doc">更换医生</a>' : ''}</span>
        </div>
        ${!cfg.lockedTypeId ? `<div class="type-pills" style="margin-bottom:12px">
          ${bookableTypes.map(t => `<button type="button" class="type-pill ${state.typeId == t.id ? 'selected' : ''}" data-pick-type="${t.id}">
            ${App.esc(t.name)}<small>${t.duration_min}分钟</small>
          </button>`).join('')}
        </div>` : ''}
        ${bodyHtml}
      </div>`;
    }

    function paint() {
      const panel = state.step === 1 ? renderStep1() : (state.step === 2 ? renderStep2() : renderStep3());
      container.innerHTML = renderStepper() + panel;

      container.querySelectorAll('[data-step]').forEach(el => {
        el.onclick = () => {
          const target = Number(el.dataset.step);
          if (target === 1 && !cfg.lockedDoctorId) { state.step = 1; paint(); notify(); }
          if (target === 2 && state.doctorId) { state.step = 2; paint(); notify(); }
          if (target === 3 && state.selectedDate) { state.step = 3; paint(); notify(); }
        };
      });

      container.querySelectorAll('[data-pick-doc]').forEach(btn => {
        btn.onclick = () => {
          state.doctorId = Number(btn.dataset.pickDoc);
          state.selectedDate = '';
          state.pickedSlot = null;
          state.slotsData = null;
          state.step = 2;
          notify();
          loadMonthDates();
        };
      });

      container.querySelectorAll('[data-pick-type]').forEach(btn => {
        btn.onclick = () => {
          state.typeId = Number(btn.dataset.pickType);
          state.pickedSlot = null;
          notify();
          if (state.step === 3 && state.selectedDate) loadSlots();
          else paint();
        };
      });

      container.querySelectorAll('[data-complex]').forEach(btn => {
        btn.onclick = () => App.toast(`「${btn.dataset.complex}」需医生面诊评估，请到店或致电诊所由前台排程`, 'err');
      });

      const prevBtn = container.querySelector('#cal-prev');
      if (prevBtn) prevBtn.onclick = () => {
        if (state.calMonth === 1) { state.calYear--; state.calMonth = 12; } else state.calMonth--;
        loadMonthDates();
      };
      const nextBtn = container.querySelector('#cal-next');
      if (nextBtn) nextBtn.onclick = () => {
        if (state.calMonth === 12) { state.calYear++; state.calMonth = 1; } else state.calMonth++;
        loadMonthDates();
      };
      const todayBtn = container.querySelector('#cal-today');
      if (todayBtn) todayBtn.onclick = () => {
        const n = new Date();
        state.calYear = n.getFullYear();
        state.calMonth = n.getMonth() + 1;
        loadMonthDates();
      };

      container.querySelectorAll('[data-pick-date]').forEach(btn => {
        btn.onclick = () => {
          state.selectedDate = btn.dataset.pickDate;
          state.step = 3;
          loadSlots();
        };
      });

      container.querySelectorAll('.slot:not(.busy)').forEach(btn => {
        btn.onclick = () => {
          state.pickedSlot = {
            starts_at: btn.dataset.slot,
            ends_at: btn.dataset.end,
            room_id: Number(btn.dataset.room) || null,
            schedule_id: Number(btn.dataset.sched) || null,
          };
          notify();
          paint();
        };
      });

      const backDoc = container.querySelector('#wiz-back-doc') || container.querySelector('#wiz-reselect-doc');
      if (backDoc) backDoc.onclick = e => { e.preventDefault(); state.step = 1; paint(); notify(); };
      const backDate = container.querySelector('#wiz-back-date') || container.querySelector('#wiz-reselect-date');
      if (backDate) backDate.onclick = e => { e.preventDefault(); state.step = 2; paint(); notify(); };
    }

    paint();
    if (cfg.lockedDoctorId) loadMonthDates();
    return {
      get state() { return state; },
      reloadSlots: loadSlots,
    };
  }

  // UC-01 前台登记并预约 / UC-05 患者自助预约（三步渐进向导：选医生 → 选年月日 → 选时间段）
  function create() {
    const db = API.raw();
    const doctors = API.doctors(true);
    const types = API.listTypes(true).filter(t => !isPatient || t.self_bookable);
    if (!types.length || !doctors.length) { App.toast('缺少启用中的预约类型或医生', 'err'); return; }

    const patientStrip = isPatient ? '' : `
      <div class="patient-strip">
        <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px">就诊患者（检索已有档案或就地新建/待核对档案）</div>
        <div class="patient-strip-top">
          <input id="p-search" placeholder="输入姓名或手机号检索…" style="width:200px">
          ${App.selectHtml('f-patient', (db.patients || []).map(p => ({ value: p.id, label: `${p.patient_no} ${p.name} ${p.phone || ''}` })), db.patients[0] ? db.patients[0].id : '', 'style="flex:1;min-width:200px"')}
          <button class="btn soft sm" type="button" id="p-quick-new">+ 新建/待核对档案</button>
        </div>
        <div id="p-new-box" style="display:none;margin-top:12px;padding-top:12px;border-top:1px dashed var(--line)">
          <div class="form-grid">
            ${App.fieldRow('新患者姓名', '<input id="np-name" placeholder="必填">')}
            ${App.fieldRow('手机号', '<input id="np-phone" placeholder="联系电话">')}
            ${App.fieldRow('出生日期', '<input id="np-birth" type="date">')}
            ${App.fieldRow('身份核对', App.selectHtml('np-pending', [{ value: '0', label: '确认新患者' }, { value: '1', label: '身份存疑·建立待核对档案' }], '0'))}
            ${App.fieldRow('重要健康提示', '<input id="np-note" placeholder="如：过敏史">', true)}
          </div>
          <button class="btn sm" type="button" id="np-create">保存档案并选用</button>
        </div>
      </div>`;

    const body = `
      ${patientStrip}
      <div id="booking-wizard"></div>
      <div id="complaint-wrap" style="display:none;margin-top:14px;padding-top:12px;border-top:1px solid var(--line-soft)">
        ${App.fieldRow('主诉（选填）', '<input id="f-complaint" placeholder="如：右下后牙冷热痛三天">', true)}
      </div>`;

    const m = App.modal(isPatient ? '自助预约挂号' : '登记患者并预约诊疗', body,
      `<button class="btn ghost" id="m-cancel">取消</button>
       ${canWrite ? '<button class="btn ghost" id="m-addon">号源已满 · 前台加号</button>' : ''}
       <button class="btn success" id="m-save" disabled>确认提交预约</button>`, 'lg');

    const saveBtn = m.el.querySelector('#m-save');
    const complaintWrap = m.el.querySelector('#complaint-wrap');
    m.el.querySelector('#m-cancel').onclick = m.close;

    const wiz = buildBookingWizard(m.el.querySelector('#booking-wizard'), {
      onChange(st) {
        saveBtn.disabled = !st.pickedSlot;
        complaintWrap.style.display = st.step === 3 ? 'block' : 'none';
      },
    });

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
      const st = wiz.state;
      if (!st.pickedSlot) { App.toast('请先选择时间段', 'err'); return; }
      const pid = isPatient ? session.patientId : Number(m.el.querySelector('#f-patient').value);
      if (!pid) { App.toast('请选择或先新建患者档案', 'err'); return; }
      const r = await API.bookAppointment({
        patient_id: pid,
        type_id: st.typeId,
        doctor_id: st.doctorId,
        room_id: st.pickedSlot.room_id,
        schedule_id: st.pickedSlot.schedule_id,
        starts_at: st.pickedSlot.starts_at,
        ends_at: st.pickedSlot.ends_at,
        chief_complaint: m.el.querySelector('#f-complaint').value.trim(),
        stage: isPatient ? '待确认' : '已确认',
      });
      if (!r.ok) { App.toast(r.error, 'err'); wiz.reloadSlots(); return; }
      m.close();
      App.toast(`预约成功：${r.data.appointment_no}${isPatient ? '（已提交前台待确认）' : ''}`, 'ok');
      render();
    };

    // 前台加号（号源已满时使用，原因记入变更历史）
    const addonBtn = m.el.querySelector('#m-addon');
    if (addonBtn) {
      addonBtn.onclick = () => {
        const st = wiz.state;
        const pid = Number(m.el.querySelector('#f-patient').value);
        if (!pid) { App.toast('请先选择患者', 'err'); return; }
        const docOpts = doctors.map(d => ({ value: d.id, label: d.name }));
        const typeOpts = types.map(t => ({ value: t.id, label: `${t.name}（${t.duration_min}分钟）` }));
        const rooms = (API.raw().rooms || []).filter(r => r.active).map(r => ({ value: r.id, label: r.name }));
        const am = App.modal('前台加号（纳入预约变更历史）', `
          <div class="note">加号将按项目标准时长占用指定诊室，并实时校验医生与诊室资源冲突。</div>
          <div class="form-grid">
            ${App.fieldRow('接诊医生', App.selectHtml('ad-doc', docOpts, st.doctorId || docOpts[0].value))}
            ${App.fieldRow('预约项目', App.selectHtml('ad-type', typeOpts, st.typeId || typeOpts[0].value))}
            ${App.fieldRow('加号日期', `<input id="ad-date" type="date" value="${st.selectedDate || API.localToday(0)}">`)}
            ${App.fieldRow('开始时间', '<input id="ad-time" type="time" value="12:00">')}
            ${App.fieldRow('诊室', App.selectHtml('ad-room', rooms, rooms[0] ? rooms[0].value : ''), true)}
            ${App.fieldRow('加号原因（必填）', '<input id="ad-reason" placeholder="如：急诊牙痛加号、老患者复诊">', true)}
          </div>`,
          '<button class="btn ghost" id="ad-c">取消</button><button class="btn" id="ad-s">确认加号</button>', 'sm');
        am.el.querySelector('#ad-c').onclick = am.close;
        am.el.querySelector('#ad-s').onclick = async () => {
          const dVal = am.el.querySelector('#ad-date').value;
          const time = am.el.querySelector('#ad-time').value;
          const reason = am.el.querySelector('#ad-reason').value.trim();
          const typeId = Number(am.el.querySelector('#ad-type').value);
          const type = API.typeOf(typeId);
          if (!dVal || !time || !reason) { App.toast('加号日期、时间与原因必填', 'err'); return; }
          const s = `${dVal}T${time}`;
          const e = API.addMinutesLocal(s, type ? type.duration_min : 30);
          const r = await API.bookAppointment({
            patient_id: pid,
            type_id: typeId,
            doctor_id: Number(am.el.querySelector('#ad-doc').value),
            room_id: Number(am.el.querySelector('#ad-room').value),
            starts_at: s,
            ends_at: e,
            chief_complaint: m.el.querySelector('#f-complaint').value.trim(),
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
    const def = nexts.includes('已取消') ? '已取消' : nexts[0];
    const body = `<div class="note">当前状态：${App.tag(a.stage)}。状态变更将完整记录原阶段、新阶段、操作人与原因。</div>
      <div class="form-grid">
        ${App.fieldRow('目标状态', App.selectHtml('f-stage', nexts, def))}
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

  // 现代医疗改约向导：展示原预约信息 → 选择新年月日历 → 弹出上午/下午时段
  function reschedule(a) {
    if (!a) return;
    const type = API.typeOf(a.type_id);
    const body = `
      <div class="note">
        原预约：<b>${App.esc(a.appointment_no)}</b> · ${App.esc(type ? `${type.name}（${type.duration_min} 分钟）` : '')} · ${App.esc(doctorName(a.doctor_id))} · 原时段 ${App.esc(String(a.starts_at).replace('T', ' '))}。原记录将保留至变更历史。
      </div>
      <div id="resched-wizard"></div>
      <div id="resched-reason-wrap" style="display:none;margin-top:14px;padding-top:12px;border-top:1px solid var(--line-soft)">
        ${App.fieldRow('改约原因', '<input id="f-reason" value="患者要求改约">', true)}
      </div>`;
    const m = App.modal('预约改期 · ' + a.appointment_no, body,
      '<button class="btn ghost" id="m-c">取消</button><button class="btn success" id="m-s" disabled>保存改约</button>', 'lg');
    const saveBtn = m.el.querySelector('#m-s');
    const reasonWrap = m.el.querySelector('#resched-reason-wrap');
    m.el.querySelector('#m-c').onclick = m.close;

    const wiz = buildBookingWizard(m.el.querySelector('#resched-wizard'), {
      lockedDoctorId: a.doctor_id,
      lockedTypeId: a.type_id,
      excludeId: a.id,
      initialDate: String(a.starts_at).slice(0, 10),
      onChange(st) {
        saveBtn.disabled = !st.pickedSlot;
        reasonWrap.style.display = st.step === 3 ? 'block' : 'none';
      },
    });

    saveBtn.onclick = async () => {
      const p = wiz.state.pickedSlot;
      if (!p) { App.toast('请先选择新时间段', 'err'); return; }
      const r = await API.rescheduleAppointment({
        id: a.id,
        starts_at: p.starts_at,
        ends_at: p.ends_at,
        room_id: p.room_id,
        reason: m.el.querySelector('#f-reason').value.trim() || '改约',
      });
      if (!r.ok) { App.toast(r.error, 'err'); wiz.reloadSlots(); return; }
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
      <style>body{font-family:system-ui,sans-serif;padding:24px;color:#0F252B}h1{font-size:20px;margin-bottom:14px}
      table{border-collapse:collapse;width:100%}th,td{border:1px solid #d5e0e6;padding:8px 10px;text-align:left;font-size:13px}
      th{background:#f3f7f9;width:120px}</style></head><body>
      <h1>口腔诊所预约单 · ${App.esc(a.appointment_no)}</h1>${html}
      <p style="margin-top:16px;font-size:12px;color:#5f747c">请按预约时间提前 10 分钟到诊；如需改约或取消请提前联系诊所。</p>
      <script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }

  render();
  if (opts && opts.autoCreate && canBook) {
    setTimeout(create, 40);
  }
};
