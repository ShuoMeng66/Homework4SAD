/* 治疗计划（UC-06）：分期治疗方案、FDI 牙位、报价快照锁定、方案调整留痕、执行联动收费与技工单 */
window.Modules = window.Modules || {};
window.Modules.plans = function (set) {
  const session = API.session() || {};
  const canWrite = ['doctor', 'admin'].includes(session.role);
  let stage = '', patientId = 0;

  const TOOTH_OPTIONS = (() => {
    const out = [{ value: '', label: '不指定牙位（全口）' }];
    [1, 2, 3, 4].forEach(qd => {
      for (let n = 1; n <= 8; n++) {
        const code = `${qd}${n}`;
        out.push({ value: code, label: `${code} · ${API.toothName(code)}` });
      }
    });
    return out;
  })();

  function render() {
    const db = API.raw();
    const list = API.listPlans({ stage: stage || undefined, patient_id: patientId || undefined });
    set(`
      <div class="page-head">
        <div>
          <div class="page-title">治疗计划</div>
          <div class="page-desc">诊断后按 FDI 牙位与期次制定治疗方案，锁定报价快照，执行时自动触发收费与技工单</div>
        </div>
        ${canWrite ? '<button class="btn" id="pl-add">+ 新建计划</button>' : ''}
      </div>
      <div class="card">
        <div class="note">患者暂缓决定时可保存为「拟定」，确认后转为「执行中」并锁定报价快照（不受后续调价影响）；中途调整方案可将待执行项标记为「已取消」并新增替代项，存在未完成项的计划不可直接关闭。</div>
        <div class="toolbar">
          <div class="field"><label>阶段</label>
            ${App.selectHtml('f-stage', [{ value: '', label: '全部阶段' }, ...window.SEED.ENUM.planStage.map(s => ({ value: s, label: s }))], stage)}</div>
          <div class="field"><label>患者</label>
            ${App.selectHtml('f-patient', [{ value: 0, label: '全部患者' }, ...(db.patients || []).map(p => ({ value: p.id, label: `${p.patient_no} ${p.name}` }))], patientId)}</div>
        </div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>计划编号</th><th>患者</th><th>主治医生</th><th>诊断</th><th>有效进度</th><th>报价快照</th><th>确认时间</th><th>阶段</th><th>操作</th>
        </tr></thead><tbody>
          ${list.length ? list.map(p => {
            const pg = API.planProgress(p.id);
            const pt = (db.patients || []).find(x => x.id == p.patient_id);
            const doc = (db.employees || []).find(x => x.id == p.doctor_id);
            return `<tr>
              <td>${App.esc(p.plan_no)}</td>
              <td>${App.esc(pt ? pt.name : '—')}</td>
              <td>${App.esc(doc ? doc.name : '—')}</td>
              <td>${App.esc(p.diagnosis || '—')}</td>
              <td>${pg.done} / ${pg.total} 项</td>
              <td>¥${Number(p.quoted_amount || pg.amount).toFixed(2)}</td>
              <td class="muted">${App.esc(p.accepted_at ? String(p.accepted_at).slice(0, 16).replace('T', ' ') : '未确认')}</td>
              <td>${App.tag(p.stage)}</td>
              <td class="actions">
                <button class="btn ghost sm" data-open="${p.id}">详情</button>
                ${canWrite && p.stage === '拟定' ? `<button class="btn ghost sm" data-confirm="${p.id}">确认方案</button>` : ''}
                ${canWrite && ['已确认', '执行中'].includes(p.stage) ? `<button class="btn ghost sm" data-close="${p.id}">关闭计划</button>` : ''}
              </td></tr>`;
          }).join('') : '<tr><td colspan="9"><div class="empty">暂无治疗计划</div></td></tr>'}
        </tbody></table></div>
      </div>`);

    const addBtn = document.getElementById('pl-add');
    if (addBtn) addBtn.onclick = createPlan;
    document.getElementById('f-stage').onchange = e => { stage = e.target.value; render(); };
    document.getElementById('f-patient').onchange = e => { patientId = Number(e.target.value); render(); };
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

  function createPlan() {
    const db = API.raw();
    const patients = (db.patients || []).map(p => ({ value: p.id, label: `${p.patient_no} ${p.name}` }));
    const doctors = API.doctors(true).map(e => ({ value: e.id, label: e.name }));
    if (!patients.length || !doctors.length) { App.toast('缺少患者或医生资料', 'err'); return; }
    const defaultDoc = (session.employee_id && doctors.some(d => d.value == session.employee_id))
      ? session.employee_id : doctors[0].value;
    const body = `<div class="form-grid">
      ${App.fieldRow('患者', App.selectHtml('f-p', patients, patients[0].value))}
      ${App.fieldRow('主治医生', App.selectHtml('f-d', doctors, defaultDoc))}
      ${App.fieldRow('初始状态', App.selectHtml('f-st', [
        { value: '拟定', label: '拟定（患者暂缓决定）' },
        { value: '执行中', label: '执行中（患者已确认方案）' },
      ], '拟定'), true)}
      ${App.fieldRow('主诉', '<input id="f-cc" placeholder="患者主诉">', true)}
      ${App.fieldRow('诊断', '<input id="f-dx" placeholder="如：36 牙髓炎">', true)}
    </div>`;
    const m = App.modal('新建治疗计划', body, '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">创建计划</button>');
    m.el.querySelector('#m-c').onclick = m.close;
    m.el.querySelector('#m-s').onclick = async () => {
      const r = await API.createPlan({
        patient_id: Number(m.el.querySelector('#f-p').value),
        doctor_id: Number(m.el.querySelector('#f-d').value),
        chief_complaint: m.el.querySelector('#f-cc').value.trim(),
        diagnosis: m.el.querySelector('#f-dx').value.trim(),
        stage: m.el.querySelector('#f-st').value,
      });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('计划已创建：' + r.data.plan_no, 'ok'); render(); detail(r.data.id);
    };
  }

  function detail(id) {
    const db = API.raw();
    const plan = (db.treatmentPlans || []).find(p => p.id == id);
    if (!plan) return;
    const pg = API.planProgress(id);
    const pt = (db.patients || []).find(x => x.id == plan.patient_id);
    const doc = (db.employees || []).find(x => x.id == plan.doctor_id);
    const isOpen = !['已完成', '已终止'].includes(plan.stage);

    const rows = pg.items.map(i => {
      const order = (db.orders || []).find(o => o.id == i.lab_order_id);
      const enc = (db.encounters || []).find(e => e.id == i.encounter_id);
      return `<tr>
        <td>第 ${i.phase_no} 期</td>
        <td>${i.tooth_code ? `${App.esc(i.tooth_code)} ${App.esc(API.toothName(i.tooth_code))}` : '全口'}</td>
        <td>${App.esc(i.name)}</td>
        <td>${i.quantity} × ¥${Number(i.unit_price).toFixed(2)}</td>
        <td>${App.tag(i.stage)}</td>
        <td class="muted">${enc ? App.esc(enc.encounter_no) : ''}${i.bill_id ? ' · 收费#' + i.bill_id : ''}${order ? ' · ' + App.esc(order.order_no) : ''}</td>
        <td class="actions">
          ${canWrite && isOpen && i.stage === '待执行' ? `
            <button class="btn ghost sm" data-exec="${i.id}">执行</button>
            <button class="btn ghost sm" data-cancel-item="${i.id}">取消项</button>` : ''}
          ${canWrite && i.stage === '已执行' && !i.lab_order_id ? `<button class="btn ghost sm" data-lab="${i.id}">建技工单</button>` : ''}
          ${(!canWrite || i.stage === '已取消' || (i.stage === '已执行' && i.lab_order_id)) ? '—' : ''}
        </td></tr>`;
    }).join('');

    const body = `
      <div class="grid cols-4">
        <div class="kpi"><div class="label">患者</div><div class="value" style="font-size:16px">${App.esc(pt ? pt.name : '—')}</div></div>
        <div class="kpi"><div class="label">主治医生</div><div class="value" style="font-size:16px">${App.esc(doc ? doc.name : '—')}</div></div>
        <div class="kpi"><div class="label">有效进度</div><div class="value">${pg.done}/${pg.total}</div></div>
        <div class="kpi"><div class="label">报价快照</div><div class="value" style="font-size:18px">¥${Number(plan.quoted_amount || pg.amount).toFixed(2)}</div></div>
      </div>
      <table class="tbl" style="margin-top:12px"><tbody>
        <tr><th style="width:100px">主诉 / 诊断</th><td>${App.esc(plan.chief_complaint || '—')} ｜ ${App.esc(plan.diagnosis || '—')}</td></tr>
        <tr><th>阶段 / 确认</th><td>${App.tag(plan.stage)} ${plan.accepted_at ? '· 确认于 ' + App.esc(String(plan.accepted_at).slice(0, 16).replace('T', ' ')) : '（尚未确认）'}</td></tr>
      </tbody></table>
      <p style="margin:14px 0 8px"><b>计划项明细</b></p>
      <div class="table-wrap"><table class="tbl"><thead><tr>
        <th>期次</th><th>FDI 牙位</th><th>项目</th><th>快照单价</th><th>状态</th><th>关联诊疗/单据</th><th>操作</th>
      </tr></thead><tbody>${rows || '<tr><td colspan="7"><div class="empty">暂无计划项</div></td></tr>'}</tbody></table></div>
      ${canWrite && isOpen ? `<div class="toolbar" style="margin-top:12px">
        <button class="btn ghost sm" id="pi-add">+ 添加计划项</button>
        ${plan.stage === '拟定' ? '<button class="btn sm" id="pl-confirm-btn">患者确认方案</button>' : ''}
        <button class="btn ghost sm" id="pl-term-btn">终止计划</button>
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
    const tmBtn = m.el.querySelector('#pl-term-btn');
    if (tmBtn) tmBtn.onclick = async () => {
      const reason = prompt('请输入终止计划的原因', '患者调整治疗意愿');
      if (!reason) return;
      const r = await API.terminatePlan(plan.id, reason);
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      App.toast('治疗计划已终止', 'ok');
      m.close(); detail(plan.id); render();
    };
    m.el.querySelectorAll('[data-cancel-item]').forEach(b => b.onclick = async () => {
      const reason = prompt('中途调整方案：请输入取消该计划项的原因（原项将保留历史）', '方案调整替换');
      if (reason === null) return;
      const r = await API.cancelPlanItem(Number(b.dataset.cancelItem), reason);
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      App.toast('原计划项已标记为已取消并保留历史', 'ok');
      m.close(); detail(plan.id); render();
    });
    m.el.querySelectorAll('[data-exec]').forEach(b => b.onclick = () => execItem(plan, Number(b.dataset.exec), () => { m.close(); detail(plan.id); render(); }));
    m.el.querySelectorAll('[data-lab]').forEach(b => b.onclick = () => labOrderForItem(Number(b.dataset.lab), () => { m.close(); detail(plan.id); render(); }));
  }

  function addItem(plan, done) {
    const db = API.raw();
    const prices = (db.priceItems || []).filter(p => p.active).map(p => ({ value: p.id, label: `${p.name} · ¥${Number(p.unit_price).toFixed(2)}` }));
    const body = `
      ${!prices.length ? '<div class="note warn">当前无可用收费价目，请先维护基础信息。</div>' : ''}
      <div class="form-grid">
        ${App.fieldRow('FDI 牙位', App.selectHtml('f-tooth', TOOTH_OPTIONS, ''))}
        ${App.fieldRow('收费价目（固化单价快照）', App.selectHtml('f-price', prices, prices[0] ? prices[0].value : ''))}
        ${App.fieldRow('期次', '<input id="f-phase" type="number" min="1" value="1">')}
        ${App.fieldRow('数量', '<input id="f-qty" type="number" min="1" step="0.5" value="1">')}
      </div>
      <div style="margin-top:8px;font-size:12px" class="muted">若缺少对应价目：${API.can('basic') ? '<a href="#" id="go-basic">跳转基础信息维护</a>' : '请联系管理员或诊所负责人在「基础信息 → 收费价目」中补充'}</div>`;
    const m = App.modal('添加计划项', body, '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">添加</button>');
    m.el.querySelector('#m-c').onclick = m.close;
    const gb = m.el.querySelector('#go-basic');
    if (gb) gb.onclick = e => { e.preventDefault(); m.close(); App.navigate('basic'); };
    m.el.querySelector('#m-s').onclick = async () => {
      const pid = Number(m.el.querySelector('#f-price').value);
      if (!pid) { App.toast('请选择有效的价目项目', 'err'); return; }
      const r = await API.addPlanItem({
        plan_id: plan.id,
        tooth_code: m.el.querySelector('#f-tooth').value,
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
      App.toast('该患者暂无诊疗记录，请先在「诊疗记录」录入本次诊疗后再执行计划项', 'err');
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
        ${App.fieldRow('是否同步生成义齿技工单草稿', App.selectHtml('ex-lab-on', [{ value: '0', label: '否' }, { value: '1', label: '是（生成草稿）' }], needLabDefault ? '1' : '0'), true)}
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
};
