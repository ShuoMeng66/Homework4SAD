/* ============================================================
 * app.js — SPA 框架：双模式登录（员工账号 + 患者短信验证码）、角色快捷体验、菜单鉴权与通用 UI
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

  let current = 'dashboard';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function toast(msg, type) {
    const el = document.getElementById('toast');
    el.textContent = msg;
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
        <main class="login-frame">
          <header class="login-mast">
            <div class="login-mark">＋</div>
            <div class="login-mast-name"><b>口腔诊所管理系统</b><span>DENTAL CLINIC SYSTEM</span></div>
            <i aria-hidden="true"></i>
          </header>
          <section class="login-card">${inner}</section>
          ${state ? '' : `
          <div class="role-dock" aria-label="角色切换说明">
            <span>按角色快速体验</span>
            <div class="role-grid">
              ${DEMO_ACCOUNTS.map(([account, label, desc, pass, kind]) => `
                <button class="role-chip" type="button" data-demo="${account}" data-pass="${pass}" data-kind="${kind}" title="${desc}">
                  <b>${label}</b><small>${desc}</small>
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
        <div class="tabs" style="margin:-4px 0 14px">
          <div class="tab ${!isPat ? 'active' : ''}" data-lmode="staff">诊所员工登录</div>
          <div class="tab ${isPat ? 'active' : ''}" data-lmode="patient">患者自助登录</div>
        </div>
        <h1 id="login-title">${isPat ? '患者自助入口' : '进入诊所工作台'}</h1>
        <div class="login-rule"></div>
        <div class="login-fields">
          ${isPat ? `
            <div class="login-field">
              <label for="lg-user">手机号</label>
              <input id="lg-user" placeholder="输入登记的手机号（如 13800000001）" autocomplete="tel">
            </div>
            <div class="login-field">
              <label for="lg-pass">短信验证码</label>
              <div style="display:flex;gap:8px">
                <input id="lg-pass" placeholder="6 位验证码" style="flex:1" autocomplete="one-time-code">
                <button class="btn ghost sm" id="lg-sms" type="button" style="white-space:nowrap">获取验证码</button>
              </div>
            </div>
          ` : `
            <div class="login-field">
              <label for="lg-user">账号</label>
              <input id="lg-user" placeholder="输入员工账号" autocomplete="username">
            </div>
            <div class="login-field">
              <label for="lg-pass">密码</label>
              <input id="lg-pass" type="password" placeholder="••••••••" autocomplete="current-password">
            </div>
          `}
        </div>
        <button class="btn block" id="lg-btn" type="button">${isPat ? '验证码登录' : '登 录'} <span aria-hidden="true">→</span></button>
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
          const r = await API.requestSmsCode(phone);
          smsBtn.disabled = false;
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
        if (!u || !p) { err.textContent = isPat ? '请输入手机号与验证码' : '请输入账号与密码'; return; }
        err.textContent = '正在验证并加载数据…';
        const r = await API.login(u, p, isPat ? 'patient_sms' : 'staff');
        if (!r.ok) { err.textContent = r.error; return; }
        showApp();
        toast('登录成功', 'ok');
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
    const allowed = MODULES.filter(m => API.can(m.id));
    navigate(current && API.can(current) ? current : (allowed[0] ? allowed[0].id : 'dashboard'));
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
        nav += `<div class="nav-item" data-nav="${m.id}"><span class="ico">${m.icon}</span><span>${navLabel(m, s.role)}</span></div>`;
      });
    });
    document.getElementById('sidebar').innerHTML = `
      <div class="sb-brand"><div class="mark">＋</div><div><b>口腔诊所管理</b><small>DENTAL CLINIC</small></div></div>
      <div class="sb-nav">${nav}</div>
      <div class="sb-foot">诊所服务运行中</div>`;
    document.getElementById('sidebar').querySelectorAll('[data-nav]').forEach(el => {
      el.onclick = () => navigate(el.dataset.nav);
    });
    const roleLabel = window.SEED.ROLE_LABEL[s.role] || '';
    const userLabel = s.name && s.name !== roleLabel ? s.name : '';
    const avatarChar = (userLabel || roleLabel || '医').slice(0, 1);
    const todayCn = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
    document.getElementById('topbar').innerHTML = `
      <div class="tb-left">
        <div class="tb-title" id="tb-title">今日队列</div>
        <div class="tb-date">${esc(todayCn)}</div>
      </div>
      <div class="tb-right">
        <div class="tb-profile">
          <span class="avatar-badge">${esc(avatarChar)}</span>
          ${userLabel ? `<span class="tb-user">${esc(userLabel)}</span>` : ''}
          <span class="tb-role">${esc(roleLabel)}</span>
        </div>
        <button class="btn ghost sm" id="logout-btn">退出</button>
      </div>`;
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
    current = id;
    document.getElementById('sidebar').querySelectorAll('[data-nav]').forEach(el => {
      el.classList.toggle('active', el.dataset.nav === id);
    });
    const mod = MODULES.find(m => m.id === id);
    const s = API.session();
    document.getElementById('tb-title').textContent = mod ? navLabel(mod, s.role) : id;
    const fn = window.Modules && window.Modules[id];
    if (fn) fn(setContent, opts || {});
    else document.getElementById('content').innerHTML = '<div class="note warn">模块尚未实现</div>';
  }

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

  // 附件控件与校验（文件实体交由服务端文件存储托管，不落数据库）
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
    onUnauthorized,
    modal,
    confirm: confirmBox,
    toast,
    tag,
    esc,
    fieldRow,
    selectHtml,
    attachmentFile,
    validateAttachment,
    readFileAsBase64,
    current: () => current,
  };
})();
