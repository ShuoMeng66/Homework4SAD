/* 治疗计划（UC-06）：
 * - 四象限 FDI 牙位图点选、一站式新建计划并汇总报价快照（支持暂存拟定或直接患者确认执行）
 * - 诊疗记录一键带入患者/主诉/诊断、分段状态筛选与实时检索、执行自动联动收费单与技工单
 */
window.Modules = window.Modules || {};
window.Modules.plans = function (set, opts) {
  const session = API.session() || {};
  const canWrite = ['doctor', 'admin'].includes(session.role);
  let stage = '', keyword = (opts && opts.keyword) || '';

  function filteredPlans() {
    const db = API.raw();
    let list = API.listPlans({ stage: stage || undefined });
    if (keyword) {
      const kw = keyword.toLowerCase();
      list = list.filter(p => {
        const pt = (db.patients || []).find(x => x.id == p.patient_id);
        const doc = (db.employees || []).find(x => x.id == p.doctor_id);
        return [p.plan_no, pt ? pt.name : '', doc ? doc.name : '', p.diagnosis, p.chief_complaint]
          .some(v => String(v || '').toLowerCase().includes(kw));
      });
    }
    return list;
  }

  function renderRows(list) {
    const db = API.raw();
    return list.length ? list.map(p => {
      const pg = API.planProgress(p.id);
      const pct = pg.total ? Math.round((pg.done / pg.total) * 100) : 0;
      const pt = (db.patients || []).find(x => x.id == p.patient_id);
      const doc = (db.employees || []).find(x => x.id == p.doctor_id);
      return `<tr>
        <td><b>${App.esc(p.plan_no)}</b></td>
        <td><span class="av-cell">${App.avatar(pt ? pt.name : '—')}<b>${App.esc(pt ? pt.name : '—')}</b></span></td>
        <td>${App.esc(doc ? doc.name : '—')}</td>
        <td>${App.esc(p.diagnosis || '—')}</td>
        <td><div class="pbar-inline">${App.progressBar(pct, pct === 100 ? 'green' : '')}<span>${pg.done}/${pg.total}</span></div></td>
        <td><b>¥${Number(p.quoted_amount || pg.amount).toFixed(2)}</b></td>
        <td class="muted">${App.esc(p.accepted_at ? String(p.accepted_at).slice(0, 16).replace('T', ' ') : '未确认')}</td>
        <td>${App.tag(p.stage)}</td>
        <td class="actions">
          <button class="btn ghost sm" data-open="${p.id}">详情</button>
          ${canWrite && p.stage === '拟定' ? `<button class="btn soft sm" data-confirm="${p.id}">确认方案</button>` : ''}
          ${canWrite && ['已确认', '执行中'].includes(p.stage) && pg.done === pg.total && pg.total > 0 ? `<button class="btn soft sm" data-close="${p.id}">关闭计划</button>` : ''}
        </td></tr>`;
    }).join('') : '<tr><td colspan="9"><div class="empty">当前筛选条件下暂无治疗计划</div></td></tr>';
  }

  function bindRowActions() {
    document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => detail(Number(b.dataset.open)));
    document.querySelectorAll('[data-confirm]').forEach(b => b.onclick = async () => {
      const r = await API.confirmPlan(Number(b.dataset.confirm));
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      App.toast('患者已确认方案，报价快照已锁定并转入执行中', 'ok'); render();
    });
    document.querySelectorAll('[data-close]').forEach(b => b.onclick = async () => {
      const r = await API.closePlan(Number(b.dataset.close));
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      App.toast('治疗计划已完成关闭', 'ok'); render();
    });
  }

  function render() {
    const all = API.listPlans({});
    const list = filteredPlans();
    const tabs = [
      ['', '全部', all.length],
      ['拟定', '拟定', all.filter(x => x.stage === '拟定').length],
      ['执行中', '执行中', all.filter(x => ['已确认', '执行中'].includes(x.stage)).length],
      ['已完成', '已完成', all.filter(x => x.stage === '已完成').length],
      ['已终止', '已终止', all.filter(x => x.stage === '已终止').length],
    ];

    set(`
      <div class="page-head">
        <div>
          <div class="page-title">治疗计划</div>
          <div class="page-desc">多期口腔治疗方案制定与分次执行</div>
        </div>
        ${canWrite ? '<button class="btn" id="pl-add">+ 制定治疗计划</button>' : ''}
      </div>
      <div class="card">
        <div class="toolbar" style="justify-content:space-between;align-items:center">
          <div class="tabs" style="margin-bottom:0">
            ${tabs.map(([k, l, cnt]) => `<div class="tab ${stage === k ? 'active' : ''}" data-st="${k}">${l}<span class="tab-badge">${cnt}</span></div>`).join('')}
          </div>
          ${App.searchBoxHtml('pl-kw', '检索计划号、患者或诊断…', keyword)}
        </div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>计划编号</th><th>患者</th><th>主治医生</th><th>诊断</th><th>执行进度</th><th>报价快照</th><th>确认时间</th><th>阶段</th><th>操作</th>
        </tr></thead><tbody id="pl-tbody">${renderRows(list)}</tbody></table></div>
      </div>`);

    const addBtn = document.getElementById('pl-add');
    if (addBtn) addBtn.onclick = () => createPlan({});
    document.querySelectorAll('[data-st]').forEach(el => {
      el.onclick = () => { stage = el.dataset.st; render(); };
    });
    App.bindSearchBox(document, 'pl-kw', v => {
      keyword = v;
      const tb = document.getElementById('pl-tbody');
      if (tb) { tb.innerHTML = renderRows(filteredPlans()); bindRowActions(); }
    });
    bindRowActions();
  }

  // UC-06 一站式制定治疗计划（支持点选 FDI 牙位、添加分期明细、实时汇总报价，可选暂存拟定或直接确认执行）
  function createPlan(preset = {}) {
    const db = API.raw();
    const patients = (db.patients || []).map(p => ({ value: p.id, label: `${p.patient_no} ${p.name}` }));
    const doctors = API.doctors(true).map(e => ({ value: e.id, label: e.name }));
    const prices = (db.priceItems || []).filter(p => p.active);
    if (!patients.length || !doctors.length) { App.toast('缺少患者或医生资料', 'err'); return; }

    const srcEnc = preset.encounterId ? (db.encounters || []).find(e => e.id == preset.encounterId) : null;
    const initPid = srcEnc ? srcEnc.patient_id : (preset.patientId || patients[0].value);
    const defaultDoc = srcEnc ? srcEnc.doctor_id
      : ((session.employee_id && doctors.some(d => d.value == session.employee_id)) ? session.employee_id : doctors[0].value);
    const initCc = srcEnc ? (srcEnc.chief_complaint || '') : '';
    const initDx = srcEnc ? (srcEnc.diagnosis || '') : '';

    const draftItems = [];
    const priceOpts = prices.map(p => ({ value: p.id, label: `${p.name}（¥${Number(p.unit_price).toFixed(2)}/${API.optionName(p.unit_id)}）` }));

    const body = `
      <div class="form-grid">
        ${App.fieldRow('患者', App.selectHtml('f-p', patients, initPid))}
        ${App.fieldRow('主治医生', App.selectHtml('f-d', doctors, defaultDoc))}
        ${App.fieldRow('主诉', `<input id="f-cc" value="${App.esc(initCc)}" placeholder="患者主诉">`)}
        ${App.fieldRow('本次诊断', `<input id="f-dx" value="${App.esc(initDx)}" placeholder="如：36 牙髓炎 / 冠折">`)}
      </div>

      <div style="margin-top:6px;padding-top:14px;border-top:1px solid var(--line)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:6px">
          <b>按牙位与期次排定计划项（固化当前价目快照）</b>
          ${!prices.length ? '<span class="tag red">暂无有效价目</span>' : `<span class="muted">若缺少对应价目：${API.can('basic') ? '<a href="#" id="go-basic-inline">跳转基础信息维护 →</a>' : '请联系负责人补充价目表'}</span>`}
        </div>
        ${App.toothChartHtml('cp-tooth-chart', [], false)}
        <div class="form-grid" style="margin-top:10px;align-items:end">
          ${App.fieldRow('收费价目项目', App.selectHtml('cp-price', priceOpts, priceOpts[0] ? priceOpts[0].value : ''))}
          <div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;margin-bottom:14px;align-items:end">
            <div><label style="display:block;font-size:12px;color:var(--muted);font-weight:600;margin-bottom:5px">期次</label><input id="cp-phase" type="number" min="1" value="1"></div>
            <div><label style="display:block;font-size:12px;color:var(--muted);font-weight:600;margin-bottom:5px">数量</label><input id="cp-qty" type="number" min="0.5" step="0.5" value="1"></div>
            <button type="button" class="btn soft" id="cp-add-item" ${!prices.length ? 'disabled' : ''}>+ 加入清单</button>
          </div>
        </div>
        <div id="cp-items-box"></div>
        <div class="slot-summary" style="margin-top:10px;margin-bottom:0">
          <span id="cp-quote-count">已排定 0 个计划项</span>
          <span>方案报价合计：<b id="cp-quote-sum" style="font-size:16px">¥0.00</b></span>
        </div>
      </div>`;

    const foot = `
      <button class="btn ghost" id="m-c">取消</button>
      <button class="btn ghost" id="m-draft">暂存为拟定（患者考虑中）</button>
      <button class="btn success" id="m-confirm" disabled>患者已确认 · 锁定报价并执行</button>`;

    const m = App.modal('制定分期治疗计划', body, foot, 'lg');
    m.el.querySelector('#m-c').onclick = m.close;
    const gb = m.el.querySelector('#go-basic-inline');
    if (gb) gb.onclick = e => { e.preventDefault(); m.close(); App.navigate('basic'); };

    const chart = App.bindToothChart(m.el, 'cp-tooth-chart', false, []);
    const itemsBox = m.el.querySelector('#cp-items-box');
    const confirmBtn = m.el.querySelector('#m-confirm');

    function paintDraftItems() {
      const total = draftItems.reduce((s, x) => s + x.quantity * x.unit_price, 0);
      m.el.querySelector('#cp-quote-count').textContent = `已排定 ${draftItems.length} 个计划项`;
      m.el.querySelector('#cp-quote-sum').textContent = `¥${total.toFixed(2)}`;
      confirmBtn.disabled = draftItems.length === 0;
      itemsBox.innerHTML = draftItems.length ? draftItems.map((it, idx) => `
        <div class="plan-draft-row">
          <span><span class="tag teal">第 ${it.phase_no} 期</span></span>
          <span><b>${it.tooth_code ? `${App.esc(it.tooth_code)} ${App.esc(API.toothName(it.tooth_code))} · ` : '全口 · '}${App.esc(it.name)}</b></span>
          <span>× ${it.quantity}</span>
          <span><b>¥${(it.quantity * it.unit_price).toFixed(2)}</b></span>
          <button type="button" class="btn ghost sm" data-rm-di="${idx}" style="padding:2px 8px;min-height:26px">移除</button>
        </div>`).join('') : '<div class="muted" style="padding:6px 2px">暂未添加计划项（可直接点击「暂存为拟定」后续再补充，或添加项目后直接由患者确认执行）</div>';
      itemsBox.querySelectorAll('[data-rm-di]').forEach(b => {
        b.onclick = () => { draftItems.splice(Number(b.dataset.rmDi), 1); paintDraftItems(); };
      });
    }

    const addItemBtn = m.el.querySelector('#cp-add-item');
    if (addItemBtn) {
      addItemBtn.onclick = () => {
        const pid = Number(m.el.querySelector('#cp-price').value);
        const pi = prices.find(x => x.id == pid);
        if (!pi) { App.toast('请选择有效的收费价目', 'err'); return; }
        const qty = Number(m.el.querySelector('#cp-qty').value) || 1;
        const phase = Math.max(1, Number(m.el.querySelector('#cp-phase').value) || 1);
        if (qty <= 0) { App.toast('数量必须大于 0', 'err'); return; }
        draftItems.push({
          price_item_id: pi.id,
          name: pi.name,
          unit_price: Number(pi.unit_price),
          tooth_code: chart.first(),
          phase_no: phase,
          quantity: qty,
        });
        paintDraftItems();
      };
    }
    paintDraftItems();

    async function submitPlan(targetStage) {
      if (targetStage === '执行中' && !draftItems.length) {
        App.toast('请至少添加一个计划项后再确认执行', 'err');
        return;
      }
      const r = await API.createPlan({
        patient_id: Number(m.el.querySelector('#f-p').value),
        doctor_id: Number(m.el.querySelector('#f-d').value),
        chief_complaint: m.el.querySelector('#f-cc').value.trim(),
        diagnosis: m.el.querySelector('#f-dx').value.trim(),
        stage: targetStage,
        items: draftItems.map(x => ({
          price_item_id: x.price_item_id,
          tooth_code: x.tooth_code,
          phase_no: x.phase_no,
          quantity: x.quantity,
        })),
      });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close();
      App.toast(targetStage === '执行中'
        ? `治疗计划 ${r.data.plan_no} 已确认并锁定报价快照`
        : `计划 ${r.data.plan_no} 已暂存为拟定状态`, 'ok');
      render();
      detail(r.data.id);
    }

    m.el.querySelector('#m-draft').onclick = () => submitPlan('拟定');
    confirmBtn.onclick = () => submitPlan('执行中');
  }

  function detail(id) {
    const db = API.raw();
    const plan = (db.treatmentPlans || []).find(p => p.id == id);
    if (!plan) return;
    const pg = API.planProgress(id);
    const pt = (db.patients || []).find(x => x.id == plan.patient_id);
    const doc = (db.employees || []).find(x => x.id == plan.doctor_id);
    const isOpen = !['已完成', '已终止'].includes(plan.stage);
    const isConfirmed = ['已确认', '执行中'].includes(plan.stage);

    const rows = pg.items.map(i => {
      const order = (db.orders || []).find(o => o.id == i.lab_order_id);
      const enc = (db.encounters || []).find(e => e.id == i.encounter_id);
      return `<tr>
        <td><span class="tag teal">第 ${i.phase_no} 期</span></td>
        <td>${i.tooth_code ? `<b>${App.esc(i.tooth_code)}</b> ${App.esc(API.toothName(i.tooth_code))}` : '全口'}</td>
        <td><b>${App.esc(i.name)}</b></td>
        <td>${i.quantity} × ¥${Number(i.unit_price).toFixed(2)}</td>
        <td>${App.tag(i.stage)}</td>
        <td class="muted">${enc ? App.esc(enc.encounter_no) : ''}${i.bill_id ? ' · 收费#' + i.bill_id : ''}${order ? ' · ' + App.esc(order.order_no) : ''}</td>
        <td class="actions">
          ${canWrite && isOpen && i.stage === '待执行' ? `
            ${isConfirmed ? `<button class="btn soft sm" data-exec="${i.id}">执行</button>` : '<span class="muted" style="font-size:12px">待确认方案</span>'}
            <button class="btn ghost sm" data-cancel-item="${i.id}">取消项</button>` : ''}
          ${canWrite && i.stage === '已执行' && !i.lab_order_id ? `<button class="btn ghost sm" data-lab="${i.id}">建技工单</button>` : ''}
          ${(!canWrite || i.stage === '已取消' || (i.stage === '已执行' && i.lab_order_id)) ? '—' : ''}
        </td></tr>`;
    }).join('');

    const body = `
      <div class="grid cols-4">
        <div class="kpi"><div class="label">患者</div><div class="value" style="font-size:17px">${App.esc(pt ? pt.name : '—')}</div></div>
        <div class="kpi"><div class="label">主治医生</div><div class="value" style="font-size:17px">${App.esc(doc ? doc.name : '—')}</div></div>
        <div class="kpi"><div class="label">有效进度</div><div class="value" style="font-size:22px">${pg.done}/${pg.total}</div></div>
        <div class="kpi"><div class="label">报价快照</div><div class="value" style="font-size:20px;color:var(--primary)">¥${Number(plan.quoted_amount || pg.amount).toFixed(2)}</div></div>
      </div>
      <table class="tbl" style="margin-top:12px"><tbody>
        <tr><th style="width:110px">主诉 / 诊断</th><td>${App.esc(plan.chief_complaint || '—')} ｜ ${App.esc(plan.diagnosis || '—')}</td></tr>
        <tr><th>阶段 / 确认</th><td>${App.tag(plan.stage)} ${plan.accepted_at ? '· 确认于 ' + App.esc(String(plan.accepted_at).slice(0, 16).replace('T', ' ')) : '（尚未确认，确认后方可实际执行）'}</td></tr>
      </tbody></table>
      <p style="margin:14px 0 8px"><b>计划项明细</b></p>
      <div class="table-wrap"><table class="tbl"><thead><tr>
        <th>期次</th><th>FDI 牙位</th><th>项目</th><th>快照单价</th><th>状态</th><th>关联诊疗/单据</th><th>操作</th>
      </tr></thead><tbody>${rows || '<tr><td colspan="7"><div class="empty">暂无计划项，请点击下方添加</div></td></tr>'}</tbody></table></div>
      ${canWrite && isOpen ? `<div class="toolbar" style="margin-top:12px;margin-bottom:0">
        <button class="btn soft sm" id="pi-add">+ 添加计划项</button>
        ${plan.stage === '拟定' ? '<button class="btn success sm" id="pl-confirm-btn">患者确认方案</button>' : ''}
        ${isConfirmed && pg.done === pg.total && pg.total > 0 ? '<button class="btn success sm" id="pl-close-btn">完成并关闭计划</button>' : ''}
        <button class="btn ghost sm" id="pl-term-btn" style="margin-left:auto">终止计划</button>
      </div>` : ''}`;

    const m = App.modal('治疗计划 · ' + plan.plan_no, body, '<button class="btn ghost" id="m-c">关闭</button>', 'lg');
    m.el.querySelector('#m-c').onclick = m.close;
    const addBtn = m.el.querySelector('#pi-add');
    if (addBtn) addBtn.onclick = () => addItem(plan, () => { m.close(); detail(plan.id); render(); });
    const cfBtn = m.el.querySelector('#pl-confirm-btn');
    if (cfBtn) cfBtn.onclick = async () => {
      const r = await API.confirmPlan(plan.id);
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      App.toast('已确认方案并锁定报价快照', 'ok');
      m.close(); detail(plan.id); render();
    };
    const clBtn = m.el.querySelector('#pl-close-btn');
    if (clBtn) clBtn.onclick = async () => {
      const r = await API.closePlan(plan.id);
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      App.toast('治疗计划已完成关闭', 'ok');
      m.close(); render();
    };
    const tmBtn = m.el.querySelector('#pl-term-btn');
    if (tmBtn) tmBtn.onclick = () => {
      App.promptBox('终止治疗计划 · ' + plan.plan_no, '终止原因（必填）', '患者调整治疗意愿', '请输入终止原因', async (reason, pm) => {
        const r = await API.terminatePlan(plan.id, reason);
        if (!r.ok) { App.toast(r.error, 'err'); return true; }
        App.toast('治疗计划已终止', 'ok');
        pm.close(); m.close(); render();
        return true;
      }, { required: true, warn: true, danger: true, note: '终止计划后未执行的计划项将标记为已取消并保留完整历史记录。', okText: '确认终止' });
    };
    m.el.querySelectorAll('[data-cancel-item]').forEach(b => b.onclick = () => {
      const itemId = Number(b.dataset.cancelItem);
      App.promptBox('取消计划项（保留历史）', '取消原因', '方案调整替换', '请输入调整原因', async (reason, pm) => {
        const r = await API.cancelPlanItem(itemId, reason);
        if (!r.ok) { App.toast(r.error, 'err'); return true; }
        App.toast('原计划项已标记为已取消并保留历史', 'ok');
        pm.close(); m.close(); render(); detail(plan.id);
        return true;
      }, { okText: '确认取消该项' });
    });
    m.el.querySelectorAll('[data-exec]').forEach(b => b.onclick = () => execItem(plan, Number(b.dataset.exec), () => { m.close(); detail(plan.id); render(); }));
    m.el.querySelectorAll('[data-lab]').forEach(b => b.onclick = () => labOrderForItem(Number(b.dataset.lab), () => { m.close(); detail(plan.id); render(); }));
  }

  function addItem(plan, done) {
    const db = API.raw();
    const prices = (db.priceItems || []).filter(p => p.active).map(p => ({ value: p.id, label: `${p.name} · ¥${Number(p.unit_price).toFixed(2)}` }));
    const body = `
      ${!prices.length ? '<div class="note warn">当前无可用收费价目，请先维护基础信息。</div>' : ''}
      <div style="margin-bottom:12px">
        <label style="display:block;font-size:12px;color:var(--muted);font-weight:600;margin-bottom:6px">点击选择 FDI 牙位（不选表示全口）</label>
        ${App.toothChartHtml('ai-tooth-chart', [], false)}
      </div>
      <div class="form-grid">
        ${App.fieldRow('收费价目（固化单价快照）', App.selectHtml('f-price', prices, prices[0] ? prices[0].value : ''), true)}
        ${App.fieldRow('期次', '<input id="f-phase" type="number" min="1" value="1">')}
        ${App.fieldRow('数量', '<input id="f-qty" type="number" min="0.5" step="0.5" value="1">')}
      </div>
      <div style="margin-top:4px;font-size:12px" class="muted">若缺少对应价目：${API.can('basic') ? '<a href="#" id="go-basic">跳转基础信息维护</a>' : '请联系管理员或诊所负责人在「基础信息 → 收费价目」中补充'}</div>`;
    const m = App.modal('添加计划项 · ' + plan.plan_no, body, '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">确认添加</button>', 'lg');
    const chart = App.bindToothChart(m.el, 'ai-tooth-chart', false, []);
    m.el.querySelector('#m-c').onclick = m.close;
    const gb = m.el.querySelector('#go-basic');
    if (gb) gb.onclick = e => { e.preventDefault(); m.close(); App.navigate('basic'); };
    m.el.querySelector('#m-s').onclick = async () => {
      const pid = Number(m.el.querySelector('#f-price').value);
      if (!pid) { App.toast('请选择有效的价目项目', 'err'); return; }
      const r = await API.addPlanItem({
        plan_id: plan.id,
        tooth_code: chart.first(),
        price_item_id: pid,
        phase_no: Number(m.el.querySelector('#f-phase').value) || 1,
        quantity: Number(m.el.querySelector('#f-qty').value) || 1,
      });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('计划项已添加', 'ok'); if (done) done();
    };
  }

  function execItem(plan, itemId, done) {
    const db = API.raw();
    const it = (db.planItems || []).find(x => x.id == itemId);
    const encs = (db.encounters || []).filter(e => e.patient_id == plan.patient_id)
      .map(e => ({ value: e.id, label: `${e.encounter_no} · ${String(e.occurred_at).slice(0, 16)} · ${e.diagnosis || e.chief_complaint}` }));
    if (!encs.length) {
      App.toast('该患者暂无诊疗记录，请先录入本次诊疗后再执行计划项', 'err');
      App.navigate('encounters', { autoCreate: true });
      return;
    }
    const prods = (db.products || []).filter(p => p.active).map(p => ({ value: p.id, label: p.name }));
    const labs = (db.dentalLabs || []).filter(l => l.active).map(l => ({ value: l.id, label: l.name }));
    const colors = API.listOptions('颜色').map(o => ({ value: o.id, label: o.name }));
    const types = API.listOptions('订单类型').map(o => ({ value: o.id, label: o.name }));
    const units = API.listOptions('单位').map(o => ({ value: o.id, label: o.name }));
    const needLabDefault = /冠|桥|嵌体|贴面|义齿|修复/.test(it ? it.name : '');

    const body = `
      <div class="note">执行计划项后，系统将自动按计划锁定报价快照（¥${Number(it.unit_price).toFixed(2)} × ${it.quantity}）生成关联收费单；如需义齿加工可同步创建技工单草稿。</div>
      <div class="form-grid">
        ${App.fieldRow('关联本次诊疗记录（必填）', App.selectHtml('ex-enc', encs, encs[0].value), true)}
        ${App.fieldRow('是否同步生成义齿技工单草稿', App.selectHtml('ex-lab-on', [{ value: '0', label: '否' }, { value: '1', label: '是（同步生成草稿）' }], needLabDefault ? '1' : '0'), true)}
      </div>
      <div id="ex-lab-box" style="display:${needLabDefault ? 'block' : 'none'};margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)">
        <div class="form-grid">
          ${App.fieldRow('义齿产品', App.selectHtml('ex-prod', prods, prods[0] ? prods[0].value : ''))}
          ${App.fieldRow('合作技工所', App.selectHtml('ex-lab', labs, labs[0] ? labs[0].value : ''))}
          ${App.fieldRow('颜色', App.selectHtml('ex-color', colors, colors[0] ? colors[0].value : ''))}
          ${App.fieldRow('订单类型', App.selectHtml('ex-type', types, types[0] ? types[0].value : ''))}
          ${App.fieldRow('单位', App.selectHtml('ex-unit', units, units[0] ? units[0].value : ''))}
          ${App.fieldRow('承诺日期', `<input id="ex-date" type="date" value="${API.localToday(7)}">`)}
        </div>
      </div>`;
    const m = App.modal(`执行计划项 · ${it.name}`, body, '<button class="btn ghost" id="m-c">取消</button><button class="btn success" id="m-s">确认执行</button>', 'lg');
    m.el.querySelector('#ex-lab-on').onchange = e => {
      m.el.querySelector('#ex-lab-box').style.display = e.target.value === '1' ? 'block' : 'none';
    };
    m.el.querySelector('#m-c').onclick = m.close;
    m.el.querySelector('#m-s').onclick = async () => {
      const payload = {
        id: itemId,
        encounter_id: Number(m.el.querySelector('#ex-enc').value),
      };
      if (m.el.querySelector('#ex-lab-on').value === '1') {
        payload.lab_order = {
          product_id: Number(m.el.querySelector('#ex-prod').value),
          lab_id: Number(m.el.querySelector('#ex-lab').value),
          color_id: Number(m.el.querySelector('#ex-color').value),
          type_id: Number(m.el.querySelector('#ex-type').value),
          unit_id: Number(m.el.querySelector('#ex-unit').value),
          promised_date: m.el.querySelector('#ex-date').value,
          repair_requirement: it.name,
        };
      }
      const r = await API.executePlanItem(payload);
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close();
      App.toast(`已执行！自动生成收费单 ${r.data.bill_no}${r.data.order_no ? ' 及技工单草稿 ' + r.data.order_no : ''}`, 'ok');
      if (done) done();
    };
  }

  function labOrderForItem(itemId, done) {
    const db = API.raw();
    const it = (db.planItems || []).find(x => x.id == itemId);
    const prods = (db.products || []).filter(p => p.active).map(p => ({ value: p.id, label: p.name }));
    const labs = (db.dentalLabs || []).filter(l => l.active).map(l => ({ value: l.id, label: l.name }));
    const colors = API.listOptions('颜色').map(o => ({ value: o.id, label: o.name }));
    const types = API.listOptions('订单类型').map(o => ({ value: o.id, label: o.name }));
    const units = API.listOptions('单位').map(o => ({ value: o.id, label: o.name }));
    const body = `<div class="form-grid">
      ${App.fieldRow('义齿产品', App.selectHtml('f-prod', prods, prods[0] ? prods[0].value : ''))}
      ${App.fieldRow('合作技工所', App.selectHtml('f-lab', labs, labs[0] ? labs[0].value : ''))}
      ${App.fieldRow('颜色', App.selectHtml('f-color', colors, colors[0] ? colors[0].value : ''))}
      ${App.fieldRow('订单类型', App.selectHtml('f-type', types, types[0] ? types[0].value : ''))}
      ${App.fieldRow('单位', App.selectHtml('f-unit', units, units[0] ? units[0].value : ''))}
      ${App.fieldRow('承诺日期', `<input id="f-date" type="date" value="${API.localToday(7)}">`)}
      ${App.fieldRow('修复要求', `<input id="f-req" value="${App.esc(it ? it.name : '')}">`, true)}
    </div>`;
    const m = App.modal('计划项建义齿订单草稿', body, '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">建立草稿</button>');
    m.el.querySelector('#m-c').onclick = m.close;
    m.el.querySelector('#m-s').onclick = async () => {
      const r = await API.orderFromPlanItem({
        item_id: itemId,
        product_id: Number(m.el.querySelector('#f-prod').value),
        lab_id: Number(m.el.querySelector('#f-lab').value),
        color_id: Number(m.el.querySelector('#f-color').value),
        type_id: Number(m.el.querySelector('#f-type').value),
        unit_id: Number(m.el.querySelector('#f-unit').value),
        promised_date: m.el.querySelector('#f-date').value,
        repair_requirement: m.el.querySelector('#f-req').value.trim(),
      });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast(`已生成技工单草稿 ${r.data.order_no}，请前往义齿订单补充附件并发送`, 'ok');
      if (done) done();
    };
  }

  render();
  if (opts && opts.autoCreate && canWrite) {
    setTimeout(() => createPlan({ encounterId: opts.encounterId, patientId: opts.patientId }), 40);
  }
};
