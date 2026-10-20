"""Logical schema and PlantUML ERDs for the clinic, generated from one model."""
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FIGURES = ROOT / 'figures'

# A row contains constraints, an atomic column name, and a logical SQL type.
# The trailing question mark denotes a nullable column.
SCHEMA = {
    'clinic': ('诊所资料', [
        ('PK', 'id', 'BIGINT'), ('UK', 'clinic_code', 'VARCHAR(32)'),
        ('', 'name', 'VARCHAR(120)'), ('', 'address', 'VARCHAR(240) ?'),
        ('', 'phone', 'VARCHAR(32) ?'), ('', 'active', 'BOOLEAN'),
        ('', 'created_at', 'TIMESTAMP'), ('', 'updated_at', 'TIMESTAMP')]),
    'clinic_room': ('诊室', [
        ('PK', 'id', 'BIGINT'), ('FK', 'clinic_id', 'BIGINT'),
        ('UK', 'room_code', 'VARCHAR(24)'), ('', 'name', 'VARCHAR(60)'),
        ('', 'floor_note', 'VARCHAR(80) ?'), ('', 'active', 'BOOLEAN')]),
    'employee': ('员工', [
        ('PK', 'id', 'BIGINT'), ('FK', 'clinic_id', 'BIGINT'),
        ('UK', 'employee_no', 'VARCHAR(32)'), ('', 'name', 'VARCHAR(80)'),
        ('', 'phone', 'VARCHAR(32) ?'), ('', 'active', 'BOOLEAN'),
        ('', 'joined_on', 'DATE ?'), ('', 'left_on', 'DATE ?')]),
    'employee_role': ('员工兼岗', [
        ('PK,FK', 'employee_id', 'BIGINT'), ('PK,FK', 'role_id', 'BIGINT'),
        ('', 'assigned_at', 'TIMESTAMP'), ('', 'revoked_at', 'TIMESTAMP ?')]),
    'basic_option': ('分类基础选项', [
        ('PK', 'id', 'BIGINT'), ('UK*', 'kind', 'VARCHAR(24)'),
        ('UK*', 'code', 'VARCHAR(32)'), ('', 'name', 'VARCHAR(80)'),
        ('', 'sort_order', 'INTEGER'), ('', 'active', 'BOOLEAN'),
        ('', 'description', 'VARCHAR(240) ?')]),
    'patient': ('患者档案', [
        ('PK', 'id', 'BIGINT'), ('UK', 'patient_no', 'VARCHAR(32)'),
        ('', 'name', 'VARCHAR(80)'), ('', 'birth_date', 'DATE ?'),
        ('', 'phone', 'VARCHAR(32) ?'), ('', 'contact_name', 'VARCHAR(80) ?'),
        ('', 'contact_phone', 'VARCHAR(32) ?'), ('', 'important_note', 'TEXT ?'),
        ('FK', 'created_by', 'BIGINT'), ('', 'created_at', 'TIMESTAMP'),
        ('', 'updated_at', 'TIMESTAMP')]),
    'appointment': ('诊疗预约', [
        ('PK', 'id', 'BIGINT'), ('UK', 'appointment_no', 'VARCHAR(32)'),
        ('FK', 'patient_id', 'BIGINT'), ('FK', 'doctor_id', 'BIGINT'),
        ('FK', 'room_id', 'BIGINT'), ('FK', 'type_id', 'BIGINT'),
        ('FK', 'created_by', 'BIGINT'), ('', 'chief_complaint', 'TEXT ?'),
        ('', 'starts_at', 'TIMESTAMP'), ('', 'ends_at', 'TIMESTAMP'),
        ('', 'stage', 'VARCHAR(24)'), ('', 'created_at', 'TIMESTAMP'),
        ('', 'confirmed_at', 'TIMESTAMP ?'), ('', 'arrived_at', 'TIMESTAMP ?'),
        ('', 'completed_at', 'TIMESTAMP ?'), ('', 'cancelled_at', 'TIMESTAMP ?'),
        ('', 'cancel_reason', 'TEXT ?')]),
    'appointment_event': ('预约变更历史', [
        ('PK', 'id', 'BIGINT'), ('FK', 'appointment_id', 'BIGINT'),
        ('FK', 'changed_by', 'BIGINT'), ('', 'old_start', 'TIMESTAMP ?'),
        ('', 'new_start', 'TIMESTAMP ?'), ('', 'old_end', 'TIMESTAMP ?'),
        ('', 'new_end', 'TIMESTAMP ?'), ('', 'old_stage', 'VARCHAR(24)'),
        ('', 'new_stage', 'VARCHAR(24)'), ('', 'reason', 'TEXT ?'),
        ('', 'occurred_at', 'TIMESTAMP')]),
    'encounter': ('诊疗记录', [
        ('PK', 'id', 'BIGINT'), ('UK', 'encounter_no', 'VARCHAR(32)'),
        ('FK', 'patient_id', 'BIGINT'), ('FK', 'clinic_id', 'BIGINT'),
        ('FK', 'doctor_id', 'BIGINT'), ('FK,UK', 'appointment_id', 'BIGINT ?'),
        ('', 'occurred_at', 'TIMESTAMP'), ('', 'chief_complaint', 'TEXT'),
        ('', 'diagnosis', 'TEXT ?'), ('', 'treatment_note', 'TEXT ?'),
        ('', 'completed_at', 'TIMESTAMP ?'), ('', 'created_at', 'TIMESTAMP')]),
    'price_item': ('收费价目', [
        ('PK', 'id', 'BIGINT'), ('UK', 'item_code', 'VARCHAR(32)'),
        ('', 'name', 'VARCHAR(80)'), ('FK', 'unit_id', 'BIGINT'),
        ('', 'unit_price', 'DECIMAL(12,2)'), ('', 'active', 'BOOLEAN'),
        ('', 'updated_at', 'TIMESTAMP')]),
    'bill': ('收费单与催收', [
        ('PK', 'id', 'BIGINT'), ('UK', 'bill_no', 'VARCHAR(32)'),
        ('FK', 'encounter_id', 'BIGINT'), ('FK', 'issued_by', 'BIGINT'),
        ('', 'discount_amount', 'DECIMAL(12,2)'), ('', 'discount_reason', 'TEXT ?'),
        ('', 'issued_at', 'TIMESTAMP'), ('', 'due_date', 'DATE ?'),
        ('', 'debt_opened_at', 'TIMESTAMP ?'), ('', 'settled_at', 'TIMESTAMP ?'),
        ('', 'collection_note', 'TEXT ?'), ('', 'stage', 'VARCHAR(24)'),
        ('', 'voided_at', 'TIMESTAMP ?'), ('', 'void_reason', 'TEXT ?')]),
    'bill_line': ('收费项目明细', [
        ('PK', 'id', 'BIGINT'), ('FK,UK*', 'bill_id', 'BIGINT'),
        ('UK*', 'line_no', 'INTEGER'), ('FK', 'price_item_id', 'BIGINT'),
        ('FK', 'dental_order_id', 'BIGINT ?'), ('', 'item_name', 'VARCHAR(80)'),
        ('', 'unit', 'VARCHAR(24)'), ('', 'quantity', 'DECIMAL(10,2)'),
        ('', 'unit_price', 'DECIMAL(12,2)'), ('', 'discount_amount', 'DECIMAL(12,2)'),
        ('', 'description', 'VARCHAR(240) ?')]),
    'payment': ('收款退款与支付尝试', [
        ('PK', 'id', 'BIGINT'), ('FK', 'bill_id', 'BIGINT'),
        ('UK', 'request_no', 'VARCHAR(64)'), ('UK', 'external_txn_no', 'VARCHAR(96) ?'),
        ('FK', 'method_id', 'BIGINT'), ('FK', 'refund_of_id', 'BIGINT ?'),
        ('', 'kind', 'VARCHAR(24)'), ('', 'result', 'VARCHAR(24)'),
        ('', 'amount', 'DECIMAL(12,2)'), ('', 'requested_at', 'TIMESTAMP'),
        ('', 'occurred_at', 'TIMESTAMP ?'), ('', 'failure_reason', 'TEXT ?'),
        ('', 'checked_at', 'TIMESTAMP ?')]),
    'product': ('义齿产品', [
        ('PK', 'id', 'BIGINT'), ('UK', 'product_code', 'VARCHAR(32)'),
        ('', 'name', 'VARCHAR(80)'), ('', 'material', 'VARCHAR(80)'),
        ('FK', 'unit_id', 'BIGINT'), ('', 'specification', 'VARCHAR(240) ?'),
        ('', 'requires_attachment', 'BOOLEAN'), ('', 'active', 'BOOLEAN')]),
    'dental_lab': ('合作技工所', [
        ('PK', 'id', 'BIGINT'), ('UK', 'lab_code', 'VARCHAR(32)'),
        ('', 'name', 'VARCHAR(120)'), ('', 'contact', 'VARCHAR(80)'),
        ('', 'phone', 'VARCHAR(32)'), ('', 'address', 'VARCHAR(240) ?'),
        ('', 'interface_code', 'VARCHAR(64) ?'), ('', 'active', 'BOOLEAN')]),
    'dental_order': ('义齿委托订单', [
        ('PK', 'id', 'BIGINT'), ('UK', 'order_no', 'VARCHAR(32)'),
        ('FK', 'encounter_id', 'BIGINT'), ('FK', 'product_id', 'BIGINT'),
        ('FK', 'lab_id', 'BIGINT'), ('FK', 'created_by', 'BIGINT'),
        ('FK', 'color_id', 'BIGINT'), ('FK', 'box_color_id', 'BIGINT ?'),
        ('FK', 'type_id', 'BIGINT'), ('FK', 'unit_id', 'BIGINT'),
        ('', 'quantity', 'DECIMAL(10,2)'), ('', 'repair_requirement', 'TEXT'),
        ('', 'promised_date', 'DATE'), ('', 'stage', 'VARCHAR(24)'),
        ('', 'dispatch_result', 'VARCHAR(24)'), ('', 'expected_at', 'TIMESTAMP ?'),
        ('', 'created_at', 'TIMESTAMP'), ('', 'sent_at', 'TIMESTAMP ?'),
        ('', 'accepted_at', 'TIMESTAMP ?'), ('', 'trial_at', 'TIMESTAMP ?'),
        ('', 'trial_result', 'VARCHAR(24) ?'), ('', 'delivered_at', 'TIMESTAMP ?'),
        ('', 'cancelled_at', 'TIMESTAMP ?'), ('', 'cancel_reason', 'TEXT ?')]),
    'order_tooth': ('订单牙位', [
        ('PK,FK', 'order_id', 'BIGINT'), ('PK', 'tooth_code', 'VARCHAR(8)'),
        ('', 'repair_note', 'VARCHAR(240) ?')]),
    'order_event': ('技工所回执与进展', [
        ('PK', 'id', 'BIGINT'), ('FK,UK*', 'order_id', 'BIGINT'),
        ('UK*', 'source', 'VARCHAR(64)'), ('UK*', 'event_no', 'VARCHAR(64)'),
        ('FK', 'changed_by', 'BIGINT ?'), ('', 'old_stage', 'VARCHAR(24)'),
        ('', 'new_stage', 'VARCHAR(24)'), ('', 'reason', 'TEXT ?'),
        ('', 'external_order_no', 'VARCHAR(64) ?'), ('', 'occurred_at', 'TIMESTAMP'),
        ('', 'received_at', 'TIMESTAMP')]),
    'order_attachment': ('修复附件', [
        ('PK', 'id', 'BIGINT'), ('FK', 'order_id', 'BIGINT'),
        ('FK', 'type_id', 'BIGINT'), ('FK', 'uploaded_by', 'BIGINT'),
        ('', 'file_name', 'VARCHAR(180)'), ('UK', 'storage_key', 'VARCHAR(240)'),
        ('', 'mime_type', 'VARCHAR(80)'), ('', 'byte_size', 'BIGINT'),
        ('', 'checksum', 'VARCHAR(64) ?'), ('', 'uploaded_at', 'TIMESTAMP')]),
    'reminder': ('预约与订单通知', [
        ('PK', 'id', 'BIGINT'), ('FK,UK*', 'order_id', 'BIGINT ?'),
        ('FK,UK*', 'appointment_id', 'BIGINT ?'), ('FK', 'channel_id', 'BIGINT'),
        ('FK', 'created_by', 'BIGINT'), ('UK*', 'kind', 'VARCHAR(24)'),
        ('UK*', 'scheduled_at', 'TIMESTAMP'), ('UK*', 'recipient', 'VARCHAR(120)'),
        ('', 'content', 'TEXT'), ('', 'delivery_result', 'VARCHAR(24)'),
        ('', 'attempt_count', 'INTEGER'), ('', 'last_attempt_at', 'TIMESTAMP ?'),
        ('', 'sent_at', 'TIMESTAMP ?'), ('', 'failure_reason', 'TEXT ?')]),
}

