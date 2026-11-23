/* 基础信息 F1：价目、颜色、单位、产品、员工、诊所、订单类型、盒子颜色、附件类型配置 */
window.Modules = window.Modules || {};
window.Modules.basic = function (set) {
  const tables = [
    { key: 'priceItems', label: '收费价目', cols: ['item_code','name','unit_price','active'], heads: ['编码','名称','单价','状态'], table: 'priceItems' },
    { key: 'appointmentTypes', label: '预约类型与标准时长', cols: ['code','name','duration_min','self_bookable'], heads: ['编码','名称','时长(分钟)','患者可自助'], table: 'appointmentTypes' },
    { key: 'products', label: '义齿产品', cols: ['product_code','name','material','requires_attachment'], heads: ['编码','名称','材料','需附件'], table: 'products' },
    { key: 'dentalLabs', label: '合作技工所', cols: ['lab_code','name','contact','active'], heads: ['编码','名称','联系人','状态'], table: 'dentalLabs' },
  ];
  const optionKinds = window.SEED.ENUM.optionKinds;

  function render() {
    const db = API.raw();
    const optRows = db.basicOptions.slice().sort((a,b)=>a.kind.localeCompare(b.kind)||a.sort_order-b.sort_order);
    const optTable = `
      <div class="card">
        <h3><span class="bar"></span>分类基础选项（basic_option）</h3>
        <div class="note">岗位、单位、颜色、盒色、订单类型、支付方式、通知渠道和附件类型统一在此维护；预约类型因带标准时长与自助开放标记，单独成表维护。同一选项表被多个业务字段引用时须核对类别（PDF 8.2）。</div>
        <div class="toolbar">
          ${App.selectHtml('opt-kind-filter', ['全部类别', ...optionKinds], '全部类别', 'onchange="Modules.basic.render()"')}
          <button class="btn" id="opt-add">+ 新增选项</button>
        </div>
        ${(() => {
          const f = document.getElementById('opt-kind-filter'); // 保留上次筛选
          const kind = window._optKind || '全部类别';
          const list = optRows.filter(o => kind === '全部类别' || o.kind === kind);
          return `<div class="table-wrap"><table class="tbl"><thead><tr><th>类别</th><th>编码</th><th>名称</th><th>排序</th><th>状态</th><th>操作</th></tr></thead><tbody>
            ${list.map(o => `<tr><td><span class="tag blue">${App.esc(o.kind)}</span></td><td>${App.esc(o.code)}</td><td>${App.esc(o.name)}</td><td>${o.sort_order}</td><td>${o.active?'<span class="tag green">启用</span>':'<span class="tag gray">停用</span>'}</td>
              <td class="actions"><button class="btn ghost sm" data-opt-edit="${o.id}">编辑</button> <button class="btn ghost sm" data-opt-toggle="${o.id}">${o.active?'停用':'启用'}</button></td></tr>`).join('')}
          </tbody></table></div>`;
        })()}
      </div>`;

    const simpleCards = tables.map(t => {
      const rows = db[t.table] || [];
      return `<div class="card">
        <h3><span class="bar"></span>${t.label}</h3>
        <div class="table-wrap"><table class="tbl"><thead><tr>${t.heads.concat(['操作']).map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>
          ${rows.map(r => `<tr>${t.cols.map(c=>{
            if (c === 'active') return `<td>${r.active?'<span class="tag green">启用</span>':'<span class="tag gray">停用</span>'}</td>`;
            if (typeof r[c] === 'boolean') return `<td>${r[c]?'<span class="tag green">是</span>':'<span class="tag gray">否</span>'}</td>`;
            return `<td>${App.esc(r[c])}</td>`;
          }).join('')}
            <td class="actions"><button class="btn ghost sm" data-simple-edit="${t.table}:${r.id}">编辑</button></td></tr>`).join('')}
        </tbody></table></div>
        <div style="margin-top:10px"><button class="btn ghost sm" data-simple-add="${t.table}">+ 新增</button></div>
      </div>`;
    }).join('');

    const staffCard = `<div class="card">
      <h3><span class="bar"></span>员工与诊室</h3>
      <div class="grid cols-2">
        <div><b style="font-size:13px">员工（employee）</b><div class="table-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>工号</th><th>姓名</th><th>角色</th><th>状态</th></tr></thead><tbody>
          ${db.employees.map(e=>`<tr><td>${App.esc(e.employee_no)}</td><td>${App.esc(e.name)}</td><td>${App.esc(window.SEED.ROLE_LABEL[e.role]||e.role)}</td><td>${e.active?'<span class="tag green">启用</span>':'<span class="tag gray">停用</span>'}</td></tr>`).join('')}
        </tbody></table></div></div>
        <div><b style="font-size:13px">诊室（clinic_room）</b><div class="table-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>编码</th><th>名称</th><th>状态</th></tr></thead><tbody>
          ${db.rooms.map(r=>`<tr><td>${App.esc(r.room_code)}</td><td>${App.esc(r.name)}</td><td>${r.active?'<span class="tag green">启用</span>':'<span class="tag gray">停用</span>'}</td></tr>`).join('')}
        </tbody></table></div></div>
      </div>
      <div class="note" style="margin-top:12px">医生以员工角色参与，与其他岗位共用人员档案（PDF 表20）。</div>
    </div>`;

    set(`<div class="page-head"><div><div class="page-title">基础信息</div><div class="page-desc">F1 · 价目、选项、员工、诊室、产品与技工所配置</div></div></div>
      ${optTable}${simpleCards}${staffCard}`);

    bind();
  }

  function bind() {
    const sel = document.getElementById('opt-kind-filter');
    if (sel) sel.onchange = () => { window._optKind = sel.value; render(); };
    const add = document.getElementById('opt-add');
    if (add) add.onclick = () => editOption(null);
    document.querySelectorAll('[data-opt-edit]').forEach(b => b.onclick = () => {
      const o = API.raw().basicOptions.find(x => x.id == b.dataset.optEdit); editOption(o);
    });
    document.querySelectorAll('[data-opt-toggle]').forEach(b => b.onclick = () => {
      API.toggleOption(Number(b.dataset.optToggle)); App.toast('状态已更新', 'ok'); render();
    });
    document.querySelectorAll('[data-simple-add]').forEach(b => b.onclick = () => editSimple(b.dataset.simpleAdd, null));
    document.querySelectorAll('[data-simple-edit]').forEach(b => b.onclick = () => {
      const [t, id] = b.dataset.simpleEdit.split(':');
      editSimple(t, API.raw()[t].find(x => x.id == id));
    });
  }

  function editOption(o) {
    const isEdit = !!o;
    const body = `<div class="form-grid">
      ${App.fieldRow('类别', App.selectHtml('f-kind', optionKinds, o?.kind || optionKinds[0]))}
      ${App.fieldRow('编码', `<input id="f-code" value="${App.esc(o?.code||'')}">`)}
      ${App.fieldRow('名称', `<input id="f-name" value="${App.esc(o?.name||'')}">`)}
      ${App.fieldRow('排序', `<input id="f-sort" type="number" value="${o?.sort_order||1}">`)}
    </div>`;
    const m = App.modal(isEdit?'编辑选项':'新增选项', body,
      `<button class="btn ghost" id="m-cancel">取消</button><button class="btn" id="m-save">保存</button>`);
    m.el.querySelector('#m-cancel').onclick = m.close;
    m.el.querySelector('#m-save').onclick = () => {
      const code = m.el.querySelector('#f-code').value.trim();
      const name = m.el.querySelector('#f-name').value.trim();
      const kind = m.el.querySelector('#f-kind').value;
      if (!code || !name) { App.toast('编码与名称必填', 'err'); return; }
      API.upsertOption({ id: o?.id, kind, code, name, sort_order: Number(m.el.querySelector('#f-sort').value)||1, active: o?.active !== false });
      m.close(); App.toast('已保存', 'ok'); render();
    };
  }

  function editSimple(table, row) {
    const db = API.raw();
    let fields;
    if (table === 'priceItems') {
      fields = [
        ['item_code','编码','text'],['name','名称','text'],
        ['unit_price','单价','number'],['active','启用','bool'],
      ];
    } else if (table === 'appointmentTypes') {
      fields = [
        ['code','编码','text'],['name','名称','text'],
        ['duration_min','标准时长(分钟)','number'],['self_bookable','患者可自助','bool'],
        ['active','启用','bool'],
      ];
    } else if (table === 'products') {
      fields = [
        ['product_code','编码','text'],['name','名称','text'],
        ['material','材料','text'],['requires_attachment','需附件','bool'],
        ['active','启用','bool'],
      ];
    } else {
      fields = [
        ['lab_code','编码','text'],['name','名称','text'],
        ['contact','联系人','text'],['active','启用','bool'],
      ];
    }
    const body = '<div class="form-grid">' + fields.map(([k,label,type]) => {
      if (type === 'bool') {
        const on = row ? row[k] !== false : true;
        return App.fieldRow(label, App.selectHtml('f-'+k, [{value:'1',label:'是'},{value:'0',label:'否'}], on?'1':'0'));
      }
      return App.fieldRow(label, `<input id="f-${k}" type="${type}" value="${App.esc(row?.[k]??'')}">`);
    }).join('') + '</div>';
    const TITLE = { priceItems:'价目', appointmentTypes:'预约类型', products:'义齿产品', dentalLabs:'技工所' };
    const m = App.modal((row?'编辑':'新增')+(TITLE[table]||'资料'), body,
      `<button class="btn ghost" id="m-cancel">取消</button><button class="btn" id="m-save">保存</button>`);
    m.el.querySelector('#m-cancel').onclick = m.close;
    m.el.querySelector('#m-save').onclick = () => {
      const obj = { id: row?.id };
      fields.forEach(([k,,type]) => {
        obj[k] = type === 'bool' ? m.el.querySelector('#f-'+k).value === '1'
          : type === 'number' ? Number(m.el.querySelector('#f-'+k).value) : m.el.querySelector('#f-'+k).value.trim();
      });
      if (table === 'priceItems') { obj.unit_id = 15; obj.updated_at = new Date().toISOString().slice(0,16); }
      if (table === 'dentalLabs') { obj.phone = row?.phone||''; }
      if (table === 'appointmentTypes') { obj.price_hint = row?.price_hint||''; obj.sort_order = row?.sort_order||1; }
      if (table === 'products') { obj.unit_id = row?.unit_id||15; }
      API.upsertSimple(table, obj);
      m.close(); App.toast('已保存', 'ok'); render();
    };
  }

  render();
};
window.Modules.basic.render = () => window.Modules.basic(App.setContent);
