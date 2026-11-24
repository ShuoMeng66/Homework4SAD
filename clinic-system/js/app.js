/* ============================================================
 * app.js — 旗舰级现代医疗 SPA 外壳：
 * 分栏视觉登录 + 可折叠侧栏与实时待办徽章 + 平滑弹窗/ESC关闭 + 精美组件库
 * ============================================================ */
window.App = (function () {
  const MODULES = [
    { id: 'dashboard',    name: '今日队列', icon: '▦', group: '工作台' },
    { id: 'patients',     name: '患者管理', icon: '♙', group: '接诊与排程' },
    { id: 'schedule',     name: '排班号源', icon: '▤', group: '接诊与排程' },
    { id: 'appointments', name: '预约管理', icon: '◷', group: '接诊与排程' },
    { id: 'recall',       name: '复诊召回', icon: '⟳', group: '接诊与排程' },
    { id: 'encounters',   name: '诊疗记录', icon: '✚', group: '临床与收费' },
    { id: 'plans',        name: '治疗计划', icon: '◫', group: '临床与收费' },
    { id: 'treatment',    name: '我的治疗', icon: '◈', group: '我的健康' },
    { id: 'billing',      name: '收费欠款', icon: '¥', group: '临床与收费' },
    { id: 'orders',       name: '义齿订单', icon: '⬡', group: '技工与跟进' },
    { id: 'reports',      name: '查询统计', icon: '▥', group: '经营与系统' },
    { id: 'basic',        name: '基础信息', icon: '⚙', group: '经营与系统' },
  ];

  const PATIENT_NAV = {
    appointments: '我的预约',
    treatment: '我的治疗',
    billing: '我的费用',
  };

  const RECEPTIONIST_NAV = {
    reports: '订单提醒',
  };

  // 课程演示所需角色快捷切换面板
  const DEMO_ACCOUNTS = [
    ['13800000001', '患者',   '自助预约与查进度', '123456',   'patient'],
    ['receptionist','前台',   '登记、排班与预约', 'password', 'staff'],
    ['doctor',      '医生',   '诊疗、计划与订单', 'password', 'staff'],
    ['cashier',     '收费员', '收费、支付与欠款', 'password', 'staff'],
    ['manager',     '负责人', '统计、召回与维护', 'password', 'staff'],
    ['admin',       '管理员', '账号与基础资料',   'password', 'staff'],
  ];

  const BRAND_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`;

  const ICONS = {
    calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4"/></svg>`,
    clock:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
    bell:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    wallet:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M16 14h2"/></svg>`,
    box:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>`,
    heart:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-4.5-7-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5C19 16.5 12 21 12 21z"/></svg>`,
    check:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/></svg>`,
    user:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M5 20c.8-3.8 3.2-5.5 7-5.5s6.2 1.7 7 5.5"/></svg>`,
    lock:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/></svg>`,
    phone:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 18h.01"/></svg>`,
    shield:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/></svg>`,
    refresh:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`,
    chevron:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`,
    search:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`,
  };

  let current = 'dashboard';
  let sidebarCollapsed = false;
  const modalStack = [];

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const pop = document.getElementById('role-pop-wrap');
      if (pop && pop.classList.contains('open')) { pop.classList.remove('open'); return; }
      if (modalStack.length) modalStack[modalStack.length - 1]();
    }
  });
  document.addEventListener('click', e => {
    const pop = document.getElementById('role-pop-wrap');
    if (pop && !pop.contains(e.target)) pop.classList.remove('open');
  });

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function icon(name) {
    return ICONS[name] || '';
  }

  function avatar(name) {
    const str = String(name || '—').trim();
    const ch = str.slice(0, 1) || '?';
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 5;
    return `<span class="av c${h}">${esc(ch)}</span>`;
  }

  function progressBar(pct, tone = '') {
    const v = Math.max(0, Math.min(100, Number(pct) || 0));
    return `<div class="pbar"><div class="pbar-fill ${tone}" style="width:${v.toFixed(1)}%"></div></div>`;
  }

  function toast(msg, type) {
    const el = document.getElementById('toast');
    const sym = type === 'err' ? '✕' : (type === 'ok' ? '✓' : 'i');
    el.innerHTML = `<span class="toast-ico">${sym}</span><span>${esc(msg)}</span>`;
    el.className = 'toast show ' + (type === 'err' ? 'err' : type === 'ok' ? 'ok' : '');
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.className = 'toast'; }, 3200);
  }

  function tag(stage) {
    const map = {
      '待确认': 'orange', '已确认': 'blue', '已到诊': 'teal', '已完成': 'green', '已取消': 'gray', '爽约': 'red',
      '成功': 'green', '失败': 'red', '退款': 'orange',
      '待发送': 'orange', '已发送': 'blue',
      '草稿': 'gray', '已接收': 'teal', '试戴': 'orange', '质量确认': 'blue', '已交货': 'green', '返工': 'red', '取消': 'gray',
      '待处理': 'red',
      '欠款中': 'orange', '已结清': 'green', '已作废': 'gray',
      '拟定': 'gray', '执行中': 'blue', '已终止': 'gray',
      '待执行': 'orange', '已执行': 'green',
      '待通知': 'orange', '已通知': 'blue', '已预约': 'green', '已关闭': 'gray',
      '制作中': 'blue', '待试戴': 'orange', '可取件': 'green',
      '正常': 'green', '停诊': 'red',
    };
    return `<span class="tag ${map[stage] || 'blue'}">${esc(stage)}</span>`;
  }

  function loginScene(inner, state) {
    return `
      <div class="login-shell ${state ? 'is-' + state : ''}">
        <div class="login-photo" aria-hidden="true"></div>
        <aside class="login-hero">
          <div class="login-hero-badge">数字化口腔临床与经营协同平台</div>
          <h2>从容高效接诊，<br>全流程清晰可控</h2>
          <p>覆盖患者登记、医生排班号源、分期治疗计划、收银欠款核算、义齿技工全链路追踪与实时经营统计分析。</p>
          <div class="login-highlights">
            <div class="login-hl"><b>智能排班与号源防冲突</b><span>医生与诊室资源实时校验，支持患者两周内自助选号</span></div>
            <div class="login-hl"><b>FDI 牙位分期治疗计划</b><span>确认即锁定报价快照，执行自动联动收费与技工委托</span></div>
            <div class="login-hl"><b>透明收银与欠款闭环</b><span>多渠道分次收款、查单核对、退款重算与到期催收</span></div>
            <div class="login-hl"><b>义齿委外 8 状态追踪</b><span>附件托管、回执幂等去重、患者三态隐私脱敏展示</span></div>
          </div>
        </aside>
        <main class="login-frame">
          <header class="login-mast">
            <div class="login-mark">${BRAND_SVG}</div>
            <div class="login-mast-name"><b>口腔诊所管理系统</b><span>DENTAL CLINIC CLOUD</span></div>
            <i aria-hidden="true"></i>
          </header>
          <section class="login-card">${inner}</section>
          ${state ? '' : `
          <div class="role-dock" aria-label="角色切换说明">
            <span>按角色快速体验</span>
            <div class="role-grid">
              ${DEMO_ACCOUNTS.map(([account, label, desc, pass, kind]) => `
                <button class="role-chip" type="button" data-demo="${account}" data-pass="${pass}" data-kind="${kind}" title="${desc}">
                  <span class="role-chip-av">${label.slice(0, 1)}</span>
                  <div class="role-chip-txt"><b>${label}</b><small>${desc}</small></div>
                </button>`).join('')}
            </div>
          </div>`}
          <footer class="login-caption">口腔诊所管理系统</footer>
        </main>
      </div>`;
  }

  function renderLogin() {
    const s = API.session();
    if (s) {
      showApp();
      return;
    }
    let loginMode = 'staff';

    function paint() {
      const isPat = loginMode === 'patient';
      document.getElementById('login-view').innerHTML = loginScene(`
        <div class="tabs" style="margin:-2px 0 16px;width:100%;display:grid;grid-template-columns:1fr 1fr">
          <div class="tab ${!isPat ? 'active' : ''}" data-lmode="staff" style="justify-content:center">诊所员工登录</div>
          <div class="tab ${isPat ? 'active' : ''}" data-lmode="patient" style="justify-content:center">患者自助登录</div>
        </div>
        <h1 id="login-title">${isPat ? '患者自助服务' : '欢迎回到诊所工作台'}</h1>
        <div class="login-rule"></div>
        <div class="login-fields">
          ${isPat ? `
            <div class="login-field">
              <label for="lg-user">登记手机号</label>
              <div class="input-icon-wrap">
                <span class="in-ico">${ICONS.phone}</span>
                <input id="lg-user" placeholder="请输入登记手机号（如 13800000001）" autocomplete="tel">
              </div>
            </div>
            <div class="login-field">
              <label for="lg-pass">短信验证码</label>
              <div style="display:flex;gap:8px">
                <div class="input-icon-wrap" style="flex:1">
                  <span class="in-ico">${ICONS.shield}</span>
                  <input id="lg-pass" placeholder="6 位验证码" autocomplete="one-time-code">
                </div>
                <button class="btn soft sm" id="lg-sms" type="button" style="white-space:nowrap;height:44px;padding:0 14px">获取验证码</button>
              </div>
            </div>
          ` : `
            <div class="login-field">
              <label for="lg-user">员工账号</label>
              <div class="input-icon-wrap">
                <span class="in-ico">${ICONS.user}</span>
                <input id="lg-user" placeholder="输入员工账号" autocomplete="username">
              </div>
            </div>
            <div class="login-field">
              <label for="lg-pass">登录密码</label>
              <div class="input-icon-wrap">
                <span class="in-ico">${ICONS.lock}</span>
                <input id="lg-pass" type="password" placeholder="••••••••" autocomplete="current-password">
              </div>
            </div>
          `}
        </div>
        <button class="btn block" id="lg-btn" type="button">${isPat ? '验证码登录' : '立即登录'} <span aria-hidden="true">→</span></button>
        <div id="lg-err" role="status" aria-live="polite"></div>
      `);

      document.querySelectorAll('[data-lmode]').forEach(el => {
        el.onclick = () => { loginMode = el.dataset.lmode; paint(); };
      });

      const smsBtn = document.getElementById('lg-sms');
      if (smsBtn) {
        smsBtn.onclick = async () => {
          const phone = document.getElementById('lg-user').value.trim();
          const err = document.getElementById('lg-err');
          if (!phone) { err.textContent = '请先输入手机号'; return; }
          smsBtn.disabled = true;
          smsBtn.textContent = '发送中…';
          const r = await API.requestSmsCode(phone);
          smsBtn.disabled = false;
          smsBtn.textContent = '获取验证码';
          if (!r.ok) { err.textContent = r.error; return; }
          document.getElementById('lg-pass').value = r.data.demo_code;
          err.textContent = '';
          toast(`短信验证码已发送（演示验证码：${r.data.demo_code}，5 分钟内有效）`, 'ok');
        };
      }

      const go = async () => {
        const u = document.getElementById('lg-user').value.trim();
        const p = document.getElementById('lg-pass').value.trim();
        const err = document.getElementById('lg-err');
        const btn = document.getElementById('lg-btn');
        if (!u || !p) { err.textContent = isPat ? '请输入手机号与验证码' : '请输入账号与密码'; return; }
        err.textContent = '';
        btn.disabled = true;
        btn.innerHTML = `<span class="spin-dot"></span> 正在登录并同步数据…`;
        const r = await API.login(u, p, isPat ? 'patient_sms' : 'staff');
        if (!r.ok) {
          btn.disabled = false;
          btn.innerHTML = `${isPat ? '验证码登录' : '立即登录'} <span aria-hidden="true">→</span>`;
          err.textContent = r.error;
          return;
        }
        showApp();
        toast('欢迎回来，数据已同步', 'ok');
      };

      document.getElementById('lg-btn').onclick = go;
      document.getElementById('lg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });

      document.querySelectorAll('[data-demo]').forEach(btn => {
        btn.onclick = () => {
          const targetMode = btn.dataset.kind === 'patient' ? 'patient' : 'staff';
          if (loginMode !== targetMode) {
            loginMode = targetMode;
            paint();
          }
          document.getElementById('lg-user').value = btn.dataset.demo;
          document.getElementById('lg-pass').value = btn.dataset.pass || 'password';
          document.getElementById('lg-err').textContent = '';
          document.querySelectorAll('[data-demo]').forEach(b => b.classList.toggle('active', b.dataset.demo === btn.dataset.demo));
          go();
        };
      });
    }

    paint();
  }

  function navLabel(mod, role) {
    if (role === 'patient' && PATIENT_NAV[mod.id]) return PATIENT_NAV[mod.id];
    if (role === 'receptionist' && RECEPTIONIST_NAV[mod.id]) return RECEPTIONIST_NAV[mod.id];
    return mod.name;
  }

  function showApp() {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('app-view').style.display = 'flex';
    renderShell();
    updateBadges();
    const allowed = MODULES.filter(m => API.can(m.id));
    navigate(current && API.can(current) ? current : (allowed[0] ? allowed[0].id : 'dashboard'));
  }

  function updateBadges() {
    const sb = document.getElementById('sidebar');
    const s = API.session();
    if (!sb || !s) return;
    const q = API.queues();
    const db = API.raw();
    const pendingRems = (db.reminders || []).filter(r => r.delivery_result !== '已发送').length;
    const badgeMap = {
      appointments: s.role === 'patient'
        ? (db.appointments || []).filter(a => a.stage === '待确认').length
        : q.pendingConfirm.length,
      recall: q.recallDue.length,
      billing: s.role === 'patient'
        ? (db.bills || []).filter(b => Number(b.debt || 0) > 0).length
        : q.debtDue.length,
      orders: q.toTry.length + q.toPick.length,
      reports: s.role === 'receptionist' ? pendingRems : 0,
    };
    sb.querySelectorAll('[data-nav]').forEach(el => {
      const id = el.dataset.nav;
      const old = el.querySelector('.nav-badge');
      const cnt = badgeMap[id] || 0;
      if (cnt > 0) {
        const cls = (id === 'billing' || id === 'recall') ? 'nav-badge danger' : 'nav-badge';
        if (old) { old.className = cls; old.textContent = cnt; }
        else el.insertAdjacentHTML('beforeend', `<span class="${cls}">${cnt}</span>`);
      } else if (old) {
        old.remove();
      }
    });
  }

  function renderShell() {
    const s = API.session();
    const groups = {};
    MODULES.filter(m => API.can(m.id)).forEach(m => {
      const grp = s.role === 'patient' ? '自助服务'
        : (s.role === 'receptionist' && m.id === 'reports' ? '技工与跟进' : m.group);
      (groups[grp] = groups[grp] || []).push(m);
    });
    let nav = '';
    Object.keys(groups).forEach(g => {
      nav += `<div class="sb-group">${g}</div>`;
      groups[g].forEach(m => {
        const label = navLabel(m, s.role);
        nav += `<div class="nav-item" data-nav="${m.id}" title="${esc(label)}"><span class="ico">${m.icon}</span><span class="nav-label">${esc(label)}</span></div>`;
      });
    });
    const sb = document.getElementById('sidebar');
    sb.className = sidebarCollapsed ? 'collapsed' : '';
    sb.innerHTML = `
      <div class="sb-brand">
        <div class="mark">${BRAND_SVG}</div>
        <div class="sb-brand-text"><b>口腔诊所管理</b><small>DENTAL CLINIC</small></div>
      </div>
      <div class="sb-nav">${nav}</div>
      <div class="sb-foot">
        <span class="sb-status"><i></i><span class="sb-foot-text">服务在线</span></span>
        <button class="sb-toggle" id="sb-toggle" type="button" title="折叠或展开导航">${ICONS.chevron}</button>
      </div>`;
    sb.querySelectorAll('[data-nav]').forEach(el => {
      el.onclick = () => navigate(el.dataset.nav);
    });
    const tog = document.getElementById('sb-toggle');
    if (tog) {
      tog.onclick = () => {
        sidebarCollapsed = !sidebarCollapsed;
        sb.classList.toggle('collapsed', sidebarCollapsed);
      };
    }

    const roleLabel = window.SEED.ROLE_LABEL[s.role] || '';
    const userLabel = s.name && s.name !== roleLabel ? s.name : '';
    const avatarChar = (userLabel || roleLabel || '医').slice(0, 1);
    const todayCn = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
    document.getElementById('topbar').innerHTML = `
      <div class="tb-left">
        <span class="tb-crumb">口腔诊所 /</span>
        <div class="tb-title" id="tb-title">今日队列</div>
        <div class="tb-date">${esc(todayCn)}</div>
      </div>
      <div class="tb-right">
        <button class="btn ghost icon-btn tb-refresh" id="tb-refresh" type="button" title="同步最新数据">${ICONS.refresh}</button>
        <div class="role-pop-wrap" id="role-pop-wrap">
          <div class="tb-profile clickable" id="tb-profile-btn" title="点击快速切换体验角色">
            <span class="avatar-badge">${esc(avatarChar)}</span>
            ${userLabel ? `<span class="tb-user">${esc(userLabel)}</span>` : ''}
            <span class="tb-role">${esc(roleLabel)}</span>
            <span class="tb-caret">▾</span>
          </div>
          <div class="role-pop" id="role-pop">
            <div class="role-pop-head"><span>一键切换角色体验</span><span>RBAC</span></div>
            ${DEMO_ACCOUNTS.map(([acc, lbl, desc, pass, kind]) => {
              const isCur = s.username === acc;
              return `<button type="button" class="role-pop-item ${isCur ? 'current' : ''}" data-qswitch="${acc}" data-qpass="${pass}" data-qkind="${kind}">
                ${avatar(lbl)}
                <div><b>${esc(lbl)}</b><small>${esc(desc)}</small></div>
                ${isCur ? '<span class="role-pop-check">✓</span>' : ''}
              </button>`;
            }).join('')}
          </div>
        </div>
        <button class="btn ghost sm" id="logout-btn">退出</button>
      </div>`;

    const popWrap = document.getElementById('role-pop-wrap');
    const profBtn = document.getElementById('tb-profile-btn');
    if (profBtn && popWrap) {
      profBtn.onclick = e => {
        e.stopPropagation();
        popWrap.classList.toggle('open');
      };
      popWrap.querySelectorAll('[data-qswitch]').forEach(btn => {
        btn.onclick = async () => {
          const acc = btn.dataset.qswitch;
          if (acc === s.username) { popWrap.classList.remove('open'); return; }
          popWrap.classList.remove('open');
          while (modalStack.length) modalStack[modalStack.length - 1]();
          const r = await API.login(acc, btn.dataset.qpass, btn.dataset.qkind === 'patient' ? 'patient_sms' : 'staff');
          if (!r.ok) { toast(r.error, 'err'); return; }
          showApp();
          toast(`已切换为「${window.SEED.ROLE_LABEL[r.data.role] || r.data.name}」视角`, 'ok');
        };
      });
    }

    const rfBtn = document.getElementById('tb-refresh');
    if (rfBtn) {
      rfBtn.onclick = async () => {
        rfBtn.classList.add('spinning');
        const r = await API.refresh();
        setTimeout(() => rfBtn.classList.remove('spinning'), 360);
        if (r.ok) {
          const fn = window.Modules && window.Modules[current];
          if (fn) fn(setContent, {});
          toast('已同步最新业务数据', 'ok');
        }
      };
    }

    document.getElementById('logout-btn').onclick = () => {
      API.logout();
      current = 'dashboard';
      document.getElementById('app-view').style.display = 'none';
      document.getElementById('login-view').style.display = 'flex';
      renderLogin();
    };
  }

  function onUnauthorized() {
    document.getElementById('app-view').style.display = 'none';
    document.getElementById('login-view').style.display = 'flex';
    renderLogin();
    toast('会话已失效，请重新登录', 'err');
  }

  function navigate(id, opts) {
    if (!API.can(id)) {
      toast('当前角色无权访问该模块', 'err');
      return;
    }
    const switched = current !== id;
    current = id;
    document.getElementById('sidebar').querySelectorAll('[data-nav]').forEach(el => {
      el.classList.toggle('active', el.dataset.nav === id);
    });
    const mod = MODULES.find(m => m.id === id);
    const s = API.session();
    document.getElementById('tb-title').textContent = mod ? navLabel(mod, s.role) : id;
    const contentEl = document.getElementById('content');
    if (switched) {
      contentEl.classList.remove('page-enter');
      void contentEl.offsetWidth;
      contentEl.classList.add('page-enter');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    const fn = window.Modules && window.Modules[id];
    if (fn) fn(setContent, opts || {});
    else contentEl.innerHTML = '<div class="note warn">模块尚未实现</div>';
  }

  const setContent = html => { document.getElementById('content').innerHTML = html; };

  function modal(title, bodyHtml, footHtml, size) {
    const root = document.getElementById('modal-root');
    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.style.zIndex = String(500 + modalStack.length * 10);
    mask.innerHTML = `<div class="modal ${size || ''}">
      <div class="modal-head"><h3>${title}</h3><button class="modal-x" type="button" title="关闭（Esc）">×</button></div>
      <div class="modal-body">${bodyHtml}</div>
      ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}
    </div>`;
    root.appendChild(mask);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      const idx = modalStack.indexOf(close);
      if (idx >= 0) modalStack.splice(idx, 1);
      mask.classList.add('closing');
      setTimeout(() => { if (mask.parentNode) mask.parentNode.removeChild(mask); }, 155);
    };
    modalStack.push(close);
    mask.querySelector('.modal-x').onclick = close;
    mask.onclick = e => { if (e.target === mask) close(); };
    return { close, el: mask.querySelector('.modal'), root: mask };
  }

  function confirmBox(msg, onYes) {
    const m = modal('确认操作', `<p style="font-size:14px">${esc(msg)}</p>`,
      `<button class="btn ghost" id="cf-no">取消</button><button class="btn danger" id="cf-yes">确定</button>`, 'sm');
    m.el.querySelector('#cf-no').onclick = m.close;
    m.el.querySelector('#cf-yes').onclick = () => { m.close(); onYes(); };
  }

  function promptBox(title, label, defaultVal, placeholder, onSubmit, opts = {}) {
    const m = modal(title, `
      ${opts.note ? `<div class="note ${opts.warn ? 'warn' : ''}">${esc(opts.note)}</div>` : ''}
      ${fieldRow(label, `<input id="pr-input" value="${esc(defaultVal || '')}" placeholder="${esc(placeholder || '')}">`, true)}`,
      `<button class="btn ghost" id="pr-no">取消</button><button class="btn ${opts.danger ? 'danger' : ''}" id="pr-yes">${esc(opts.okText || '确认')}</button>`, 'sm');
    const inp = m.el.querySelector('#pr-input');
    setTimeout(() => { inp.focus(); inp.select(); }, 40);
    m.el.querySelector('#pr-no').onclick = m.close;
    const go = async () => {
      const val = inp.value.trim();
      if (opts.required && !val) { toast('请填写必填内容', 'err'); inp.focus(); return; }
      const keepOpen = await onSubmit(val, m);
      if (keepOpen !== true) m.close();
    };
    m.el.querySelector('#pr-yes').onclick = go;
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }

  // 附件控件与校验
  function attachmentFile(id) {
    return `<input id="${id}" type="file" accept="image/jpeg,image/png,application/pdf">`;
  }
  function validateAttachment(file) {
    if (!file) return '请选择要上传的文件';
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowed.includes(file.type)) return '附件类型仅允许 JPG、PNG、PDF';
    if (file.size <= 0) return '附件不能为空';
    if (file.size > 10 * 1024 * 1024) return '附件大小不得超过 10 MB';
    return null;
  }
  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',').pop());
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  }

  function fieldRow(label, inputHtml, full) {
    return `<div class="field ${full ? 'full' : ''}"><label>${label}</label>${inputHtml}</div>`;
  }

  function selectHtml(id, options, value, extra) {
    return `<select id="${id}" ${extra || ''}>${options.map(o => {
      const v = typeof o === 'object' ? o.value : o;
      const t = typeof o === 'object' ? o.label : o;
      return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(t)}</option>`;
    }).join('')}</select>`;
  }

  // 统一实时搜索框控件（含清空按钮与放大镜图标）
  function searchBoxHtml(id, placeholder, value = '') {
    return `<div class="search-box ${value ? 'has-val' : ''}" id="${id}-wrap">
      ${ICONS.search}
      <input id="${id}" placeholder="${esc(placeholder || '输入关键词筛选…')}" value="${esc(value)}" autocomplete="off">
      <button type="button" class="search-clear" id="${id}-clear" title="清空">×</button>
    </div>`;
  }

  function bindSearchBox(root, id, onChange) {
    const scope = root || document;
    const wrap = scope.querySelector(`#${id}-wrap`);
    const inp = scope.querySelector(`#${id}`);
    const clr = scope.querySelector(`#${id}-clear`);
    if (!inp) return;
    const fire = () => {
      const v = inp.value.trim();
      if (wrap) wrap.classList.toggle('has-val', !!inp.value);
      onChange(v);
    };
    inp.oninput = fire;
    if (clr) {
      clr.onclick = () => {
        inp.value = '';
        fire();
        inp.focus();
      };
    }
  }

  // FDI 国际标准四象限交互牙位图（支持单选与多选）
  const QUADS = [
    [18, 17, 16, 15, 14, 13, 12, 11],
    [21, 22, 23, 24, 25, 26, 27, 28],
    [48, 47, 46, 45, 44, 43, 42, 41],
    [31, 32, 33, 34, 35, 36, 37, 38],
  ];

  function toothChartHtml(id, selectedList = [], multi = false) {
    const sel = new Set((selectedList || []).map(String).filter(Boolean));
    return `<div class="tooth-chart" id="${id}">
      <div class="tooth-chart-top">
        <span>右上 (18-11) ｜ 左上 (21-28) · 右下 (48-41) ｜ 左下 (31-38)</span>
        <span>${multi ? '可点击多颗牙位多选' : '点击选择单颗牙位（再次点击取消表示全口）'}</span>
      </div>
      <div class="tooth-quad-grid">
        ${QUADS.map(q => `<div class="tooth-quad">${q.map(c =>
          `<button type="button" class="tooth-btn ${sel.has(String(c)) ? 'on' : ''}" data-tc="${c}" title="${c} ${API.toothName(String(c))}">${c}</button>`
        ).join('')}</div>`).join('')}
      </div>
      <div class="tooth-picked-bar">
        <span id="${id}-summary"></span>
        <button type="button" class="btn ghost sm" id="${id}-clear" style="min-height:24px;padding:2px 8px;font-size:11px">清空牙位</button>
      </div>
    </div>`;
  }

  function bindToothChart(root, id, multi = false, initial = [], onChange = null) {
    const box = (root || document).querySelector(`#${id}`);
    if (!box) return { get: () => [] };
    const picked = new Set((initial || []).map(String).filter(Boolean));

    function sync() {
      box.querySelectorAll('[data-tc]').forEach(b => {
        b.classList.toggle('on', picked.has(b.dataset.tc));
      });
      const arr = Array.from(picked);
      const sumEl = box.querySelector(`#${id}-summary`);
      if (sumEl) {
        sumEl.innerHTML = arr.length
          ? `已选 <b>${arr.length}</b> 颗：${arr.map(c => `<b>${c}</b>（${esc(API.toothName(c))}）`).join('、')}`
          : `<span class="muted">${multi ? '未指定牙位（草稿可留空，发送前须补齐）' : '不指定具体牙位（全口项目）'}</span>`;
      }
      if (onChange) onChange(arr);
    }

    box.querySelectorAll('[data-tc]').forEach(b => {
      b.onclick = () => {
        const c = b.dataset.tc;
        if (picked.has(c)) {
          picked.delete(c);
        } else {
          if (!multi) picked.clear();
          picked.add(c);
        }
        sync();
      };
    });
    const clr = box.querySelector(`#${id}-clear`);
    if (clr) clr.onclick = () => { picked.clear(); sync(); };
    sync();
    return {
      get: () => Array.from(picked),
      first: () => Array.from(picked)[0] || '',
    };
  }

  function openPrint(title, bodyHtml) {
    const w = window.open('', '_blank');
    if (!w) {
      toast('浏览器拦截了打印窗口，请允许弹窗后重试', 'err');
      return;
    }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>
        body{font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;padding:28px;color:#0E2229;line-height:1.6}
        h1{font-size:20px;margin:0 0 12px;padding-bottom:10px;border-bottom:2px solid #0C8C80}
        table{border-collapse:collapse;width:100%;margin-top:12px}
        th,td{border:1px solid #D5E0E6;padding:8px 11px;text-align:left;font-size:13px}
        th{background:#F2F6F9;width:130px;color:#2C444D}
      </style></head><body>${bodyHtml}<script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }

  async function init() {
    const loginView = document.getElementById('login-view');
    loginView.innerHTML = loginScene(`
      <div class="login-kicker">SYSTEM CHECK</div>
      <h1>连接诊所服务</h1>
      <div class="login-rule"></div>
      <div class="login-loading"><span aria-hidden="true"></span>正在检测服务状态…</div>
    `, 'loading');
    const h = await API.health();
    if (!h.ok) {
      loginView.innerHTML = loginScene(`
        <div class="login-kicker">CONNECTION FAILED</div>
        <h1>服务器不可用</h1>
        <div class="login-rule"></div>
        <p class="login-mini">${esc(h.error)}</p>
        <button class="btn block" id="lg-retry" type="button">重新连接</button>
      `, 'error');
      document.getElementById('lg-retry').onclick = init;
      return;
    }
    if (API.session()) {
      const rf = await API.refresh();
      if (rf.ok) { showApp(); return; }
      API.logout();
    }
    renderLogin();
  }

  return {
    init,
    setContent,
    navigate,
    updateBadges,
    onUnauthorized,
    modal,
    confirm: confirmBox,
    promptBox,
    toast,
    tag,
    esc,
    icon,
    avatar,
    progressBar,
    fieldRow,
    selectHtml,
    searchBoxHtml,
    bindSearchBox,
    toothChartHtml,
    bindToothChart,
    openPrint,
    attachmentFile,
    validateAttachment,
    readFileAsBase64,
    current: () => current,
  };
})();