FOREIGN_KEYS = {
    'clinic_room': {'clinic_id': 'clinic'},
    'employee': {'clinic_id': 'clinic'},
    'employee_role': {'employee_id': 'employee', 'role_id': 'basic_option'},
    'patient': {'created_by': 'employee'},
    'appointment': {'patient_id': 'patient', 'doctor_id': 'employee', 'room_id': 'clinic_room',
                    'type_id': 'basic_option', 'created_by': 'employee'},
    'appointment_event': {'appointment_id': 'appointment', 'changed_by': 'employee'},
    'encounter': {'patient_id': 'patient', 'clinic_id': 'clinic', 'doctor_id': 'employee',
                  'appointment_id': 'appointment'},
    'price_item': {'unit_id': 'basic_option'},
    'bill': {'encounter_id': 'encounter', 'issued_by': 'employee'},
    'bill_line': {'bill_id': 'bill', 'price_item_id': 'price_item', 'dental_order_id': 'dental_order'},
    'payment': {'bill_id': 'bill', 'method_id': 'basic_option', 'refund_of_id': 'payment'},
    'product': {'unit_id': 'basic_option'},
    'dental_order': {'encounter_id': 'encounter', 'product_id': 'product', 'lab_id': 'dental_lab',
                     'created_by': 'employee', 'color_id': 'basic_option', 'box_color_id': 'basic_option',
                     'type_id': 'basic_option', 'unit_id': 'basic_option'},
    'order_tooth': {'order_id': 'dental_order'},
    'order_event': {'order_id': 'dental_order', 'changed_by': 'employee'},
    'order_attachment': {'order_id': 'dental_order', 'type_id': 'basic_option', 'uploaded_by': 'employee'},
    'reminder': {'order_id': 'dental_order', 'appointment_id': 'appointment',
                 'channel_id': 'basic_option', 'created_by': 'employee'},
}

