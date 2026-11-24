/* ============================================================
 * app.js — 口腔诊所临床与运营工作站核心外壳（v6）：
 * 品牌图标系统 + 多页签工作栏 + URL Hash 路由保持 + ⌘K 全局速查 + 表格排序分页 + FDI 牙位图
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

  const DEMO_ACCOUNTS = [
    ['13800000001', '患者',   '张伟',   '123456',   'patient'],
    ['receptionist','前台',   '王舒瑶', 'password', 'staff'],
    ['doctor',      '医生',   '李承泽', 'password', 'staff'],
    ['cashier',     '收费员', '张明轩', 'password', 'staff'],
    ['manager',     '负责人', '陈怀瑾', 'password', 'staff'],
    ['admin',       '管理员', '林致远', 'password', 'staff'],
  ];

  const BRAND_IMG = `<img src="assets/brand-icon.png?v=rel-v6" alt="口腔诊所管理系统" class="brand-img">`;

  const ICONS = {
    calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4"/></svg>`,
    clock:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
    bell:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    wallet:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M16 14h2"/></svg>`,
    box:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>`,
    heart:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-4.5-7-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5C19 16.5 12 21 12 21z"/></svg>`,
    check:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.95" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 12l2 2 4-4"/></svg>`,
    user:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M5 20c.8-3.8 3.2-5.5 7-5.5s6.2 1.7 7 5.5"/></svg>`,
    lock:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/></svg>`,
    phone:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 18h.01"/></svg>`,
    shield:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z"/></svg>`,
    refresh:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.95" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`,
    chevron:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`,
    search:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.95" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`,
    info:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>`,
  };

  let current = 'dashboard';
  let sidebarCollapsed = false;
  let spotlightModal = null;
  const modalStack = [];

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') {
      if (API.session()) {
        e.preventDefault();
        openSpotlight();
      }
      return;
    }
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

  // 丝滑自定义缓动滚动（使用 behavior: 'instant' 避免与 CSS scroll-behavior 冲突卡顿）
  function smoothGlideTo(targetY, duration = 800) {
    const startY = window.scrollY || window.pageYOffset || 0;
    const diff = targetY - startY;
    if (Math.abs(diff) < 2) return;
    const t0 = performance.now();
    const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    function step(now) {
      const p = Math.min(1, (now - t0) / duration);
      window.scrollTo({ top: startY + diff * ease(p), behavior: 'instant' });
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  window.addEventListener('hashchange', () => {
    if (!API.session()) return;
    const target = (location.hash || '').replace(/^#/, '');
    if (target && target !== current && API.can(target)) {
      navigate(target, {}, true);
    }
  });

  const sleep = ms => new Promise(res => setTimeout(res, ms));

  // 全屏平滑认证/切换角色过渡遮罩（3 秒加载圆环 + 分阶段临床握手提示 + 柔和淡入淡出）
  async function runAuthCeremony(taskPromise, captions) {
    const steps = captions || [
      '正在核验身份凭证与岗位权限…',
      '正在同步排班号源与临床业务数据…',
      '工作台准备就绪，正在进入系统…',
    ];
    const veil = document.createElement('div');
    veil.className = 'auth-veil';
    veil.innerHTML = `
      <div class="auth-veil-box">
        <div class="auth-ring-wrap">
          <div class="auth-ring"></div>
          ${BRAND_IMG}
        </div>
        <div class="auth-stage-title" id="auth-stage-txt">${esc(steps[0])}</div>
        <div class="auth-progress"><div class="auth-progress-bar" id="auth-pbar"></div></div>
        <div class="auth-stage-sub">口腔诊所临床与运营工作站 · 安全会话连接中</div>
      </div>`;
    document.body.appendChild(veil);
    // 触发渐显与 3s 进度条推进
    requestAnimationFrame(() => {
      veil.classList.add('visible');
      const bar = veil.querySelector('#auth-pbar');
      if (bar) bar.style.width = '100%';
    });

    const txtEl = veil.querySelector('#auth-stage-txt');
    const t1 = setTimeout(() => { if (txtEl && steps[1]) txtEl.textContent = steps[1]; }, 1050);
    const t2 = setTimeout(() => { if (txtEl && steps[2]) txtEl.textContent = steps[2]; }, 2150);

    const startTs = Date.now();
    const res = await taskPromise;
    if (!res || !res.ok) {
      clearTimeout(t1);
      clearTimeout(t2);
      // 即使报错也保留短暂平滑过渡，避免生硬闪断
      const elapsed = Date.now() - startTs;
      if (elapsed < 550) await sleep(550 - elapsed);
      veil.classList.remove('visible');
      setTimeout(() => { if (veil.parentNode) veil.parentNode.removeChild(veil); }, 320);
      return res;
    }

    // 严格保证至少 3000ms 的完整登录仪式感
    const remain = Math.max(0, 3000 - (Date.now() - startTs));
    if (remain > 0) await sleep(remain);
    clearTimeout(t1);
    clearTimeout(t2);
    return { ok: true, data: res.data, veil };
  }

  function finishVeilIntoApp(veil, welcomeMsg) {
    const loginView = document.getElementById('login-view');
    const appView = document.getElementById('app-view');
    appView.classList.add('view-pre-enter');
    showApp();
    loginView.classList.remove('view-fade-in');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        appView.classList.remove('view-pre-enter');
        appView.classList.add('view-entered');
        if (veil) {
          veil.classList.add('leaving');
          veil.classList.remove('visible');
          setTimeout(() => { if (veil.parentNode) veil.parentNode.removeChild(veil); }, 440);
        }
        if (welcomeMsg) toast(welcomeMsg, 'ok');
      });
    });
  }

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
    el._t = setTimeout(() => { el.className = 'toast'; }, 3000);
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
        <aside class="login-editorial">
          <h2 class="ed-hero-title">
            <span>现代口腔门诊</span>
            <span>诊疗管理系统</span>
          </h2>
        </aside>
        <main class="login-frame">
          <header class="login-mast">
            <div class="login-mark">${BRAND_IMG}</div>
            <div class="login-mast-name"><b>口腔诊所管理系统</b><span>DENTAL CLINIC WORKSTATION</span></div>
            <i aria-hidden="true"></i>
          </header>
          <section class="login-card">${inner}</section>
          ${state ? '' : `
          <div class="role-dock" aria-label="快捷账号预填">
            <div class="role-dock-head"><span>快捷账号预填</span><small>点击填入凭证</small></div>
            <div class="role-grid">
              ${DEMO_ACCOUNTS.map(([account, label, desc, pass, kind]) => `
                <button class="role-chip" type="button" data-demo="${account}" data-label="${label}" data-pass="${pass}" data-kind="${kind}" title="${label} · ${desc}">
                  <span class="role-chip-av">${label.slice(0, 1)}</span>
                  <div class="role-chip-txt"><b>${label}</b><small>${desc}</small></div>
                </button>`).join('')}
            </div>
          </div>`}
        </main>
        ${state ? '' : `
        <button type="button" class="scroll-cue" id="scroll-to-about" aria-label="向下滑动查看关于">
          <span class="scroll-cue-txt">关于</span>
          <span class="scroll-cue-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 8l5 5 5-5"/><path d="M7 14l5 5 5-5" opacity=".5"/>
            </svg>
          </span>
        </button>`}
      </div>
      ${state ? '' : `
      <section class="corp-about" id="corp-about" aria-label="关于作者">
        <div class="corp-about-inner">
          <div class="corp-about-head">
            <span class="corp-eyebrow">ABOUT</span>
            <h3>关于</h3>
          </div>
          <div class="corp-info-grid">
            <div class="corp-info-item"><span>姓名</span><b>陈荣杰</b></div>
            <div class="corp-info-item"><span>学号</span><b class="corp-num">8305240320</b></div>
            <div class="corp-info-item"><span>学院</span><b>中南大学商学院</b></div>
            <div class="corp-info-item"><span>班级</span><b>信管 <em class="corp-num-inline">T2401</em></b></div>
            <div class="corp-info-item"><span>指导老师</span><b>毕文杰</b></div>
          </div>
          <div class="corp-about-foot">
            <button type="button" class="scroll-up-btn" id="scroll-back-top">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 14l-5-5-5 5"/></svg>
              <span>返回顶部</span>
            </button>
          </div>
        </div>
      </section>`}`;
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
        <div class="login-switch">
          <button type="button" class="lsw-btn ${!isPat ? 'active' : ''}" data-lmode="staff">院内医护端</button>
          <button type="button" class="lsw-btn ${isPat ? 'active' : ''}" data-lmode="patient">患者自助端</button>
        </div>
        <h1 id="login-title">${isPat ? '患者自助服务' : '登录工作台'}</h1>
        <p class="login-sub">${isPat ? '验证预留手机号以预约挂号或查询进度' : '使用员工账号登录门诊系统'}</p>
        <div class="login-fields">
          ${isPat ? `
            <div class="login-field">
              <label for="lg-user">登记手机号</label>
              <div class="input-icon-wrap">
                <span class="in-ico">${ICONS.phone}</span>
                <input id="lg-user" placeholder="如 13800000001" autocomplete="tel">
              </div>
            </div>
            <div class="login-field">
              <label for="lg-pass">短信验证码</label>
              <div style="display:flex;gap:8px">
                <div class="input-icon-wrap" style="flex:1">
                  <span class="in-ico">${ICONS.shield}</span>
                  <input id="lg-pass" placeholder="6 位数字验证码" autocomplete="one-time-code">
                </div>
                <button class="btn ghost" id="lg-sms" type="button" style="white-space:nowrap;height:42px;padding:0 13px">获取验证码</button>
              </div>
            </div>
          ` : `
            <div class="login-field">
              <label for="lg-user">登录账号</label>
              <div class="input-icon-wrap">
                <span class="in-ico">${ICONS.user}</span>
                <input id="lg-user" placeholder="输入员工账号" autocomplete="username">
              </div>
            </div>
            <div class="login-field">
              <label for="lg-pass">登录密码</label>
              <div class="input-icon-wrap">
                <span class="in-ico">${ICONS.lock}</span>
                <input id="lg-pass" type="password" placeholder="输入登录密码" autocomplete="current-password">
              </div>
            </div>
          `}
        </div>
        <button class="btn block" id="lg-btn" type="button">${isPat ? '验证并进入' : '进入工作台'} <span aria-hidden="true">→</span></button>
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
          toast(`验证码已发送（演示码：${r.data.demo_code}，5 分钟内有效）`, 'ok');
        };
      }

      const go = async () => {
        const u = document.getElementById('lg-user').value.trim();
        const p = document.getElementById('lg-pass').value.trim();
        const err = document.getElementById('lg-err');
        const btn = document.getElementById('lg-btn');
        if (!u || !p) {
          err.className = 'lg-msg err';
          err.textContent = isPat ? '请输入登记手机号与短信验证码' : '请输入登录账号与密码';
          return;
        }
        err.textContent = '';
        btn.disabled = true;
        btn.innerHTML = `<span class="spin-dot"></span> 正在建立安全会话…`;
        const c = await runAuthCeremony(API.login(u, p, isPat ? 'patient_sms' : 'staff'));
        if (!c || !c.ok) {
          btn.disabled = false;
          btn.innerHTML = `${isPat ? '验证并进入' : '进入工作台'} <span aria-hidden="true">→</span>`;
          err.className = 'lg-msg err';
          err.textContent = (c && c.error) || '登录失败';
          return;
        }
        finishVeilIntoApp(c.veil, '登录成功，欢迎进入门诊工作台');
      };

      document.getElementById('lg-btn').onclick = go;
      document.getElementById('lg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      document.getElementById('lg-user').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('lg-pass').focus(); });

      document.querySelectorAll('[data-demo]').forEach(btn => {
        btn.onclick = () => {
          const targetMode = btn.dataset.kind === 'patient' ? 'patient' : 'staff';
          const pickedAcc = btn.dataset.demo;
          const pickedPass = btn.dataset.pass || 'password';
          const pickedLbl = btn.dataset.label || '演示';
          if (loginMode !== targetMode) {
            loginMode = targetMode;
            paint();
          }
          const uEl = document.getElementById('lg-user');
          const pEl = document.getElementById('lg-pass');
          const err = document.getElementById('lg-err');
          const lgBtn = document.getElementById('lg-btn');
          uEl.value = pickedAcc;
          pEl.value = pickedPass;
          [uEl, pEl].forEach(el => {
            el.classList.remove('prefill-pulse');
            void el.offsetWidth;
            el.classList.add('prefill-pulse');
          });
          err.className = 'lg-msg ok';
          err.textContent = `已填入「${pickedLbl}」账号凭证，请点击上方按钮登录`;
          document.querySelectorAll('[data-demo]').forEach(b => b.classList.toggle('active', b.dataset.demo === pickedAcc));
          if (lgBtn) lgBtn.focus();
        };
      });

      const cueBtn = document.getElementById('scroll-to-about');
      const aboutSec = document.getElementById('corp-about');
      const backBtn = document.getElementById('scroll-back-top');
      if (cueBtn && aboutSec) {
        cueBtn.onclick = () => {
          aboutSec.classList.add('revealed');
          smoothGlideTo(aboutSec.offsetTop, 800);
        };
      }
      if (backBtn) {
        backBtn.onclick = () => smoothGlideTo(0, 720);
      }
      if (aboutSec && 'IntersectionObserver' in window) {
        const io = new IntersectionObserver(entries => {
          entries.forEach(en => {
            if (en.isIntersecting) aboutSec.classList.add('revealed');
          });
        }, { threshold: 0.18 });
        io.observe(aboutSec);
      }
    }

    paint();
    window.onscroll = () => {
      const cue = document.getElementById('scroll-to-about');
      if (cue) cue.classList.toggle('hidden-cue', (window.scrollY || 0) > 100);
    };
  }

  function navLabel(mod, role) {
    if (role === 'patient' && PATIENT_NAV[mod.id]) return PATIENT_NAV[mod.id];
    if (role === 'receptionist' && RECEPTIONIST_NAV[mod.id]) return RECEPTIONIST_NAV[mod.id];
    return mod.name;
  }

  function showApp() {
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('app-view').style.display = 'flex';
    const allowed = MODULES.filter(m => API.can(m.id));
    const defaultId = allowed[0] ? allowed[0].id : 'dashboard';
    renderShell();
    updateBadges();
    const hashTarget = (location.hash || '').replace(/^#/, '');
    const startId = (hashTarget && API.can(hashTarget))
      ? hashTarget
      : (current && API.can(current) ? current : defaultId);
    navigate(startId);
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
        <div class="mark">${BRAND_IMG}</div>
        <div class="sb-brand-text"><b>口腔诊所管理</b><small>CLINIC WORKSTATION</small></div>
      </div>
      <div class="sb-nav">${nav}</div>
      <div class="sb-foot">
        <span class="sb-status"><i></i><span class="sb-foot-text">服务已连接</span></span>
        <button class="sb-toggle" id="sb-toggle" type="button" title="收起或展开侧边导航">${ICONS.chevron}</button>
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
        <span class="tb-crumb" id="tb-crumb">工作台</span>
        <span class="tb-sep">/</span>
        <div class="tb-title" id="tb-title">今日队列</div>
        <div class="tb-date">${esc(todayCn)}</div>
      </div>
      <div class="tb-right">
        <button class="cmdk-btn" id="tb-cmdk" type="button" title="全局速查患者、单号与功能跳转 (⌘K / Ctrl+K)">
          ${ICONS.search}
          <span>${s.role === 'patient' ? '快速检索我的记录…' : '查找患者 / 单号 / 页面…'}</span>
          <kbd>⌘K</kbd>
        </button>
        <button class="btn ghost icon-btn tb-refresh" id="tb-refresh" type="button" title="同步最新业务数据">${ICONS.refresh}</button>
        <div class="role-pop-wrap" id="role-pop-wrap">
          <div class="tb-profile clickable" id="tb-profile-btn" title="点击切换演示角色">
            <span class="avatar-badge">${esc(avatarChar)}</span>
            ${userLabel ? `<span class="tb-user">${esc(userLabel)}</span>` : ''}
            <span class="tb-role">${esc(roleLabel)}</span>
            <span class="tb-caret">▾</span>
          </div>
          <div class="role-pop" id="role-pop">
            <div class="role-pop-head"><span>切换岗位视角</span><span>RBAC</span></div>
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

    const cmdkBtn = document.getElementById('tb-cmdk');
    if (cmdkBtn) cmdkBtn.onclick = openSpotlight;

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
          const c = await runAuthCeremony(
            API.login(acc, btn.dataset.qpass, btn.dataset.qkind === 'patient' ? 'patient_sms' : 'staff'),
            ['正在切换岗位会话身份…', '正在按角色最小权限重载业务视图…', '切换完成，正在展开工作台…']
          );
          if (!c || !c.ok) { toast((c && c.error) || '角色切换失败', 'err'); return; }
          current = '';
          if (location.hash) history.replaceState(null, '', location.pathname + location.search);
          finishVeilIntoApp(c.veil, `已切换至「${window.SEED.ROLE_LABEL[c.data.role] || c.data.name}」视角`);
        };
      });
    }

    const rfBtn = document.getElementById('tb-refresh');
    if (rfBtn) {
      rfBtn.onclick = async () => {
        rfBtn.classList.add('spinning');
        const r = await API.refresh();
        setTimeout(() => rfBtn.classList.remove('spinning'), 340);
        if (r.ok) {
          const fn = window.Modules && window.Modules[current];
          if (fn) fn(setContent, {});
          toast('业务数据已同步', 'ok');
        }
      };
    }

    document.getElementById('logout-btn').onclick = () => {
      const appView = document.getElementById('app-view');
      const loginView = document.getElementById('login-view');
      appView.classList.remove('view-entered');
      appView.classList.add('view-fade-out');
      setTimeout(() => {
        API.logout();
        current = 'dashboard';
        if (location.hash) history.replaceState(null, '', location.pathname + location.search);
        appView.style.display = 'none';
        appView.classList.remove('view-fade-out');
        loginView.style.display = 'block';
        renderLogin();
        loginView.classList.remove('view-fade-in');
        void loginView.offsetWidth;
        loginView.classList.add('view-fade-in');
      }, 240);
    };
  }

  // 全局快速检索与直达面板（⌘K / Ctrl+K）
  function openSpotlight() {
    if (spotlightModal) {
      spotlightModal.close();
      spotlightModal = null;
      return;
    }
    const s = API.session();
    if (!s) return;
    const db = API.raw();

    const baseItems = [];
    // 1. 快捷新建动作
    if (['receptionist', 'admin'].includes(s.role) && API.can('appointments')) {
      baseItems.push({ cat: '快捷操作', title: '+ 登记并新建预约', sub: '三步选号向导', run: () => navigate('appointments', { autoCreate: true }) });
    }
    if (s.role === 'patient' && API.can('appointments')) {
      baseItems.push({ cat: '快捷操作', title: '+ 自助预约挂号', sub: '未来两周标准项目选号', run: () => navigate('appointments', { autoCreate: true }) });
    }
    if (['receptionist', 'admin'].includes(s.role) && API.can('patients')) {
      baseItems.push({ cat: '快捷操作', title: '+ 登记新患者档案', sub: '建档与联系方式校验', run: () => navigate('patients', { autoCreate: true }) });
    }
    if (['doctor', 'admin'].includes(s.role) && API.can('encounters')) {
      baseItems.push({ cat: '快捷操作', title: '+ 录入诊疗病历', sub: '主诉、诊断与复查建议', run: () => navigate('encounters', { autoCreate: true }) });
    }
    if (['doctor', 'admin'].includes(s.role) && API.can('plans')) {
      baseItems.push({ cat: '快捷操作', title: '+ 制定分期治疗计划', sub: 'FDI 牙位图点选与报价快照', run: () => navigate('plans', { autoCreate: true }) });
    }
    if (['doctor', 'admin'].includes(s.role) && API.can('orders')) {
      baseItems.push({ cat: '快捷操作', title: '+ 新建义齿加工草稿', sub: '多牙位选择与附件托管', run: () => navigate('orders', { autoCreate: true }) });
    }
    if (['cashier', 'admin'].includes(s.role) && API.can('billing')) {
      baseItems.push({ cat: '快捷操作', title: '+ 开具收费单', sub: '项目计价与首笔收款', run: () => navigate('billing', { autoCreate: true }) });
    }

    // 2. 页面导航
    MODULES.filter(m => API.can(m.id)).forEach(m => {
      const lbl = navLabel(m, s.role);
      baseItems.push({ cat: '页面跳转', title: lbl, sub: m.group, kw: `${lbl} ${m.id} ${m.group}`, run: () => navigate(m.id) });
    });

    // 3. 角色权限范围内的业务单据索引
    const dataItems = [];
    if (API.can('patients')) {
      (db.patients || []).forEach(p => {
        dataItems.push({
          cat: '患者档案',
          title: `${p.name}（${p.patient_no}）`,
          sub: `${p.phone || '无电话'}${p.important_note ? ' · ' + p.important_note : ''}`,
          kw: `${p.patient_no} ${p.name} ${p.phone || ''}`,
          run: () => navigate('patients', { keyword: p.patient_no }),
        });
      });
    }
    if (API.can('appointments')) {
      (db.appointments || []).forEach(a => {
        const pt = (db.patients || []).find(x => x.id == a.patient_id);
        const ptSuffix = s.role === 'patient' ? '' : ` · ${pt ? pt.name : '患者'}`;
        dataItems.push({
          cat: '预约记录',
          title: `${a.appointment_no}${ptSuffix}`,
          sub: `${String(a.starts_at || '').slice(0, 16).replace('T', ' ')} · ${a.stage}`,
          kw: `${a.appointment_no} ${s.role === 'patient' ? '' : (pt ? pt.name : '')} ${a.starts_at} ${a.stage}`,
          run: () => navigate('appointments', { keyword: a.appointment_no, scope: 'all' }),
        });
      });
    }
    if (API.can('billing')) {
      (db.bills || []).forEach(b => {
        const pt = API.patientOfBill(b.id);
        const ptSuffix = (s.role === 'patient' || !pt) ? '' : ` · ${pt.name}`;
        dataItems.push({
          cat: '收费账单',
          title: `${b.bill_no}${ptSuffix}`,
          sub: `应收 ¥${Number(b.receivable || 0).toFixed(2)} · ${b.stage}`,
          kw: `${b.bill_no} ${pt ? pt.name : ''} ${b.stage}`,
          run: () => navigate('billing', { keyword: b.bill_no }),
        });
      });
    }
    if (API.can('orders')) {
      (db.orders || []).forEach(o => {
        const pt = API.patientOfOrder(o.id);
        dataItems.push({
          cat: '义齿订单',
          title: `${o.order_no}${pt ? ' · ' + pt.name : ''}`,
          sub: `${o.stage}${o.promised_date ? ' · 承诺日 ' + o.promised_date : ''}`,
          kw: `${o.order_no} ${pt ? pt.name : ''} ${o.stage}`,
          run: () => navigate('orders', { keyword: o.order_no }),
        });
      });
    }

    const root = document.getElementById('modal-root');
    const mask = document.createElement('div');
    mask.className = 'modal-mask cmdk-mask';
    mask.style.zIndex = String(600 + modalStack.length * 10);
    mask.innerHTML = `<div class="cmdk-panel" role="dialog" aria-label="全局速查">
      <div class="cmdk-head">
        ${ICONS.search}
        <input id="cmdk-in" placeholder="输入姓名、手机号、单号（P/A/B/O）或功能名称…" autocomplete="off">
        <kbd class="cmdk-esc">ESC</kbd>
      </div>
      <div class="cmdk-list" id="cmdk-list"></div>
      <div class="cmdk-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
        <span><kbd>Enter</kbd> 直达</span>
        <span><kbd>Esc</kbd> 关闭</span>
      </div>
    </div>`;
    root.appendChild(mask);

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      spotlightModal = null;
      const i = modalStack.indexOf(close);
      if (i >= 0) modalStack.splice(i, 1);
      mask.classList.add('closing');
      setTimeout(() => { if (mask.parentNode) mask.parentNode.removeChild(mask); }, 150);
    };
    modalStack.push(close);
    spotlightModal = { close };
    mask.onclick = e => { if (e.target === mask) close(); };
    mask.querySelector('.cmdk-esc').onclick = close;

    const inp = mask.querySelector('#cmdk-in');
    const listEl = mask.querySelector('#cmdk-list');
    let filtered = [];
    let selIdx = 0;

    function renderList() {
      const q = inp.value.trim().toLowerCase();
      if (!q) {
        filtered = baseItems.concat(dataItems.slice(0, 8));
      } else {
        filtered = baseItems.concat(dataItems).filter(it =>
          `${it.title} ${it.sub || ''} ${it.kw || ''} ${it.cat}`.toLowerCase().includes(q)
        ).slice(0, 24);
      }
      if (selIdx >= filtered.length) selIdx = 0;
      if (!filtered.length) {
        listEl.innerHTML = `<div class="cmdk-empty">未找到与「${esc(inp.value.trim())}」匹配的权限内记录或页面</div>`;
        return;
      }
      listEl.innerHTML = filtered.map((it, i) => `
        <button type="button" class="cmdk-item ${i === selIdx ? 'active' : ''}" data-cidx="${i}">
          <span class="cmdk-cat">${esc(it.cat)}</span>
          <span class="cmdk-main"><b>${esc(it.title)}</b><small>${esc(it.sub || '')}</small></span>
          <span class="cmdk-enter">↵</span>
        </button>`).join('');
      listEl.querySelectorAll('[data-cidx]').forEach(btn => {
        const idx = Number(btn.dataset.cidx);
        btn.onmouseenter = () => {
          selIdx = idx;
          listEl.querySelectorAll('.cmdk-item').forEach((el, k) => el.classList.toggle('active', k === selIdx));
        };
        btn.onclick = () => {
          const item = filtered[idx];
          close();
          if (item && item.run) item.run();
        };
      });
    }

    inp.oninput = () => { selIdx = 0; renderList(); };
    inp.onkeydown = e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filtered.length) { selIdx = (selIdx + 1) % filtered.length; renderList(); }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filtered.length) { selIdx = (selIdx - 1 + filtered.length) % filtered.length; renderList(); }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = filtered[selIdx];
        if (item) { close(); item.run(); }
      }
    };
    renderList();
    setTimeout(() => inp.focus(), 20);
  }

  function onUnauthorized() {
    document.getElementById('app-view').style.display = 'none';
    document.getElementById('login-view').style.display = 'block';
    renderLogin();
    toast('会话已过期，请重新登录', 'err');
  }

  function navigate(id, opts, fromHash) {
    if (!API.can(id)) {
      toast('当前角色无权访问该模块', 'err');
      return;
    }
    const switched = current !== id;
    current = id;
    if (!fromHash && location.hash !== '#' + id) {
      history.replaceState(null, '', '#' + id);
    }

    const sb = document.getElementById('sidebar');
    if (sb) {
      sb.querySelectorAll('[data-nav]').forEach(el => {
        el.classList.toggle('active', el.dataset.nav === id);
      });
    }
    const mod = MODULES.find(m => m.id === id);
    const s = API.session();
    const titleEl = document.getElementById('tb-title');
    const crumbEl = document.getElementById('tb-crumb');
    if (titleEl && mod && s) titleEl.textContent = navLabel(mod, s.role);
    if (crumbEl && mod && s) {
      crumbEl.textContent = s.role === 'patient' ? '自助服务'
        : (s.role === 'receptionist' && mod.id === 'reports' ? '技工与跟进' : mod.group);
    }

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

  const setContent = html => {
    const el = document.getElementById('content');
    el.innerHTML = html;
    queueMicrotask(() => enhanceTables(el));
  };

  /* ============================================================
   * 表格增强器：表头点击排序（数字/金额/日期/中文）+ 自适应分页条
   * ============================================================ */
  function parseSortVal(txt) {
    const s = String(txt || '').trim();
    if (!s || s === '—') return { type: 2, v: '' };
    const money = s.replace(/^[¥￥]/, '').replace(/,/g, '');
    if (/^-?\d+(\.\d+)?%?$/.test(money)) {
      return { type: 0, v: parseFloat(money) };
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      return { type: 0, v: Date.parse(s.slice(0, 19).replace(' ', 'T')) || 0 };
    }
    return { type: 1, v: s };
  }

  function enhanceTables(root) {
    const scope = root || document.getElementById('content');
    if (!scope) return;
    scope.querySelectorAll('table.tbl').forEach(tbl => {
      if (tbl._enhanced) {
        if (tbl._syncPager) tbl._syncPager();
        return;
      }
      const thead = tbl.querySelector('thead');
      const tbody = tbl.querySelector('tbody');
      if (!thead || !tbody) return;
      tbl._enhanced = true;

      let page = 1;
      let pageSize = 12;

      // 挂载分页容器（紧随 .table-wrap 或 table 之后）
      const wrap = tbl.closest('.table-wrap') || tbl;
      const pager = document.createElement('div');
      pager.className = 'tbl-pager';
      pager.style.display = 'none';
      wrap.insertAdjacentElement('afterend', pager);

      function activeRows() {
        return Array.from(tbody.querySelectorAll(':scope > tr')).filter(tr => {
          if (tr.querySelector('.empty')) return false;
          if (tr.style.display === 'none') return false;
          return true;
        });
      }

      function syncPager() {
        // 先移除全部分页隐藏标记
        tbody.querySelectorAll(':scope > tr.is-paged-out').forEach(tr => tr.classList.remove('is-paged-out'));
        const rows = activeRows();
        const total = rows.length;
        if (total <= 12 && pageSize === 12) {
          pager.style.display = 'none';
          return;
        }
        if (total === 0) {
          pager.style.display = 'none';
          return;
        }
        const effectiveSize = pageSize === 0 ? total : pageSize;
        const totalPages = Math.max(1, Math.ceil(total / effectiveSize));
        if (page > totalPages) page = totalPages;
        if (page < 1) page = 1;
        const startIdx = (page - 1) * effectiveSize;
        const endIdx = startIdx + effectiveSize;
        rows.forEach((tr, idx) => {
          if (idx < startIdx || idx >= endIdx) tr.classList.add('is-paged-out');
        });

        pager.style.display = 'flex';
        const pages = [];
        for (let p = 1; p <= totalPages; p++) {
          if (totalPages <= 7 || p === 1 || p === totalPages || Math.abs(p - page) <= 1) {
            pages.push(p);
          } else if (pages[pages.length - 1] !== '…') {
            pages.push('…');
          }
        }
        pager.innerHTML = `
          <div class="tp-info">共 <b>${total}</b> 条记录 · 显示 ${startIdx + 1}–${Math.min(endIdx, total)}</div>
          <div class="tp-right">
            <select class="tp-size" aria-label="每页行数">
              <option value="12" ${pageSize === 12 ? 'selected' : ''}>12 条/页</option>
              <option value="25" ${pageSize === 25 ? 'selected' : ''}>25 条/页</option>
              <option value="0" ${pageSize === 0 ? 'selected' : ''}>显示全部</option>
            </select>
            ${totalPages > 1 ? `<div class="tp-btns">
              <button type="button" class="tp-btn" data-tp="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹</button>
              ${pages.map(p => p === '…'
                ? '<span class="tp-dots">…</span>'
                : `<button type="button" class="tp-btn ${p === page ? 'active' : ''}" data-tp="${p}">${p}</button>`
              ).join('')}
              <button type="button" class="tp-btn" data-tp="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>›</button>
            </div>` : ''}
          </div>`;
        const sizeSel = pager.querySelector('.tp-size');
        if (sizeSel) {
          sizeSel.onchange = () => {
            pageSize = Number(sizeSel.value);
            page = 1;
            syncPager();
          };
        }
        pager.querySelectorAll('[data-tp]').forEach(b => {
          b.onclick = () => {
            const np = Number(b.dataset.tp);
            if (np >= 1 && np <= totalPages && np !== page) {
              page = np;
              syncPager();
            }
          };
        });
      }

      // 表头点击排序
      const ths = Array.from(thead.querySelectorAll('th'));
      ths.forEach((th, colIdx) => {
        const txt = th.textContent.trim();
        if (!txt || txt === '操作' || txt === '附件') return;
        th.classList.add('is-sortable');
        th.title = '点击按此列排序';
        th.onclick = () => {
          const curDir = th.dataset.sortDir === 'asc' ? 'desc' : 'asc';
          ths.forEach(x => { delete x.dataset.sortDir; });
          th.dataset.sortDir = curDir;
          const allTrs = Array.from(tbody.querySelectorAll(':scope > tr')).filter(tr => !tr.querySelector('.empty'));
          if (allTrs.length <= 1) return;
          allTrs.sort((ra, rb) => {
            const ca = ra.children[colIdx] ? ra.children[colIdx].textContent : '';
            const cb = rb.children[colIdx] ? rb.children[colIdx].textContent : '';
            const pa = parseSortVal(ca);
            const pb = parseSortVal(cb);
            if (pa.type !== pb.type) return pa.type - pb.type;
            let cmp = 0;
            if (pa.type === 0) cmp = pa.v - pb.v;
            else cmp = String(pa.v).localeCompare(String(pb.v), 'zh-CN', { numeric: true });
            return curDir === 'asc' ? cmp : -cmp;
          });
          applyingSort = true;
          allTrs.forEach(tr => tbody.appendChild(tr));
          applyingSort = false;
          page = 1;
          syncPager();
        };
      });

      let applyingSort = false;
      const obs = new MutationObserver(() => {
        if (applyingSort) return;
        page = 1;
        syncPager();
      });
      obs.observe(tbody, { childList: true });

      tbl._syncPager = syncPager;
      syncPager();
    });
  }

  function syncTables(root) {
    const scope = root || document.getElementById('content');
    if (!scope) return;
    scope.querySelectorAll('table.tbl').forEach(tbl => {
      if (tbl._syncPager) tbl._syncPager();
    });
  }

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
    queueMicrotask(() => enhanceTables(mask));
    return { close, el: mask.querySelector('.modal'), root: mask };
  }

  function confirmBox(msg, onYes) {
    const m = modal('操作确认', `<p style="font-size:14px;line-height:1.65">${esc(msg)}</p>`,
      `<button class="btn ghost" id="cf-no">取消</button><button class="btn danger" id="cf-yes">确认执行</button>`, 'sm');
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

  // 统一实时搜索框控件（兼容 bindSearchBox(id, fn) 与 bindSearchBox(root, id, fn) 两种调用签名）
  function searchBoxHtml(id, placeholder, value = '') {
    return `<div class="search-box ${value ? 'has-val' : ''}" id="${id}-wrap">
      ${ICONS.search}
      <input id="${id}" placeholder="${esc(placeholder || '输入关键词筛选…')}" value="${esc(value)}" autocomplete="off">
      <button type="button" class="search-clear" id="${id}-clear" title="清空">×</button>
    </div>`;
  }

  function bindSearchBox(rootOrId, idOrFn, maybeFn) {
    let scope = document;
    let id = rootOrId;
    let onChange = idOrFn;
    if (typeof rootOrId !== 'string') {
      scope = rootOrId || document;
      id = idOrFn;
      onChange = maybeFn;
    }
    const wrap = scope.querySelector(`#${id}-wrap`);
    const inp = scope.querySelector(`#${id}`);
    const clr = scope.querySelector(`#${id}-clear`);
    if (!inp || typeof onChange !== 'function') return;
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
        <span>右上 (18–11) ｜ 左上 (21–28) · 右下 (48–41) ｜ 左下 (31–38)</span>
        <span>${multi ? '点击牙位支持多颗连选' : '点击选择单颗牙位（再次点击取消表示全口）'}</span>
      </div>
      <div class="tooth-quad-grid">
        ${QUADS.map(q => `<div class="tooth-quad">${q.map(c =>
          `<button type="button" class="tooth-btn ${sel.has(String(c)) ? 'on' : ''}" data-tc="${c}" title="${c} ${API.toothName(String(c))}">${c}</button>`
        ).join('')}</div>`).join('')}
      </div>
      <div class="tooth-picked-bar">
        <span id="${id}-summary"></span>
        <button type="button" class="btn ghost sm" id="${id}-clear" style="min-height:24px;padding:2px 8px;font-size:11px">清空选择</button>
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
        body{font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB',sans-serif;padding:36px 40px;color:#0F172A;line-height:1.65;font-variant-numeric:tabular-nums}
        h1{font-family:'Newsreader','Noto Serif SC','Songti SC','STSong',serif;font-size:22px;font-weight:600;letter-spacing:.04em;margin:0 0 16px;padding-bottom:12px;border-bottom:1.5px solid #0F172A}
        table{border-collapse:collapse;width:100%;margin-top:14px}
        th,td{border:1px solid #CBD5E1;padding:9px 13px;text-align:left;font-size:13px}
        th{background:#F8FAFC;width:136px;color:#334155;font-weight:600;letter-spacing:.03em}
      </style></head><body>${bodyHtml}<script>window.onload=()=>window.print()<\/script></body></html>`);
    w.document.close();
  }

  async function init() {
    const loginView = document.getElementById('login-view');
    loginView.innerHTML = loginScene(`
      <div class="login-kicker">CONNECTING</div>
      <h1>正在连接门诊服务</h1>
      <p class="login-sub">正在校验数据库连接与会话状态…</p>
      <div class="login-loading"><span aria-hidden="true"></span>请稍候</div>
    `, 'loading');
    const h = await API.health();
    if (!h.ok) {
      loginView.innerHTML = loginScene(`
        <div class="login-kicker">OFFLINE</div>
        <h1>服务暂时不可用</h1>
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
    openSpotlight,
    enhanceTables,
    syncTables,
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
