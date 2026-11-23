/* 查询统计 F6 / UC-04：四项指标+确认周期、样本量、明细入口、订单提醒、导出 */
window.Modules = window.Modules || {};
window.Modules.reports = function (set) {
  const today = new Date().toISOString().slice(0,10);
  const monthAgo = new Date(Date.now()-30*86400000).toISOString().slice(0,10);
  let start = monthAgo, end = today, data = null, bizType = '全部';

  async function compute() {
    const r = await API.compute.reports(start, end);
    if (!r.ok) { App.toast('服务器统计失败：' + (r.error || ''), 'err'); return; }
    data = r.data;
    render();
  }

  function render() {
    const metrics = data ? data.metrics : [];
    set(`
      <div class="page-head"><div><div class="page-title">查询统计</div><div class="page-desc">F6 / UC-04 · 指标口径统一、可追溯明细、订单提醒</div></div>
        <button class="btn ghost" id="r-export" ${data?'':'disabled'}>导出报表</button></div>
      <div class="card">
        <div class="note">BR-07/BR-08：待确认支付和未关闭订单不计入完成量；指标可追溯到原始记录；比率分母为零显示"无可计算样本"。</div>
        <div class="toolbar">
          <div class="field"><label>开始日期</label><input id="r-start" type="date" value="${start}"></div>
          <div class="field"><label>结束日期</label><input id="r-end" type="date" value="${end}"></div>
          <div class="field"><label>业务类型</label>${App.selectHtml('r-biz', ['全部','预约','收费','订单'], bizType)}</div>
          <button class="btn" id="r-run">计算指标</button>
        </div>
      </div>
      ${data ? `
      <div class="grid cols-3">
        ${metrics.map(m=>`<div class="kpi">
          <div class="label">${App.esc(m.name)}</div>
          <div class="value" style="font-size:22px">${App.esc(m.value)}</div>
          <div class="foot">样本量 ${m.sample}${m.numerator!=null?` ｜ ${App.esc(m.numerator)} / ${App.esc(m.denominator)}${m.key==='chairUtilization'?' 分钟':''}`:''}</div>
        </div>`).join('')}
      </div>
      ${data.doctors ? `<div class="card">
        <h3><span class="bar"></span>医生工作量</h3>
        <div class="note">按有效预约统计（含待确认、已确认、已到诊、已完成）；占用时长以预约起止计算，用于判断产能是否压在某一位医生身上。</div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>医生</th><th>有效预约</th><th>已完成</th><th>预约占用</th>
        </tr></thead><tbody>
          ${data.doctors.length ? data.doctors.map(d => `<tr>
            <td>${App.esc(d.name)}</td><td>${d.appointments}</td><td>${d.done}</td>
            <td>${Math.floor(d.minutes / 60)} 小时 ${d.minutes % 60} 分</td></tr>`).join('')
            : '<tr><td colspan="4"><div class="empty">该期间没有预约</div></td></tr>'}
        </tbody></table></div>
      </div>` : ''}
      <div style="height:18px"></div>
      <div class="card">
        <h3><span class="bar"></span>数据质量异常（${data.anomalies.length}）</h3>
        ${data.anomalies.length?`<div class="table-wrap"><table class="tbl"><thead><tr><th>类型</th><th>记录ID</th><th>问题</th></tr></thead><tbody>
          ${data.anomalies.map(a=>`<tr><td>${App.esc(a.type)}</td><td>#${a.id}</td><td><span class="tag red">无法关联有效患者或必要明细</span></td></tr>`).join('')}
        </tbody></table></div>`:'<div class="empty">未发现关联异常</div>'}
      </div>
      <div class="grid cols-2">
        <div class="card">
          <h3><span class="bar"></span>试戴 / 待处理订单（${data.trial.length}）</h3>
          ${data.trial.length?`<div class="table-wrap"><table class="tbl"><thead><tr><th>订单</th><th>患者</th><th>状态</th></tr></thead><tbody>
            ${data.trial.map(o=>`<tr><td>${App.esc(o.order_no)}</td><td>${App.esc(API.patientOfOrder(o.id)?.name||'')}</td><td>${App.tag(o.stage)}</td></tr>`).join('')}
          </tbody></table></div>`:'<div class="empty">无</div>'}
        </div>
        <div class="card">
          <h3><span class="bar"></span>逾期订单（${data.overdue.length}）</h3>
          ${data.overdue.length?`<div class="table-wrap"><table class="tbl"><thead><tr><th>订单</th><th>患者</th><th>承诺日</th><th>状态</th></tr></thead><tbody>
            ${data.overdue.map(o=>`<tr><td>${App.esc(o.order_no)}</td><td>${App.esc(API.patientOfOrder(o.id)?.name||'')}</td><td>${App.esc(o.promised_date)}</td><td>${App.tag(o.stage)}</td></tr>`).join('')}
          </tbody></table></div>`:'<div class="empty">无逾期订单</div>'}
        </div>
      </div>
      <div class="card">
        <h3><span class="bar"></span>订单提醒</h3>
        ${renderReminders()}
      </div>` : `<div class="card"><div class="empty">选择期间后点击"计算指标"，按表24 口径读取业务记录并保留样本量。</div></div>`}`);
    bind();
  }

  function renderReminders() {
    const list = API.listReminders();
    return list.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>类型</th><th>目标</th><th>收件人</th><th>渠道</th><th>计划时间</th><th>发送结果</th><th>操作</th></tr></thead><tbody>
      ${list.map(r=>`<tr><td>${App.esc(r.kind)}</td><td>${r.order_id?'订单#'+r.order_id:'预约#'+r.appointment_id}</td>
        <td>${App.esc(r.recipient)}</td><td>${App.esc((API.raw().basicOptions.find(x=>x.id==r.channel_id)||{}).name||'')}</td>
        <td>${App.esc(r.scheduled_at)}</td><td>${App.tag(r.delivery_result)}</td>
        <td>${r.delivery_result!=='已发送'?`<button class="btn ghost sm" data-send="${r.id}">发送</button>`:'—'}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">暂无提醒</div>';
  }

  function bind() {
    document.getElementById('r-run').onclick = compute;
    const biz = document.getElementById('r-biz');
    if (biz) biz.onchange = () => { bizType = biz.value; };
    document.querySelectorAll('[data-send]').forEach(b => b.onclick = () => {
      const r = API.sendReminder(Number(b.dataset.send));
      if (!r.ok) { App.toast(r.error,'err'); return; }
      App.toast('提醒已发送','ok'); render();
    });
    const exp = document.getElementById('r-export');
    if (exp) exp.onclick = exportCsv;
  }

  function exportCsv() {
    if (!data) return;
    const rows = [['指标','数值','样本量','分子','分母']];
    data.metrics.forEach(m => rows.push([m.name, m.value, m.sample, m.numerator==null?'':m.numerator, m.denominator==null?'':m.denominator]));
    const csv = '\ufeff' + rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `统计报表_${start}_${end}.csv`;
    a.click();
    App.toast('报表已导出','ok');
  }

  compute();
};
