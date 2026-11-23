/* 患者管理 F2 / UC-01 患者部分：登记、查询、期间查询、联系方式与重要提示、待核对档案 */
window.Modules = window.Modules || {};
window.Modules.patients = function (set) {
  let keyword = '', start = '', end = '';

  function render() {
    const list = API.listPatients({ keyword, start, end });
    const pending = list.filter(p => p.pending);
    set(`
      <div class="page-head"><div><div class="page-title">患者管理</div><div class="page-desc">F2 · 登记、查询、期间登记、联系方式与重要提示（UC-01）</div></div>
        <button class="btn" id="p-add">+ 登记患者</button></div>
      <div class="card">
        <div class="toolbar">
          <div class="field"><label>关键词（姓名/电话/编号）</label><input id="f-kw" placeholder="输入查询" value="${App.esc(keyword)}"></div>
          <div class="field"><label>登记起</label><input id="f-start" type="date" value="${start}"></div>
          <div class="field"><label>登记止</label><input id="f-end" type="date" value="${end}"></div>
          <button class="btn ghost" id="f-search">查询</button>
          <button class="btn ghost" id="f-reset">重置</button>
        </div>
        ${pending.length ? `<div class="note warn">有 ${pending.length} 条待核对档案：身份尚未确认，暂不合并。请核对后完善。</div>` : ''}
        <div class="table-wrap"><table class="tbl"><thead><tr><th>患者编号</th><th>姓名</th><th>电话</th><th>出生日期</th><th>重要提示</th><th>登记时间</th><th>操作</th></tr></thead><tbody>
          ${list.length ? list.map(p => `<tr>
            <td>${App.esc(p.patient_no)}${p.pending?' <span class="tag orange">待核对</span>':''}</td>
            <td>${App.esc(p.name)}</td><td>${App.esc(p.phone||'')}</td><td>${App.esc(p.birth_date||'')}</td>
            <td>${p.important_note?`<span class="tag red">${App.esc(p.important_note)}</span>`:'—'}</td>
            <td>${App.esc(String(p.created_at).slice(0,16))}</td>
            <td class="actions"><button class="btn ghost sm" data-edit="${p.id}">编辑</button> <button class="btn ghost sm" data-detail="${p.id}">详情</button></td>
          </tr>`).join('') : `<tr><td colspan="7"><div class="empty">未找到患者记录</div></td></tr>`}
        </tbody></table></div>
      </div>`);
    bind();
  }

  function bind() {
    document.getElementById('p-add').onclick = () => edit(null);
    document.getElementById('f-search').onclick = () => {
      keyword = document.getElementById('f-kw').value.trim();
      start = document.getElementById('f-start').value;
      end = document.getElementById('f-end').value;
      render();
    };
    document.getElementById('f-reset').onclick = () => { keyword=start=end=''; render(); };
    document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => edit(API.raw().patients.find(p=>p.id==b.dataset.edit)));
    document.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => detail(API.raw().patients.find(p=>p.id==b.dataset.detail)));
  }

  function edit(p) {
    const isEdit = !!p;
    const body = `<div class="form-grid">
      ${App.fieldRow('姓名', `<input id="f-name" value="${App.esc(p?.name||'')}">`)}
      ${App.fieldRow('电话', `<input id="f-phone" value="${App.esc(p?.phone||'')}">`)}
      ${App.fieldRow('出生日期', `<input id="f-birth" type="date" value="${App.esc(p?.birth_date||'')}">`)}
      ${App.fieldRow('紧急联系人', `<input id="f-cn" value="${App.esc(p?.contact_name||'')}">`)}
      ${App.fieldRow('紧急联系电话', `<input id="f-cp" value="${App.esc(p?.contact_phone||'')}">`)}
      ${App.fieldRow('身份状态', App.selectHtml('f-pending', [{value:'0',label:'已确认同一患者'},{value:'1',label:'待核对（暂不合并）'}], p?.pending?'1':'0'))}
      ${App.fieldRow('重要提示', `<input id="f-note" value="${App.esc(p?.important_note||'')}" placeholder="如过敏史">`, true)}
    </div>`;
    const m = App.modal(isEdit?'编辑患者':'登记患者', body,
      `<button class="btn ghost" id="m-cancel">取消</button><button class="btn" id="m-save">保存</button>`);
    m.el.querySelector('#m-cancel').onclick = m.close;
    m.el.querySelector('#m-save').onclick = () => {
      const name = m.el.querySelector('#f-name').value.trim();
      if (!name) { App.toast('姓名必填', 'err'); return; }
      const data = {
        name, phone: m.el.querySelector('#f-phone').value.trim(),
        birth_date: m.el.querySelector('#f-birth').value || null,
        contact_name: m.el.querySelector('#f-cn').value.trim(),
        contact_phone: m.el.querySelector('#f-cp').value.trim(),
        important_note: m.el.querySelector('#f-note').value.trim(),
        pending: m.el.querySelector('#f-pending').value === '1',
      };
      if (isEdit) API.updatePatient(p.id, data); else API.addPatient(data);
      m.close(); App.toast(isEdit?'已更新':'登记成功', 'ok'); render();
    };
  }

  // 患者 360：一次看全预约、就诊、修复进度、费用与召回
  function detail(p) {
    if (!p) return;
    const db = API.raw();
    const appts = db.appointments.filter(a => a.patient_id == p.id)
      .sort((a, b) => String(b.starts_at).localeCompare(String(a.starts_at)));
    const timeline = API.patientTreatment(p.id);
    const recalls = (db.recalls || []).filter(r => r.patient_id == p.id);
    const fee = timeline.reduce((acc, t) => ({
      receivable: acc.receivable + t.fee.receivable,
      paid: acc.paid + t.fee.paid,
      due: acc.due + t.fee.due,
    }), { receivable: 0, paid: 0, due: 0 });

    const apptRows = appts.slice(0, 6).map(a => {
      const doc = db.employees.find(x => x.id == a.doctor_id);
      const tp = API.typeOf(a.type_id);
      return `<tr><td>${App.esc(String(a.starts_at).replace('T', ' '))}</td>
        <td>${App.esc(tp ? tp.name : '')}</td>
        <td>${App.esc(doc ? doc.name : '')}</td>
        <td><span class="tag ${a.source === '患者自助' ? 'blue' : 'gray'}">${App.esc(a.source || '前台')}</span></td>
        <td>${App.tag(a.stage)}</td></tr>`;
    }).join('');

    const visitRows = timeline.map(t => {
      const e = t.encounter;
      const items = t.orders.map(o => {
        const pg = API.progressOf(o);
        return `<div class="appliance"><div class="appliance-main"><b>${App.esc(API.applianceOf(o).text)}</b>
          <span class="tag ${pg.tone}">${App.esc(pg.label)}</span></div>
          <div class="appliance-hint">${App.esc(pg.hint)}</div></div>`;
      }).join('');
      return `<tr><td style="white-space:nowrap">${App.esc(String(e.occurred_at).slice(0, 10))}</td>
        <td>${App.esc(e.diagnosis || '')}<div class="muted">${App.esc(e.treatment_note || '')}</div>
          ${items ? `<div class="appliance-list">${items}</div>` : ''}</td>
        <td style="white-space:nowrap">¥${t.fee.receivable.toFixed(2)}<div class="muted">已付 ¥${t.fee.paid.toFixed(2)}</div></td>
        <td>${t.fee.due > 0 ? `<span class="tag red">待付 ¥${t.fee.due.toFixed(2)}</span>` : '<span class="tag green">已结清</span>'}</td></tr>`;
    }).join('');

    const recallRows = recalls.map(r => `<tr><td>${App.esc(r.reason || '')}</td>
      <td>${App.esc(r.due_date)}</td><td>${App.tag(r.stage)}</td></tr>`).join('');

    const body = `
      <div class="grid cols-4">
        <div class="kpi"><div class="label">就诊次数</div><div class="value">${timeline.length}</div></div>
        <div class="kpi"><div class="label">累计应收</div><div class="value" style="font-size:20px">¥${fee.receivable.toFixed(0)}</div></div>
        <div class="kpi"><div class="label">已付</div><div class="value" style="font-size:20px">¥${fee.paid.toFixed(0)}</div></div>
        <div class="kpi"><div class="label">待付</div><div class="value" style="font-size:20px;color:${fee.due > 0 ? 'var(--danger)' : 'var(--success)'}">¥${fee.due.toFixed(0)}</div></div>
      </div>
      <table class="tbl" style="margin-top:14px"><tbody>
        <tr><th style="width:110px">编号 / 姓名</th><td>${App.esc(p.patient_no)} · ${App.esc(p.name)}${p.pending ? ' <span class="tag orange">待核对</span>' : ''}</td></tr>
        <tr><th>电话</th><td>${App.esc(p.phone || '')}</td></tr>
        <tr><th>出生日期</th><td>${App.esc(p.birth_date || '')}</td></tr>
        <tr><th>紧急联系人</th><td>${App.esc(p.contact_name || '')} ${App.esc(p.contact_phone || '')}</td></tr>
        <tr><th>重要提示</th><td>${p.important_note ? `<span class="tag red">${App.esc(p.important_note)}</span>` : '无'}</td></tr>
      </tbody></table>

      <p style="margin:16px 0 8px"><b>最近预约</b></p>
      ${appts.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>时间</th><th>项目</th><th>医生</th><th>来源</th><th>状态</th></tr></thead><tbody>${apptRows}</tbody></table></div>` : '<div class="muted" style="padding:8px 0">暂无记录</div>'}

      <p style="margin:16px 0 8px"><b>治疗记录与修复进度</b></p>
      ${timeline.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>日期</th><th>诊断与处理</th><th>应收</th><th>结清</th></tr></thead><tbody>${visitRows}</tbody></table></div>` : '<div class="muted" style="padding:8px 0">暂无记录</div>'}

      <p style="margin:16px 0 8px"><b>复诊召回</b></p>
      ${recalls.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>原因</th><th>到期日</th><th>状态</th></tr></thead><tbody>${recallRows}</tbody></table></div>` : '<div class="muted" style="padding:8px 0">暂无记录</div>'}`;
    App.modal('患者 360 · ' + p.name, body, `<button class="btn ghost" id="m-close">关闭</button>`, 'lg');
    document.getElementById('m-close').onclick = () => { document.getElementById('modal-root').innerHTML = ''; };
  }

  render();
};
