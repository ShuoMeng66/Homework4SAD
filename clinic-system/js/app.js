/* ============================================================
 * app.js — SPA 框架：登录、鉴权、菜单、路由、通用 UI 工具
 * ============================================================ */
window.App = (function () {
  const MODULES = [
    { id: 'dashboard',    name: '工作台',     icon: '▦', group: '概览' },
    { id: 'patients',     name: '患者管理',   icon: '♙', group: '业务' },
    { id: 'appointments', name: '预约管理',   icon: '▤', group: '业务' },
    { id: 'schedule',     name: '排班管理',   icon: '▦', group: '业务' },
    { id: 'recall',       name: '复诊召回',   icon: '⟳', group: '业务' },
    { id: 'treatment',    name: '我的治疗',   icon: '◈', group: '业务' },
    { id: 'encounters',   name: '诊疗记录',   icon: '✚', group: '业务' },
    { id: 'billing',      name: '收费欠款',   icon: '¥', group: '业务' },
    { id: 'orders',       name: '义齿订单',   icon: '⬡', group: '业务' },
    { id: 'reports',      name: '查询统计',   icon: '▥', group: '管理' },
    { id: 'design',       name: '设计图版',   icon: '▧', group: '管理' },
    { id: 'basic',        name: '基础信息',   icon: '⚙', group: '管理' },
  ];
  // 患者端沿用同一批模块，只换业务名称（同一份实现，不同权限与文案）
  const PATIENT_NAV = {
    appointments: '我的预约', treatment: '我的治疗', billing: '我的费用',
  };
  let current = 'dashboard';

  function h(html) { return html; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function toast(msg, type) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.className = 'toast show ' + (type === 'err' ? 'err' : type === 'ok' ? 'ok' : '');
    clearTimeout(el._t); el._t = setTimeout(() => { el.className = 'toast'; }, 2600);
  }
  function tag(stage) {
    const map = {
      '待确认': 'orange', '已确认': 'blue', '已到诊': 'teal', '已完成': 'green', '已取消': 'gray', '爽约': 'red',
      '成功': 'green', '失败': 'red', '待发送': 'orange',
      '草稿': 'gray', '已发送': 'blue', '已接收': 'teal', '试戴': 'orange', '质量确认': 'blue', '已交货': 'green', '返工': 'red', '取消': 'gray',
      '欠款中': 'orange', '已结清': 'green', '待重试': 'orange',
    };
    return `<span class="tag ${map[stage] || 'blue'}">${esc(stage)}</span>`;
  }

  const DEMO_ACCOUNTS = [
    ['13800000001', '患者', '自助预约与查费用', '123456'],
    ['receptionist', '前台', '登记、排班与预约', 'password'],
    ['doctor', '医生', '接诊录入与订单', 'password'],
    ['cashier', '收费', '收费支付与欠款', 'password'],
    ['manager', '负责人', '统计与召回跟踪', 'password'],
    ['admin', '管理员', '基础信息与全模块', 'password'],
  ];

  function loginScene(inner, state) {
    return `
      <div class="login-shell ${state ? 'is-' + state : ''}">
        <div class="login-photo" aria-hidden="true"></div>
        <main class="login-frame">
          <header class="login-mast">
            <div class="login-mark">＋</div>
            <div class="login-mast-name"><b>口腔诊所管理</b><span>CLINIC OPERATIONS</span></div>
            <i aria-hidden="true"></i>
          </header>
          <section class="login-card">${inner}</section>
          ${state ? '' : `
          <div class="role-dock" aria-label="角色模拟说明">
            <span>按角色体验业务</span>
            <div class="role-grid">
              ${DEMO_ACCOUNTS.map(([account, label, desc, pass]) => `
                <button class="role-chip" type="button" data-demo="${account}" data-pass="${pass}" title="${desc}">
                  <b>${label}</b><small>${desc}</small>
                </button>`).join('')}
            </div>
          </div>`}
          <footer class="login-caption">SAD COURSE PROJECT · 2026</footer>
        </main>
      </div>`;
  }

  function renderLogin() {
    const s = API.session();
    if (s) { showApp(); return; }
    document.getElementById('login-view').innerHTML = loginScene(`
      <div class="login-kicker">STAFF ACCESS · 01</div>
      <h1 id="login-title">进入工作台</h1>
      <div class="login-rule"></div>
      <div class="login-fields">
        <div class="login-field"><label for="lg-user">账号</label><input id="lg-user" placeholder="输入工号或角色名" autocomplete="username"></div>
        <div class="login-field"><label for="lg-pass">密码</label><input id="lg-pass" type="password" placeholder="••••••••" autocomplete="current-password"></div>
      </div>
      <button class="btn block" id="lg-btn" type="button">登 录 <span aria-hidden="true">→</span></button>
      <div id="lg-err" role="status" aria-live="polite"></div>
    `);
    const go = async () => {
      const u = document.getElementById('lg-user').value.trim();
      const p = document.getElementById('lg-pass').value;
      const err = document.getElementById('lg-err');
      err.textContent = '正在连接服务器…';
      const r = await API.login(u, p);
      if (!r.ok) { err.textContent = r.error; return; }
      const c = await API.connect();
      if (!c.ok) { err.textContent = c.error; API.logout(); return; }
      showApp();
      toast('已连接服务器 · 数据实时存储于后端', 'ok');
    };
    document.getElementById('lg-btn').onclick = go;
    document.getElementById('lg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    document.querySelectorAll('[data-demo]').forEach(btn => {
      btn.onclick = () => {
        document.getElementById('lg-user').value = btn.dataset.demo;
        document.getElementById('lg-pass').value = btn.dataset.pass || 'password';
        document.getElementById('lg-err').textContent = '';
        document.querySelectorAll('[data-demo]').forEach(b => b.classList.toggle('active', b === btn));
      };
    });
  }

  function showApp() {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('app-view').style.display = 'flex';
    renderShell();
    const allowed = MODULES.filter(m => API.can(m.id));
    navigate(current && API.can(current) ? current : (allowed[0] ? allowed[0].id : 'dashboard'));
  }

  function renderShell() {
    const s = API.session();
    // 侧栏（按角色过滤）
    const groups = {};
    MODULES.filter(m => API.can(m.id)).forEach(m => { (groups[m.group] = groups[m.group] || []).push(m); });
    let nav = '';
    Object.keys(groups).forEach(g => {
      nav += `<div class="sb-group">${g}</div>`;
      groups[g].forEach(m => {
        const nm = (s && s.role === 'patient' && PATIENT_NAV[m.id]) || m.name;
        nav += `<div class="nav-item" data-nav="${m.id}"><span class="ico">${m.icon}</span><span>${nm}</span></div>`;
      });
    });
    document.getElementById('sidebar').innerHTML = `
      <div class="sb-brand"><div class="mark">＋</div><div><b>口腔诊所管理</b><small>CLINIC MANAGEMENT</small></div></div>
      <div class="sb-nav">${nav}</div>
      <div class="sb-foot">SAD 课程作业 · v1.0</div>`;
    document.getElementById('sidebar').querySelectorAll('[data-nav]').forEach(el => {
      el.onclick = () => navigate(el.dataset.nav);
    });
    const roleLabel = window.SEED.ROLE_LABEL[s.role] || '';
    const userLabel = s.name && s.name !== roleLabel ? s.name : '';
    document.getElementById('topbar').innerHTML = `
      <div class="tb-title" id="tb-title">工作台</div>
      <div class="tb-right">
        <span class="tb-role">${esc(roleLabel)}</span>
        ${userLabel ? `<span class="tb-user">${esc(userLabel)}</span>` : ''}
        <button class="btn ghost sm" id="logout-btn">退出</button>
      </div>`;
    document.getElementById('logout-btn').onclick = () => {
      API.logout(); current = 'dashboard';
      document.getElementById('app-view').style.display = 'none';
      document.getElementById('login-view').style.display = 'flex';
      renderLogin();
    };
  }

  function navigate(id) {
    if (!API.can(id)) { toast('当前角色无权访问该模块', 'err'); return; }
    current = id;
    document.getElementById('sidebar').querySelectorAll('[data-nav]').forEach(el => el.classList.toggle('active', el.dataset.nav === id));
    const mod = MODULES.find(m => m.id === id);
    const s = API.session();
    document.getElementById('tb-title').textContent =
      mod ? ((s && s.role === 'patient' && PATIENT_NAV[id]) || mod.name) : id;
    const fn = window.Modules && window.Modules[id];
    if (fn) fn(setContent);
    else document.getElementById('content').innerHTML = '<div class="note warn">模块尚未实现</div>';
  }

  // 模块渲染入口：给模块传一个 setContent 函数
  const setContent = html => { document.getElementById('content').innerHTML = html; };

  function modal(title, bodyHtml, footHtml, size) {
    const root = document.getElementById('modal-root');
    root.innerHTML = `<div class="modal-mask">
      <div class="modal ${size || ''}">
        <div class="modal-head"><h3>${title}</h3><button class="modal-x" id="modal-x">×</button></div>
        <div class="modal-body">${bodyHtml}</div>
        ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}
      </div></div>`;
    const close = () => { root.innerHTML = ''; };
    document.getElementById('modal-x').onclick = close;
    root.querySelector('.modal-mask').onclick = e => { if (e.target.classList.contains('modal-mask')) close(); };
    return { close, el: root.querySelector('.modal'), root };
  }

  function confirmBox(msg, onYes) {
    const m = modal('确认操作', `<p style="font-size:14px">${esc(msg)}</p>`,
      `<button class="btn ghost" id="cf-no">取消</button><button class="btn danger" id="cf-yes">确定</button>`, 'sm');
    m.el.querySelector('#cf-no').onclick = m.close;
    m.el.querySelector('#cf-yes').onclick = () => { m.close(); onYes(); };
  }

  // 附件约束（表22）：仅允许诊所批准的类型与大小，文件不写入订单字段
  function attachmentFile(id) {
    return `<input id="${id}" type="file" accept="image/jpeg,image/png,application/pdf">`;
  }
  function validateAttachment(file) {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!allowed.includes(file.type)) return '附件类型仅允许 JPG、PNG、PDF';
    if (file.size <= 0) return '附件不能为空';
    if (file.size > 10 * 1024 * 1024) return '附件大小不得超过 10 MB';
    return null;
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

  async function init() {
    const loginView = document.getElementById('login-view');
    loginView.innerHTML = loginScene(`
      <div class="login-kicker">SYSTEM CHECK</div>
      <h1>连接服务器</h1>
      <div class="login-rule"></div>
      <div class="login-loading"><span aria-hidden="true"></span>正在读取诊所数据…</div>
    `, 'loading');
    const c = await API.connect();
    if (!c.ok) {
      loginView.innerHTML = loginScene(`
        <div class="login-kicker">CONNECTION FAILED</div>
        <h1>服务器不可用</h1>
        <div class="login-rule"></div>
        <p class="login-mini">${esc(c.error)}</p>
        <button class="btn block" id="lg-retry" type="button">重新连接</button>
      `, 'error');
      document.getElementById('lg-retry').onclick = init;
      return;
    }
    renderLogin();
  }

  return {
    init,
    setContent,
    navigate,
    modal,
    confirm: confirmBox,
    toast,
    tag,
    esc,
    h,
    fieldRow,
    selectHtml,
    current: () => current,
  };
})();