GROUPS = {
    'resources': ('诊所、岗位与基础资料', 'E8EDF5', ['clinic', 'clinic_room', 'employee', 'employee_role', 'basic_option']),
    'patient': ('患者、预约与诊疗', 'E3F0EE', ['patient', 'appointment', 'appointment_event', 'encounter']),
    'billing': ('收费明细、支付与催收', 'F7ECD7', ['price_item', 'bill', 'bill_line', 'payment']),
    'order': ('义齿委托、交付与通知', 'ECE5F4', ['product', 'dental_lab', 'dental_order', 'order_tooth',
                                                   'order_event', 'order_attachment', 'reminder']),
}

def esc(s):
    return s.replace('_', r'\_').replace('&', r'\&').replace('%', r'\%')

def validate_schema():
    assert len(SCHEMA) == 20
    for table, (_, rows) in SCHEMA.items():
        names = [name for _, name, _ in rows]
        assert len(names) == len(set(names)), table
        assert any('PK' in key for key, _, _ in rows), table
        assert {name for key, name, _ in rows if 'FK' in key} == set(FOREIGN_KEYS.get(table, {})), table
        for target in FOREIGN_KEYS.get(table, {}).values():
            assert target in SCHEMA and ('PK', 'id', 'BIGINT') in SCHEMA[target][1], target
    return len(SCHEMA), sum(map(len, FOREIGN_KEYS.values()))

