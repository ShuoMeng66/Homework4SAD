/* 基础信息维护：价目表、预约类型、基础选项、产品、合作技工所、诊所、诊室、员工兼岗与账号管理 */
window.Modules = window.Modules || {};
window.Modules.basic = function (set) {
  const session = API.session() || {};
  const isAdmin = session.role === 'admin';
  const optionKinds = window.SEED.ENUM.optionKinds;
  let tab = 'options';
  let optKind = '全部类别';

  function render() {
    const db = API.raw();
    const tabs = [
      ['options', '分类基础选项'],
      ['price', '收费价目'],
      ['apptType', '预约类型'],
      ['product', '义齿产品'],
      ['lab', '合作技工所'],
      ['org', '诊所与诊室'],
      ['staff', '员工与兼岗'],
    ];
    if (isAdmin) {
      tabs.push(['accounts', '系统账号'], ['audit', '变更审计']);
    }

    let body = '';
    if (tab === 'options') {
      const list = (db.basicOptions || []).filter(o => optKind === '全部类别' || o.kind === optKind);
      body = `
        <div class="note">岗位、支付方式、通知渠道、附件类型、订单类型、颜色、盒子颜色和单位统一在此维护，编码在同一类别内唯一；已停用选项退出新业务选择。</div>
        <div class="toolbar">
          ${App.selectHtml('opt-kind-filter', ['全部类别', ...optionKinds], optKind)}
          <button class="btn" id="opt-add">+ 新增选项</button>
        </div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>类别</th><th>编码</th><th>名称</th><th>说明</th><th>排序</th><th>状态</th><th>操作</th>
        </tr></thead><tbody>
          ${list.map(o => `<tr>
            <td><span class="tag blue">${App.esc(o.kind)}</span></td>
            <td>${App.esc(o.code)}</td><td>${App.esc(o.name)}</td>
            <td class="muted">${App.esc(o.description || '—')}</td>
            <td>${o.sort_order}</td>
            <td>${o.active ? '<span class="tag green">启用</span>' : '<span class="tag gray">停用</span>'}</td>
            <td class="actions">
              <button class="btn ghost sm" data-opt-edit="${o.id}">编辑</button>
              <button class="btn ghost sm" data-opt-toggle="${o.id}">${o.active ? '停用' : '启用'}</button>
            </td></tr>`).join('')}
        </tbody></table></div>`;
    } else if (tab === 'price') {
      body = `
        <div class="toolbar"><button class="btn" id="pi-add">+ 新增收费价目</button></div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>编码</th><th>项目名称</th><th>单位</th><th>单价</th><th>更新时间</th><th>状态</th><th>操作</th>
        </tr></thead><tbody>
          ${(db.priceItems || []).map(p => `<tr>
            <td>${App.esc(p.item_code)}</td><td>${App.esc(p.name)}</td>
            <td>${App.esc(API.optionName(p.unit_id))}</td>
            <td>¥${Number(p.unit_price).toFixed(2)}</td>
            <td class="muted">${App.esc(String(p.updated_at || '').slice(0, 16))}</td>
            <td>${p.active ? '<span class="tag green">启用</span>' : '<span class="tag gray">停用</span>'}</td>
            <td class="actions"><button class="btn ghost sm" data-pi-edit="${p.id}">编辑</button></td>
          </tr>`).join('')}
        </tbody></table></div>`;
    } else if (tab === 'apptType') {
      body = `
        <div class="toolbar"><button class="btn" id="at-add">+ 新增预约类型</button></div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>编码</th><th>名称</th><th>标准时长</th><th>患者可自助</th><th>参考价提示</th><th>排序</th><th>状态</th><th>操作</th>
        </tr></thead><tbody>
          ${(db.appointmentTypes || []).map(t => `<tr>
            <td>${App.esc(t.code)}</td><td>${App.esc(t.name)}</td>
            <td>${t.duration_min} 分钟</td>
            <td>${t.self_bookable ? '<span class="tag green">开放自助</span>' : '<span class="tag gray">前台排程</span>'}</td>
            <td>${App.esc(t.price_hint || '—')}</td><td>${t.sort_order}</td>
            <td>${t.active ? '<span class="tag green">启用</span>' : '<span class="tag gray">停用</span>'}</td>
            <td class="actions"><button class="btn ghost sm" data-at-edit="${t.id}">编辑</button></td>
          </tr>`).join('')}
        </tbody></table></div>`;
    } else if (tab === 'product') {
      body = `
        <div class="toolbar"><button class="btn" id="pr-add">+ 新增义齿产品</button></div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>编码</th><th>产品名称</th><th>材料</th><th>规格</th><th>单位</th><th>必传附件</th><th>状态</th><th>操作</th>
        </tr></thead><tbody>
          ${(db.products || []).map(p => `<tr>
            <td>${App.esc(p.product_code)}</td><td>${App.esc(p.name)}</td>
            <td>${App.esc(p.material)}</td><td class="muted">${App.esc(p.specification || '—')}</td>
            <td>${App.esc(API.optionName(p.unit_id))}</td>
            <td>${p.requires_attachment ? '<span class="tag orange">是</span>' : '<span class="tag gray">否</span>'}</td>
            <td>${p.active ? '<span class="tag green">启用</span>' : '<span class="tag gray">停用</span>'}</td>
            <td class="actions"><button class="btn ghost sm" data-pr-edit="${p.id}">编辑</button></td>
          </tr>`).join('')}
        </tbody></table></div>`;
    } else if (tab === 'lab') {
      body = `
        <div class="toolbar"><button class="btn" id="lb-add">+ 新增合作技工所</button></div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>编码</th><th>名称</th><th>联系人</th><th>电话</th><th>地址</th><th>接口编码</th><th>状态</th><th>操作</th>
        </tr></thead><tbody>
          ${(db.dentalLabs || []).map(l => `<tr>
            <td>${App.esc(l.lab_code)}</td><td>${App.esc(l.name)}</td>
            <td>${App.esc(l.contact)}</td><td>${App.esc(l.phone)}</td>
            <td class="muted">${App.esc(l.address || '—')}</td>
            <td class="muted">${App.esc(l.interface_code || '—')}</td>
            <td>${l.active ? '<span class="tag green">启用</span>' : '<span class="tag gray">停用</span>'}</td>
            <td class="actions"><button class="btn ghost sm" data-lb-edit="${l.id}">编辑</button></td>
          </tr>`).join('')}
        </tbody></table></div>`;
    } else if (tab === 'org') {
      body = `
        <div class="grid cols-2">
          <div>
            <div class="toolbar"><b>诊所资料</b><button class="btn ghost sm" id="cl-add">+ 新增诊所</button></div>
            <div class="table-wrap"><table class="tbl"><thead><tr><th>编码</th><th>名称</th><th>电话</th><th>地址</th><th>状态</th><th>操作</th></tr></thead><tbody>
              ${(db.clinics || []).map(c => `<tr>
                <td>${App.esc(c.clinic_code)}</td><td>${App.esc(c.name)}</td>
                <td>${App.esc(c.phone || '—')}</td><td class="muted">${App.esc(c.address || '—')}</td>
                <td>${c.active ? '<span class="tag green">启用</span>' : '<span class="tag gray">停用</span>'}</td>
                <td><button class="btn ghost sm" data-cl-edit="${c.id}">编辑</button></td>
              </tr>`).join('')}
            </tbody></table></div>
          </div>
          <div>
            <div class="toolbar"><b>诊室配置</b><button class="btn ghost sm" id="rm-add">+ 新增诊室</button></div>
            <div class="table-wrap"><table class="tbl"><thead><tr><th>编码</th><th>诊室名称</th><th>楼层备注</th><th>状态</th><th>操作</th></tr></thead><tbody>
              ${(db.rooms || []).map(r => `<tr>
                <td>${App.esc(r.room_code)}</td><td>${App.esc(r.name)}</td>
                <td class="muted">${App.esc(r.floor_note || '—')}</td>
                <td>${r.active ? '<span class="tag green">启用</span>' : '<span class="tag gray">停用</span>'}</td>
                <td><button class="btn ghost sm" data-rm-edit="${r.id}">编辑</button></td>
              </tr>`).join('')}
            </tbody></table></div>
          </div>
        </div>`;
    } else if (tab === 'staff') {
      body = `
        <div class="note">医生作为员工岗位参与业务，员工兼岗通过岗位关联维护，支持一名员工同时担任多个岗位。已停用员工或撤岗医生不再参与新排班与接诊。</div>
        <div class="toolbar"><button class="btn" id="emp-add">+ 新增员工</button></div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>工号</th><th>姓名</th><th>电话</th><th>担任岗位（支持兼岗）</th><th>入职日期</th><th>状态</th><th>操作</th>
        </tr></thead><tbody>
          ${(db.employees || []).map(e => `<tr>
            <td>${App.esc(e.employee_no)}</td><td>${App.esc(e.name)}</td>
            <td>${App.esc(e.phone || '—')}</td>
            <td>${(e.role_names || []).map(n => `<span class="tag blue">${App.esc(n)}</span>`).join(' ') || '—'}</td>
            <td>${App.esc(e.joined_on || '—')}</td>
            <td>${e.active ? '<span class="tag green">启用</span>' : '<span class="tag gray">停用</span>'}</td>
            <td><button class="btn ghost sm" data-emp-edit="${e.id}">编辑 / 兼岗</button></td>
          </tr>`).join('')}
        </tbody></table></div>`;
    } else if (tab === 'accounts' && isAdmin) {
      body = `
        <div class="note">系统管理员维护登录账号与角色绑定（患者亦可直接通过登记手机号获取短信验证码自助登录）。</div>
        <div class="toolbar"><button class="btn" id="acc-add">+ 新增账号</button></div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>账号</th><th>显示名</th><th>角色</th><th>关联员工/患者</th><th>状态</th><th>操作</th>
        </tr></thead><tbody>
          ${(db.accounts || []).map(a => {
            const emp = (db.employees || []).find(e => e.id == a.employee_id);
            const pat = (db.patients || []).find(p => p.id == a.patient_id);
            return `<tr>
              <td>${App.esc(a.username)}</td><td>${App.esc(a.display_name)}</td>
              <td><span class="tag blue">${App.esc(window.SEED.ROLE_LABEL[a.role_code] || a.role_code)}</span></td>
              <td class="muted">${emp ? '员工 ' + App.esc(emp.name) : (pat ? '患者 ' + App.esc(pat.name) : '—')}</td>
              <td>${a.active ? '<span class="tag green">启用</span>' : '<span class="tag gray">停用</span>'}</td>
              <td><button class="btn ghost sm" data-acc-edit="${a.id}">编辑</button></td>
            </tr>`;
          }).join('')}
        </tbody></table></div>`;
    } else if (tab === 'audit' && isAdmin) {
      body = `
        <div class="note">关键数据变更记录操作者、时间、原值、新值与原因，满足系统可追溯性要求。</div>
        <div class="table-wrap"><table class="tbl"><thead><tr>
          <th>时间</th><th>对象</th><th>动作</th><th>操作者</th><th>原因</th>
        </tr></thead><tbody>
          ${(db.auditLogs || []).length ? (db.auditLogs || []).map(l => `<tr>
            <td>${App.esc(String(l.occurred_at).slice(0, 19).replace('T', ' '))}</td>
            <td>${App.esc(l.entity_type)} #${l.entity_id}</td>
            <td><span class="tag blue">${App.esc(l.action)}</span></td>
            <td>${App.esc(l.operator_name || '')}</td>
            <td class="muted">${App.esc(l.reason || '—')}</td>
          </tr>`).join('') : '<tr><td colspan="5"><div class="empty">暂无变更审计记录</div></td></tr>'}
        </tbody></table></div>`;
    }

    set(`
      <div class="page-head"><div>
        <div class="page-title">基础信息</div>
        <div class="page-desc">价目、预约类型、分类选项、产品、技工所、诊所诊室、员工兼岗${isAdmin ? '与系统账号' : ''}维护</div>
      </div></div>
      <div class="card">
        <div class="tabs">${tabs.map(([k, l]) => `<div class="tab ${tab === k ? 'active' : ''}" data-btab="${k}">${l}</div>`).join('')}</div>
        ${body}
      </div>`);

    bind();
  }

  function bind() {
    document.querySelectorAll('[data-btab]').forEach(el => {
      el.onclick = () => { tab = el.dataset.btab; render(); };
    });
    const kf = document.getElementById('opt-kind-filter');
    if (kf) kf.onchange = () => { optKind = kf.value; render(); };

    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    on('opt-add', () => editOption(null));
    on('pi-add', () => editPrice(null));
    on('at-add', () => editApptType(null));
    on('pr-add', () => editProduct(null));
    on('lb-add', () => editLab(null));
    on('cl-add', () => editClinic(null));
    on('rm-add', () => editRoom(null));
    on('emp-add', () => editEmployee(null));
    on('acc-add', () => editAccount(null));

    const db = API.raw();
    document.querySelectorAll('[data-opt-edit]').forEach(b => b.onclick = () => editOption(db.basicOptions.find(x => x.id == b.dataset.optEdit)));
    document.querySelectorAll('[data-opt-toggle]').forEach(b => b.onclick = async () => {
      const r = await API.toggleOption(Number(b.dataset.optToggle));
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      App.toast('状态已更新', 'ok'); render();
    });
    document.querySelectorAll('[data-pi-edit]').forEach(b => b.onclick = () => editPrice(db.priceItems.find(x => x.id == b.dataset.piEdit)));
    document.querySelectorAll('[data-at-edit]').forEach(b => b.onclick = () => editApptType(db.appointmentTypes.find(x => x.id == b.dataset.atEdit)));
    document.querySelectorAll('[data-pr-edit]').forEach(b => b.onclick = () => editProduct(db.products.find(x => x.id == b.dataset.prEdit)));
    document.querySelectorAll('[data-lb-edit]').forEach(b => b.onclick = () => editLab(db.dentalLabs.find(x => x.id == b.dataset.lbEdit)));
    document.querySelectorAll('[data-cl-edit]').forEach(b => b.onclick = () => editClinic(db.clinics.find(x => x.id == b.dataset.clEdit)));
    document.querySelectorAll('[data-rm-edit]').forEach(b => b.onclick = () => editRoom(db.rooms.find(x => x.id == b.dataset.rmEdit)));
    document.querySelectorAll('[data-emp-edit]').forEach(b => b.onclick = () => editEmployee(db.employees.find(x => x.id == b.dataset.empEdit)));
    document.querySelectorAll('[data-acc-edit]').forEach(b => b.onclick = () => editAccount((db.accounts || []).find(x => x.id == b.dataset.accEdit)));
  }

  function editOption(o) {
    const body = `<div class="form-grid">
      ${App.fieldRow('类别', App.selectHtml('f-kind', optionKinds, o ? o.kind : (optKind !== '全部类别' ? optKind : optionKinds[0])))}
      ${App.fieldRow('编码', `<input id="f-code" value="${App.esc(o ? o.code : '')}">`)}
      ${App.fieldRow('名称', `<input id="f-name" value="${App.esc(o ? o.name : '')}">`)}
      ${App.fieldRow('排序', `<input id="f-sort" type="number" value="${o ? o.sort_order : 1}">`)}
      ${App.fieldRow('状态', App.selectHtml('f-active', [{ value: '1', label: '启用' }, { value: '0', label: '停用' }], o && !o.active ? '0' : '1'))}
      ${App.fieldRow('说明', `<input id="f-desc" value="${App.esc(o ? o.description || '' : '')}">`, true)}
    </div>`;
    const m = App.modal(o ? '编辑选项' : '新增选项', body, '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">保存</button>');
    m.el.querySelector('#m-c').onclick = m.close;
    m.el.querySelector('#m-s').onclick = async () => {
      const r = await API.saveOption({
        id: o ? o.id : null,
        kind: m.el.querySelector('#f-kind').value,
        code: m.el.querySelector('#f-code').value.trim(),
        name: m.el.querySelector('#f-name').value.trim(),
        description: m.el.querySelector('#f-desc').value.trim(),
        sort_order: Number(m.el.querySelector('#f-sort').value) || 1,
        active: m.el.querySelector('#f-active').value === '1',
      });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('已保存', 'ok'); render();
    };
  }

  function editPrice(p) {
    const units = API.listOptions('单位').map(u => ({ value: u.id, label: u.name }));
    const body = `<div class="form-grid">
      ${App.fieldRow('项目编码', `<input id="f-code" value="${App.esc(p ? p.item_code : '')}">`)}
      ${App.fieldRow('项目名称', `<input id="f-name" value="${App.esc(p ? p.name : '')}">`)}
      ${App.fieldRow('计量单位', App.selectHtml('f-unit', units, p ? p.unit_id : (units[0] ? units[0].value : '')))}
      ${App.fieldRow('标准单价', `<input id="f-price" type="number" min="0" step="0.01" value="${p ? p.unit_price : 0}">`)}
      ${App.fieldRow('状态', App.selectHtml('f-active', [{ value: '1', label: '启用' }, { value: '0', label: '停用' }], p && !p.active ? '0' : '1'))}
    </div>`;
    const m = App.modal(p ? '编辑收费价目' : '新增收费价目', body, '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">保存</button>');
    m.el.querySelector('#m-c').onclick = m.close;
    m.el.querySelector('#m-s').onclick = async () => {
      const r = await API.savePriceItem({
        id: p ? p.id : null,
        item_code: m.el.querySelector('#f-code').value.trim(),
        name: m.el.querySelector('#f-name').value.trim(),
        unit_id: Number(m.el.querySelector('#f-unit').value),
        unit_price: Number(m.el.querySelector('#f-price').value),
        active: m.el.querySelector('#f-active').value === '1',
      });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('已保存', 'ok'); render();
    };
  }

  function editApptType(t) {
    const body = `<div class="form-grid">
      ${App.fieldRow('编码', `<input id="f-code" value="${App.esc(t ? t.code : '')}">`)}
      ${App.fieldRow('类型名称', `<input id="f-name" value="${App.esc(t ? t.name : '')}">`)}
      ${App.fieldRow('标准时长(分钟)', `<input id="f-dur" type="number" min="15" step="15" value="${t ? t.duration_min : 30}">`)}
      ${App.fieldRow('患者自助开放', App.selectHtml('f-self', [{ value: '1', label: '是（标准项目）' }, { value: '0', label: '否（前台排程）' }], t && t.self_bookable ? '1' : '0'))}
      ${App.fieldRow('参考价提示', `<input id="f-hint" value="${App.esc(t ? t.price_hint || '' : '')}">`)}
      ${App.fieldRow('排序', `<input id="f-sort" type="number" value="${t ? t.sort_order : 1}">`)}
      ${App.fieldRow('状态', App.selectHtml('f-active', [{ value: '1', label: '启用' }, { value: '0', label: '停用' }], t && !t.active ? '0' : '1'))}
    </div>`;
    const m = App.modal(t ? '编辑预约类型' : '新增预约类型', body, '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">保存</button>');
    m.el.querySelector('#m-c').onclick = m.close;
    m.el.querySelector('#m-s').onclick = async () => {
      const r = await API.saveAppointmentType({
        id: t ? t.id : null,
        code: m.el.querySelector('#f-code').value.trim(),
        name: m.el.querySelector('#f-name').value.trim(),
        duration_min: Number(m.el.querySelector('#f-dur').value),
        self_bookable: m.el.querySelector('#f-self').value === '1',
        price_hint: m.el.querySelector('#f-hint').value.trim(),
        sort_order: Number(m.el.querySelector('#f-sort').value) || 1,
        active: m.el.querySelector('#f-active').value === '1',
      });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('已保存', 'ok'); render();
    };
  }

  function editProduct(p) {
    const units = API.listOptions('单位').map(u => ({ value: u.id, label: u.name }));
    const body = `<div class="form-grid">
      ${App.fieldRow('产品编码', `<input id="f-code" value="${App.esc(p ? p.product_code : '')}">`)}
      ${App.fieldRow('产品名称', `<input id="f-name" value="${App.esc(p ? p.name : '')}">`)}
      ${App.fieldRow('材料', `<input id="f-mat" value="${App.esc(p ? p.material : '')}">`)}
      ${App.fieldRow('单位', App.selectHtml('f-unit', units, p ? p.unit_id : (units[0] ? units[0].value : '')))}
      ${App.fieldRow('必须上传附件', App.selectHtml('f-att', [{ value: '1', label: '是' }, { value: '0', label: '否' }], p && p.requires_attachment ? '1' : '0'))}
      ${App.fieldRow('状态', App.selectHtml('f-active', [{ value: '1', label: '启用' }, { value: '0', label: '停用' }], p && !p.active ? '0' : '1'))}
      ${App.fieldRow('规格说明', `<input id="f-spec" value="${App.esc(p ? p.specification || '' : '')}">`, true)}
    </div>`;
    const m = App.modal(p ? '编辑义齿产品' : '新增义齿产品', body, '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">保存</button>');
    m.el.querySelector('#m-c').onclick = m.close;
    m.el.querySelector('#m-s').onclick = async () => {
      const r = await API.saveProduct({
        id: p ? p.id : null,
        product_code: m.el.querySelector('#f-code').value.trim(),
        name: m.el.querySelector('#f-name').value.trim(),
        material: m.el.querySelector('#f-mat').value.trim(),
        unit_id: Number(m.el.querySelector('#f-unit').value),
        specification: m.el.querySelector('#f-spec').value.trim(),
        requires_attachment: m.el.querySelector('#f-att').value === '1',
        active: m.el.querySelector('#f-active').value === '1',
      });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('已保存', 'ok'); render();
    };
  }

  function editLab(l) {
    const body = `<div class="form-grid">
      ${App.fieldRow('技工所编码', `<input id="f-code" value="${App.esc(l ? l.lab_code : '')}">`)}
      ${App.fieldRow('技工所名称', `<input id="f-name" value="${App.esc(l ? l.name : '')}">`)}
      ${App.fieldRow('联系人', `<input id="f-contact" value="${App.esc(l ? l.contact : '')}">`)}
      ${App.fieldRow('联系电话', `<input id="f-phone" value="${App.esc(l ? l.phone : '')}">`)}
      ${App.fieldRow('接口编码', `<input id="f-iface" value="${App.esc(l ? l.interface_code || '' : '')}">`)}
      ${App.fieldRow('状态', App.selectHtml('f-active', [{ value: '1', label: '启用' }, { value: '0', label: '停用' }], l && !l.active ? '0' : '1'))}
      ${App.fieldRow('地址', `<input id="f-addr" value="${App.esc(l ? l.address || '' : '')}">`, true)}
    </div>`;
    const m = App.modal(l ? '编辑合作技工所' : '新增合作技工所', body, '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">保存</button>');
    m.el.querySelector('#m-c').onclick = m.close;
    m.el.querySelector('#m-s').onclick = async () => {
      const r = await API.saveDentalLab({
        id: l ? l.id : null,
        lab_code: m.el.querySelector('#f-code').value.trim(),
        name: m.el.querySelector('#f-name').value.trim(),
        contact: m.el.querySelector('#f-contact').value.trim(),
        phone: m.el.querySelector('#f-phone').value.trim(),
        address: m.el.querySelector('#f-addr').value.trim(),
        interface_code: m.el.querySelector('#f-iface').value.trim(),
        active: m.el.querySelector('#f-active').value === '1',
      });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('已保存', 'ok'); render();
    };
  }

  function editClinic(c) {
    const body = `<div class="form-grid">
      ${App.fieldRow('诊所编码', `<input id="f-code" value="${App.esc(c ? c.clinic_code : '')}">`)}
      ${App.fieldRow('诊所名称', `<input id="f-name" value="${App.esc(c ? c.name : '')}">`)}
      ${App.fieldRow('联系电话', `<input id="f-phone" value="${App.esc(c ? c.phone || '' : '')}">`)}
      ${App.fieldRow('状态', App.selectHtml('f-active', [{ value: '1', label: '启用' }, { value: '0', label: '停用' }], c && !c.active ? '0' : '1'))}
      ${App.fieldRow('地址', `<input id="f-addr" value="${App.esc(c ? c.address || '' : '')}">`, true)}
    </div>`;
    const m = App.modal(c ? '编辑诊所资料' : '新增诊所资料', body, '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">保存</button>');
    m.el.querySelector('#m-c').onclick = m.close;
    m.el.querySelector('#m-s').onclick = async () => {
      const r = await API.saveClinic({
        id: c ? c.id : null,
        clinic_code: m.el.querySelector('#f-code').value.trim(),
        name: m.el.querySelector('#f-name').value.trim(),
        phone: m.el.querySelector('#f-phone').value.trim(),
        address: m.el.querySelector('#f-addr').value.trim(),
        active: m.el.querySelector('#f-active').value === '1',
      });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('已保存', 'ok'); render();
    };
  }

  function editRoom(rm) {
    const clinics = (API.raw().clinics || []).map(c => ({ value: c.id, label: c.name }));
    const body = `<div class="form-grid">
      ${App.fieldRow('所属诊所', App.selectHtml('f-clinic', clinics, rm ? rm.clinic_id : (clinics[0] ? clinics[0].value : 1)))}
      ${App.fieldRow('诊室编码', `<input id="f-code" value="${App.esc(rm ? rm.room_code : '')}">`)}
      ${App.fieldRow('诊室名称', `<input id="f-name" value="${App.esc(rm ? rm.name : '')}">`)}
      ${App.fieldRow('楼层备注', `<input id="f-floor" value="${App.esc(rm ? rm.floor_note || '' : '')}">`)}
      ${App.fieldRow('状态', App.selectHtml('f-active', [{ value: '1', label: '启用' }, { value: '0', label: '停用' }], rm && !rm.active ? '0' : '1'))}
    </div>`;
    const m = App.modal(rm ? '编辑诊室' : '新增诊室', body, '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">保存</button>');
    m.el.querySelector('#m-c').onclick = m.close;
    m.el.querySelector('#m-s').onclick = async () => {
      const r = await API.saveRoom({
        id: rm ? rm.id : null,
        clinic_id: Number(m.el.querySelector('#f-clinic').value),
        room_code: m.el.querySelector('#f-code').value.trim(),
        name: m.el.querySelector('#f-name').value.trim(),
        floor_note: m.el.querySelector('#f-floor').value.trim(),
        active: m.el.querySelector('#f-active').value === '1',
      });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('已保存', 'ok'); render();
    };
  }

  function editEmployee(emp) {
    const db = API.raw();
    const clinics = (db.clinics || []).map(c => ({ value: c.id, label: c.name }));
    const roleOpts = API.listOptions('岗位');
    const selected = new Set(emp ? (emp.role_ids || []) : []);
    const roleBoxes = `<div style="display:flex;flex-wrap:wrap;gap:12px;padding:6px 0">${roleOpts.map(r => `
      <label style="display:inline-flex;align-items:center;gap:5px;font-weight:400;cursor:pointer">
        <input type="checkbox" class="f-role" value="${r.id}" ${selected.has(r.id) ? 'checked' : ''} style="width:auto">
        ${App.esc(r.name)}
      </label>`).join('')}</div>`;
    const body = `<div class="form-grid">
      ${App.fieldRow('所属诊所', App.selectHtml('f-clinic', clinics, emp ? emp.clinic_id : (clinics[0] ? clinics[0].value : 1)))}
      ${App.fieldRow('员工工号', `<input id="f-no" value="${App.esc(emp ? emp.employee_no : '')}">`)}
      ${App.fieldRow('姓名', `<input id="f-name" value="${App.esc(emp ? emp.name : '')}">`)}
      ${App.fieldRow('电话', `<input id="f-phone" value="${App.esc(emp ? emp.phone || '' : '')}">`)}
      ${App.fieldRow('入职日期', `<input id="f-join" type="date" value="${App.esc(emp ? emp.joined_on || '' : '')}">`)}
      ${App.fieldRow('离职日期', `<input id="f-left" type="date" value="${App.esc(emp ? emp.left_on || '' : '')}">`)}
      ${App.fieldRow('状态', App.selectHtml('f-active', [{ value: '1', label: '在职启用' }, { value: '0', label: '停用' }], emp && !emp.active ? '0' : '1'))}
      ${App.fieldRow('岗位配置（可多选实现兼岗）', roleBoxes, true)}
    </div>`;
    const m = App.modal(emp ? '编辑员工与岗位' : '新增员工', body, '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">保存</button>');
    m.el.querySelector('#m-c').onclick = m.close;
    m.el.querySelector('#m-s').onclick = async () => {
      const role_ids = Array.from(m.el.querySelectorAll('.f-role:checked')).map(x => Number(x.value));
      const r = await API.saveEmployee({
        id: emp ? emp.id : null,
        clinic_id: Number(m.el.querySelector('#f-clinic').value),
        employee_no: m.el.querySelector('#f-no').value.trim(),
        name: m.el.querySelector('#f-name').value.trim(),
        phone: m.el.querySelector('#f-phone').value.trim(),
        joined_on: m.el.querySelector('#f-join').value || null,
        left_on: m.el.querySelector('#f-left').value || null,
        active: m.el.querySelector('#f-active').value === '1',
        role_ids,
      });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('员工与岗位已保存', 'ok'); render();
    };
  }

  function editAccount(acc) {
    const db = API.raw();
    const emps = [{ value: '', label: '不关联员工' }].concat((db.employees || []).map(e => ({ value: e.id, label: `${e.employee_no} ${e.name}` })));
    const roleChoices = Object.keys(window.SEED.ROLE_LABEL).map(k => ({ value: k, label: window.SEED.ROLE_LABEL[k] }));
    const body = `<div class="form-grid">
      ${App.fieldRow('登录账号', `<input id="f-user" value="${App.esc(acc ? acc.username : '')}">`)}
      ${App.fieldRow('显示名称', `<input id="f-name" value="${App.esc(acc ? acc.display_name : '')}">`)}
      ${App.fieldRow('角色', App.selectHtml('f-role', roleChoices, acc ? acc.role_code : 'receptionist'))}
      ${App.fieldRow('关联员工', App.selectHtml('f-emp', emps, acc && acc.employee_id ? acc.employee_id : ''))}
      ${App.fieldRow(acc ? '重置密码（留空不改）' : '初始密码', `<input id="f-pass" type="password" placeholder="${acc ? '留空保持原密码' : '必填'}">`)}
      ${App.fieldRow('状态', App.selectHtml('f-active', [{ value: '1', label: '启用' }, { value: '0', label: '停用' }], acc && !acc.active ? '0' : '1'))}
    </div>`;
    const m = App.modal(acc ? '编辑账号' : '新增系统账号', body, '<button class="btn ghost" id="m-c">取消</button><button class="btn" id="m-s">保存</button>');
    m.el.querySelector('#m-c').onclick = m.close;
    m.el.querySelector('#m-s').onclick = async () => {
      const r = await API.saveAccount({
        id: acc ? acc.id : null,
        username: m.el.querySelector('#f-user').value.trim(),
        display_name: m.el.querySelector('#f-name').value.trim(),
        role_code: m.el.querySelector('#f-role').value,
        employee_id: m.el.querySelector('#f-emp').value ? Number(m.el.querySelector('#f-emp').value) : null,
        password: m.el.querySelector('#f-pass').value,
        active: m.el.querySelector('#f-active').value === '1',
      });
      if (!r.ok) { App.toast(r.error, 'err'); return; }
      m.close(); App.toast('账号已保存', 'ok'); render();
    };
  }

  render();
};
