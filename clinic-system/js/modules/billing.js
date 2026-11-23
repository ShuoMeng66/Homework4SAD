/* 收费欠款（UC-02）：收费录入、价目固化、订单关联、分次支付/重付、退款重算、催收备注、作废单据与凭证打印 */
window.Modules = window.Modules || {};
window.Modules.billing = function (set) {
  const session = API.session() || {};
  const isPatient = session.role === 'patient';
  const canWrite = ['cashier', 'admin'].includes(session.role);
  let tab = 'bills';

  function render() {
    const db = API.raw();
    const bills = db.bills || [];
    let content = '';

    if (isPatient || tab === 'bills') {
      const feeSum = bills.reduce((a, b) => {
        if (b.stage === '已作废') return a;
        a.rec += Number(b.receivable || 0);
        a.paid += Number(b.received || 0);
        a.debt += Number(b.debt || 0);
        return a;
      }, { rec: 0, paid: 0, debt: 0 });

      content = `
        ${isPatient ? `<div class="grid cols-3" style="margin-bottom:14px">
          <div class="kpi"><div class="label">累计应收</div><div class="value" style="font-size:20px">¥${feeSum.rec.toFixed(2)}</div></div>
          <div class="kpi"><div class="label">已付金额</div><div class="value" style="font-size:20px">¥${feeSum.paid.toFixed(2)}</div></div>
          <div class="kpi"><div class="label">当前欠款</div><div class="value" style="font-size:20px;color:${feeSum.debt > 0 ? 'var(--danger)' : 'var(--success)'}">¥${feeSum.debt.toFixed(2)}</div></div>
        </div>` : ''}
        ${canWrite ? '<div class="toolbar"><button class="btn" id="b-add">+ 录入收费</button></div>' : ''}
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>收费单号</th>${isPatient ? '' : '<th>患者</th>'}<th>诊疗编号</th><th>开单时间</th>
          <th>应收</th><th>有效已收</th><th>欠款</th><th>状态</th><th>操作</th>
        </tr></thead><tbody>
          ${bills.length ? bills.map(b => {
            const p = API.patientOfBill(b.id);
            const enc = (db.encounters || []).find(e => e.id == b.encounter_id);
            const debt = Number(b.debt || 0);
            const hasActivePay = API.payments(b.id).some(x => ['成功', '待确认'].includes(x.result));
            return `<tr>
              <td>${App.esc(b.bill_no)}</td>
              ${isPatient ? '' : `<td>${App.esc(p ? p.name : '—')}</td>`}
              <td>${App.esc(enc ? enc.encounter_no : '—')}</td>
              <td>${App.esc(String(b.issued_at || '').slice(0, 16).replace('T', ' '))}</td>
              <td>¥${Number(b.receivable || 0).toFixed(2)}</td>
              <td>¥${Number(b.received || 0).toFixed(2)}</td>
              <td style="color:${debt > 0 ? 'var(--danger)' : 'var(--success)'};font-weight:600">¥${debt.toFixed(2)}</td>
              <td>${App.tag(b.stage)}</td>
              <td class="actions">
                <button class="btn ghost sm" data-trace="${b.id}">${isPatient ? '明细' : '追溯'}</button>
                <button class="btn ghost sm" data-pay="${b.id}">支付记录</button>
                ${canWrite && b.stage === '欠款中' && !hasActivePay ? `<button class="btn ghost sm" data-disc="${b.id}">整单折扣</button>` : ''}
                <button class="btn ghost sm" data-print="${b.id}">凭证</button>
                ${canWrite && b.stage !== '已作废' ? `<button class="btn ghost sm" data-void="${b.id}">作废</button>` : ''}
              </td></tr>`;
          }).join('') : `<tr><td colspan="${isPatient ? 8 : 9}"><div class="empty">暂无收费记录</div></td></tr>`}
        </tbody></table></div>`;
    } else if (tab === 'debts' && !isPatient) {
      const debts = bills.filter(b => b.stage !== '已作废' && Number(b.debt || 0) > 0);
      content = `
        <div class="note warn">欠款余额由数据库视图实时汇总（应收 = 各行小计之和 − 整单折扣；有效已收 = 成功收款 − 成功退款；失败、待确认支付与已作废收费单均不计入）。</div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>收费单号</th><th>患者</th><th>应收</th><th>有效已收</th><th>欠款余额</th><th>欠款形成</th><th>约定到期日</th><th>催收备注</th><th>操作</th>
        </tr></thead><tbody>
          ${debts.length ? debts.map(b => {
            const p = API.patientOfBill(b.id);
            return `<tr>
              <td>${App.esc(b.bill_no)}</td>
              <td>${App.esc(p ? p.name : '—')}</td>
              <td>¥${Number(b.receivable).toFixed(2)}</td>
              <td>¥${Number(b.received).toFixed(2)}</td>
              <td style="color:var(--danger);font-weight:700">¥${Number(b.debt).toFixed(2)}</td>
              <td>${App.esc(String(b.debt_opened_at || '').slice(0, 16).replace('T', ' '))}</td>
              <td>${App.esc(b.due_date || '—')}</td>
              <td>${App.esc(b.collection_note || '—')}</td>
              <td class="actions">
                ${canWrite ? `<button class="btn ghost sm" data-coll="${b.id}">催收备注</button> <button class="btn ghost sm" data-pay="${b.id}">收款/核对</button>` : `<button class="btn ghost sm" data-trace="${b.id}">追溯</button>`}
              </td></tr>`;
          }).join('') : '<tr><td colspan="9"><div class="empty">当前无未结清欠款</div></td></tr>'}
        </tbody></table></div>`;
    }

    set(`
      <div class="page-head"><div>
        <div class="page-title">${isPatient ? '我的费用' : '收费欠款'}</div>
        <div class="page-desc">${isPatient ? '仅展示本人费用明细与待付欠款' : '收费录入、价目快照、分次收款、支付核对、退款、欠款催收与凭证输出'}</div>
      </div></div>
      <div class="card">
        ${isPatient ? '' : `<div class="tabs">
          ${[['bills', '收费单'], ['debts', '欠款查询']].map(([k, l]) => `<div class="tab ${tab === k ? 'active' : ''}" data-tab="${k}">${l}</div>`).join('')}
        </div>`}
        ${content}
      </div>`);

    bind();
  }

  function bind() {
    document.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => { tab = el.dataset.tab; render(); });
    const add = document.getElementById('b-add');
    if (add) add.onclick = createBill;
    const db = API.raw();
    document.querySelectorAll('[data-trace]').forEach(b => b.onclick = () => trace(db.bills.find(x => x.id == b.dataset.trace)));
    document.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => paymentsModal(db.bills.find(x => x.id == b.dataset.pay)));
    document.querySelectorAll('[data-disc]').forEach(b => b.onclick = () => applyDiscountModal(db.bills.find(x => x.id == b.dataset.disc)));
    document.querySelectorAll('[data-print]').forEach(b => b.onclick = () => printReceipt(db.bills.find(x => x.id == b.dataset.print)));
    document.querySelectorAll('[data-coll]').forEach(b => b.onclick = () => editCollection(db.bills.find(x => x.id == b.dataset.coll)));
    document.querySelectorAll('[data-void]').forEach(b => b.onclick = () => voidBill(db.bills.find(x => x.id == b.dataset.void)));
  }

  function applyDiscountModal(bill) {
    if (!bill) return;
    const m = App.modal('录入整单折扣 · ' + bill.bill_no, `
      <div class="note">当前行金额合计 ¥${Number(bill.line_sum || bill.receivable).toFixed(2)}。合法折扣须填写原因并记入变更审计，已有成功或待确认支付后不可修改。</div>
      <div class="form-grid">
        ${App.fieldRow('整单折扣金额', `<input id="d-amt" type="number" min="0" max="${Number(bill.line_sum || bill.receivable)}" step="0.01" value="${Number(bill.discount_amount || 0)}">`)}
        ${App.fieldRow('折扣原因（折扣 > 0 时必填）', `<input id="d-reason" value="${App.esc(bill.discount_reason || '')}" placeholder="如：会员活动优惠 / 老患者减免">`, true)}
      </div>`,
      '<button class="btn ghost" id="d-c">取消</button><button class="btn" id="d-s">保存折扣</button>', 'sm');
    m.el.querySelector('#d-c').onclick = m.close;
    m.el.querySelector('#d-s').onclick = async () => {
      const amt = Number(m.el.querySelector('#d-amt').value) || 0;
      const reason = m.el.querySelector('#d-reason').value.trim();
      if (amt > 0 && !reason) { App.toast('使用整单折扣时必须填写折扣原因', 'err'); return; }
      const r = await API.applyBillDiscount({ id: bill.id, discount_amount: amt, discount_reason: reason });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('整单折扣已保存并重算欠款', 'ok'); render();
    };
  }

  function createBill() {
    const db = API.raw();
    const encs = (db.encounters || []).map(e => {
      const p = (db.patients || []).find(x => x.id == e.patient_id);
      return { value: e.id, label: `${e.encounter_no} · ${p ? p.name : ''} · ${e.diagnosis || e.chief_complaint}` };
    });
    if (!encs.length) { App.toast('请先由医生录入诊疗记录', 'err'); return; }
    const priceItems = (db.priceItems || []).filter(p => p.active);
    if (!priceItems.length) { App.toast('当前无有效价目，请交主管核对基础信息', 'err'); return; }
    const methodOpts = API.listOptions('支付方式').map(o => ({ value: o.id, label: o.name }));
    const unbilledPlanItems = (db.planItems || []).filter(i => i.stage === '已执行' && !i.bill_id && i.encounter_id);
    const planItemOpts = [{ value: '', label: '不关联计划项（按现行价目表开单）' }].concat(
      unbilledPlanItems.map(i => {
        const enc = (db.encounters || []).find(e => e.id == i.encounter_id);
        return { value: i.id, label: `${enc ? enc.encounter_no + ' · ' : ''}${i.name}（锁定快照 ¥${Number(i.unit_price).toFixed(2)} × ${i.quantity}）` };
      })
    );

    const body = `
      <div class="note">系统自动加载权威价目单价（或已执行计划项锁定报价快照）以防绕过折扣审计；如需优惠请填写行折扣或整单折扣与原因；未找到对应项目时请联系主管核对价目表。</div>
      <div class="form-grid">
        ${unbilledPlanItems.length ? App.fieldRow('补开已执行计划项（选填）', App.selectHtml('f-plan-item', planItemOpts, ''), true) : ''}
        ${App.fieldRow('关联诊疗记录', App.selectHtml('f-enc', encs, encs[0].value), true)}
        ${App.fieldRow('支付方式', App.selectHtml('f-method', methodOpts, methodOpts[0] ? methodOpts[0].value : ''))}
        ${App.fieldRow('本次发起支付金额（留空默认全额）', '<input id="f-init-pay" type="number" min="0" step="0.01" placeholder="支持部分首付/分次收款">')}
        ${App.fieldRow('整单折扣', '<input id="f-discount" type="number" min="0" step="0.01" value="0">')}
        ${App.fieldRow('折扣原因（有整单折扣时必填）', '<input id="f-disc-reason" placeholder="如：会员优惠 / 复诊减免">')}
        ${App.fieldRow('约定到期日', `<input id="f-due" type="date" value="${API.localToday(7)}">`)}
      </div>
      <p style="margin:14px 0 8px"><b>收费明细</b> <button class="btn ghost sm" type="button" id="add-line">+ 添加项目</button></p>
      <div id="lines"></div>
      <div id="bill-calc" class="note" style="margin-top:10px">应收：¥0.00 ｜ 欠款：¥0.00</div>`;

    const m = App.modal('录入收费单', body,
      '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">保存并生成待确认支付</button>', 'lg');
    m.el.querySelector('#m-c').onclick = m.close;

    const linesBox = m.el.querySelector('#lines');
    const encSel = m.el.querySelector('#f-enc');
    const piSel = m.el.querySelector('#f-plan-item');
    let lineSeq = 0;

    function ordersForCurrentEnc() {
      const eid = Number(encSel.value);
      return [{ value: '', label: '不关联义齿订单' }].concat(
        (db.orders || []).filter(o => o.encounter_id == eid).map(o => ({ value: o.id, label: `${o.order_no}（${o.stage}）` }))
      );
    }

    function addLine(preset = null) {
      lineSeq++;
      const id = 'ln' + lineSeq;
      const row = document.createElement('div');
      row.className = 'form-grid';
      row.style.cssText = 'border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:10px';
      const allPriceMap = (db.priceItems || []);
      const itemOpts = priceItems.map(p => ({ value: p.id, label: `${p.name}（¥${p.unit_price}/${API.optionName(p.unit_id)}）` }));
      if (preset && preset.price_item_id && !itemOpts.some(o => o.value == preset.price_item_id)) {
        const inactive = allPriceMap.find(p => p.id == preset.price_item_id);
        if (inactive) itemOpts.unshift({ value: inactive.id, label: `${inactive.name}（快照 ¥${preset.unit_price}）` });
      }
      const defItem = (preset && preset.price_item_id) ? preset.price_item_id : itemOpts[0].value;
      const defPrice = (preset && preset.unit_price != null) ? preset.unit_price : priceItems[0].unit_price;
      const defQty = (preset && preset.quantity) ? preset.quantity : 1;
      const defOrd = (preset && preset.dental_order_id) ? preset.dental_order_id : '';
      row.innerHTML =
        App.fieldRow('收费项目', App.selectHtml(id + '-item', itemOpts, defItem, 'data-line-item')) +
        App.fieldRow('关联同次诊疗义齿订单', App.selectHtml(id + '-ord', ordersForCurrentEnc(), defOrd, 'data-line-ord')) +
        App.fieldRow('数量', `<input id="${id}-qty" type="number" min="0.01" step="0.01" value="${defQty}" data-line-qty>`) +
        App.fieldRow('权威单价（只读）', `<input id="${id}-price" type="number" value="${defPrice}" readonly data-line-price style="background:var(--bg)">`) +
        App.fieldRow('行折扣', `<input id="${id}-disc" type="number" min="0" step="0.01" value="0" data-line-disc>`) +
        App.fieldRow('备注', `<input id="${id}-desc" value="${App.esc((preset && preset.description) || '')}" placeholder="选填" data-line-desc>`);
      linesBox.appendChild(row);
      const itemSel = row.querySelector('[data-line-item]');
      itemSel.onchange = () => {
        const pi = allPriceMap.find(p => p.id == itemSel.value);
        if (pi) row.querySelector('[data-line-price]').value = pi.unit_price;
        updateCalc();
      };
      row.querySelectorAll('input').forEach(i => i.oninput = updateCalc);
      updateCalc();
    }

    encSel.onchange = () => {
      const ordOpts = ordersForCurrentEnc();
      linesBox.querySelectorAll('[data-line-ord]').forEach(sel => {
        sel.innerHTML = ordOpts.map(o => `<option value="${App.esc(o.value)}">${App.esc(o.label)}</option>`).join('');
      });
    };

    if (piSel) {
      piSel.onchange = () => {
        const piId = Number(piSel.value);
        if (!piId) return;
        const item = unbilledPlanItems.find(x => x.id == piId);
        if (!item) return;
        encSel.value = item.encounter_id;
        linesBox.innerHTML = '';
        addLine({
          price_item_id: item.price_item_id,
          unit_price: item.unit_price,
          quantity: item.quantity,
          dental_order_id: item.lab_order_id || '',
          description: item.tooth_code ? `牙位 ${item.tooth_code}` : '',
        });
      };
    }

    function collectLines() {
      return Array.from(linesBox.children).map(row => ({
        price_item_id: Number(row.querySelector('[data-line-item]').value),
        dental_order_id: row.querySelector('[data-line-ord]').value ? Number(row.querySelector('[data-line-ord]').value) : null,
        quantity: Number(row.querySelector('[data-line-qty]').value) || 0,
        unit_price: Number(row.querySelector('[data-line-price]').value) || 0,
        discount_amount: Number(row.querySelector('[data-line-disc]').value) || 0,
        description: row.querySelector('[data-line-desc]').value.trim(),
      }));
    }

    function updateCalc() {
      const ls = collectLines();
      const lineSum = ls.reduce((s, l) => s + (l.quantity * l.unit_price - l.discount_amount), 0);
      const disc = Number(m.el.querySelector('#f-discount').value) || 0;
      const rec = Math.max(0, lineSum - disc);
      m.el.querySelector('#bill-calc').textContent = `行合计：¥${lineSum.toFixed(2)} ｜ 应收：¥${rec.toFixed(2)} ｜ 待核对支付后重算欠款`;
    }

    m.el.querySelector('#add-line').onclick = () => addLine();
    m.el.querySelector('#f-discount').oninput = updateCalc;
    addLine();

    m.el.querySelector('#m-s').onclick = async () => {
      const ls = collectLines();
      const disc = Number(m.el.querySelector('#f-discount').value) || 0;
      const discReason = m.el.querySelector('#f-disc-reason').value.trim();
      if (disc > 0 && !discReason) { App.toast('使用整单折扣时必须填写折扣原因', 'err'); return; }
      const initPayRaw = m.el.querySelector('#f-init-pay').value.trim();
      const r = await API.createBill({
        encounter_id: Number(encSel.value),
        plan_item_id: piSel && piSel.value ? Number(piSel.value) : null,
        method_id: Number(m.el.querySelector('#f-method').value),
        discount_amount: disc,
        discount_reason: discReason,
        due_date: m.el.querySelector('#f-due').value || null,
        initial_pay_amount: initPayRaw === '' ? null : Number(initPayRaw),
        lines: ls,
      });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast(`收费单已保存：${r.data.bill_no}`, 'ok'); render();
    };
  }

  function paymentsModal(bill) {
    if (!bill) return;
    const pays = API.payments(bill.id);
    const debt = Number(bill.debt || 0);
    const body = `
      <div class="note">银行卡号等敏感信息由第三方支付托管，本系统仅存外部交易号与支付结果。失败与待确认支付不计入已收；支持分次收款与支付失败后重试。</div>
      <div class="toolbar">
        <span><b>${App.esc(bill.bill_no)}</b> · 应收 ¥${Number(bill.receivable).toFixed(2)} · 有效已收 ¥${Number(bill.received).toFixed(2)} · 欠款 <b style="color:${debt > 0 ? 'var(--danger)' : 'var(--success)'}">¥${debt.toFixed(2)}</b></span>
        ${canWrite && bill.stage !== '已作废' && debt > 0 ? '<button class="btn sm" id="p-new" style="margin-left:auto">+ 发起新支付 / 补缴</button>' : ''}
      </div>
      <table class="tbl"><thead><tr>
        <th>请求号</th><th>类型</th><th>方式</th><th>金额</th><th>结果</th><th>外部交易号</th><th>核对/说明</th>${canWrite ? '<th>操作</th>' : ''}
      </tr></thead><tbody>
        ${pays.length ? pays.map(p => `<tr>
          <td>${App.esc(p.request_no || '—')}</td>
          <td>${App.esc(p.kind)}</td>
          <td>${App.esc(API.optionName(p.method_id))}</td>
          <td>¥${Number(p.amount).toFixed(2)}</td>
          <td>${App.tag(p.result)}</td>
          <td class="muted">${App.esc(p.external_txn_no || '—')}</td>
          <td class="muted">${App.esc(p.failure_reason || (p.occurred_at ? String(p.occurred_at).slice(0, 16).replace('T', ' ') : '处理中'))}</td>
          ${canWrite ? `<td class="actions">
            ${p.result === '待确认' ? `<button class="btn ghost sm" data-verify="${p.id}">核对结果</button>` : ''}
            ${p.kind === '收款' && p.result === '成功' ? `<button class="btn ghost sm" data-refund="${p.id}">退款</button>` : ''}
            ${p.result !== '待确认' && !(p.kind === '收款' && p.result === '成功') ? '—' : ''}
          </td>` : ''}
        </tr>`).join('') : `<tr><td colspan="${canWrite ? 8 : 7}"><div class="empty">暂无支付尝试记录</div></td></tr>`}
      </tbody></table>`;

    const m = App.modal('支付记录 · ' + bill.bill_no, body, '<button class="btn ghost" id="m-c">关闭</button>', 'lg');
    m.el.querySelector('#m-c').onclick = () => { m.close(); render(); };

    const newBtn = m.el.querySelector('#p-new');
    if (newBtn) {
      newBtn.onclick = () => {
        const pendingSum = pays.filter(x => x.kind === '收款' && x.result === '待确认')
          .reduce((s, x) => s + Number(x.amount || 0), 0);
        const avail = Math.max(0, Number((debt - pendingSum).toFixed(2)));
        if (avail <= 0) {
          App.toast(`当前已有 ¥${pendingSum.toFixed(2)} 待确认支付请求，请先凭原请求号核对结果后再决定是否重试`, 'err');
          return;
        }
        const methods = API.listOptions('支付方式').map(o => ({ value: o.id, label: o.name }));
        const pm = App.modal('发起新支付 / 分次补缴', `
          <div class="note">当前未结清欠款 ¥${debt.toFixed(2)}${pendingSum > 0 ? `（另有待确认支付 ¥${pendingSum.toFixed(2)}，本次可发起上限 ¥${avail.toFixed(2)}）` : ''}，可输入部分或全部金额发起新支付请求。</div>
          <div class="form-grid">
            ${App.fieldRow('支付方式', App.selectHtml('np-method', methods, methods[0] ? methods[0].value : ''))}
            ${App.fieldRow('本次支付金额', `<input id="np-amt" type="number" min="0.01" max="${avail}" step="0.01" value="${avail.toFixed(2)}">`)}
          </div>`,
          '<button class="btn ghost" id="np-c">取消</button><button class="btn" id="np-s">发起支付请求</button>', 'sm');
        pm.el.querySelector('#np-c').onclick = pm.close;
        pm.el.querySelector('#np-s').onclick = async () => {
          const r = await API.createPayment({
            bill_id: bill.id,
            method_id: Number(pm.el.querySelector('#np-method').value),
            amount: Number(pm.el.querySelector('#np-amt').value),
          });
          if (!r.ok) { App.toast(r.error, 'err'); return; }
          pm.close(); m.close(); App.toast(`已生成支付请求 ${r.data.request_no}`, 'ok');
          render();
          paymentsModal((API.raw().bills || []).find(x => x.id == bill.id));
        };
      };
    }

    m.el.querySelectorAll('[data-verify]').forEach(b => b.onclick = () => {
      const pid = Number(b.dataset.verify);
      const pay = pays.find(x => x.id == pid) || {};
      const vm = App.modal('凭原请求号核对支付结果', `
        <div class="note">原请求号：<b>${App.esc(pay.request_no || '—')}</b>（金额 ¥${Number(pay.amount || 0).toFixed(2)}）。支付处理中应凭原请求号向支付服务查单确认，禁止直接发起重复扣款。</div>
        <div class="form-grid">
          ${App.fieldRow('支付服务返回结果', App.selectHtml('vr-res', ['成功', '失败', '待确认'], '成功'), true)}
          ${App.fieldRow('外部交易号（成功时选填，留空自动生成）', '<input id="vr-txn" placeholder="第三方支付流水号">', true)}
          ${App.fieldRow('失败原因（失败时填写）', '<input id="vr-fail" placeholder="如：余额不足或超时">', true)}
        </div>`,
        '<button class="btn ghost" id="vr-c">取消</button><button class="btn ghost" id="vr-q" type="button">凭原请求号查单（确认成功）</button><button class="btn" id="vr-s">确认核对</button>', 'sm');
      vm.el.querySelector('#vr-c').onclick = vm.close;
      async function submitVerify(resVal, txnVal, failVal) {
        const r = await API.verifyPayment({
          id: pid, result: resVal, external_txn_no: txnVal, failure_reason: failVal,
        });
        if (!r.ok) { App.toast(r.error, 'err'); return; }
        vm.close(); m.close(); App.toast('支付结果已核对并重算欠款', 'ok');
        render();
        paymentsModal((API.raw().bills || []).find(x => x.id == bill.id));
      }
      vm.el.querySelector('#vr-q').onclick = () => submitVerify('成功', `QRY-${pay.request_no || pid}-${Date.now().toString().slice(-4)}`, '');
      vm.el.querySelector('#vr-s').onclick = () => submitVerify(
        vm.el.querySelector('#vr-res').value,
        vm.el.querySelector('#vr-txn').value.trim(),
        vm.el.querySelector('#vr-fail').value.trim()
      );
    });

    m.el.querySelectorAll('[data-refund]').forEach(b => b.onclick = () => {
      const pid = Number(b.dataset.refund);
      const src = pays.find(x => x.id == pid);
      const refunded = pays.filter(x => x.refund_of_id == pid && x.result === '成功')
        .reduce((s, x) => s + Number(x.amount || 0), 0);
      const left = Math.max(0, Number(src.amount) - refunded);
      if (left <= 0) { App.toast('该笔收款已全额退款', 'err'); return; }
      const rm = App.modal('发起退款', `
        <div class="note">原成功收款 ¥${Number(src.amount).toFixed(2)}，已退 ¥${refunded.toFixed(2)}，可退上限 ¥${left.toFixed(2)}。若退款后产生欠款将自动清空结清标记并保留原支付流水。</div>
        <div class="form-grid">
          ${App.fieldRow('退款金额', `<input id="rf-amt" type="number" min="0.01" max="${left}" step="0.01" value="${left.toFixed(2)}">`)}
          ${App.fieldRow('退款原因', '<input id="rf-reason" placeholder="如：方案变更退费">', true)}
        </div>`,
        '<button class="btn ghost" id="rf-c">取消</button><button class="btn danger" id="rf-s">确认退款</button>', 'sm');
      rm.el.querySelector('#rf-c').onclick = rm.close;
      rm.el.querySelector('#rf-s').onclick = async () => {
        const r = await API.refundPayment(pid, Number(rm.el.querySelector('#rf-amt').value), rm.el.querySelector('#rf-reason').value.trim());
        if (!r.ok) { App.toast(r.error, 'err'); return; }
        rm.close(); m.close(); App.toast('退款已记录并重算欠款', 'ok');
        render();
        paymentsModal((API.raw().bills || []).find(x => x.id == bill.id));
      };
    });
  }

  function editCollection(bill) {
    if (!bill) return;
    const m = App.modal('维护欠款催收信息 · ' + bill.bill_no, `
      <div class="form-grid">
        ${App.fieldRow('约定到期日', `<input id="c-due" type="date" value="${App.esc(bill.due_date || '')}">`, true)}
        ${App.fieldRow('催收备注', `<textarea id="c-note" rows="3">${App.esc(bill.collection_note || '')}</textarea>`, true)}
      </div>`,
      '<button class="btn ghost" id="c-c">取消</button><button class="btn" id="c-s">保存</button>', 'sm');
    m.el.querySelector('#c-c').onclick = m.close;
    m.el.querySelector('#c-s').onclick = async () => {
      const r = await API.updateBillCollection({
        id: bill.id,
        due_date: m.el.querySelector('#c-due').value || null,
        collection_note: m.el.querySelector('#c-note').value.trim(),
      });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('催收信息已更新', 'ok'); render();
    };
  }

  function voidBill(bill) {
    if (!bill) return;
    const m = App.modal('作废收费单 · ' + bill.bill_no, `
      <div class="note warn">已开单据禁止物理删除，作废将留痕并退出有效统计与欠款计算。须确保当前有效已收为 0 且无待确认支付。</div>
      ${App.fieldRow('作废原因（必填）', '<input id="v-reason" placeholder="如：开单项目录入错误">', true)}`,
      '<button class="btn ghost" id="v-c">取消</button><button class="btn danger" id="v-s">确认作废</button>', 'sm');
    m.el.querySelector('#v-c').onclick = m.close;
    m.el.querySelector('#v-s').onclick = async () => {
      const reason = m.el.querySelector('#v-reason').value.trim();
      if (!reason) { App.toast('请填写作废原因', 'err'); return; }
      const r = await API.voidBill(bill.id, reason);
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('收费单已作废', 'ok'); render();
    };
  }

  function trace(bill) {
    if (!bill) return;
    const db = API.raw();
    const p = API.patientOfBill(bill.id);
    const enc = (db.encounters || []).find(e => e.id == bill.encounter_id);
    const lines = API.billLines(bill.id);
    const pays = API.payments(bill.id);
    const body = `
      <div class="grid cols-3">
        <div class="kpi"><div class="label">患者</div><div class="value" style="font-size:16px">${App.esc(p ? p.name : '—')}</div></div>
        <div class="kpi"><div class="label">诊疗记录</div><div class="value" style="font-size:16px">${App.esc(enc ? enc.encounter_no : '—')}</div></div>
        <div class="kpi"><div class="label">欠款余额</div><div class="value" style="font-size:16px">¥${Number(bill.debt || 0).toFixed(2)}</div></div>
      </div>
      ${bill.discount_amount > 0 ? `<div class="note" style="margin-top:10px">整单折扣：¥${Number(bill.discount_amount).toFixed(2)}（原因：${App.esc(bill.discount_reason || '未填')}）</div>` : ''}
      ${bill.stage === '已作废' ? `<div class="note warn" style="margin-top:10px">已于 ${App.esc(bill.voided_at || '')} 作废，原因：${App.esc(bill.void_reason || '')}</div>` : ''}
      <p style="margin:14px 0 8px"><b>收费明细</b></p>
      <table class="tbl"><thead><tr><th>行</th><th>项目</th>${isPatient ? '' : '<th>关联订单</th>'}<th>单位</th><th>数量</th><th>成交单价</th><th>行折扣</th><th>小计</th></tr></thead><tbody>
        ${lines.map(l => {
          const ord = !isPatient && l.dental_order_id ? (db.orders || []).find(o => o.id == l.dental_order_id) : null;
          return `<tr><td>${l.line_no}</td><td>${App.esc(l.item_name)}</td>${isPatient ? '' : `<td class="muted">${App.esc(ord ? ord.order_no : '—')}</td>`}<td>${App.esc(l.unit)}</td>
          <td>${l.quantity}</td><td>¥${Number(l.unit_price).toFixed(2)}</td><td>¥${Number(l.discount_amount).toFixed(2)}</td>
          <td>¥${(Number(l.quantity) * Number(l.unit_price) - Number(l.discount_amount)).toFixed(2)}</td></tr>`;
        }).join('')}
      </tbody></table>
      <p style="margin:14px 0 8px"><b>支付流水（${pays.length}）</b></p>
      <table class="tbl"><thead><tr><th>类型</th><th>方式</th><th>金额</th><th>结果</th><th>时间</th></tr></thead><tbody>
        ${pays.map(x => `<tr><td>${App.esc(x.kind)}</td><td>${App.esc(API.optionName(x.method_id))}</td>
          <td>¥${Number(x.amount).toFixed(2)}</td><td>${App.tag(x.result)}</td>
          <td>${App.esc(String(x.occurred_at || x.requested_at || '').slice(0, 16).replace('T', ' '))}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">无</div></td></tr>'}
      </tbody></table>`;
    const m = App.modal('收费单追溯 · ' + bill.bill_no, body, '<button class="btn ghost" id="m-c">关闭</button>', 'lg');
    m.el.querySelector('#m-c').onclick = m.close;
  }

  function printReceipt(bill) {
    if (!bill) return;
    const db = API.raw();
    const p = API.patientOfBill(bill.id);
    const enc = (db.encounters || []).find(e => e.id == bill.encounter_id);
    const lines = API.billLines(bill.id);
    const pays = API.payments(bill.id).filter(x => x.result === '成功');
    const w = window.open('', '_blank');
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>收费凭证 ${App.esc(bill.bill_no)}</title>
      <style>body{font-family:system-ui,sans-serif;padding:24px;color:#142A26}h1{font-size:20px;margin-bottom:8px}
      table{border-collapse:collapse;width:100%;margin-top:12px}th,td{border:1px solid #ccc;padding:8px;text-align:left;font-size:13px}
      th{background:#f3f1eb}</style></head><body>
      <h1>口腔诊所收费凭证 · ${App.esc(bill.bill_no)}</h1>
      <p style="font-size:13px">患者：${App.esc(p ? p.name : '—')} ｜ 诊疗编号：${App.esc(enc ? enc.encounter_no : '—')} ｜ 开单时间：${App.esc(String(bill.issued_at || '').slice(0, 16).replace('T', ' '))} ｜ 状态：${App.esc(bill.stage)}</p>
      <table><thead><tr><th>行</th><th>项目</th>${isPatient ? '' : '<th>关联订单</th>'}<th>单位</th><th>数量</th><th>单价</th><th>行折扣</th><th>小计</th></tr></thead><tbody>
        ${lines.map(l => {
          const ord = !isPatient && l.dental_order_id ? (db.orders || []).find(o => o.id == l.dental_order_id) : null;
          return `<tr><td>${l.line_no}</td><td>${App.esc(l.item_name)}</td>${isPatient ? '' : `<td>${App.esc(ord ? ord.order_no : '—')}</td>`}<td>${App.esc(l.unit)}</td><td>${l.quantity}</td>
          <td>¥${Number(l.unit_price).toFixed(2)}</td><td>¥${Number(l.discount_amount).toFixed(2)}</td>
          <td>¥${(Number(l.quantity) * Number(l.unit_price) - Number(l.discount_amount)).toFixed(2)}</td></tr>`;
        }).join('')}
      </tbody></table>
      <p style="margin-top:14px;font-size:14px"><b>整单折扣：</b>¥${Number(bill.discount_amount || 0).toFixed(2)} ｜ <b>应收：</b>¥${Number(bill.receivable || 0).toFixed(2)} ｜ <b>已收：</b>¥${Number(bill.received || 0).toFixed(2)} ｜ <b>欠款：</b>¥${Number(bill.debt || 0).toFixed(2)}</p>
      <p style="font-size:12px;color:#666">成功收退款记录：${pays.map(x => `${x.kind} ¥${Number(x.amount).toFixed(2)}（${x.external_txn_no || x.request_no || ''}）`).join('；') || '暂无'}</p>
      <script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }

  render();
};
