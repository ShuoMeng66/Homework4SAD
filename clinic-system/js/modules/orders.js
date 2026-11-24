/* 义齿订单（UC-03）：
 * - 四象限 FDI 多牙位图形化点选、草稿创建/编辑、拖拽与点击双模附件托管上传
 * - 8 状态全流程可视化节点条、回执幂等去重与拒收处理、试戴/返工/交货/更正/线下结单
 */
window.Modules = window.Modules || {};
window.Modules.orders = function (set, opts) {
  const session = API.session() || {};
  const isDoctor = ['doctor', 'admin'].includes(session.role);
  const canDeliver = ['receptionist', 'doctor', 'admin'].includes(session.role);
  const canOfflineClose = ['manager', 'admin'].includes(session.role);
  let scope = 'all', keyword = (opts && opts.keyword) || '';

  const FLOW_STAGES = ['草稿', '已发送', '已接收', '试戴', '质量确认', '已交货'];

  function availableActions(o) {
    const btns = [];
    if (isDoctor) {
      if (o.stage === '草稿') {
        btns.push(['send', '确认发送至技工所', '']);
        btns.push(['stage:取消', '取消订单', 'ghost']);
      } else if (o.stage === '已发送') {
        if (o.dispatch_result === '待处理') btns.push(['send', '重新发送', '']);
        btns.push(['receipt:已接收', '受理技工所接收回执', '']);
        btns.push(['reject', '登记技工所拒收（待处理）', 'warn']);
        btns.push(['stage:取消', '取消订单', 'ghost']);
      } else if (o.stage === '已接收') {
        btns.push(['receipt:试戴', '受理技工所试戴通知', '']);
      } else if (o.stage === '试戴') {
        btns.push(['stage:质量确认', '登记试戴合格（质量确认）', 'success']);
        btns.push(['stage:返工', '试戴不合格 · 申请返工', 'warn']);
      } else if (o.stage === '返工') {
        btns.push(['receipt:试戴', '技工所返工后再次试戴', '']);
      } else if (o.stage === '已交货') {
        btns.push(['stage:返工', '申请返工（保留交货历史）', 'warn']);
        btns.push(['correct', '登记更正记录', 'ghost']);
      }
    }
    if (canDeliver && o.stage === '质量确认') {
      btns.push(['stage:已交货', '确认交货', 'success']);
    }
    if (canOfflineClose && !['草稿', '已交货', '取消'].includes(o.stage)) {
      btns.push(['offline_close', '负责人线下渠道结单确认', 'ghost']);
    }
    return btns;
  }

  function filteredOrders() {
    const db = API.raw();
    const today = API.localToday(0);
    let list = (db.orders || []).slice();
    if (scope === 'draft') list = list.filter(o => o.stage === '草稿' || o.dispatch_result === '待处理');
    if (scope === 'making') list = list.filter(o => ['已发送', '已接收', '返工'].includes(o.stage));
    if (scope === 'trial') list = list.filter(o => ['试戴', '质量确认'].includes(o.stage));
    if (scope === 'delivered') list = list.filter(o => o.stage === '已交货');
    if (scope === 'overdue') list = list.filter(o => o.promised_date && o.promised_date < today && !['已交货', '取消', '草稿'].includes(o.stage));
    if (keyword) {
      const kw = keyword.toLowerCase();
      list = list.filter(o => {
        const p = API.patientOfOrder(o.id);
        const prod = (db.products || []).find(x => x.id == o.product_id);
        const teeth = API.orderTeeth(o.id).map(t => t.tooth_code).join(',');
        return [o.order_no, p ? p.name : '', prod ? prod.name : '', teeth, o.stage]
          .some(v => String(v || '').toLowerCase().includes(kw));
      });
    }
    return list;
  }

  function renderRows(list) {
    const db = API.raw();
    const today = API.localToday(0);
    return list.length ? list.map(o => {
      const p = API.patientOfOrder(o.id);
      const prod = (db.products || []).find(x => x.id == o.product_id);
      const lab = (db.dentalLabs || []).find(x => x.id == o.lab_id);
      const teeth = API.orderTeeth(o.id);
      const isOverdue = o.promised_date && o.promised_date < today && !['已交货', '取消', '草稿'].includes(o.stage);
      const acts = availableActions(o);
      return `<tr>
        <td><b>${App.esc(o.order_no)}</b></td>
        <td><span class="av-cell">${App.avatar(p ? p.name : '—')}<b>${App.esc(p ? p.name : '—')}</b></span></td>
        <td>${App.esc(prod ? prod.name : '—')}</td>
        <td>${App.esc(lab ? lab.name : '—')}</td>
        <td>${teeth.map(t => `<span class="tag teal" style="margin:1px">${App.esc(t.tooth_code)}</span>`).join(' ') || '<span class="muted">待补填</span>'}</td>
        <td>${App.esc(API.optionName(o.color_id))}</td>
        <td>${o.quantity} ${App.esc(API.optionName(o.unit_id))}</td>
        <td><b>${App.esc(o.promised_date || '')}</b>${isOverdue ? ' <span class="tag red">逾期</span>' : ''}</td>
        <td>${App.tag(o.stage)}${o.dispatch_result === '待处理' ? ' <span class="tag red">拒收待处理</span>' : ''}</td>
        <td class="actions">
          <button class="btn ghost sm" data-detail="${o.id}">详情</button>
          ${isDoctor && o.stage === '草稿' ? `<button class="btn ghost sm" data-edit="${o.id}">编辑</button>` : ''}
          ${acts.length ? `<button class="btn soft sm" data-act="${o.id}">推进状态</button>` : ''}
        </td></tr>`;
    }).join('') : '<tr><td colspan="10"><div class="empty">当前筛选范围暂无义齿订单</div></td></tr>';
  }

  function bindRowActions() {
    const db = API.raw();
    document.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => detail(db.orders.find(o => o.id == b.dataset.detail)));
    document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openDraftModal(db.orders.find(o => o.id == b.dataset.edit)));
    document.querySelectorAll('[data-act]').forEach(b => b.onclick = () => actions(db.orders.find(o => o.id == b.dataset.act)));
  }

  function render() {
    const all = API.raw().orders || [];
    const today = API.localToday(0);
    const list = filteredOrders();

    const tabs = [
      ['all', '全部订单', all.length],
      ['draft', '草稿/待发', all.filter(o => o.stage === '草稿' || o.dispatch_result === '待处理').length],
      ['making', '在制中', all.filter(o => ['已发送', '已接收', '返工'].includes(o.stage)).length],
      ['trial', '试戴 / 质检', all.filter(o => ['试戴', '质量确认'].includes(o.stage)).length],
      ['delivered', '已交货', all.filter(o => o.stage === '已交货').length],
      ['overdue', '逾期订单', all.filter(o => o.promised_date && o.promised_date < today && !['已交货', '取消', '草稿'].includes(o.stage)).length],
    ];

    set(`
      <div class="page-head">
        <div>
          <div class="page-title">义齿订单</div>
          <div class="page-desc">修复体加工委托、试戴质检与取件追踪</div>
        </div>
        ${isDoctor ? '<button class="btn" id="o-add">+ 建立订单草稿</button>' : ''}
      </div>
      <div class="card">
        <div class="toolbar" style="justify-content:space-between;align-items:center">
          <div class="tabs" style="margin-bottom:0">
            ${tabs.map(([k, l, cnt]) => `<div class="tab ${scope === k ? 'active' : ''}" data-scope="${k}">${l}<span class="tab-badge">${cnt}</span></div>`).join('')}
          </div>
          ${App.searchBoxHtml('o-kw', '检索订单号、患者、产品或牙位…', keyword)}
        </div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>订单号</th><th>患者</th><th>产品</th><th>技工所</th><th>FDI 牙位</th><th>颜色</th><th>数量</th><th>承诺日期</th><th>状态</th><th>操作</th>
        </tr></thead><tbody id="ord-tbody">${renderRows(list)}</tbody></table></div>
      </div>`);

    const add = document.getElementById('o-add');
    if (add) add.onclick = () => openDraftModal(null, {});
    document.querySelectorAll('[data-scope]').forEach(el => el.onclick = () => { scope = el.dataset.scope; render(); });
    App.bindSearchBox(document, 'o-kw', v => {
      keyword = v;
      const tb = document.getElementById('ord-tbody');
      if (tb) { tb.innerHTML = renderRows(filteredOrders()); bindRowActions(); }
    });
    bindRowActions();
  }

  function openDraftModal(existing, preset = {}) {
    const db = API.raw();
    const encs = (db.encounters || []).map(e => {
      const p = (db.patients || []).find(x => x.id == e.patient_id);
      return { value: e.id, label: `${e.encounter_no} · ${p ? p.name : ''} · ${e.diagnosis || e.chief_complaint}` };
    });
    const products = (db.products || []).filter(p => p.active).map(p => ({ value: p.id, label: `${p.name}（${p.material}${p.requires_attachment ? '·须传附件' : ''}）` }));
    const labs = (db.dentalLabs || []).filter(l => l.active).map(l => ({ value: l.id, label: l.name }));
    const colors = API.listOptions('颜色').map(o => ({ value: o.id, label: o.name }));
    const boxColors = [{ value: '', label: '不指定' }].concat(API.listOptions('盒子颜色').map(o => ({ value: o.id, label: o.name })));
    const types = API.listOptions('订单类型').map(o => ({ value: o.id, label: o.name }));
    const units = API.listOptions('单位').map(o => ({ value: o.id, label: o.name }));

    if (!products.length || !labs.length || !colors.length || !types.length || !units.length) {
      App.toast('缺少产品/技工所/颜色/订单类型/单位等基础配置，请先补充基础信息', 'err');
      if (API.can('basic')) App.navigate('basic');
      return;
    }
    if (!existing && !encs.length) {
      App.toast('请先录入诊疗记录后再建立义齿订单', 'err');
      return;
    }

    const oldTeeth = existing ? API.orderTeeth(existing.id).map(t => t.tooth_code) : [];
    const initEnc = preset.encounterId || (encs[0] ? encs[0].value : '');
    const body = `
      <div class="note">单张订单绑定一种产品，可在下方四象限牙位图中点击多颗牙位（草稿阶段允许暂留空，上传附件后再确认发送）。</div>
      <div class="form-grid">
        ${existing ? '' : App.fieldRow('关联诊疗记录', App.selectHtml('f-enc', encs, initEnc), true)}
        ${App.fieldRow('义齿产品', App.selectHtml('f-product', products, existing ? existing.product_id : products[0].value))}
        ${App.fieldRow('合作技工所', App.selectHtml('f-lab', labs, existing ? existing.lab_id : labs[0].value))}
        ${App.fieldRow('订单类型', App.selectHtml('f-type', types, existing ? existing.type_id : types[0].value))}
        ${App.fieldRow('比色颜色', App.selectHtml('f-color', colors, existing ? existing.color_id : colors[0].value))}
        ${App.fieldRow('盒子颜色', App.selectHtml('f-box', boxColors, existing && existing.box_color_id ? existing.box_color_id : ''))}
        ${App.fieldRow('数量', `<input id="f-qty" type="number" min="0.5" step="0.5" value="${existing ? existing.quantity : 1}">`)}
        ${App.fieldRow('单位', App.selectHtml('f-unit', units, existing ? existing.unit_id : units[0].value))}
        ${App.fieldRow('承诺交期', `<input id="f-promise" type="date" value="${existing ? existing.promised_date : API.localToday(10)}">`)}
      </div>
      <div style="margin:4px 0 14px">
        <label style="display:block;font-size:12px;color:var(--muted);font-weight:600;margin-bottom:6px">FDI 牙位选择（支持多颗连选，点选后自动同步颗粒数量）</label>
        ${App.toothChartHtml('ord-tooth-chart', oldTeeth, true)}
      </div>
      ${App.fieldRow('修复加工要求', `<textarea id="f-req" rows="2" placeholder="如：边缘密合、邻接适中、咬合轻接触">${App.esc(existing ? existing.repair_requirement : '')}</textarea>`, true)}`;

    const m = App.modal(existing ? `编辑草稿 · ${existing.order_no}` : '建立义齿订单草稿', body,
      '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">保存草稿</button>', 'lg');
    m.el.querySelector('#m-c').onclick = m.close;
    const qtyInp = m.el.querySelector('#f-qty');
    const chart = App.bindToothChart(m.el, 'ord-tooth-chart', true, oldTeeth, arr => {
      if (arr.length > 0 && qtyInp) qtyInp.value = arr.length;
    });

    m.el.querySelector('#m-s').onclick = async () => {
      const payload = {
        id: existing ? existing.id : undefined,
        encounter_id: existing ? existing.encounter_id : Number(m.el.querySelector('#f-enc').value),
        product_id: Number(m.el.querySelector('#f-product').value),
        lab_id: Number(m.el.querySelector('#f-lab').value),
        type_id: Number(m.el.querySelector('#f-type').value),
        color_id: Number(m.el.querySelector('#f-color').value),
        box_color_id: m.el.querySelector('#f-box').value ? Number(m.el.querySelector('#f-box').value) : null,
        unit_id: Number(m.el.querySelector('#f-unit').value),
        quantity: Number(qtyInp.value),
        promised_date: m.el.querySelector('#f-promise').value,
        repair_requirement: m.el.querySelector('#f-req').value.trim(),
        teeth: chart.get(),
      };
      const r = existing ? await API.updateOrderDraft(payload) : await API.createOrderDraft(payload);
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast(existing ? '草稿已更新' : `草稿已建立：${r.data.order_no}`, 'ok'); render();
    };
  }

  function actions(o) {
    if (!o) return;
    const btns = availableActions(o);

    const body = `
      <div class="note">订单 <b>${App.esc(o.order_no)}</b> 当前状态：${App.tag(o.stage)}${o.dispatch_result === '待处理' ? ' · <span class="tag red">技工所拒收待处理</span>' : ''}</div>
      <div class="toolbar" style="flex-wrap:wrap;margin-bottom:0">
        ${btns.length ? btns.map(([k, l, cls]) => `<button class="btn ${cls} sm" data-ak="${k}">${l}</button>`).join('') : '<div class="empty">当前角色在该状态下无可执行操作</div>'}
      </div>`;
    const m = App.modal('订单状态操作 · ' + o.order_no, body, '<button class="btn ghost" id="m-c">关闭</button>');
    m.el.querySelector('#m-c').onclick = m.close;

    m.el.querySelectorAll('[data-ak]').forEach(b => b.onclick = async () => {
      const key = b.dataset.ak;
      if (key === 'send') {
        const r = await API.sendOrder(o.id);
        if (!r.ok) { App.toast(r.error, 'err'); return; }
        m.close(); App.toast('订单已发送至技工所', 'ok'); render();
      } else if (key === 'reject') {
        const fm = App.modal('登记技工所拒收回执', `
          <div class="form-grid">
            ${App.fieldRow('事件号', `<input id="rj-ev" value="REJ${Date.now()}">`)}
            ${App.fieldRow('拒收原因', '<input id="rj-reason" placeholder="如：牙模边缘不清，需重取">', true)}
          </div>`, '<button class="btn ghost" id="rj-c">取消</button><button class="btn danger" id="rj-s">登记拒收</button>', 'sm');
        fm.el.querySelector('#rj-c').onclick = fm.close;
        fm.el.querySelector('#rj-s').onclick = async () => {
          const r = await API.orderReceipt({
            id: o.id, source: 'lab', action: 'reject',
            event_no: fm.el.querySelector('#rj-ev').value.trim(),
            reason: fm.el.querySelector('#rj-reason').value.trim(),
          });
          if (!r.ok) { App.toast(r.error, 'err'); return; }
          fm.close(); m.close(); App.toast('已标记为技工所拒收待处理', 'ok'); render();
        };
      } else if (key.startsWith('receipt:')) {
        const st = key.split(':')[1];
        const fm = App.modal(`受理技工所回执（→ ${st}）`, `
          <div class="note">按（订单号 + 来源 + 事件号）联合幂等去重；接收回执将同步更新预计完成时间并按承诺日期排定内部到期提醒。</div>
          <div class="form-grid">
            ${App.fieldRow('来源', '<input id="rc-src" value="lab">')}
            ${App.fieldRow('事件号（防重）', `<input id="rc-ev" value="LAB-${Date.now()}">`)}
            ${App.fieldRow('技工所外部单号', '<input id="rc-ext" placeholder="选填">')}
            ${st === '已接收' ? App.fieldRow('预计完成时间', `<input id="rc-exp" type="datetime-local" value="${o.promised_date || API.localToday(7)}T17:00">`) : ''}
            ${App.fieldRow('回执说明', '<input id="rc-reason" placeholder="选填">', true)}
          </div>`, '<button class="btn ghost" id="rc-c">取消</button><button class="btn" id="rc-s">受理回执</button>');
        fm.el.querySelector('#rc-c').onclick = fm.close;
        fm.el.querySelector('#rc-s').onclick = async () => {
          const r = await API.orderReceipt({
            id: o.id,
            source: fm.el.querySelector('#rc-src').value.trim(),
            event_no: fm.el.querySelector('#rc-ev').value.trim(),
            new_stage: st,
            external_order_no: fm.el.querySelector('#rc-ext').value.trim(),
            expected_at: fm.el.querySelector('#rc-exp') ? fm.el.querySelector('#rc-exp').value : null,
            reason: fm.el.querySelector('#rc-reason').value.trim(),
          });
          if (!r.ok) { App.toast(r.error, 'err'); return; }
          fm.close(); m.close();
          App.toast(r.data.duplicate ? '重复回执：已幂等返回原处理结果' : `回执已受理，订单推进至「${st}」`, 'ok');
          render();
        };
      } else if (key.startsWith('stage:')) {
        const st = key.split(':')[1];
        const fm = App.modal(`推进订单状态 → ${st}`, `
          <div class="form-grid">
            ${st === '质量确认' ? App.fieldRow('试戴结论', '<input id="st-tr" value="合格">', true) : ''}
            ${App.fieldRow('原因 / 备注（返工与取消必填）', '<input id="st-reason" placeholder="请输入说明">', true)}
          </div>`, '<button class="btn ghost" id="st-c">取消</button><button class="btn" id="st-s">确认</button>', 'sm');
        fm.el.querySelector('#st-c').onclick = fm.close;
        fm.el.querySelector('#st-s').onclick = async () => {
          const r = await API.orderStage({
            id: o.id, action: 'transition', stage: st,
            trial_result: fm.el.querySelector('#st-tr') ? fm.el.querySelector('#st-tr').value.trim() : null,
            reason: fm.el.querySelector('#st-reason').value.trim(),
          });
          if (!r.ok) { App.toast(r.error, 'err'); return; }
          fm.close(); m.close(); App.toast(`状态已更新为「${st}」`, 'ok'); render();
        };
      } else if (key === 'correct' || key === 'offline_close') {
        const title = key === 'correct' ? '已交货订单更正记录' : '负责人线下渠道结单确认';
        const fm = App.modal(title, App.fieldRow('原因说明（必填）', '<input id="ex-reason" placeholder="请输入详细原因">', true),
          '<button class="btn ghost" id="ex-c">取消</button><button class="btn" id="ex-s">确认提交</button>', 'sm');
        fm.el.querySelector('#ex-c').onclick = fm.close;
        fm.el.querySelector('#ex-s').onclick = async () => {
          const r = await API.orderStage({ id: o.id, action: key, reason: fm.el.querySelector('#ex-reason').value.trim() });
          if (!r.ok) { App.toast(r.error, 'err'); return; }
          fm.close(); m.close(); App.toast('操作已记录留痕', 'ok'); render();
        };
      }
    });
  }

  function renderOrderFlow(stage) {
    const curIdx = FLOW_STAGES.indexOf(stage);
    const items = FLOW_STAGES.map((st, idx) => {
      const cls = curIdx >= 0 ? (idx < curIdx ? 'done' : (idx === curIdx ? 'active' : '')) : '';
      return `${idx > 0 ? '<span class="flow-arrow">→</span>' : ''}<span class="flow-step ${cls}">${idx < curIdx ? '✓ ' : ''}${st}</span>`;
    }).join('');
    const extra = stage === '返工' ? '<span class="flow-arrow">↺</span><span class="flow-step warn">返工</span>'
      : (stage === '取消' ? '<span class="flow-arrow">·</span><span class="flow-step warn">取消</span>' : '');
    return `<div class="flow-stepper">${items}${extra}</div>`;
  }

  function detail(o) {
    if (!o) return;
    const db = API.raw();
    const p = API.patientOfOrder(o.id);
    const prod = (db.products || []).find(x => x.id == o.product_id);
    const lab = (db.dentalLabs || []).find(x => x.id == o.lab_id);
    const teeth = API.orderTeeth(o.id);
    const atts = API.orderAttachments(o.id);
    const events = API.orderEvents(o.id);
    const attTypes = API.listOptions('附件类型').map(x => ({ value: x.id, label: x.name }));
    const canUpload = isDoctor && !['已交货', '取消'].includes(o.stage);
    const acts = availableActions(o);

    const body = `
      <div class="grid cols-3">
        <div class="kpi"><div class="label">患者</div><div class="value" style="font-size:17px">${App.esc(p ? p.name : '—')}</div></div>
        <div class="kpi"><div class="label">产品 / 技工所</div><div class="value" style="font-size:15.5px">${App.esc(prod ? prod.name : '—')} · ${App.esc(lab ? lab.name : '—')}</div></div>
        <div class="kpi"><div class="label">当前状态</div><div class="value" style="font-size:16px">${App.tag(o.stage)}</div></div>
      </div>
      ${renderOrderFlow(o.stage)}
      <table class="tbl"><tbody>
        <tr><th style="width:120px">修复要求</th><td>${App.esc(o.repair_requirement)}</td></tr>
        <tr><th>牙位（FDI）</th><td>${teeth.map(t => `<b>${App.esc(t.tooth_code)}</b>（${App.esc(API.toothName(t.tooth_code))}）`).join('、') || '—'}</td></tr>
        <tr><th>颜色 / 盒色 / 类型</th><td>${App.esc(API.optionName(o.color_id))} / ${App.esc(API.optionName(o.box_color_id) || '—')} / ${App.esc(API.optionName(o.type_id))}</td></tr>
        <tr><th>数量 / 承诺交期</th><td>${o.quantity} ${App.esc(API.optionName(o.unit_id))} ｜ 承诺日 <b>${App.esc(o.promised_date)}</b> ｜ 预计完成 ${App.esc(o.expected_at ? String(o.expected_at).slice(0, 16).replace('T', ' ') : '—')}</td></tr>
        <tr><th>试戴结论 / 时间轴</th><td>试戴结论：<b>${App.esc(o.trial_result || '—')}</b><div class="muted">发送 ${App.esc(String(o.sent_at || '—').slice(0, 16))} ｜ 接收 ${App.esc(String(o.accepted_at || '—').slice(0, 16))} ｜ 试戴 ${App.esc(String(o.trial_at || '—').slice(0, 16))} ｜ 交货 ${App.esc(String(o.delivered_at || '—').slice(0, 16))}</div></td></tr>
      </tbody></table>

      <p style="margin:14px 0 8px"><b>修复附件（${atts.length}，托管于独立文件存储，仅索引入库）</b></p>
      ${atts.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>文件名</th><th>分类</th><th>大小</th><th>上传时间</th><th>操作</th></tr></thead><tbody>
        ${atts.map(a => `<tr><td><b>${App.esc(a.file_name)}</b></td><td>${App.esc(API.optionName(a.type_id))}</td>
          <td>${(a.byte_size / 1024).toFixed(1)} KB</td><td>${App.esc(String(a.uploaded_at).slice(0, 16).replace('T', ' '))}</td>
          <td class="actions">
            <button class="btn ghost sm" data-dl="${a.id}">下载</button>
            ${isDoctor && o.stage === '草稿' ? `<button class="btn ghost sm" data-del-att="${a.id}">删除</button>` : ''}
          </td></tr>`).join('')}
      </tbody></table></div>` : '<div class="muted">暂无已上传附件</div>'}

      ${canUpload ? `<div class="drop-zone" id="att-drop">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;flex:1">
          ${App.selectHtml('up-type', attTypes, attTypes[0] ? attTypes[0].value : '', 'style="width:130px;height:36px;padding:4px 8px;border:1.5px solid var(--line);border-radius:8px"')}
          ${App.attachmentFile('up-file')}
          <span class="muted" id="up-hint">支持拖拽或选择 JPG / PNG / PDF（≤10MB）</span>
        </div>
        <button class="btn sm" id="up-btn" type="button">上传托管附件</button>
      </div>` : ''}

      <p style="margin:16px 0 8px"><b>全流程进展留痕（${events.length}）</b></p>
      <ul class="timeline">${events.map(e => `<li>
        <div class="t-time">${App.esc(String(e.occurred_at).slice(0, 19).replace('T', ' '))} · 来源 ${App.esc(e.source)} · 事件 ${App.esc(e.event_no)}${e.external_order_no ? ' · 外部单号 ' + App.esc(e.external_order_no) : ''}</div>
        <div class="t-title">${App.esc(e.old_stage || '新建')} → ${App.esc(e.new_stage)}</div>
        ${e.reason ? `<div>${App.esc(e.reason)}</div>` : ''}
      </li>`).join('')}</ul>`;

    const foot = `
      ${acts.length ? '<button class="btn soft" id="m-act">推进订单状态</button>' : ''}
      <button class="btn ghost" id="m-print">打印加工单</button>
      <button class="btn ghost" id="m-c">关闭</button>`;
    const m = App.modal('义齿订单详情 · ' + o.order_no, body, foot, 'lg');
    m.el.querySelector('#m-c').onclick = m.close;
    const actBtn = m.el.querySelector('#m-act');
    if (actBtn) actBtn.onclick = () => { m.close(); actions(o); };
    m.el.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => API.downloadAttachment(atts.find(x => x.id == b.dataset.dl)));
    m.el.querySelectorAll('[data-del-att]').forEach(b => b.onclick = async () => {
      const r = await API.deleteOrderAttachment(Number(b.dataset.delAtt));
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      App.toast('附件已删除', 'ok'); m.close(); detail(API.raw().orders.find(x => x.id == o.id)); render();
    });

    const upBtn = m.el.querySelector('#up-btn');
    const dropZone = m.el.querySelector('#att-drop');
    const fileInp = m.el.querySelector('#up-file');
    let droppedFile = null;

    if (fileInp) {
      fileInp.onchange = () => {
        droppedFile = fileInp.files[0] || null;
        if (droppedFile) m.el.querySelector('#up-hint').textContent = `已选：${droppedFile.name}（${(droppedFile.size / 1024).toFixed(1)} KB）`;
      };
    }
    if (dropZone) {
      dropZone.ondragover = e => { e.preventDefault(); dropZone.classList.add('dragover'); };
      dropZone.ondragleave = () => dropZone.classList.remove('dragover');
      dropZone.ondrop = e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          droppedFile = e.dataTransfer.files[0];
          m.el.querySelector('#up-hint').textContent = `已拖入：${droppedFile.name}（${(droppedFile.size / 1024).toFixed(1)} KB）`;
        }
      };
    }
    if (upBtn) {
      upBtn.onclick = async () => {
        const file = droppedFile || (fileInp && fileInp.files[0]);
        const err = App.validateAttachment(file);
        if (err) { App.toast(err, 'err'); return; }
        const b64 = await App.readFileAsBase64(file);
        const r = await API.uploadOrderAttachment({
          order_id: o.id,
          type_id: Number(m.el.querySelector('#up-type').value),
          file_name: file.name,
          mime_type: file.type,
          content_base64: b64,
        });
        if (!r.ok) { App.toast(r.error, 'err'); return; }
        App.toast('附件已上传托管', 'ok');
        m.close(); detail(API.raw().orders.find(x => x.id == o.id)); render();
      };
    }

    m.el.querySelector('#m-print').onclick = () => {
      App.openPrint(`义齿加工订单 ${o.order_no}`, `
        <h1>义齿委托加工单 · ${App.esc(o.order_no)}</h1>
        <table><tbody>
          <tr><th>患者</th><td>${App.esc(p ? `${p.name}（${p.patient_no}）` : '—')}</td></tr>
          <tr><th>合作技工所</th><td>${App.esc(lab ? `${lab.name}（${lab.contact} ${lab.phone}）` : '—')}</td></tr>
          <tr><th>产品 / 材料</th><td>${App.esc(prod ? `${prod.name} / ${prod.material}` : '—')}</td></tr>
          <tr><th>牙位（FDI）</th><td>${teeth.map(t => App.esc(t.tooth_code)).join('、') || '—'}</td></tr>
          <tr><th>颜色 / 盒色</th><td>${App.esc(API.optionName(o.color_id))} / ${App.esc(API.optionName(o.box_color_id) || '—')}</td></tr>
          <tr><th>数量 / 单位</th><td>${o.quantity} ${App.esc(API.optionName(o.unit_id))}</td></tr>
          <tr><th>承诺交期</th><td>${App.esc(o.promised_date)}</td></tr>
          <tr><th>修复要求</th><td>${App.esc(o.repair_requirement)}</td></tr>
          <tr><th>附件索引</th><td>${atts.map(a => App.esc(a.file_name)).join('、') || '无'}</td></tr>
        </tbody></table>`);
    };
  }

  render();
  if (opts && opts.autoCreate && isDoctor) {
    setTimeout(() => openDraftModal(null, { encounterId: opts.encounterId }), 40);
  }
};
