/* 义齿订单 F5 / UC-03：草稿、牙位/产品/颜色/附件、发送、回执去重、试戴/返工/交货状态机 */
window.Modules = window.Modules || {};
window.Modules.orders = function (set) {
  const session = API.session();
  const isPatient = !!session && session.role === 'patient';
  const patientId = session && session.patientId ? Number(session.patientId) : 0;
  let scope = 'all';

  function render() {
    let list = API.listOrders(scope === 'all' ? {} : { scope });
    if (isPatient) list = list.filter(o => { const p = API.patientOfOrder(o.id); return p && p.id == patientId; });
    set(`
      <div class="page-head"><div><div class="page-title">${isPatient ? '我的义齿订单' : '义齿订单'}</div><div class="page-desc">${isPatient ? '修复进度与交货状态，已交货即可到店领取' : 'F5 / UC-03 · 订单草稿、发送、技工所回执与交付追踪'}</div></div>
        ${isPatient ? '' : '<button class="btn" id="o-add">+ 建立订单</button>'}</div>
      <div class="card">
        <div class="note">BR-05/BR-06：订单 8 状态；已交货只能通过返工或更正修改，不得直接回退。技工所回执以来源+事件号识别重复（表17、8.7）。</div>
        <div class="tabs">
          ${[['all','全部'],['trial','试戴查询'],['delivered','已交货'],['overdue','逾期']].map(([k,l])=>`<div class="tab ${scope===k?'active':''}" data-scope="${k}">${l}</div>`).join('')}
        </div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>订单号</th><th>患者</th><th>产品</th><th>牙位</th><th>颜色</th><th>数量</th><th>承诺日</th><th>状态</th><th>操作</th></tr></thead><tbody>
          ${list.length ? list.map(o => {
            const db = API.raw();
            const p = API.patientOfOrder(o.id);
            const prod = db.products.find(x=>x.id==o.product_id);
            const color = db.basicOptions.find(x=>x.id==o.color_id);
            const teeth = API.orderTeeth(o.id);
            return `<tr><td>${App.esc(o.order_no)}</td><td>${App.esc(p?.name||'—')}</td><td>${App.esc(prod?.name||'')}</td>
              <td>${teeth.map(t=>t.tooth_code).join('、')||'—'}</td><td>${App.esc(color?.name||'')}</td><td>${o.quantity}</td>
              <td>${App.esc(o.promised_date||'')}${o.promised_date<new Date().toISOString().slice(0,10)&&!['已交货','取消'].includes(o.stage)?' <span class="tag red">逾期</span>':''}</td>
              <td>${App.tag(o.stage)}</td>
              <td class="actions"><button class="btn ghost sm" data-detail="${o.id}">详情</button> ${isPatient ? '' : `<button class="btn ghost sm" data-act="${o.id}">状态操作</button>`}</td></tr>`;
          }).join('') : `<tr><td colspan="9"><div class="empty">该范围暂无订单</div></td></tr>`}
        </tbody></table></div>
      </div>`);
    bind();
  }

  function bind() {
    const add = document.getElementById('o-add');
    if (add) add.onclick = create;
    document.querySelectorAll('[data-scope]').forEach(el => el.onclick = () => { scope=el.dataset.scope; render(); });
    document.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => detail(API.raw().orders.find(o=>o.id==b.dataset.detail)));
    document.querySelectorAll('[data-act]').forEach(b => b.onclick = () => actions(API.raw().orders.find(o=>o.id==b.dataset.act)));
  }

  function create() {
    const db = API.raw();
    const encs = db.encounters.map(e => {
      const p = db.patients.find(x=>x.id==e.patient_id);
      return {value:e.id,label:`${e.encounter_no} ${p?.name||''}`};
    });
    if (!encs.length) { App.toast('请先录入诊疗记录','err'); return; }
    const products = db.products.filter(p=>p.active).map(p=>({value:p.id,label:p.name}));
    const labs = db.dentalLabs.filter(l=>l.active).map(l=>({value:l.id,label:l.name}));
    const colors = API.listOptions('颜色').map(o=>({value:o.id,label:o.name}));
    const boxColors = API.listOptions('盒子颜色').map(o=>({value:o.id,label:o.name}));
    const types = API.listOptions('订单类型').map(o=>({value:o.id,label:o.name}));
    const units = API.listOptions('单位').map(o=>({value:o.id,label:o.name}));
    const attTypes = API.listOptions('附件类型').map(o=>({value:o.id,label:o.name}));

    const body = `<div class="note">UC-03：草稿允许暂不填牙位，但发送前必须至少一个有效牙位（BR 表17）。一个订单只选一种产品，可含多个牙位与附件。</div>
      <div class="form-grid">
        ${App.fieldRow('诊疗记录', App.selectHtml('f-enc', encs, encs[0].value))}
        ${App.fieldRow('产品', App.selectHtml('f-product', products, products[0]?.value))}
        ${App.fieldRow('技工所', App.selectHtml('f-lab', labs, labs[0]?.value))}
        ${App.fieldRow('订单类型', App.selectHtml('f-type', types, types[0]?.value))}
        ${App.fieldRow('颜色', App.selectHtml('f-color', colors, colors[0]?.value))}
        ${App.fieldRow('盒子颜色', App.selectHtml('f-box', boxColors, boxColors[0]?.value))}
        ${App.fieldRow('数量', `<input id="f-qty" type="number" min="0.01" step="0.01" value="1">`)}
        ${App.fieldRow('单位', App.selectHtml('f-unit', units, units[0]?.value))}
        ${App.fieldRow('承诺日期', `<input id="f-promise" type="date" value="${new Date(Date.now()+10*86400000).toISOString().slice(0,10)}">`)}
        ${App.fieldRow('附件', App.selectHtml('f-att', [{value:'',label:'无'}].concat(attTypes.map(o=>({value:o.id,label:o.name}))), ''))}
        ${App.fieldRow('牙位（逗号分隔，如 11,12,36）', `<input id="f-teeth" placeholder="11,12,36">`, true)}
        ${App.fieldRow('修复要求', `<textarea id="f-req" rows="2"></textarea>`, true)}
      </div>`;
    const m = App.modal('建立义齿订单草稿', body,
      `<button class="btn ghost" id="m-cancel">取消</button><button class="btn" id="m-save">保存草稿</button>`, 'lg');
    m.el.querySelector('#m-cancel').onclick = m.close;
    m.el.querySelector('#m-save').onclick = () => {
      const teethRaw = m.el.querySelector('#f-teeth').value.trim();
      const teeth = teethRaw ? teethRaw.split(/[,，\s]+/).filter(Boolean).map(t=>({tooth_code:t})) : [];
      const att = m.el.querySelector('#f-att').value;
      const r = API.createOrderDraft({
        encounter_id: Number(m.el.querySelector('#f-enc').value),
        product_id: Number(m.el.querySelector('#f-product').value),
        lab_id: Number(m.el.querySelector('#f-lab').value),
        type_id: Number(m.el.querySelector('#f-type').value),
        color_id: Number(m.el.querySelector('#f-color').value),
        box_color_id: Number(m.el.querySelector('#f-box').value),
        unit_id: Number(m.el.querySelector('#f-unit').value),
        quantity: Number(m.el.querySelector('#f-qty').value),
        promised_date: m.el.querySelector('#f-promise').value,
        repair_requirement: m.el.querySelector('#f-req').value.trim(),
        teeth,
        attachments: att ? [{type_id:Number(att),file_name:'修复附件'}] : [],
      });
      m.close(); App.toast(`草稿已建立：${r.data.order_no}`,'ok'); render();
    };
  }

  async function actions(o) {
    if (!o) return;
    const legal = {
      '草稿': [['send','确认发送'],['stage:已取消','取消订单']],
      '已发送': [['event:已接收','受理技工所回执'],['stage:已取消','取消订单']],
      '已接收': [['event:试戴','登记试戴结果']],
      '试戴': [['stage:质量确认','确认质量合格'],['stage:返工','申请返工']],
      '返工': [['event:试戴','技工所再次提交试戴']],
      '质量确认': [['stage:已交货','确认交货']],
      '已交货': [['stage:返工','返工（保留交货记录）']],
      '取消': [],
    }[o.stage] || [];
    const body = `<div class="note">当前状态：${App.tag(o.stage)}。订单号 ${App.esc(o.order_no)}。所有转换按表17 状态机校验，非法转换将被拒绝。</div>
      <div class="toolbar">${legal.length?legal.map(([k,l])=>`<button class="btn ${k.startsWith('stage:返工')?'warn':''} sm" data-acttype="${k}">${l}</button>`).join(''):'<div class="empty">该状态无可用操作</div>'}</div>
      <div id="act-form"></div>`;
    const m = App.modal('订单状态操作 · '+o.order_no, body, `<button class="btn ghost" id="m-close">关闭</button>`);
    m.el.querySelector('#m-close').onclick = () => { m.close(); render(); };
    m.el.querySelectorAll('[data-acttype]').forEach(b => b.onclick = async () => {
      const key = b.dataset.acttype;
      if (key === 'send') {
        const vr = await API.compute.transition(o.stage, '已发送');
        if (!vr.ok || !vr.data.ok) { App.toast(vr.data?.error || vr.error || '状态校验失败','err'); return; }
        const r = await API.sendOrder(o.id);
        if (!r.ok) { App.toast(r.error,'err'); return; }
        m.close(); App.toast('订单已发送','ok'); render();
      } else if (key.startsWith('stage:')) {
        const st = key.split(':')[1];
        const f = App.modal('确认操作', `<div class="field"><label>原因/备注</label><input id="f-reason"></div>`,
          `<button class="btn ghost" id="s-cancel">取消</button><button class="btn" id="s-ok">确定</button>`, 'sm');
        f.el.querySelector('#s-cancel').onclick = f.close;
        f.el.querySelector('#s-ok').onclick = async () => {
          const vr = await API.compute.transition(o.stage, st);
          if (!vr.ok || !vr.data.ok) { App.toast(vr.data?.error || vr.error || '状态校验失败','err'); return; }
          const r = await API.changeOrderStage(o.id, st, f.el.querySelector('#f-reason').value.trim());
          if (!r.ok) { App.toast(r.error,'err'); return; }
          f.close(); m.close(); App.toast(`状态已更新为「${st}」`,'ok'); render();
        };
      } else if (key.startsWith('event:')) {
        const st = key.split(':')[1];
        const f = App.modal('技工所回执 / 进展', `<div class="note">来源与事件号用于识别重复回执。重复事件将被忽略。</div>
          <div class="form-grid">
            ${App.fieldRow('来源', `<input id="f-source" value="lab">`)}
            ${App.fieldRow('事件号', `<input id="f-event" value="EVT${Date.now()}">`)}
            ${App.fieldRow('新状态', `<input id="f-stage" value="${st}" readonly>`)}
            ${App.fieldRow('外部订单号', `<input id="f-ext">`)}
            ${App.fieldRow('预计完成时间', `<input id="f-expected" type="date">`)}
            ${App.fieldRow('试戴结果（如适用）', `<input id="f-trial">`, true)}
          </div>`,
          `<button class="btn ghost" id="s-cancel">取消</button><button class="btn" id="s-ok">受理回执</button>`);
        f.el.querySelector('#s-cancel').onclick = f.close;
        f.el.querySelector('#s-ok').onclick = async () => {
          const vr = await API.compute.transition(o.stage, st);
          if (!vr.ok || !vr.data.ok) { App.toast(vr.data?.error || vr.error || '状态校验失败','err'); return; }
          const r = await API.receiveOrderEvent(o.id, {
            source: f.el.querySelector('#f-source').value.trim(),
            event_no: f.el.querySelector('#f-event').value.trim(),
            new_stage: st,
            external_order_no: f.el.querySelector('#f-ext').value.trim(),
            expected_finish_date: f.el.querySelector('#f-expected').value || null,
            trial_result: f.el.querySelector('#f-trial').value.trim(),
          });
          if (!r.ok) { App.toast(r.error,'err'); return; }
          f.close(); m.close(); App.toast('回执已受理','ok'); render();
        };
      }
    });
  }

  function detail(o) {
    if (!o) return;
    const db = API.raw();
    const p = API.patientOfOrder(o.id);
    const prod = db.products.find(x=>x.id==o.product_id);
    const teeth = API.orderTeeth(o.id);
    const atts = API.orderAttachments(o.id);
    const events = API.orderEvents(o.id);
    const body = `
      <div class="grid cols-3">
        <div class="kpi"><div class="label">患者</div><div class="value" style="font-size:16px">${App.esc(p?.name||'—')}</div></div>
        <div class="kpi"><div class="label">产品</div><div class="value" style="font-size:16px">${App.esc(prod?.name||'')}</div></div>
        <div class="kpi"><div class="label">当前状态</div><div class="value" style="font-size:16px">${App.tag(o.stage)}</div></div>
      </div>
      <table class="tbl" style="margin-top:14px"><tbody>
        <tr><th style="width:120px">修复要求</th><td>${App.esc(o.repair_requirement||'')}</td></tr>
        <tr><th>牙位</th><td>${teeth.map(t=>t.tooth_code).join('、')||'—'}</td></tr>
        <tr><th>数量/单位</th><td>${o.quantity} ${App.esc((db.basicOptions.find(x=>x.id==o.unit_id)||{}).name||'')}</td></tr>
        <tr><th>承诺日期</th><td>${App.esc(o.promised_date||'')}</td></tr>
        <tr><th>预计完成时间</th><td>${App.esc(events.map(e=>e.expected_finish_date).filter(Boolean).pop() || o.expected_at || '—')}</td></tr>
        <tr><th>关键时间</th><td>发送 ${App.esc(o.sent_at||'—')} ｜ 接收 ${App.esc(o.accepted_at||'—')} ｜ 试戴 ${App.esc(o.trial_at||'—')} ｜ 交货 ${App.esc(o.delivered_at||'—')}</td></tr>
      </tbody></table>
      <p style="margin:14px 0 8px"><b>附件（${atts.length}）</b></p>
      ${atts.length?`<table class="tbl"><thead><tr><th>文件名</th><th>类型</th><th>大小</th><th>上传</th></tr></thead><tbody>${atts.map(a=>`<tr><td>${App.esc(a.file_name)}</td><td>${App.esc(a.mime_type)}</td><td>${a.byte_size} B</td><td>${App.esc(String(a.uploaded_at).slice(0,16))}</td></tr>`).join('')}</tbody></table>`:'<div class="empty">无附件</div>'}
      <p style="margin:14px 0 8px"><b>订单进展（${events.length}）</b></p>
      <ul class="timeline">${events.map(e=>`<li><div class="t-time">${App.esc(e.occurred_at)} · 来源 ${App.esc(e.source)} · 事件 ${App.esc(e.event_no)}</div>
        <div class="t-title">${App.esc(e.old_stage||'—')} → ${App.esc(e.new_stage)}</div>${e.reason?`<div>${App.esc(e.reason)}</div>`:''}</li>`).join('')}</ul>`;
    App.modal('订单详情 · '+o.order_no, body,
      `<button class="btn ghost" id="m-print">打印/导出</button><button class="btn ghost" id="m-close">关闭</button>`, 'lg');
    document.getElementById('m-close').onclick = () => document.getElementById('modal-root').innerHTML='';
    document.getElementById('m-print').onclick = () => {
      const w = window.open('', '_blank');
      w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>义齿订单 ${App.esc(o.order_no)}</title>
        <style>body{font-family:system-ui,sans-serif;padding:24px;color:#142A26}h1{font-size:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left;font-size:13px}th{background:#f3f1eb}</style>
        </head><body><h1>义齿订单确认单 · ${App.esc(o.order_no)}</h1>${body}<script>window.onload=()=>window.print()<\/script></body></html>`);
      w.document.close();
    };
  }

  render();
};
