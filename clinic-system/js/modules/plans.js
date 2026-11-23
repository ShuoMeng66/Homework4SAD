/* 治疗计划 F6：以计划项为锚点组织收费、技工单与执行记录
 * 一颗牙的多次治疗由此连成一条线，患者"还要来几次"才有答案 */
window.Modules = window.Modules || {};
window.Modules.plans = function (set) {
  let stage = '', patientId = 0;

  const TOOTH_OPTIONS = (() => {
    const out = [{ value: '', label: '不指定牙位（全口）' }];
    [1, 2, 3, 4].forEach(qd => {
      for (let n = 1; n <= 8; n++) {
        const code = String(qd) + String(n);
        out.push({ value: code, label: `${code} · ${API.toothName(code)}` });
      }
    });
    return out;
  })();

  function render() {
    const db = API.raw();
    let list = API.listPlans({ stage: stage || undefined, patient_id: patientId || undefined });
    set(`
      <div class="page-head"><div>
        <div class="page-title">治疗计划</div>
        <div class="page-desc">F6 · 诊断后制定分期计划，执行时产生收费与技工单</div>
      </div><button class="btn" id="pl-add">+ 新建计划</button></div>

      <div class="card">
        <div class="note">计划项是收费单、技工单与就诊执行记录的共同锚点。一颗牙的根管分三次做完，仍然是同一条计划下的三个执行时点；报价在计划确认时快照，后续价目调整不影响已确认计划。</div>
        <div class="toolbar">
          <div class="field"><label>阶段</label>
            ${App.selectHtml('f-stage', [{ value: '', label: '全部' },
              ...window.SEED.ENUM.planStage.map(s => ({ value: s, label: s }))], stage)}</div>
          <div class="field"><label>患者</label>
            ${App.selectHtml('f-patient', [{ value: 0, label: '全部患者' },
              ...db.patients.map(p => ({ value: p.id, label: `${p.patient_no} ${p.name}` }))], patientId)}</div>
        </div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>计划编号</th><th>患者</th><th>诊断</th><th>进度</th><th>报价</th><th>阶段</th><th>操作</th>
        </tr></thead><tbody>
          ${list.length ? list.map(p => {
            const pg = API.planProgress(p.id);
            const pt = db.patients.find(x => x.id == p.patient_id);
            return `<tr><td>${App.esc(p.plan_no)}</td><td>${App.esc(pt ? pt.name : '')}</td>
              <td>${App.esc(p.diagnosis || '')}</td>
              <td>${pg.done}/${pg.total} 项</td>
              <td>¥${pg.amount.toFixed(0)}</td>
              <td>${App.tag(p.stage)}</td>
              <td class="actions"><button class="btn ghost sm" data-open="${p.id}">详情</button>
                ${p.stage === '执行中' || p.stage === '已确认'
                  ? `<button class="btn ghost sm" data-close="${p.id}">关闭</button>` : ''}</td></tr>`;
          }).join('') : `<tr><td colspan="7"><div class="empty">暂无计划</div></td></tr>`}
        </tbody></table></div>
      </div>`);

    document.getElementById('pl-add').onclick = createPlan;
    document.getElementById('f-stage').onchange = e => { stage = e.target.value; render(); };
    document.getElementById('f-patient').onchange = e => { patientId = Number(e.target.value); render(); };
    document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => detail(Number(b.dataset.open)));
    document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => {
      const r = API.closePlan(Number(b.dataset.close));
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      App.toast('计划已关闭', 'ok'); render();
    });
  }

  function createPlan() {
    const db = API.raw();
    const patients = db.patients.map(p => ({ value: p.id, label: `${p.patient_no} ${p.name}` }));
    const doctors = db.employees.filter(e => e.role === 'doctor' && e.active)
      .map(e => ({ value: e.id, label: e.name }));
    if (!patients.length || !doctors.length) { App.toast('缺少患者或医生', 'err'); return; }
    const body = `<div class="form-grid">
      ${App.fieldRow('患者', App.selectHtml('f-p', patients, patients[0].value))}
      ${App.fieldRow('主治医生', App.selectHtml('f-d', doctors, doctors[0].value))}
      ${App.fieldRow('主诉', `<input id="f-cc" placeholder="患者自述">`, true)}
      ${App.fieldRow('诊断', `<input id="f-dx" placeholder="如：36 牙髓炎">`, true)}
    </div>`;
    const m = App.modal('新建治疗计划', body,
      `<button class="btn ghost" id="m-cancel">取消</button><button class="btn" id="m-save">创建</button>`);
    m.el.querySelector('#m-cancel').onclick = m.close;
    m.el.querySelector('#m-save').onclick = () => {
      const plan = API.createPlan({
        patient_id: Number(m.el.querySelector('#f-p').value),
        doctor_id: Number(m.el.querySelector('#f-d').value),
        chief_complaint: m.el.querySelector('#f-cc').value.trim(),
        diagnosis: m.el.querySelector('#f-dx').value.trim(),
        stage: '执行中',
      });
      m.close(); App.toast('计划已创建：' + plan.plan_no, 'ok');
      render(); detail(plan.id);
    };
  }

  function detail(id) {
    const plan = API.planOf(id);
    if (!plan) return;
    const db = API.raw();
    const pg = API.planProgress(id);
    const pt = db.patients.find(x => x.id == plan.patient_id);
    const doc = db.employees.find(x => x.id == plan.doctor_id);

    const rows = pg.items.map(i => {
      const v = API.planItemView(i);
      const order = db.orders.find(o => o.id == i.lab_order_id);
      const bill = db.bills.find(b => b.id == i.bill_id);
      return `<tr>
        <td>第 ${i.phase_no} 期</td>
        <td>${i.tooth_code ? App.esc(i.tooth_code) + ' ' + App.esc(API.toothName(i.tooth_code)) : '—'}</td>
        <td>${App.esc(i.name)}</td>
        <td>${i.quantity} × ¥${Number(i.unit_price).toFixed(0)}</td>
        <td>${App.tag(v.label)}</td>
        <td class="muted">${bill ? App.esc(bill.bill_no) : ''} ${order ? App.esc(order.order_no) : ''}</td>
        <td class="actions">${i.stage === '待执行'
          ? `<button class="btn ghost sm" data-exec="${i.id}">标记执行</button>` : '—'}</td>
      </tr>`;
    }).join('');

    const body = `
      <div class="grid cols-4">
        <div class="kpi"><div class="label">患者</div><div class="value" style="font-size:17px">${App.esc(pt ? pt.name : '')}</div></div>
        <div class="kpi"><div class="label">主治</div><div class="value" style="font-size:17px">${App.esc(doc ? doc.name : '')}</div></div>
        <div class="kpi"><div class="label">进度</div><div class="value">${pg.done}/${pg.total}</div></div>
        <div class="kpi"><div class="label">报价</div><div class="value" style="font-size:20px">¥${pg.amount.toFixed(0)}</div></div>
      </div>
      <table class="tbl" style="margin-top:14px"><tbody>
        <tr><th style="width:96px">主诉</th><td>${App.esc(plan.chief_complaint || '—')}</td></tr>
        <tr><th>诊断</th><td>${App.esc(plan.diagnosis || '—')}</td></tr>
        <tr><th>阶段</th><td>${App.tag(plan.stage)}</td></tr>
      </tbody></table>

      <p style="margin:16px 0 8px"><b>计划项</b></p>
      <div class="table-wrap"><table class="tbl"><thead><tr>
        <th>期次</th><th>牙位</th><th>项目</th><th>金额</th><th>状态</th><th>关联单号</th><th>操作</th>
      </tr></thead><tbody>${rows || '<tr><td colspan="7"><div class="empty">还没有计划项</div></td></tr>'}</tbody></table></div>
      <div style="margin-top:12px"><button class="btn ghost sm" id="pi-add">+ 添加计划项</button></div>`;

    const m = App.modal('治疗计划 · ' + plan.plan_no, body,
      `<button class="btn ghost" id="m-close">关闭</button>`, 'lg');
    m.el.querySelector('#m-close').onclick = m.close;
    m.el.querySelector('#pi-add').onclick = () => addItem(plan, () => { m.close(); detail(plan.id); });
    m.el.querySelectorAll('[data-exec]').forEach(b => b.onclick = () => {
      const r = API.executePlanItem(Number(b.dataset.exec));
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      App.toast('已标记执行', 'ok');
      m.close(); detail(plan.id); render();
    });
  }

  function addItem(plan, done) {
    const db = API.raw();
    const prices = db.priceItems.filter(p => p.active)
      .map(p => ({ value: p.id, label: `${p.name} · ¥${p.unit_price}` }));
    const body = `<div class="form-grid">
      ${App.fieldRow('牙位', App.selectHtml('f-tooth', TOOTH_OPTIONS, ''))}
      ${App.fieldRow('项目', App.selectHtml('f-price', prices, prices[0] ? prices[0].value : ''))}
      ${App.fieldRow('期次', `<input id="f-phase" type="number" min="1" value="1">`)}
      ${App.fieldRow('数量', `<input id="f-qty" type="number" min="1" value="1">`)}
    </div>`;
    const m = App.modal('添加计划项', body,
      `<button class="btn ghost" id="m-cancel">取消</button><button class="btn" id="m-save">添加</button>`);
    m.el.querySelector('#m-cancel').onclick = m.close;
    m.el.querySelector('#m-save').onclick = () => {
      const price = db.priceItems.find(x => x.id == m.el.querySelector('#f-price').value);
      if (!price) { App.toast('请选择项目', 'err'); return; }
      API.addPlanItem({
        plan_id: plan.id,
        tooth_code: m.el.querySelector('#f-tooth').value,
        price_item_id: price.id,
        name: price.name,
        quantity: Number(m.el.querySelector('#f-qty').value) || 1,
        unit_price: Number(price.unit_price) || 0,
        phase_no: Number(m.el.querySelector('#f-phase').value) || 1,
      });
      App.toast('计划项已添加', 'ok');
      m.close(); if (done) done();
    };
  }

  render();
};
