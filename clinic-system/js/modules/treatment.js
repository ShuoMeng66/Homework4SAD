/* 患者端 · 我的治疗：展示本人治疗计划、修复件可视化三态进度（制作中/待试戴/可取件）与本人就诊记录 */
window.Modules = window.Modules || {};
window.Modules.treatment = function (set) {
  const STAGES = ['制作中', '待试戴', '可取件'];

  function renderApplianceTracker(ap) {
    const idx = Math.max(0, STAGES.indexOf(ap.progress));
    const teeth = (ap.teeth || []).map(c => `${c} ${API.toothName(c)}`).join('、');
    const stepHtml = STAGES.map((label, i) => {
      const cls = i < idx ? 'done' : (i === idx ? 'current' : '');
      const bar = i < STAGES.length - 1 ? `<div class="stage-bar ${i < idx ? 'done' : ''}"></div>` : '';
      return `<div class="stage-step ${cls}">
        <span class="stage-dot">${i < idx ? '✓' : (i + 1)}</span>
        <span>${label}</span>
      </div>${bar}`;
    }).join('');
    return `<div class="appliance-track-card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
        <div class="appliance-main">
          <b>${teeth ? App.esc(teeth) + ' · ' : ''}${App.esc(ap.product_name)}</b>
          ${App.tag(ap.progress)}
        </div>
        <div class="appliance-hint">${ap.promised_date ? '预计完成参考日：' + App.esc(ap.promised_date) : ''}</div>
      </div>
      <div class="stage-track">${stepHtml}</div>
    </div>`;
  }

  function render() {
    const db = API.raw();
    const patient = (db.patients || [])[0];
    const plans = db.treatmentPlans || [];
    const encounters = db.encounters || [];
    const appliances = db.appliances || [];
    const bills = db.bills || [];
    const empName = id => ((db.employees || []).find(e => e.id == id) || {}).name || '—';

    const fee = bills.reduce((a, b) => {
      a.receivable += Number(b.receivable || 0);
      a.paid += Number(b.received || 0);
      a.due += Number(b.debt || 0);
      return a;
    }, { receivable: 0, paid: 0, due: 0 });

    const todo = [];
    appliances.forEach(ap => {
      const teeth = (ap.teeth || []).map(API.toothName).join('、');
      const label = (teeth ? teeth + ' · ' : '') + ap.product_name;
      if (ap.progress === '待试戴') todo.push(`${label} 已到店，请预约来院试戴`);
      if (ap.progress === '可取件') todo.push(`${label} 已制作完成，可以来院取件`);
    });
    if (fee.due > 0) todo.push(`您有待付费用 ¥${fee.due.toFixed(2)}`);

    set(`
      <div class="ws-header">
        <div class="ws-header-left">
          <div class="ws-eyebrow">PATIENT HEALTH PORTAL</div>
          <h2 class="ws-title">我的口腔健康与治疗进度</h2>
          <div class="ws-meta">
            <span>${todo.length ? App.esc(todo[0]) : '当前各项治疗进度正常，可随时在线预约复查与核对费用明细'}</span>
          </div>
        </div>
        <div class="ws-actions">
          <button class="btn" id="tr-go-book">+ 自助预约</button>
          <button class="btn ghost" id="tr-go-bill">查看费用明细</button>
        </div>
      </div>

      ${todo.length > 1 ? `<div class="note warn">${todo.map(t => `· ${App.esc(t)}`).join('<br>')}</div>` : ''}

      <div class="grid cols-3" style="margin-bottom:18px">
        <div class="kpi">
          <div class="kpi-top">
            <div><div class="label">治疗计划</div><div class="value">${plans.length}</div></div>
            <span class="kpi-ico">${App.icon('heart')}</span>
          </div>
          <div class="kpi-foot">累计就诊记录 ${encounters.length} 次</div>
        </div>
        <div class="kpi">
          <div class="kpi-top">
            <div><div class="label">累计应收费用</div><div class="value" style="font-size:24px">¥${fee.receivable.toFixed(2)}</div></div>
            <span class="kpi-ico blue">${App.icon('wallet')}</span>
          </div>
          <div class="kpi-foot">已结清 ¥${fee.paid.toFixed(2)}</div>
        </div>
        <div class="kpi">
          <div class="kpi-top">
            <div><div class="label">当前待付金额</div><div class="value" style="font-size:24px;color:${fee.due > 0 ? 'var(--danger)' : 'var(--success)'}">¥${fee.due.toFixed(2)}</div></div>
            <span class="kpi-ico ${fee.due > 0 ? 'danger' : 'green'}">${App.icon('check')}</span>
          </div>
          <div class="kpi-foot">${fee.due > 0 ? '请前往诊所前台结算' : '费用已全部结清'}</div>
        </div>
      </div>

      <div class="card">
        <h3><span class="bar"></span>定制修复件进度</h3>
        <div class="note">修复件仅展示「制作中 → 待试戴 → 可取件」三个阶段，时间节点更新将由诊所提前通知。</div>
        ${appliances.length ? `<div class="appliance-list">${appliances.map(renderApplianceTracker).join('')}</div>` : '<div class="empty">当前暂无定制修复件</div>'}
      </div>

      <div class="card">
        <h3><span class="bar"></span>我的治疗计划</h3>
        ${plans.length ? plans.map(plan => {
          const pg = API.planProgress(plan.id);
          const pct = pg.total ? Math.round((pg.done / pg.total) * 100) : 0;
          const rows = pg.valid.map(i => {
            const label = i.appliance_progress || (i.stage === '已执行' ? '已完成' : '待安排');
            const when = i.executed_at ? String(i.executed_at).slice(0, 10) : '';
            return `<div class="appliance">
              <div class="appliance-main">
                <b>${i.tooth_code ? `${App.esc(API.toothName(i.tooth_code))} · ` : ''}${App.esc(i.name)}</b>
                ${App.tag(label)}
              </div>
              <div class="appliance-hint">第 ${i.phase_no} 期 · ¥${(Number(i.unit_price) * Number(i.quantity)).toFixed(2)}${when ? ' · 执行于 ' + App.esc(when) : ''}</div>
            </div>`;
          }).join('');
          return `<div style="padding:12px 0;border-bottom:1px solid var(--line-soft)">
            <div class="visit-head">
              <div>
                <div class="visit-date">${App.esc(plan.diagnosis || '口腔治疗计划')}</div>
                <div class="visit-doc">主治医生：${App.esc(empName(plan.doctor_id))} · 已完成 ${pg.done}/${pg.total} 项（${pct}%）</div>
              </div>
              <div class="visit-fee">${App.tag(plan.stage)}<span>报价 <b>¥${Number(plan.quoted_amount || pg.amount).toFixed(2)}</b></span></div>
            </div>
            <div style="margin:10px 0">${App.progressBar(pct, pct === 100 ? 'green' : '')}</div>
            <div class="appliance-list">${rows}</div>
          </div>`;
        }).join('') : '<div class="empty">暂无治疗计划</div>'}
      </div>

      <div class="card">
        <h3><span class="bar"></span>我的就诊记录</h3>
        ${encounters.length ? `<div class="table-wrap"><table class="tbl"><thead><tr>
          <th>就诊日期</th><th>接诊医生</th><th>主诉</th><th>诊断</th><th>处理说明</th>
        </tr></thead><tbody>
          ${encounters.map(e => `<tr>
            <td style="white-space:nowrap"><b>${App.esc(String(e.occurred_at).slice(0, 10))}</b> <span class="muted">${App.esc(String(e.occurred_at).slice(11, 16))}</span></td>
            <td><span class="av-cell">${App.avatar(empName(e.doctor_id))}<span>${App.esc(empName(e.doctor_id))}</span></span></td>
            <td>${App.esc(e.chief_complaint)}</td>
            <td>${App.esc(e.diagnosis || '—')}</td>
            <td class="muted">${App.esc(e.treatment_note || '—')}</td>
          </tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">暂无就诊记录</div>'}
      </div>

      ${patient && patient.important_note ? `<div class="card"><div class="note"><b>就诊健康提示：</b>${App.esc(patient.important_note)}</div></div>` : ''}
    `);

    const bk = document.getElementById('tr-go-book');
    if (bk) bk.onclick = () => App.navigate('appointments', { autoCreate: true });
    const bl = document.getElementById('tr-go-bill');
    if (bl) bl.onclick = () => App.navigate('billing');
  }

  render();
};