# Replaces the former TikZ renderer. SCHEMA, FOREIGN_KEYS and GROUPS remain unchanged.
def diagram(name, tables, references=(), overview=False):
    included=set(tables)|set(references)
    lines=['@startuml','!include _style.puml','hide circle','hide empty methods',
           'skinparam defaultFontSize 16','skinparam ClassFontSize 19',
           'skinparam ClassAttributeFontSize 15','skinparam ArrowFontSize 13',
           'skinparam nodesep 40','skinparam ranksep 65',
           'skinparam linetype ortho','top to bottom direction']
    def table_block(t):
        title,rows=SCHEMA[t]
        ref=t in references
        if ref:rows=[row for row in rows if 'PK' in row[0]]
        result=[f'entity "{t}\\n{title}'+('（引用）' if ref else '')+f'" as {t} #FFFFFF {{']
        for key,col,typ in rows:
            target=FOREIGN_KEYS.get(t,{}).get(col)
            result.append('  {field} '+(f'[{key}] ' if key else '')+f'{col} : {typ}'+(f' → {target}.id' if target else ''))
        return result+['}']
    if overview:
        for group,(title,color,names) in GROUPS.items():
            selected=[t for t in names if t in included]
            lines.append(f'package "{title}" as group_{group} #{color} {{')
            for t in selected:lines.extend(table_block(t))
            for i in range(0,len(selected),2):
                if i+1<len(selected):lines.append(f'{selected[i]} -[hidden]right- {selected[i+1]}')
                if i+2<len(selected):lines.append(f'{selected[i]} -[hidden]down- {selected[i+2]}')
            lines.append('}')
        lines.extend(['group_resources -[hidden]right- group_patient',
                      'group_patient -[hidden]right- group_billing',
                      'group_billing -[hidden]right- group_order'])
    else:
        for t in SCHEMA:
            if t in included:lines.extend(table_block(t))
    # One child-to-parent line per table pair; every FK remains explicit in its row.
    for table in SCHEMA:
        if table not in included or table in references:continue
        targets=list(dict.fromkeys(FOREIGN_KEYS.get(table,{}).values()))
        for target in targets:
            if target in included:
                lines.append(f'{table} -[norank,#6B7280]-> {target}')
    if not overview:
        grids={
          '16_erd_appointments':[['clinic','employee','employee_role'],['clinic_room','patient','basic_option'],['appointment','encounter','appointment_event']],
          '17_erd_billing':[['employee','encounter','basic_option'],['price_item','bill','payment'],['dental_order','bill_line']],
          '18_erd_orders':[['encounter','employee','basic_option','appointment'],['product','dental_order','dental_lab'],['order_tooth','order_event','order_attachment'],['reminder']]}
        rows=grids[name]
        for row in rows:
            for a,b in zip(row,row[1:]):lines.append(f'{a} -[hidden]right- {b}')
        for row,nxt in zip(rows,rows[1:]):lines.append(f'{row[0]} -[hidden]down- {nxt[0]}')
    lines += ['legend bottom left',
              'PK：主键   FK：外键   UK：唯一   UK*：联合唯一   ?：可空',
              '箭头：外键所在表 → 被引用表；逐字段引用目标见表内。',
              'endlegend','@enduml']
    (FIGURES/f'{name}.puml').write_text('\n'.join(lines)+'\n',encoding='utf-8')
    return name

