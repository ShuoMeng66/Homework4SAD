/* 查询统计与订单提醒（UC-04）：严格按表 25 七项统计口径、医生/业务筛选、原始明细下钻、数据异常、待办与通知发送重试、CSV 导出 */
window.Modules = window.Modules || {};
window.Modules.reports = function (set) {
  const session = API.session() || {};
  const isReceptionist = session.role === 'receptionist';

  let start = API.localToday(-30);
  let end = API.localToday(0);
  let doctorId = '';
  let bizType = '全部';
  let recTab = 'reminders';
  let data = null;
  let errMsg = '';

  async function loadReports() {
    if (isReceptionist) {
      paint();
      return;
    }
    const r = await API.reports({ start, end, doctor_id: doctorId, biz_type: bizType });
    if (!r.ok) {
      errMsg = r.error || '统计计算失败';
      App.toast(errMsg, 'err');
      paint();
      return;
    }
    errMsg = '';
    data = r.data;
    paint();
  }

  function renderRemindersSection() {
    const db = API.raw();
    const list = db.reminders || [];
    return `
      <div class="card">
        <div class="toolbar" style="margin-bottom:10px">
          <h3 style="margin:0"><span class="bar"></span>预约与订单提醒（${list.length}）</h3>
          <button class="btn ghost sm" id="rem-add" style="margin-left:auto">+ 排定提醒</button>
        </div>
        ${list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr>
          <th>类型</th><th>关联目标</th><th>收件人</th><th>渠道</th><th>计划时间</th><th>重试次</th><th>结果</th><th>内容</th><th>操作</th>
        </tr></thead><tbody>
          ${list.map(r => `<tr>
            <td>${App.esc(r.kind)}</td>
            <td>${r.order_id ? '订单 #' + r.order_id : '预约 #' + r.appointment_id}</td>
            <td>${App.esc(r.recipient)}</td>
            <td>${App.esc(API.optionName(r.channel_id))}</td>
            <td>${App.esc(String(r.scheduled_at).slice(0, 16).replace('T', ' '))}</td>
            <td>${r.attempt_count || 0}</td>
            <td>${App.tag(r.delivery_result)}${r.failure_reason ? `<div class="muted">${App.esc(r.failure_reason)}</div>` : ''}</td>
            <td class="muted">${App.esc(r.content)}</td>
            <td class="actions">
              ${r.delivery_result !== '已发送' ? `
                <button class="btn ghost sm" data-rem-send="${r.id}">${r.delivery_result === '失败' ? '重试发送' : '发送'}</button>
                <button class="btn ghost sm" data-rem-fail="${r.id}" title="模拟通道异常以便测试失败重试">模拟失败</button>` : '—'}
            </td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">暂无提醒记录</div>'}
      </div>`;
  }

  function paint() {
    const db = API.raw();

    // 前台接待视图（UC-04 相关参与者：简洁分栏工作台，整合提醒发送、义齿跟进与到期召回，不暴露财务统计）
    if (isReceptionist) {
      const today = API.localToday(0);
      const orders = db.orders || [];
      const rems = db.reminders || [];
      const pendingRems = rems.filter(r => r.delivery_result !== '已发送');
      const trial = orders.filter(o => ['试戴', '质量确认'].includes(o.stage));
      const delivered = orders.filter(o => o.stage === '已交货');
      const overdue = orders.filter(o => o.promised_date && o.promised_date < today && !['已交货', '取消', '草稿'].includes(o.stage));
      const dueRecalls = (db.recalls || []).filter(r => ['待通知', '已通知'].includes(r.stage) && r.due_date <= today);

      let tabBody = '';
      if (recTab === 'reminders') {
        tabBody = `
          <div class="toolbar" style="justify-content:space-between;align-items:center">
            <span class="muted">共 ${rems.length} 条通知记录，其中 <b>${pendingRems.length}</b> 条待发送或失败可重试</span>
            <button class="btn sm" id="rem-add">+ 排定提醒</button>
          </div>
          ${rems.length ? `<div class="table-wrap"><table class="tbl"><thead><tr>
            <th>类型</th><th>关联目标</th><th>收件人</th><th>渠道</th><th>计划时间</th><th>重试</th><th>结果</th><th>内容</th><th>操作</th>
          </tr></thead><tbody>
            ${rems.map(r => `<tr>
              <td><b>${App.esc(r.kind)}</b></td>
              <td>${r.order_id ? '订单 #' + r.order_id : '预约 #' + r.appointment_id}</td>
              <td>${App.esc(r.recipient)}</td>
              <td>${App.esc(API.optionName(r.channel_id))}</td>
              <td>${App.esc(String(r.scheduled_at).slice(0, 16).replace('T', ' '))}</td>
              <td>${r.attempt_count || 0}</td>
              <td>${App.tag(r.delivery_result)}${r.failure_reason ? `<div class="muted">${App.esc(r.failure_reason)}</div>` : ''}</td>
              <td class="muted" style="max-width:260px">${App.esc(r.content)}</td>
              <td class="actions">
                ${r.delivery_result !== '已发送' ? `
                  <button class="btn soft sm" data-rem-send="${r.id}">${r.delivery_result === '失败' ? '重试发送' : '发送'}</button>
                  <button class="btn ghost sm" data-rem-fail="${r.id}" title="模拟通道异常以验证失败重试">模拟失败</button>` : '—'}
              </td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">暂无提醒记录</div>'}`;
      } else if (recTab === 'orders') {
        const trackList = [
          ...overdue.map(o => ({ ...o, _group: '逾期跟进', _tone: 'red' })),
          ...trial.map(o => ({ ...o, _group: '待试戴/质检', _tone: 'orange' })),
          ...delivered.map(o => ({ ...o, _group: '已交货取件', _tone: 'green' })),
        ];
        tabBody = trackList.length ? `<div class="table-wrap"><table class="tbl"><thead><tr>
          <th>跟进分类</th><th>订单号</th><th>患者</th><th>承诺日</th><th>状态</th><th>操作</th>
        </tr></thead><tbody>
          ${trackList.map(o => `<tr>
            <td><span class="tag ${o._tone}">${o._group}</span></td>
            <td><b>${App.esc(o.order_no)}</b></td>
            <td>${App.esc((API.patientOfOrder(o.id) || {}).name || '—')}</td>
            <td>${App.esc(o.promised_date || '—')}</td>
            <td>${App.tag(o.stage)}</td>
            <td class="actions"><button class="btn ghost sm" data-goto-orders="1">前往订单</button></td>
          </tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">当前无待跟进义齿订单</div>';
      } else {
        tabBody = dueRecalls.length ? `<div class="table-wrap"><table class="tbl"><thead><tr>
          <th>患者</th><th>到期日</th><th>召回原因</th><th>状态</th><th>操作</th>
        </tr></thead><tbody>
          ${dueRecalls.map(r => `<tr>
            <td><b>${App.esc(((db.patients || []).find(p => p.id == r.patient_id) || {}).name || '—')}</b></td>
            <td>${App.esc(r.due_date)}</td>
            <td>${App.esc(r.reason)}</td>
            <td>${App.tag(r.stage)}</td>
            <td class="actions"><button class="btn soft sm" data-book-recall="${r.id}">立即约诊</button></td>
          </tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">暂无到期未回访召回</div>';
      }

      set(`
        <div class="page-head"><div>
          <div class="page-title">订单与召回提醒</div>
          <div class="page-desc">统一处理待发送通知、试戴/逾期/交货义齿跟进与到期未回访复诊召回</div>
        </div></div>
        <div class="grid cols-4" style="margin-bottom:18px">
          <div class="kpi"><div class="label">待发送 / 失败提醒</div><div class="value" style="color:${pendingRems.length ? 'var(--warn)' : 'var(--ink)'}">${pendingRems.length}</div><div class="kpi-foot">共 ${rems.length} 条通知记录</div></div>
          <div class="kpi"><div class="label">试戴 / 待质检</div><div class="value" style="color:var(--primary)">${trial.length}</div><div class="kpi-foot">需联系患者安排试戴</div></div>
          <div class="kpi"><div class="label">逾期未交付</div><div class="value" style="color:${overdue.length ? 'var(--danger)' : 'var(--ink)'}">${overdue.length}</div><div class="kpi-foot">已交货 ${delivered.length} 单</div></div>
          <div class="kpi"><div class="label">到期未回访召回</div><div class="value" style="color:${dueRecalls.length ? 'var(--warn)' : 'var(--ink)'}">${dueRecalls.length}</div><div class="kpi-foot">建议及时联系约诊</div></div>
        </div>
        <div class="card">
          <div class="tabs">
            <div class="tab ${recTab === 'reminders' ? 'active' : ''}" data-rectab="reminders">通知发送队列<span class="tab-badge">${pendingRems.length}</span></div>
            <div class="tab ${recTab === 'orders' ? 'active' : ''}" data-rectab="orders">义齿交付跟进<span class="tab-badge">${overdue.length + trial.length + delivered.length}</span></div>
            <div class="tab ${recTab === 'recalls' ? 'active' : ''}" data-rectab="recalls">到期复诊召回<span class="tab-badge">${dueRecalls.length}</span></div>
          </div>
          ${tabBody}
        </div>`);
      document.querySelectorAll('[data-rectab]').forEach(el => {
        el.onclick = () => { recTab = el.dataset.rectab; paint(); };
      });
      document.querySelectorAll('[data-goto-orders]').forEach(el => {
        el.onclick = () => App.navigate('orders');
      });
      document.querySelectorAll('[data-book-recall]').forEach(el => {
        el.onclick = () => {
          const rec = (db.recalls || []).find(x => x.id == el.dataset.bookRecall);
          if (rec) App.navigate('appointments', { autoCreate: true, patientId: rec.patient_id, chiefComplaint: rec.reason || '' });
        };
      });
      bindCommon();
      return;
    }

    // 诊所负责人 / 系统管理员完整统计与下钻视图
    const doctors = [{ value: '', label: '全部医生' }].concat(API.doctors(false).map(d => ({ value: d.id, label: d.name })));
    const metrics = data ? data.metrics : [];
    const showApptPanels = bizType === '全部' || bizType === '预约';
    const showOrderPanels = bizType === '全部' || bizType === '订单';

    set(`
      <div class="page-head">
        <div>
          <div class="page-title">查询统计</div>
          <div class="page-desc">经营指标实时派生、样本规模提示、明细下钻追溯、数据异常标出与一致口径导出</div>
        </div>
        <button class="btn ghost" id="r-export" ${data ? '' : 'disabled'}>导出报表（CSV）</button>
      </div>
      <div class="card">
        <div class="note">待确认支付与未关闭订单不计入完成量；分母为零统一显示「无可计算样本」；点击任意指标卡片可下钻至原始业务明细；患者联系方式按角色权限脱敏展示。</div>
        <div class="toolbar">
          <div class="field"><label>开始日期</label><input id="r-start" type="date" value="${start}"></div>
          <div class="field"><label>结束日期</label><input id="r-end" type="date" value="${end}"></div>
          <div class="field"><label>医生</label>${App.selectHtml('r-doc', doctors, doctorId)}</div>
          <div class="field"><label>业务类型</label>${App.selectHtml('r-biz', ['全部', '预约', '收费', '订单'], bizType)}</div>
          <div style="display:flex;gap:6px;align-items:center">
            <button class="btn ghost sm" data-range="7">近 7 天</button>
            <button class="btn ghost sm" data-range="30">近 30 天</button>
            <button class="btn ghost sm" data-range="90">近 90 天</button>
            <button class="btn sm" id="r-run">刷新统计</button>
          </div>
        </div>
      </div>

      ${data ? `
        <div class="grid cols-3">
          ${metrics.map(m => {
            const pctMatch = String(m.value || '').match(/^([\d.]+)%$/);
            const pctVal = pctMatch ? Number(pctMatch[1]) : null;
            const barTone = pctVal === null ? '' : (pctVal >= 80 ? 'green' : (pctVal >= 50 ? '' : 'warn'));
            return `<div class="kpi" data-drill="${m.key}" style="cursor:pointer" title="点击下钻查看原始明细">
              <div class="label">${App.esc(m.name)} <span class="muted" style="float:right;font-size:11px;color:var(--primary)">下钻明细 →</span></div>
              <div class="value" style="font-size:24px">${App.esc(m.value)}</div>
              ${pctVal !== null ? `<div style="margin:6px 0 2px">${App.progressBar(pctVal, barTone)}</div>` : ''}
              <div class="kpi-foot">
                样本量 ${m.sample}${m.small_sample ? ' <span class="tag orange">样本量偏小</span>' : ''}
                ${m.numerator != null ? ` ｜ ${App.esc(m.numerator)} / ${App.esc(m.denominator)}${m.unit ? ' ' + m.unit : ''}` : ''}
                ${m.key === 'recovery' ? `<br>期间新增欠款：<b>¥${Number(m.new_debt || 0).toFixed(2)}</b>（${m.new_debt_count || 0} 笔）` : ''}
              </div>
            </div>`;
          }).join('')}
        </div>

        ${showApptPanels ? `<div style="height:16px"></div>
        <div class="grid cols-2">
          <div class="card">
            <h3><span class="bar"></span>诊室椅位利用率（按诊室核定）</h3>
            ${(data.rooms || []).length ? `<table class="tbl"><thead><tr><th>诊室</th><th>占用 / 排班(分)</th><th>利用率</th></tr></thead><tbody>
              ${data.rooms.map(r => {
                const pm = String(r.rate || '').match(/^([\d.]+)%$/);
                const pv = pm ? Number(pm[1]) : 0;
                return `<tr><td><b>${App.esc(r.room_name)}</b></td><td>${r.booked_min} / ${r.sched_min}</td>
                  <td><div class="pbar-inline">${App.progressBar(pv, pv >= 80 ? 'warn' : '')}<span>${App.esc(r.rate)}</span></div></td></tr>`;
              }).join('')}
            </tbody></table>` : '<div class="empty">该期间无排班数据</div>'}
          </div>
          <div class="card">
            <h3><span class="bar"></span>医生工作量</h3>
            ${(data.doctors || []).length ? (() => {
              const maxMin = Math.max(1, ...data.doctors.map(x => Number(x.minutes || 0)));
              return `<table class="tbl"><thead><tr><th>医生</th><th>预约 / 完成</th><th>占用时长</th></tr></thead><tbody>
                ${data.doctors.map(d => `<tr>
                  <td><span class="av-cell">${App.avatar(d.name)}<b>${App.esc(d.name)}</b></span></td>
                  <td>${d.appointments} / <b>${d.done}</b></td>
                  <td><div class="pbar-inline">${App.progressBar((d.minutes / maxMin) * 100)}<span>${Math.floor(d.minutes / 60)}h ${d.minutes % 60}m</span></div></td>
                </tr>`).join('')}
              </tbody></table>`;
            })() : '<div class="empty">该期间无医生预约</div>'}
          </div>
        </div>` : '<div style="height:16px"></div>'}

        <div class="card">
          <h3><span class="bar"></span>数据质量异常（${(data.anomalies || []).length}）</h3>
          ${(data.anomalies || []).length ? `<table class="tbl"><thead><tr><th>类型</th><th>单号 / 编号</th><th>异常说明</th></tr></thead><tbody>
            ${data.anomalies.map(a => `<tr><td>${App.esc(a.type)}</td><td>${App.esc(a.no || '#' + a.id)}</td><td><span class="tag red">${App.esc(a.problem)}</span></td></tr>`).join('')}
          </tbody></table>` : '<div class="empty">统计期间内未发现关联或重复建档异常</div>'}
        </div>

        ${showOrderPanels ? `<div class="grid cols-2">
          <div class="card">
            <h3><span class="bar"></span>试戴 / 待质检订单（${data.trial.length}）</h3>
            ${data.trial.length ? `<table class="tbl"><thead><tr><th>订单号</th><th>患者</th><th>产品</th><th>状态</th></tr></thead><tbody>
              ${data.trial.map(o => `<tr><td>${App.esc(o.order_no)}</td><td>${App.esc(o.patient)}</td><td>${App.esc(o.product_name)}</td><td>${App.tag(o.stage)}</td></tr>`).join('')}
            </tbody></table>` : '<div class="empty">无试戴订单</div>'}
          </div>
          <div class="card">
            <h3><span class="bar"></span>逾期订单（${data.overdue.length}）</h3>
            ${data.overdue.length ? `<table class="tbl"><thead><tr><th>订单号</th><th>患者</th><th>承诺日</th><th>状态</th><th>操作</th></tr></thead><tbody>
              ${data.overdue.map(o => `<tr><td>${App.esc(o.order_no)}</td><td>${App.esc(o.patient)}</td><td>${App.esc(o.promised_date)}</td>
                <td>${App.tag(o.stage)}</td><td><button class="btn ghost sm" data-offclose="${o.id}">线下结单</button></td></tr>`).join('')}
            </tbody></table>` : '<div class="empty">无逾期订单</div>'}
          </div>
        </div>` : ''}

        ${(showOrderPanels || showApptPanels) ? `<div class="grid cols-2">
          ${showOrderPanels ? `<div class="card">
            <h3><span class="bar"></span>已交货订单（${data.delivered.length}）</h3>
            ${data.delivered.length ? `<table class="tbl"><thead><tr><th>订单号</th><th>患者</th><th>承诺日</th><th>交货时间</th></tr></thead><tbody>
              ${data.delivered.map(o => `<tr><td>${App.esc(o.order_no)}</td><td>${App.esc(o.patient)}</td><td>${App.esc(o.promised_date)}</td><td>${App.esc(String(o.delivered_at || '').slice(0, 16).replace('T', ' '))}</td></tr>`).join('')}
            </tbody></table>` : '<div class="empty">无已交货订单</div>'}
          </div>` : ''}
          ${showApptPanels ? `<div class="card">
            <h3><span class="bar"></span>到期未回访复诊召回（${(data.dueRecalls || []).length}）</h3>
            ${(data.dueRecalls || []).length ? `<table class="tbl"><thead><tr><th>患者</th><th>到期日</th><th>原因</th><th>状态</th></tr></thead><tbody>
              ${data.dueRecalls.map(r => `<tr><td>${App.esc(r.patient)}</td><td>${App.esc(r.due_date)}</td><td>${App.esc(r.reason)}</td><td>${App.tag(r.stage)}</td></tr>`).join('')}
            </tbody></table>` : '<div class="empty">无到期未回访召回</div>'}
          </div>` : ''}
        </div>` : ''}

        ${renderRemindersSection()}
      ` : `<div class="card">${errMsg ? `<div class="note error">${App.esc(errMsg)}</div>` : '<div class="empty">正在按统一口径计算统计指标…</div>'}</div>`}`);

    bindCommon();
    const applyFilters = () => {
      start = document.getElementById('r-start').value;
      end = document.getElementById('r-end').value;
      doctorId = document.getElementById('r-doc').value;
      bizType = document.getElementById('r-biz').value;
      loadReports();
    };
    const runBtn = document.getElementById('r-run');
    if (runBtn) runBtn.onclick = applyFilters;
    ['r-start', 'r-end', 'r-doc', 'r-biz'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.onchange = applyFilters;
    });
    document.querySelectorAll('[data-range]').forEach(btn => {
      btn.onclick = () => {
        const days = Number(btn.dataset.range) || 30;
        start = API.localToday(-days);
        end = API.localToday(0);
        loadReports();
      };
    });
    const expBtn = document.getElementById('r-export');
    if (expBtn) expBtn.onclick = exportCsv;
    document.querySelectorAll('[data-drill]').forEach(el => {
      el.onclick = () => showDrilldown(el.dataset.drill);
    });
    document.querySelectorAll('[data-offclose]').forEach(b => {
      b.onclick = () => {
        const oid = Number(b.dataset.offclose);
        const m = App.modal('负责人线下渠道结单确认', App.fieldRow('结单原因（必填）', '<input id="oc-r" placeholder="如：技工所线下直达诊所并已交付患者">', true),
          '<button class="btn ghost" id="oc-c">取消</button><button class="btn" id="oc-s">确认结单</button>', 'sm');
        m.el.querySelector('#oc-c').onclick = m.close;
        m.el.querySelector('#oc-s').onclick = async () => {
          const r = await API.orderStage({ id: oid, action: 'offline_close', reason: m.el.querySelector('#oc-r').value.trim() });
          if (!r.ok) { App.toast(r.error, 'err'); return; }
          m.close(); App.toast('已完成线下结单确认', 'ok'); loadReports();
        };
      };
    });
  }

  function bindCommon() {
    document.querySelectorAll('[data-rem-send]').forEach(b => b.onclick = async () => {
      const r = await API.sendReminder(Number(b.dataset.remSend), false);
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      App.toast('提醒已发送', 'ok'); paint();
    });
    document.querySelectorAll('[data-rem-fail]').forEach(b => b.onclick = async () => {
      const r = await API.sendReminder(Number(b.dataset.remFail), true);
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      App.toast('已记录发送失败，可点击「重试发送」验证失败重试流程', 'err'); paint();
    });
    const addRem = document.getElementById('rem-add');
    if (addRem) addRem.onclick = createReminderModal;
  }

  function createReminderModal() {
    const db = API.raw();
    const channels = API.listOptions('通知渠道').map(o => ({ value: o.id, label: o.name }));
    const orders = (db.orders || []).map(o => ({ value: o.id, label: `${o.order_no}（${o.stage}）` }));
    const appts = (db.appointments || []).map(a => ({ value: a.id, label: `${a.appointment_no}（${a.starts_at}）` }));
    const body = `<div class="note">每条提醒必须且仅能关联一个预约或一张义齿订单；向患者发送的修复通知不得包含内部订单号与技工所信息。</div>
      <div class="form-grid">
        ${App.fieldRow('目标类型', App.selectHtml('rm-target-type', [{ value: 'order', label: '义齿订单' }, { value: 'appt', label: '诊疗预约' }], 'order'))}
        ${App.fieldRow('通知渠道', App.selectHtml('rm-ch', channels, channels[0] ? channels[0].value : ''))}
        <div class="field" id="rm-ord-wrap"><label>选择订单</label>${App.selectHtml('rm-ord', orders, orders[0] ? orders[0].value : '')}</div>
        <div class="field" id="rm-apt-wrap" style="display:none"><label>选择预约</label>${App.selectHtml('rm-apt', appts, appts[0] ? appts[0].value : '')}</div>
        ${App.fieldRow('提醒类型', '<input id="rm-kind" value="取件提醒">')}
        ${App.fieldRow('计划发送时间', `<input id="rm-time" type="datetime-local" value="${API.localNowMin()}">`)}
        ${App.fieldRow('收件人（手机号/邮箱）', '<input id="rm-rec" placeholder="如 13800000001">', true)}
        ${App.fieldRow('提醒内容', '<input id="rm-content" placeholder="提醒正文">', true)}
      </div>`;
    const m = App.modal('排定通知提醒', body, '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">保存提醒</button>');
    m.el.querySelector('#m-c').onclick = m.close;
    const ttSel = m.el.querySelector('#rm-target-type');
    const ordWrap = m.el.querySelector('#rm-ord-wrap');
    const aptWrap = m.el.querySelector('#rm-apt-wrap');
    const ordSel = m.el.querySelector('#rm-ord');
    const aptSel = m.el.querySelector('#rm-apt');
    const recInp = m.el.querySelector('#rm-rec');
    const kindInp = m.el.querySelector('#rm-kind');
    const contentInp = m.el.querySelector('#rm-content');
    let lastAutoContent = '';

    function syncTarget() {
      const isOrd = ttSel.value === 'order';
      ordWrap.style.display = isOrd ? '' : 'none';
      aptWrap.style.display = isOrd ? 'none' : '';
      let phone = '';
      let autoText = '';
      if (isOrd && ordSel.value) {
        const o = (db.orders || []).find(x => x.id == ordSel.value);
        const prod = o ? (db.products || []).find(x => x.id == o.product_id) : null;
        const p = API.patientOfOrder(Number(ordSel.value));
        if (p && p.phone && !String(p.phone).includes('*')) phone = p.phone;
        const isTryIn = o && o.stage === '试戴';
        kindInp.value = isTryIn ? '试戴提醒' : '取件提醒';
        const prodLabel = prod ? `（${prod.name}）` : '';
        autoText = isTryIn
          ? `您的定制修复体${prodLabel}已到达试戴阶段，请预约来院试戴。`
          : `您的定制修复体${prodLabel}已制作完成可取件，请到诊所领取。`;
      } else if (!isOrd && aptSel.value) {
        kindInp.value = '预约提醒';
        const a = (db.appointments || []).find(x => x.id == aptSel.value);
        const p = a ? (db.patients || []).find(x => x.id == a.patient_id) : null;
        if (p && p.phone && !String(p.phone).includes('*')) phone = p.phone;
        const starts = a ? String(a.starts_at || '').slice(0, 16).replace('T', ' ') : '';
        autoText = starts ? `您预约于 ${starts} 到诊，如需改约请提前联系诊所。` : '请按预约时间准时到诊，如需改约请提前联系诊所。';
      } else {
        kindInp.value = isOrd ? '取件提醒' : '预约提醒';
      }
      if (phone) recInp.value = phone;
      if (!contentInp.value.trim() || contentInp.value === lastAutoContent) {
        contentInp.value = autoText;
        lastAutoContent = autoText;
      }
    }
    ttSel.onchange = syncTarget;
    ordSel.onchange = syncTarget;
    aptSel.onchange = syncTarget;
    syncTarget();

    m.el.querySelector('#m-s').onclick = async () => {
      const tt = ttSel.value;
      const r = await API.createReminder({
        order_id: tt === 'order' ? Number(ordSel.value) : null,
        appointment_id: tt === 'appt' ? Number(aptSel.value) : null,
        channel_id: Number(m.el.querySelector('#rm-ch').value),
        kind: kindInp.value.trim(),
        scheduled_at: m.el.querySelector('#rm-time').value,
        recipient: recInp.value.trim(),
        content: m.el.querySelector('#rm-content').value.trim(),
      });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('提醒已排定', 'ok'); paint();
    };
  }

  function showDrilldown(key) {
    if (!data || !data.drilldown) return;
    const d = data.drilldown[key];
    let title = '指标原始明细下钻';
    let html = '';
    if (key === 'appointmentConfirmMedian') {
      title = '预约确认周期样本明细';
      html = d.length ? `<table class="tbl"><thead><tr><th>预约号</th><th>患者</th><th>医生</th><th>创建时间</th><th>确认时间</th><th>状态</th></tr></thead><tbody>
        ${d.map(x => `<tr><td>${App.esc(x.no)}</td><td>${App.esc(x.patient)}</td><td>${App.esc(x.doctor)}</td><td>${App.esc(String(x.created_at).slice(0, 16))}</td><td>${App.esc(String(x.confirmed_at).slice(0, 16))}</td><td>${App.tag(x.stage)}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">无样本记录</div>';
    } else if (key === 'fulfillment') {
      title = '预约兑现率原始预约明细';
      html = d.length ? `<table class="tbl"><thead><tr><th>预约号</th><th>患者</th><th>医生</th><th>预约时段</th><th>状态</th></tr></thead><tbody>
        ${d.map(x => `<tr><td>${App.esc(x.no)}</td><td>${App.esc(x.patient)}</td><td>${App.esc(x.doctor)}</td><td>${App.esc(x.starts_at)}</td><td>${App.tag(x.stage)}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">无样本记录</div>';
    } else if (key === 'chairUtilization') {
      title = '按诊室椅位利用率明细';
      html = d.length ? `<table class="tbl"><thead><tr><th>诊室</th><th>占用分钟</th><th>排班分钟</th><th>利用率</th></tr></thead><tbody>
        ${d.map(x => `<tr><td>${App.esc(x.room_name)}</td><td>${x.booked_min}</td><td>${x.sched_min}</td><td>${App.esc(x.rate)}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">无排班记录</div>';
    } else if (key === 'recovery') {
      title = '欠款回收率（期初队列与期间新增欠款明细）';
      html = `<p><b>期初欠款队列（${d.opening_queue.length}）</b></p>
        ${d.opening_queue.length ? `<table class="tbl"><thead><tr><th>收费单</th><th>患者</th><th>期初余额</th><th>期间净回款</th><th>当前余额</th></tr></thead><tbody>
          ${d.opening_queue.map(x => `<tr><td>${App.esc(x.bill_no)}</td><td>${App.esc(x.patient)}</td><td>¥${x.opening_debt}</td><td>¥${x.recovered}</td><td>¥${x.current_debt}</td></tr>`).join('')}
        </tbody></table>` : '<div class="muted">无期初欠款队列</div>'}
        <p style="margin-top:14px"><b>期间新增欠款（${d.new_debt_bills.length}）</b></p>
        ${d.new_debt_bills.length ? `<table class="tbl"><thead><tr><th>收费单</th><th>患者</th><th>新增欠款</th><th>到期日</th></tr></thead><tbody>
          ${d.new_debt_bills.map(x => `<tr><td>${App.esc(x.bill_no)}</td><td>${App.esc(x.patient)}</td><td>¥${x.debt}</td><td>${App.esc(x.due_date || '—')}</td></tr>`).join('')}
        </tbody></table>` : '<div class="muted">无期间新增欠款</div>'}`;
    } else if (key === 'onTime') {
      title = '订单按期交付率样本明细';
      html = d.length ? `<table class="tbl"><thead><tr><th>订单号</th><th>患者</th><th>产品</th><th>承诺日</th><th>交货时间</th><th>状态</th></tr></thead><tbody>
        ${d.map(x => `<tr><td>${App.esc(x.order_no)}</td><td>${App.esc(x.patient)}</td><td>${App.esc(x.product_name)}</td><td>${App.esc(x.promised_date)}</td><td>${App.esc(String(x.delivered_at || '—').slice(0, 16))}</td><td>${App.tag(x.stage)}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">无纳入考核订单</div>';
    } else {
      title = '记录关联完整度核查明细';
      const checked = Array.isArray(d) ? [] : (d.checked || []);
      const anoms = Array.isArray(d) ? d : (d.anomalies || []);
      html = `<p><b>纳入核查的单据（${checked.length}）</b></p>
        ${checked.length ? `<table class="tbl"><thead><tr><th>类型</th><th>单号</th><th>患者</th><th>核查结果</th></tr></thead><tbody>
          ${checked.map(x => `<tr><td>${App.esc(x.type)}</td><td>${App.esc(x.no)}</td><td>${App.esc(x.patient)}</td><td>${x.status === '完整' ? '<span class="tag green">完整</span>' : `<span class="tag red">${App.esc(x.status)}</span>`}</td></tr>`).join('')}
        </tbody></table>` : '<div class="muted">统计期间无纳入核查的单据</div>'}
        <p style="margin-top:14px"><b>异常记录（含疑似重复建档，${anoms.length}）</b></p>
        ${anoms.length ? `<table class="tbl"><thead><tr><th>类型</th><th>编号</th><th>异常问题</th></tr></thead><tbody>
          ${anoms.map(x => `<tr><td>${App.esc(x.type)}</td><td>${App.esc(x.no || '#' + x.id)}</td><td>${App.esc(x.problem)}</td></tr>`).join('')}
        </tbody></table>` : '<div class="muted">无异常记录</div>'}`;
    }
    const m = App.modal(title, html, '<button class="btn ghost" id="m-c">关闭</button>', 'lg');
    m.el.querySelector('#m-c').onclick = m.close;
  }

  function exportCsv() {
    if (!data) return;
    const rows = [['分类', '项目/指标', '数值', '样本量', '分子', '分母', '补充说明']];
    (data.metrics || []).forEach(m => {
      const extra = m.key === 'recovery' ? `期间新增欠款 ¥${Number(m.new_debt || 0).toFixed(2)}（${m.new_debt_count || 0} 笔）` : '';
      rows.push(['核心指标', m.name, m.value, m.sample, m.numerator == null ? '' : m.numerator, m.denominator == null ? '' : m.denominator, extra]);
    });
    if (bizType === '全部' || bizType === '预约') {
      (data.rooms || []).forEach(r => {
        rows.push(['诊室椅位', r.room_name, r.rate, '', r.booked_min, r.sched_min, '单位：分钟']);
      });
      (data.doctors || []).forEach(d => {
        rows.push(['医生工作量', d.name, `${d.appointments} 预约 / ${d.done} 完成`, d.appointments, d.done, d.appointments, `占用 ${d.minutes} 分钟`]);
      });
    }
    (data.anomalies || []).forEach(a => {
      rows.push(['数据异常', `${a.type} ${a.no || '#' + a.id}`, a.problem, '', '', '', '']);
    });
    const csv = '\ufeff' + rows.map(r => r.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `口腔诊所统计报表_${start}_${end}.csv`;
    a.click();
    App.toast('报表已按页面一致口径导出', 'ok');
  }

  paint();
  loadReports();
};
