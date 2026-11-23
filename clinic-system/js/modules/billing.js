/* 收费欠款 F3 / UC-02：收费录入、价目调用、支付结果、欠款查询、收费单追溯 */
window.Modules = window.Modules || {};
window.Modules.billing = function (set) {
  const session = API.session();
  const isPatient = !!session && session.role === 'patient';
  const patientId = session && session.patientId ? Number(session.patientId) : 0;
  let tab = 'bills';

  function render() {
    const db = API.raw();
    let content = '';
    if (tab === 'bills') {
      let bills = API.listBills();
      if (isPatient) bills = bills.filter(b => { const p = API.patientOfBill(b.id); return p && p.id == patientId; });
      content = `${isPatient ? '' : '<div class="toolbar"><button class="btn" id="b-add">+ 录入收费</button></div>'}
        <div class="table-wrap"><table class="tbl"><thead><tr><th>收费单</th><th>患者</th><th>诊疗</th><th>应收</th><th>已收</th><th>欠款</th><th>状态</th><th>操作</th></tr></thead><tbody>
          ${bills.length ? bills.map(b => {
            const c = API.calcBill(b.id);
            const p = API.patientOfBill(b.id);
            const enc = db.encounters.find(e=>e.id==b.encounter_id);
            return `<tr><td>${App.esc(b.bill_no)}</td><td>${App.esc(p?.name||'—')}</td><td>${App.esc(enc?.encounter_no||'')}</td>
              <td>¥${c.receivable.toFixed(2)}</td><td>¥${c.received.toFixed(2)}</td>
              <td style="color:${c.debt>0?'var(--danger)':'var(--success)'};font-weight:600">¥${c.debt.toFixed(2)}</td>
              <td>${App.tag(b.stage)}</td>
              <td class="actions"><button class="btn ghost sm" data-trace="${b.id}">追溯</button> <button class="btn ghost sm" data-pay="${b.id}">支付记录</button></td></tr>`;
          }).join('') : `<tr><td colspan="8"><div class="empty">暂无收费单</div></td></tr>`}
        </tbody></table></div>`;
    } else if (tab === 'debts') {
      const debts = API.listDebts();
      content = `<div class="note warn">BR-03：应收=项目金额-合法折扣，欠款=应收-已收。失败与待确认支付不计入已收（BR-04）。退款后若重新欠款清除结清标记，原支付记录保留。</div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>收费单</th><th>患者</th><th>应收</th><th>有效已收</th><th>欠款余额</th><th>欠款形成</th><th>到期日</th><th>催收备注</th></tr></thead><tbody>
          ${debts.length ? debts.map(d => `<tr><td>${App.esc(d.bill.bill_no)}</td><td>${App.esc(d.patient?.name||'—')}</td>
            <td>¥${d.receivable.toFixed(2)}</td><td>¥${d.received.toFixed(2)}</td>
            <td style="color:var(--danger);font-weight:700">¥${d.debt.toFixed(2)}</td>
            <td>${App.esc(String(d.bill.debt_opened_at||'').slice(0,16))}</td><td>${App.esc(d.bill.due_date||'')}</td>
            <td>${App.esc(d.bill.collection_note||'—')}</td></tr>`).join('') : `<tr><td colspan="8"><div class="empty">当前无欠款</div></td></tr>`}
        </tbody></table></div>`;
    }
    set(`
      <div class="page-head"><div><div class="page-title">收费欠款</div><div class="page-desc">F3 / UC-02 · 收费录入、支付结果、欠款计算与单据追溯</div></div></div>
      <div class="card">
        <div class="tabs">
          ${[['bills','收费单'],['debts','欠款查询']].map(([k,l])=>`<div class="tab ${tab===k?'active':''}" data-tab="${k}">${l}</div>`).join('')}
        </div>
        ${content}
      </div>`);
    bind();
  }

  function bind() {
    document.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => { tab = el.dataset.tab; render(); });
    const add = document.getElementById('b-add');
    if (add) add.onclick = createBill;
    document.querySelectorAll('[data-trace]').forEach(b => b.onclick = () => trace(API.raw().bills.find(x=>x.id==b.dataset.trace)));
    document.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => payments(API.raw().bills.find(x=>x.id==b.dataset.pay)));
  }

  function createBill() {
    const db = API.raw();
    const encs = db.encounters.map(e => {
      const p = db.patients.find(x=>x.id==e.patient_id);
      return { value: e.id, label: `${e.encounter_no} ${p?.name||''}` };
    });
    if (!encs.length) { App.toast('请先录入诊疗记录','err'); return; }
    const priceOpts = API.listOptions('').filter(o=>false); // 价目单独构造
    const priceItems = db.priceItems.filter(p=>p.active);
    const methodOpts = API.listOptions('支付方式').map(o=>({value:o.id,label:o.name}));

    const body = `
      <div class="note">UC-02：提交患者与项目 → 反馈待收费项目与价目 → 确认数量/折扣/方式 → 计算应收已收欠款并保存 → 请求支付 → 记录结果。</div>
      <div class="form-grid">
        ${App.fieldRow('诊疗记录', App.selectHtml('f-enc', encs, encs[0].value))}
        ${App.fieldRow('支付方式', App.selectHtml('f-method', methodOpts, methodOpts[0]?.value))}
        ${App.fieldRow('整单折扣', `<input id="f-discount" type="number" min="0" value="0">`)}
        ${App.fieldRow('到期日', `<input id="f-due" type="date">`)}
      </div>
      <p style="margin:16px 0 8px"><b>收费明细</b> <button class="btn ghost sm" id="add-line">+ 添加项目</button></p>
      <div id="lines"></div>
      <div id="bill-calc" class="note" style="margin-top:12px">应收：¥0.00 ｜ 已收：¥0.00 ｜ 欠款：¥0.00</div>`;
    const m = App.modal('录入收费', body,
      `<button class="btn ghost" id="m-cancel">取消</button><button class="btn" id="m-save">保存收费单</button>`, 'lg');
    m.el.querySelector('#m-cancel').onclick = m.close;

    const linesBox = m.el.querySelector('#lines');
    let lineNo = 0;
    function addLine() {
      lineNo++;
      const id = 'line'+lineNo;
      const row = document.createElement('div');
      row.className = 'form-grid'; row.id = id;
      row.style.borderBottom='1px solid var(--border)'; row.style.paddingBottom='10px'; row.style.marginBottom='10px';
      const itemOpts = priceItems.map(p=>({value:p.id,label:`${p.name} ¥${p.unit_price}`}));
      row.innerHTML =
        App.fieldRow('项目', App.selectHtml(id+'-item', itemOpts, itemOpts[0]?.value, 'data-line-item')) +
        App.fieldRow('数量', `<input id="${id}-qty" type="number" min="0.01" step="0.01" value="1" data-line-qty>`) +
        App.fieldRow('单价', `<input id="${id}-price" type="number" min="0" step="0.01" value="${priceItems[0]?.unit_price||0}" data-line-price>`) +
        App.fieldRow('行折扣', `<input id="${id}-disc" type="number" min="0" step="0.01" value="0" data-line-disc>`);
      linesBox.appendChild(row);
      const itemSel = row.querySelector('[data-line-item]');
      itemSel.onchange = () => {
        const pi = priceItems.find(p=>p.id==itemSel.value);
        if (pi) row.querySelector('[data-line-price]').value = pi.unit_price;
        updateCalc();
      };
      row.querySelectorAll('input').forEach(i => i.oninput = updateCalc);
      updateCalc();
    }
    function collectLines() {
      return Array.from(linesBox.children).map(row => ({
        price_item_id: Number(row.querySelector('[data-line-item]').value),
        item_name: (priceItems.find(p=>p.id==row.querySelector('[data-line-item]').value)||{}).name || '',
        unit: '颗',
        quantity: Number(row.querySelector('[data-line-qty]').value)||0,
        unit_price: Number(row.querySelector('[data-line-price]').value)||0,
        discount_amount: Number(row.querySelector('[data-line-disc]').value)||0,
        dental_order_id: null,
      }));
    }
    function updateCalc() {
      const lines = collectLines();
      const lineSum = lines.reduce((s,l)=>s+(l.quantity*l.unit_price - l.discount_amount),0);
      const disc = Number(m.el.querySelector('#f-discount').value)||0;
      const rec = Math.max(0, lineSum - disc);
      m.el.querySelector('#bill-calc').innerText = `应收：¥${rec.toFixed(2)} ｜ 已收：¥0.00（待支付） ｜ 欠款：¥${rec.toFixed(2)}`;
    }
    m.el.querySelector('#add-line').onclick = addLine;
    m.el.querySelector('#f-discount').oninput = updateCalc;
    addLine();

    m.el.querySelector('#m-save').onclick = async () => {
      const lines = collectLines().filter(l=>l.quantity>0);
      if (!lines.length) { App.toast('至少添加一条有效明细','err'); return; }
      const disc = Number(m.el.querySelector('#f-discount').value)||0;
      const vr = await API.compute.bill(lines, disc);
      if (!vr.ok) { App.toast('服务器金额计算失败：'+(vr.error||''),'err'); return; }
      const r = await API.addBill({
        encounter_id: Number(m.el.querySelector('#f-enc').value),
        discount_amount: disc,
        due_date: m.el.querySelector('#f-due').value || null,
        method_id: Number(m.el.querySelector('#f-method').value),
        lines,
        serverCalc: vr.data,
      });
      if (!r.ok) { App.toast(r.error,'err'); return; }
      m.close(); App.toast(`收费单已保存：${r.data.bill_no}`,'ok'); render();
    };
  }

  function payments(bill) {
    if (!bill) return;
    const c = API.calcBill(bill.id);
    const body = `<div class="note">UC-02：支付结果记录。失败与待确认不计入已收；待确认须用原请求号核对。退款以 refund_of_id 关联原成功收款。</div>
      <p><b>${App.esc(bill.bill_no)}</b> · 应收 ¥${c.receivable.toFixed(2)} · 有效已收 ¥${c.received.toFixed(2)} · 欠款 ¥${c.debt.toFixed(2)}</p>
      <table class="tbl" style="margin-top:10px"><thead><tr><th>请求号</th><th>类型</th><th>金额</th><th>结果</th><th>外部交易号</th><th>时间</th><th>操作</th></tr></thead><tbody>
        ${c.pays.length?c.pays.map(p=>`<tr><td>${App.esc(p.request_no)}</td><td>${App.esc(p.kind)}</td><td>¥${p.amount}</td>
          <td>${App.tag(p.result)}</td><td>${App.esc(p.external_txn_no||'—')}</td><td>${App.esc(p.occurred_at||p.requested_at)}</td>
          <td>${p.result==='待确认'
            ? `<button class="btn ghost sm" data-result="${p.id}">核对结果</button>`
            : (p.kind==='收款' && p.result==='成功'
              ? `<button class="btn ghost sm" data-refund="${p.id}">退款</button>` : '—')}</td></tr>`).join(''):`<tr><td colspan="7"><div class="empty">暂无支付记录</div></td></tr>`}
      </tbody></table>`;
    const m = App.modal('支付记录 · '+bill.bill_no, body, `<button class="btn ghost" id="m-close">关闭</button>`, 'lg');
    m.el.querySelector('#m-close').onclick = () => { m.close(); render(); };
    m.el.querySelectorAll('[data-refund]').forEach(b => b.onclick = () => {
      const pid = Number(b.dataset.refund);
      const src = c.pays.find(x => x.id == pid);
      const refunded = c.pays.filter(x => x.refund_of_id == pid && x.result === '成功')
        .reduce((a, x) => a + Number(x.amount || 0), 0);
      const left = Math.max(0, Number(src.amount || 0) - refunded);
      if (left <= 0) { App.toast('该笔收款已全额退款', 'err'); return; }
      const mm = App.modal('退款', `
        <div class="note">原收款 ¥${Number(src.amount).toFixed(2)}，已退 ¥${refunded.toFixed(2)}，可退 ¥${left.toFixed(2)}。退款累计不得超过原金额。</div>
        <div class="form-grid">
          <div class="field"><label>退款金额</label><input id="f-amt" type="number" min="0" step="0.01" value="${left}"></div>
          <div class="field full"><label>退款原因</label><input id="f-reason" placeholder="如：治疗中止退费"></div>
        </div>`,
        `<button class="btn ghost" id="rf-cancel">取消</button><button class="btn danger" id="rf-save">确认退款</button>`, 'sm');
      mm.el.querySelector('#rf-cancel').onclick = mm.close;
      mm.el.querySelector('#rf-save').onclick = async () => {
        const amt = Number(mm.el.querySelector('#f-amt').value);
        const reason = mm.el.querySelector('#f-reason').value.trim();
        if (!(amt > 0)) { App.toast('退款金额必须大于 0', 'err'); return; }
        if (amt > left) { App.toast('超过可退金额', 'err'); return; }
        const r = await API.refundPayment(pid, amt, reason);
        if (!r.ok) { App.toast(r.error, 'err'); return; }
        mm.close(); m.close(); App.toast('退款已记录', 'ok'); render();
      };
    });
    m.el.querySelectorAll('[data-result]').forEach(b => b.onclick = () => {
      const pid = b.dataset.result;
      const r = App.selectHtml('f-result', ['成功','失败','待确认'], '成功');
      const mm = App.modal('核对支付结果', `<div class="field"><label>结果</label>${r}</div>
        <div class="field"><label>外部交易号</label><input id="f-txn"></div>
        <div class="field"><label>失败原因（失败时）</label><input id="f-fail"></div>`,
        `<button class="btn ghost" id="r-cancel">取消</button><button class="btn" id="r-save">保存</button>`, 'sm');
      mm.el.querySelector('#r-cancel').onclick = mm.close;
      mm.el.querySelector('#r-save').onclick = async () => {
        const result = mm.el.querySelector('#f-result').value;
        const r = result === '成功' || result === '失败'
          ? await API.requestPayment(pid, result)
          : await API.recordPaymentResult(pid, result,
              mm.el.querySelector('#f-txn').value.trim(), mm.el.querySelector('#f-fail').value.trim());
        if (!r.ok) { App.toast(r.error, 'err'); return; }
        mm.close(); m.close(); App.toast('支付服务结果已核对并记录','ok'); render();
      };
    });
  }

  function trace(bill) {
    if (!bill) return;
    const t = API.traceBill(bill.id);
    const body = `
      <div class="grid cols-3">
        <div class="kpi"><div class="label">患者</div><div class="value" style="font-size:16px">${App.esc(t.patient?.name||'—')}</div></div>
        <div class="kpi"><div class="label">诊疗记录</div><div class="value" style="font-size:16px">${App.esc(t.encounter?.encounter_no||'—')}</div></div>
        <div class="kpi"><div class="label">欠款</div><div class="value" style="font-size:16px">¥${t.calc.debt.toFixed(2)}</div></div>
      </div>
      <p style="margin:14px 0 8px"><b>收费明细</b></p>
      <table class="tbl"><thead><tr><th>行</th><th>项目</th><th>数量</th><th>单价</th><th>行折扣</th><th>小计</th></tr></thead><tbody>
        ${t.lines.map(l=>`<tr><td>${l.line_no}</td><td>${App.esc(l.item_name)}</td><td>${l.quantity}</td><td>¥${l.unit_price}</td><td>¥${l.discount_amount}</td><td>¥${(l.quantity*l.unit_price-l.discount_amount).toFixed(2)}</td></tr>`).join('')}
      </tbody></table>
      <p style="margin:14px 0 8px"><b>支付尝试（${t.pays.length}）</b></p>
      <table class="tbl"><thead><tr><th>请求号</th><th>类型</th><th>金额</th><th>结果</th></tr></thead><tbody>
        ${t.pays.map(p=>`<tr><td>${App.esc(p.request_no)}</td><td>${App.esc(p.kind)}</td><td>¥${p.amount}</td><td>${App.tag(p.result)}</td></tr>`).join('')||`<tr><td colspan="4"><div class="empty">无</div></td></tr>`}
      </tbody></table>`;
    App.modal('收费单追溯 · '+bill.bill_no, body, `<button class="btn ghost" id="m-close">关闭</button>`, 'lg');
    document.getElementById('m-close').onclick = () => document.getElementById('modal-root').innerHTML='';
  }

  render();
};