def generate_erds():
    validate_schema()
    names = [
        diagram('15_erd_overview',list(SCHEMA),overview=True),
        diagram('16_erd_appointments',['clinic','clinic_room','employee','employee_role','basic_option',
                                     'patient','appointment','appointment_event','encounter']),
        diagram('17_erd_billing',['price_item','bill','bill_line','payment'],
                ['employee','encounter','basic_option','dental_order']),
        diagram('18_erd_orders',['product','dental_lab','dental_order','order_tooth','order_event',
                                'order_attachment','reminder'],
                ['employee','encounter','basic_option','appointment'])]

    # Generate the report's complete FK inventory from the same schema.
    text = [r'\begingroup\linespread{1}\fontsize{10.5}{13}\selectfont\renewcommand{\arraystretch}{1.05}',
            r'\begin{longtable}{L{8.0cm}L{6.5cm}}',
            r'\caption{外键引用清单}\label{tab:foreign-keys}\\',
            r'\toprule 外键字段 & 引用目标\\\midrule\endfirsthead',
            r'\toprule 外键字段 & 引用目标\\\midrule\endhead']
    for table, mapping in FOREIGN_KEYS.items():
        by_target = defaultdict(list)
        for col, target in mapping.items():
            by_target[target].append(col)
        for target, cols in by_target.items():
            text.append(esc(table)+'.'+('、'.join(esc(c) for c in cols))+ ' & '+esc(target)+r'.id\\')
    text += [r'\bottomrule\end{longtable}', r'\endgroup']
    (ROOT / 'database_foreign_keys.tex').write_text('\n'.join(text)+'\n', encoding='utf-8')
    return names

if __name__=='__main__':
    generate_erds()
    print('Validated schema:',validate_schema())
