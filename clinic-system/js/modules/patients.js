/* 患者管理：患者登记、查询、期间登记统计、联系方式与重要健康提示维护、重复建档与待核对提醒、完整诊疗史回看 */
window.Modules = window.Modules || {};
window.Modules.patients = function (set, opts) {
  const session = API.session() || {};
  const canEdit = ['receptionist', 'admin'].includes(session.role);
  let keyword = '', start = '', end = '';

  const isPending = p => String(p.important_note || '').includes('【待核对】');

  function render() {
    const db = API.raw();
    const list = API.listPatients({ keyword, start, end });
    const pendingList = list.filter(isPending);
    const dups = db.duplicatePatients || [];

    set(`
      <div class="page-head">
        <div>
          <div class="page-title">患者管理</div>
          <div class="page-desc">患者登记、查询、期间登记统计、联系方式与重要健康提示维护</div>
        </div>
        ${canEdit ? '<button class="btn" id="p-add">+ 登记患者</button>' : ''}
      </div>
      <div class="card">
        <div class="toolbar">
          <div class="field"><label>关键词（姓名/电话/编号）</label><input id="f-kw" placeholder="输入查询" value="${App.esc(keyword)}"></div>
          <div class="field"><label>登记起</label><input id="f-start" type="date" value="${start}"></div>
          <div class="field"><label>登记止</label><input id="f-end" type="date" value="${end}"></div>
          <button class="btn ghost" id="f-search">查询</button>
          <button class="btn ghost" id="f-reset">重置</button>
          <span class="muted" style="margin-left:auto">当前符合条件：<b>${list.length}</b> 人</span>
        </div>
        ${pendingList.length ? `<div class="note warn">有 ${pendingList.length} 条待核对档案（暂不自动合并），请核对身份后更新。</div>` : ''}
        ${dups.length ? `<div class="note warn">检测到疑似重复建档提示（${dups.length} 条）：${dups.map(d => `${App.esc(d.patient_no)} ${App.esc(d.name)}`).join('、')}</div>` : ''}
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>患者编号</th><th>姓名</th><th>电话</th><th>出生日期</th><th>紧急联系人</th><th>重要健康提示</th><th>登记时间</th><th>操作</th>
        </tr></thead><tbody>
          ${list.length ? list.map(p => `<tr>
            <td><b>${App.esc(p.patient_no)}</b>${isPending(p) ? ' <span class="tag orange">待核对</span>' : ''}</td>
            <td><span class="av-cell">${App.avatar(p.name)}<b>${App.esc(p.name)}</b></span></td>
            <td>${App.esc(p.phone || '—')}</td>
            <td>${App.esc(p.birth_date || '—')}</td>
            <td class="muted">${App.esc([p.contact_name, p.contact_phone].filter(Boolean).join(' ') || '—')}</td>
            <td>${p.important_note ? `<span class="tag red">${App.esc(p.important_note)}</span>` : '—'}</td>
            <td>${App.esc(String(p.created_at || '').slice(0, 16).replace('T', ' '))}</td>
            <td class="actions">
              ${canEdit ? `<button class="btn ghost sm" data-edit="${p.id}">编辑</button> ` : ''}
              <button class="btn ghost sm" data-detail="${p.id}">诊疗史</button>
            </td></tr>`).join('') : '<tr><td colspan="8"><div class="empty">未找到患者档案</div></td></tr>'}
        </tbody></table></div>
      </div>`);

    bind();
  }

  function bind() {
    const add = document.getElementById('p-add');
    if (add) add.onclick = () => edit(null);
    document.getElementById('f-search').onclick = () => {
      keyword = document.getElementById('f-kw').value.trim();
      start = document.getElementById('f-start').value;
      end = document.getElementById('f-end').value;
      render();
    };
    document.getElementById('f-reset').onclick = () => { keyword = start = end = ''; render(); };
    document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(API.raw().patients.find(p => p.id == b.dataset.edit)));
    document.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => detail(API.raw().patients.find(p => p.id == b.dataset.detail)));
  }

  function edit(p) {
    const isEdit = !!p;
    const cleanNote = String(p ? p.important_note || '' : '').replace('【待核对】', '').trim();
    const body = `<div class="form-grid">
      ${App.fieldRow('姓名', `<input id="f-name" value="${App.esc(p ? p.name : '')}">`)}
      ${App.fieldRow('电话（允许家庭共用）', `<input id="f-phone" value="${App.esc(p ? p.phone || '' : '')}">`)}
      ${App.fieldRow('出生日期', `<input id="f-birth" type="date" value="${App.esc(p ? p.birth_date || '' : '')}">`)}
      ${App.fieldRow('身份核对状态', App.selectHtml('f-pending', [
        { value: '0', label: '已确认身份' },
        { value: '1', label: '待核对档案（暂不自动合并）' },
      ], p && isPending(p) ? '1' : '0'))}
      ${App.fieldRow('紧急联系人', `<input id="f-cn" value="${App.esc(p ? p.contact_name || '' : '')}">`)}
      ${App.fieldRow('紧急联系电话', `<input id="f-cp" value="${App.esc(p ? p.contact_phone || '' : '')}">`)}
      ${App.fieldRow('重要健康提示', `<input id="f-note" value="${App.esc(cleanNote)}" placeholder="如：青霉素过敏、高血压史">`, true)}
      ${isEdit ? App.fieldRow('变更原因（留痕）', `<input id="f-reason" value="更新患者档案">`, true) : ''}
    </div>`;
    const m = App.modal(isEdit ? '编辑患者档案' : '登记新患者', body,
      '<button class="btn ghost" id="m-cancel">取消</button><button class="btn" id="m-save">保存</button>');
    m.el.querySelector('#m-cancel').onclick = m.close;
    m.el.querySelector('#m-save').onclick = async () => {
      const name = m.el.querySelector('#f-name').value.trim();
      if (!name) { App.toast('患者姓名必填', 'err'); return; }
      const payload = {
        id: p ? p.id : undefined,
        name,
        phone: m.el.querySelector('#f-phone').value.trim(),
        birth_date: m.el.querySelector('#f-birth').value || null,
        contact_name: m.el.querySelector('#f-cn').value.trim(),
        contact_phone: m.el.querySelector('#f-cp').value.trim(),
        important_note: m.el.querySelector('#f-note').value.trim(),
        pending: m.el.querySelector('#f-pending').value === '1',
        reason: isEdit ? m.el.querySelector('#f-reason').value.trim() : undefined,
      };
      const r = isEdit ? await API.updatePatient(payload) : await API.addPatient(payload);
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast(isEdit ? '档案已更新' : `登记成功：${r.data.patient_no}`, 'ok'); render();
    };
  }

  // 按报告表 20：按身份/电话检索患者并回看完整诊疗史（严格隔离收费财务数据）
  function detail(p) {
    if (!p) return;
    const db = API.raw();
    const appts = (db.appointments || []).filter(a => a.patient_id == p.id)
      .sort((a, b) => String(b.starts_at).localeCompare(String(a.starts_at)));
    const encs = (db.encounters || []).filter(e => e.patient_id == p.id)
      .sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at)));
    const empName = id => ((db.employees || []).find(e => e.id == id) || {}).name || '—';

    const body = `
      <table class="tbl"><tbody>
        <tr><th style="width:120px">患者编号 / 姓名</th><td>${App.esc(p.patient_no)} · <b>${App.esc(p.name)}</b></td></tr>
        <tr><th>联系电话</th><td>${App.esc(p.phone || '—')}</td></tr>
        <tr><th>出生日期</th><td>${App.esc(p.birth_date || '—')}</td></tr>
        <tr><th>紧急联系人</th><td>${App.esc([p.contact_name, p.contact_phone].filter(Boolean).join(' ') || '—')}</td></tr>
        <tr><th>重要健康提示</th><td>${p.important_note ? `<span class="tag red">${App.esc(p.important_note)}</span>` : '无'}</td></tr>
      </tbody></table>
      <p style="margin:16px 0 8px"><b>预约记录（${appts.length}）</b></p>
      ${appts.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>预约编号</th><th>时间</th><th>项目</th><th>医生</th><th>来源</th><th>状态</th></tr></thead><tbody>
        ${appts.map(a => `<tr><td>${App.esc(a.appointment_no)}</td><td>${App.esc(String(a.starts_at).replace('T', ' '))}</td>
          <td>${App.esc((API.typeOf(a.type_id) || {}).name || '')}</td><td>${App.esc(empName(a.doctor_id))}</td>
          <td><span class="tag ${a.source === '患者自助' ? 'blue' : 'gray'}">${App.esc(a.source)}</span></td>
          <td>${App.tag(a.stage)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="muted">暂无预约记录</div>'}
      <p style="margin:16px 0 8px"><b>完整诊疗史（${encs.length}）</b></p>
      ${encs.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>诊疗编号</th><th>就诊时间</th><th>接诊医生</th><th>主诉</th><th>诊断与处理</th></tr></thead><tbody>
        ${encs.map(e => `<tr><td>${App.esc(e.encounter_no)}</td><td>${App.esc(String(e.occurred_at).slice(0, 16).replace('T', ' '))}</td>
          <td>${App.esc(empName(e.doctor_id))}</td><td>${App.esc(e.chief_complaint)}</td>
          <td>${App.esc(e.diagnosis || '—')}<div class="muted">${App.esc(e.treatment_note || '')}</div></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="muted">暂无诊疗记录</div>'}`;
    const m = App.modal(`患者档案与诊疗史 · ${p.name}`, body, '<button class="btn ghost" id="m-close">关闭</button>', 'lg');
    m.el.querySelector('#m-close').onclick = m.close;
  }

  render();
  if (opts && opts.autoCreate && canEdit) {
    setTimeout(() => edit(null), 40);
  }
};
