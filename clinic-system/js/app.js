/* ============================================================
 * app.js — SPA 框架：登录、鉴权、菜单、路由、通用 UI 工具
 * ============================================================ */
window.App = (function () {
  const MODULES = [
    { id: 'dashboard',    name: '工作台',     icon: '▦', group: '概览' },
    { id: 'patients',     name: '患者管理',   icon: '♙', group: '业务' },
    { id: 'appointments', name: '预约管理',   icon: '▤', group: '业务' },
    { id: 'encounters',   name: '诊疗记录',   icon: '✚', group: '业务' },
    { id: 'billing',      name: '收费欠款',   icon: '¥', group: '业务' },
    { id: 'orders',       name: '义齿订单',   icon: '⬡', group: '业务' },
    { id: 'reports',      name: '查询统计',   icon: '▥', group: '管理' },
    { id: 'basic',        name: '基础信息',   icon: '⚙', group: '管理' },
  ];
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

  function renderLogin() {
    const s = API.session();
    if (s) { showApp(); return; }
    document.getElementById('login-view').innerHTML = `
      <div class="login-card">
        <div class="login-logo"><div class="mark">＋</div><div><h1>口腔诊所管理系统</h1></div></div>
        <div class="login-sub">Dental Clinic Management System · 系统分析与设计课程作业</div>
        <div class="field"><label>账号</label><input id="lg-user" placeholder="请输入账号" autocomplete="username"></div>
        <div class="field"><label>密码</label><input id="lg-pass" type="password" placeholder="请输入密码" autocomplete="current-password"></div>
        <button class="btn block" id="lg-btn">登 录</button>
        <div id="lg-err" style="color:var(--danger);font-size:12px;margin-top:10px;min-height:16px"></div>
        <div class="field" style="display:flex;align-items:center;gap:10px;margin-top:6px">
          <label style="margin:0;display:flex;align-items:center;gap:6px;font-weight:400">
            <input type="checkbox" id="lg-remote" ${API.remote.enabled()?'checked':''} style="width:auto"> 连接服务器（真实后端）
          </label>
        </div>
        <div class="login-hint"><b>演示账号（密码均为 password）</b>
          <code>receptionist</code> 前台　<code>doctor</code> 医生　<code>cashier</code> 收费员<br>
          <code>manager</code> 负责人　<code>admin</code> 管理员
        </div>
      </div>`;
    const go = async () => {
      const u = document.getElementById('lg-user').value.trim();
      const p = document.getElementById('lg-pass').value;
      const remote = document.getElementById('lg-remote').checked;
      API.remote.set(remote);
      const err = document.getElementById('lg-err');
      err.textContent = remote ? '正在连接服务器…' : '';
      const r = remote ? await API.loginRemote(u, p) : API.login(u, p);
      if (!r.ok) { err.textContent = r.error; return; }
      showApp();
      if (remote) toast('已连接服务器后端', 'ok');
    };
    document.getElementById('lg-btn').onclick = go;
    document.getElementById('lg-pass').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  }

  function showApp() {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('app-view').style.display = 'flex';
    renderShell();
    navigate(current && API.can(current) ? current : 'dashboard');
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
        nav += `<div class="nav-item" data-nav="${m.id}"><span class="ico">${m.icon}</span><span>${m.name}</span></div>`;
      });
    });
    document.getElementById('sidebar').innerHTML = `
      <div class="sb-brand"><div class="mark">＋</div><div><b>口腔诊所管理</b><small>CLINIC MANAGEMENT</small></div></div>
      <div class="sb-nav">${nav}</div>
      <div class="sb-foot">SAD 课程作业 · v1.0</div>`;
    document.getElementById('sidebar').querySelectorAll('[data-nav]').forEach(el => {
      el.onclick = () => navigate(el.dataset.nav);
    });
    document.getElementById('topbar').innerHTML = `
      <div class="tb-title" id="tb-title">工作台</div>
      <div class="tb-right">
        <span class="tb-role">${esc(window.SEED.ROLE_LABEL[s.role])}</span>
        <span class="tb-user">${esc(s.name)}</span>
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
    document.getElementById('tb-title').textContent = mod ? mod.name : id;
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
    return { close, el: root.querySelector('.modal') };
  }

  function confirmBox(msg, onYes) {
    const m = modal('确认操作', `<p style="font-size:14px">${esc(msg)}</p>`,
      `<button class="btn ghost" id="cf-no">取消</button><button class="btn danger" id="cf-yes">确定</button>`, 'sm');
    m.el.querySelector('#cf-no').onclick = m.close;
    m.el.querySelector('#cf-yes').onclick = () => { m.close(); onYes(); };
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

  return {
    init: renderLogin,
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
