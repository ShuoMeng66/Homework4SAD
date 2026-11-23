/* ============================================================
 * seed.js — 字段规范与初始化种子数据
 * 字段口径来自 PDF 表20~22（20 张表 / 44 外键 / 唯一约束）
 * 本文件是前端 localStorage 与后端 SQLite 的共同事实源
 * ============================================================ */

// ---------- 账号与角色（PDF 表5 + 用户指定默认口令） ----------
const USERS = [
  { username: 'receptionist',  password: 'password', role: 'receptionist', name: '前台接待' },
  { username: 'doctor',        password: 'password', role: 'doctor',       name: '口腔医生' },
  { username: 'cashier',       password: 'password', role: 'cashier',      name: '收费员' },
  { username: 'manager',       password: 'password', role: 'manager',      name: '诊所负责人' },
  { username: 'admin',         password: 'password', role: 'admin',        name: '管理员' },
  // 患者自助入口：用手机号登录，密码即短信验证码
  { username: '13800000001',   password: '123456',   role: 'patient',      name: '张伟', patient_id: 1 },
];

const ROLE_LABEL = {
  receptionist: '前台接待', doctor: '口腔医生', cashier: '收费员',
  manager: '诊所负责人', admin: '管理员', patient: '患者',
};

// 角色可见模块（见 site-spec 权限矩阵）
const ROLE_MODULES = {
  receptionist: ['dashboard', 'patients', 'appointments', 'schedule', 'plans', 'recall', 'orders', 'encounters', 'design'],
  doctor:       ['dashboard', 'appointments', 'schedule', 'plans', 'encounters', 'orders', 'recall', 'design'],
  cashier:      ['dashboard', 'billing', 'design'],
  manager:      ['dashboard', 'basic', 'billing', 'orders', 'reports', 'recall', 'plans', 'design'],
  admin:        ['dashboard', 'basic', 'patients', 'appointments', 'schedule', 'plans', 'encounters', 'billing', 'orders', 'reports', 'recall', 'design'],
  patient:      ['appointments', 'treatment', 'billing'],
};

// ---------- 枚举（PDF BR-02 / BR-04 / BR-05） ----------
const ENUM = {
  appointmentStage: ['待确认', '已确认', '已到诊', '已完成', '已取消', '爽约'],
  payStatus:        ['成功', '失败', '待确认', '退款'],
  orderStage:       ['草稿', '已发送', '已接收', '试戴', '质量确认', '已交货', '返工', '取消'],
  scheduleStage:    ['正常', '停诊'],
  recallStage:      ['待通知', '已通知', '已预约', '已关闭'],
  planStage:        ['拟定', '已确认', '执行中', '已完成', '已终止'],
  optionKinds:      ['支付方式', '通知渠道', '附件类型', '订单类型', '颜色', '盒子颜色', '单位'],
};

// ---------- 基础选项（basic_option，PDF 8.2） ----------
const basicOptions = [
  { id: 3,  kind: '支付方式', code: 'CASH',    name: '现金',   sort_order: 1, active: true },
  { id: 4,  kind: '支付方式', code: 'CARD',    name: '刷卡',   sort_order: 2, active: true },
  { id: 5,  kind: '支付方式', code: 'ONLINE',  name: '在线支付', sort_order: 3, active: true },
  { id: 6,  kind: '通知渠道', code: 'SMS',     name: '短信',   sort_order: 1, active: true },
  { id: 7,  kind: '通知渠道', code: 'EMAIL',   name: '邮件',   sort_order: 2, active: true },
  { id: 8,  kind: '颜色',     code: 'A1',      name: 'A1',     sort_order: 1, active: true },
  { id: 9,  kind: '颜色',     code: 'A2',      name: 'A2',     sort_order: 2, active: true },
  { id: 10, kind: '颜色',     code: 'B1',      name: 'B1',     sort_order: 3, active: true },
  { id: 11, kind: '盒子颜色', code: 'WHITE',   name: '白色',   sort_order: 1, active: true },
  { id: 12, kind: '盒子颜色', code: 'PINK',    name: '粉色',   sort_order: 2, active: true },
  { id: 13, kind: '订单类型', code: 'CROWN',   name: '牙冠',   sort_order: 1, active: true },
  { id: 14, kind: '订单类型', code: 'BRIDGE',  name: '义桥',   sort_order: 2, active: true },
  { id: 15, kind: '单位',     code: 'PIECE',   name: '颗',     sort_order: 1, active: true },
  { id: 16, kind: '单位',     code: 'SET',     name: '套',     sort_order: 2, active: true },
  { id: 17, kind: '附件类型', code: 'PHOTO',   name: '口内照片', sort_order: 1, active: true },
  { id: 18, kind: '附件类型', code: 'MODEL',   name: '牙模',   sort_order: 2, active: true },
];

// ---------- 预约类型（appointment_type，PDF 表21）：标准时长 + 自助开放标记 ----------
// duration_min 决定占用几个排班切片；self_bookable 决定患者端能否直接预约
const appointmentTypes = [
  { id: 1, code: 'FIRST',   name: '初诊检查',   duration_min: 30, self_bookable: true,  price_hint: '口腔检查 50 元',  sort_order: 1, active: true },
  { id: 2, code: 'REVISIT', name: '复诊',       duration_min: 30, self_bookable: true,  price_hint: '按诊疗项目计',    sort_order: 2, active: true },
  { id: 3, code: 'CLEAN',   name: '洁牙',       duration_min: 45, self_bookable: true,  price_hint: '200 元起',        sort_order: 3, active: true },
  { id: 4, code: 'FILL',    name: '补牙',       duration_min: 45, self_bookable: false, price_hint: '300 元/颗',       sort_order: 4, active: true },
  { id: 5, code: 'RCT',     name: '根管治疗',   duration_min: 60, self_bookable: false, price_hint: '按根管数计',      sort_order: 5, active: true },
  { id: 6, code: 'IMPLANT', name: '种植与修复', duration_min: 60, self_bookable: false, price_hint: '需医生评估后报价', sort_order: 6, active: true },
];

// ---------- 排班（schedule）：医生在某日某诊室的出诊段落，按 slot_minutes 切片出号源 ----------
// 号源不单独落表：切片 + 已占用预约实时推导余量，避免余量与预约两处口径不一致
const schedules = [];

// ---------- 复诊召回（recall）：诊疗完成后按建议复查间隔生成，推动患者回诊 ----------
const recalls = [
  { id: 1, patient_id: 1, encounter_id: 1, due_date: day(d(23)),  reason: '根管治疗后 1 个月复查', stage: '待通知', notified_at: null, appointment_id: null, note: '', created_at: iso(d(-7)) },
  { id: 2, patient_id: 2, encounter_id: 2, due_date: day(d(176)), reason: '修复后 6 个月复查',     stage: '待通知', notified_at: null, appointment_id: null, note: '', created_at: iso(d(-4)) },
];

// ---------- 诊所 / 员工 ----------
const clinics = [{ id: 1, clinic_code: 'CLINIC01', name: '口腔诊所', address: '', phone: '', active: true }];

const employees = [
  { id: 1, clinic_id: 1, employee_no: 'E001', name: '王前台', phone: '', active: true, role: 'receptionist' },
  { id: 2, clinic_id: 1, employee_no: 'E002', name: '李医生', phone: '', active: true, role: 'doctor' },
  { id: 3, clinic_id: 1, employee_no: 'E003', name: '张收费', phone: '', active: true, role: 'cashier' },
  { id: 4, clinic_id: 1, employee_no: 'E004', name: '陈负责', phone: '', active: true, role: 'manager' },
  { id: 5, clinic_id: 1, employee_no: 'E005', name: '周医生', phone: '', active: true, role: 'doctor' },
];
const doctors = employees.filter(e => e.role === 'doctor');
const rooms = [
  { id: 1, clinic_id: 1, room_code: 'R1', name: '诊室一', floor_note: '', active: true },
  { id: 2, clinic_id: 1, room_code: 'R2', name: '诊室二', floor_note: '', active: true },
];

// ---------- 价目（price_item） ----------
const priceItems = [
  { id: 1, item_code: 'EXAM',    name: '口腔检查', unit_id: 15, unit_price: 50,    active: true },
  { id: 2, item_code: 'CLEAN',   name: '洁牙',     unit_id: 15, unit_price: 200,   active: true },
  { id: 3, item_code: 'FILL',    name: '补牙',     unit_id: 15, unit_price: 300,   active: true },
  { id: 4, item_code: 'CROWN',   name: '全瓷冠',   unit_id: 15, unit_price: 1800,  active: true },
  { id: 5, item_code: 'EXTRACT', name: '拔牙',     unit_id: 15, unit_price: 150,   active: true },
  { id: 6, item_code: 'RCT',     name: '根管治疗', unit_id: 15, unit_price: 600,   active: true },
];

// ---------- 产品 / 技工所 ----------
const products = [
  { id: 1, product_code: 'P-CROWN', name: '全瓷冠', material: '二氧化锆', unit_id: 15, requires_attachment: true, active: true },
  { id: 2, product_code: 'P-BRIDGE', name: '固定桥', material: '钴铬合金', unit_id: 15, requires_attachment: true, active: true },
];
const dentalLabs = [
  { id: 1, lab_code: 'LAB01', name: '合作技工所', contact: '刘工', phone: '', active: true },
];

// ---------- 患者（patient） ----------
function d(offsetDays) {
  const x = new Date(); x.setDate(x.getDate() + offsetDays); return x;
}
function iso(dt) { return dt.toISOString().slice(0, 16); }
function day(dt) { return dt.toISOString().slice(0, 10); }

const patients = [
  { id: 1, patient_no: 'P0001', name: '张伟',   birth_date: '1985-03-12', phone: '13800000001', contact_name: '', contact_phone: '', important_note: '青霉素过敏', created_by: 1, created_at: iso(d(-30)), updated_at: iso(d(-30)) },
  { id: 2, patient_no: 'P0002', name: '李娜',   birth_date: '1992-07-08', phone: '13800000002', contact_name: '', contact_phone: '', important_note: '', created_by: 1, created_at: iso(d(-20)), updated_at: iso(d(-20)) },
  { id: 3, patient_no: 'P0003', name: '王强',   birth_date: '1978-11-23', phone: '13800000003', contact_name: '', contact_phone: '', important_note: '需复诊根管', created_by: 1, created_at: iso(d(-10)), updated_at: iso(d(-10)) },
  { id: 4, patient_no: 'P0004', name: '赵敏',   birth_date: '1999-01-30', phone: '13800000004', contact_name: '', contact_phone: '', important_note: '', created_by: 1, created_at: iso(d(-3)),  updated_at: iso(d(-3)) },
];

// ---------- 预约（appointment）+ 变更历史 ----------
const appointments = [
  { id: 1, appointment_no: 'A0001', patient_id: 1, doctor_id: 2, room_id: 1, type_id: 1, created_by: 1, chief_complaint: '牙痛复查', starts_at: iso(d(0)).slice(0, 10) + 'T09:00', ends_at: iso(d(0)).slice(0, 10) + 'T09:30', stage: '已确认', created_at: iso(d(-5)), confirmed_at: iso(d(-4)), arrived_at: null, completed_at: null, cancelled_at: null, cancel_reason: null },
  { id: 2, appointment_no: 'A0002', patient_id: 2, doctor_id: 2, room_id: 2, type_id: 2, created_by: 1, chief_complaint: '复诊取模', starts_at: iso(d(0)).slice(0, 10) + 'T10:30', ends_at: iso(d(0)).slice(0, 10) + 'T11:00', stage: '已到诊', created_at: iso(d(-3)), confirmed_at: iso(d(-2)), arrived_at: iso(d(0)), completed_at: null, cancelled_at: null, cancel_reason: null },
  { id: 3, appointment_no: 'A0003', patient_id: 3, doctor_id: 2, room_id: 1, type_id: 1, created_by: 1, chief_complaint: '初诊检查', starts_at: iso(d(1)).slice(0, 10) + 'T14:00', ends_at: iso(d(1)).slice(0, 10) + 'T14:30', stage: '待确认', created_at: iso(d(-1)), confirmed_at: null, arrived_at: null, completed_at: null, cancelled_at: null, cancel_reason: null },
  { id: 4, appointment_no: 'A0004', patient_id: 4, doctor_id: 2, room_id: 2, type_id: 1, created_by: 1, chief_complaint: '洁牙', starts_at: iso(d(-7)).slice(0, 10) + 'T09:00', ends_at: iso(d(-7)).slice(0, 10) + 'T09:30', stage: '已完成', created_at: iso(d(-10)), confirmed_at: iso(d(-9)), arrived_at: iso(d(-7)), completed_at: iso(d(-7)), cancelled_at: null, cancel_reason: null },
  { id: 5, appointment_no: 'A0005', patient_id: 1, doctor_id: 2, room_id: 1, type_id: 2, created_by: 1, chief_complaint: '改约示例', starts_at: iso(d(-12)).slice(0, 10) + 'T15:00', ends_at: iso(d(-12)).slice(0, 10) + 'T15:30', stage: '爽约', created_at: iso(d(-15)), confirmed_at: iso(d(-14)), arrived_at: null, completed_at: null, cancelled_at: null, cancel_reason: null },
];
const appointmentEvents = [
  { id: 1, appointment_id: 5, changed_by: 1, old_start: iso(d(-12)).slice(0,10)+'T14:00', new_start: iso(d(-12)).slice(0,10)+'T15:00', old_end: iso(d(-12)).slice(0,10)+'T14:30', new_end: iso(d(-12)).slice(0,10)+'T15:30', old_stage: '已确认', new_stage: '已确认', reason: '患者要求改约', occurred_at: iso(d(-13)) },
];

// ---------- 诊疗（encounter） ----------
const encounters = [
  { id: 1, encounter_no: 'EN0001', patient_id: 1, clinic_id: 1, doctor_id: 2, appointment_id: 1, occurred_at: iso(d(-7)), chief_complaint: '左下后牙疼痛', diagnosis: '牙髓炎', treatment_note: '开髓引流', recall_months: 1, completed_at: iso(d(-7)), created_at: iso(d(-7)) },
  { id: 2, encounter_no: 'EN0002', patient_id: 2, clinic_id: 1, doctor_id: 2, appointment_id: null, occurred_at: iso(d(-4)), chief_complaint: '前牙美观修复', diagnosis: '牙体缺损', treatment_note: '全瓷冠修复取模', recall_months: 6, completed_at: iso(d(-4)), created_at: iso(d(-4)) },
];

// ---------- 义齿订单（dental_order） ----------
const orders = [
  { id: 1, order_no: 'DO0001', encounter_id: 2, product_id: 1, lab_id: 1, created_by: 2,
    color_id: 8, box_color_id: 11, type_id: 13, unit_id: 15,
    quantity: 1, repair_requirement: '前牙全瓷冠，颜色A1', promised_date: day(d(10)),
    stage: '试戴', dispatch_result: '已接收', expected_at: iso(d(8)), created_at: iso(d(-4)),
    sent_at: iso(d(-4)), accepted_at: iso(d(-3)), trial_at: iso(d(-1)), trial_result: '合格',
    delivered_at: null, cancelled_at: null, cancel_reason: null },
  { id: 2, order_no: 'DO0002', encounter_id: 1, product_id: 2, lab_id: 1, created_by: 2,
    color_id: 9, box_color_id: 12, type_id: 14, unit_id: 15,
    quantity: 2, repair_requirement: '固定桥修复', promised_date: day(d(-3)),
    stage: '已交货', dispatch_result: '已接收', expected_at: iso(d(-4)), created_at: iso(d(-9)),
    sent_at: iso(d(-9)), accepted_at: iso(d(-8)), trial_at: iso(d(-5)), trial_result: '合格',
    delivered_at: iso(d(-4)), cancelled_at: null, cancel_reason: null },
  { id: 3, order_no: 'DO0003', encounter_id: 2, product_id: 1, lab_id: 1, created_by: 2,
    color_id: 10, box_color_id: 11, type_id: 13, unit_id: 15,
    quantity: 1, repair_requirement: '后牙全瓷冠', promised_date: day(d(15)),
    stage: '草稿', dispatch_result: '', expected_at: null, created_at: iso(d(-1)),
    sent_at: null, accepted_at: null, trial_at: null, trial_result: null,
    delivered_at: null, cancelled_at: null, cancel_reason: null },
];
const orderTooths = [
  { order_id: 1, tooth_code: '11', repair_note: '' },
  { order_id: 2, tooth_code: '36', repair_note: '' },
  { order_id: 2, tooth_code: '37', repair_note: '' },
  { order_id: 3, tooth_code: '46', repair_note: '' },
];
const orderEvents = [
  { id: 1, order_id: 1, source: 'lab', event_no: 'EVT001', changed_by: null, old_stage: '已发送', new_stage: '已接收', reason: '', external_order_no: 'LAB-1001', occurred_at: iso(d(-3)), received_at: iso(d(-3)) },
  { id: 2, order_id: 1, source: 'doctor', event_no: 'EVT002', changed_by: 2, old_stage: '已接收', new_stage: '试戴', reason: '试戴结果合格', external_order_no: '', occurred_at: iso(d(-1)), received_at: iso(d(-1)) },
  { id: 3, order_id: 2, source: 'lab', event_no: 'EVT003', changed_by: null, old_stage: '质量确认', new_stage: '已交货', reason: '', external_order_no: 'LAB-1002', occurred_at: iso(d(-4)), received_at: iso(d(-4)) },
  { id: 4, order_id: 1, source: 'doctor', event_no: 'EVT004', changed_by: 2, old_stage: '试戴', new_stage: '返工', reason: '边缘不密合，返工', external_order_no: '', occurred_at: iso(d(0)), received_at: iso(d(0)) },
];
const orderAttachments = [
  { id: 1, order_id: 1, type_id: 17, uploaded_by: 2, file_name: '口内照片.jpg', storage_key: 'att/1/photo.jpg', mime_type: 'image/jpeg', byte_size: 204800, checksum: null, uploaded_at: iso(d(-4)) },
];

// ---------- 收费（bill / bill_line / payment） ----------
const bills = [
  { id: 1, bill_no: 'B0001', encounter_id: 1, issued_by: 3, discount_amount: 0, discount_reason: '',
    issued_at: iso(d(-7)), due_date: day(d(-7)), debt_opened_at: null, settled_at: iso(d(-7)),
    collection_note: '', stage: '已结清', voided_at: null, void_reason: null },
  { id: 2, bill_no: 'B0002', encounter_id: 2, issued_by: 3, discount_amount: 100, discount_reason: '老客户优惠',
    issued_at: iso(d(-4)), due_date: day(d(0)), debt_opened_at: iso(d(-4)), settled_at: null,
    collection_note: '待患者付款', stage: '欠款中', voided_at: null, void_reason: null },
];
const billLines = [
  { id: 1, bill_id: 1, line_no: 1, price_item_id: 1, dental_order_id: null, item_name: '口腔检查', unit: '颗', quantity: 1, unit_price: 50, discount_amount: 0, description: '' },
  { id: 2, bill_id: 2, line_no: 1, price_item_id: 4, dental_order_id: 1, item_name: '全瓷冠', unit: '颗', quantity: 1, unit_price: 1800, discount_amount: 100, description: '' },
];
const payments = [
  { id: 1, bill_id: 1, request_no: 'REQ0001', external_txn_no: 'TXN0001', method_id: 3, refund_of_id: null,
    kind: '收款', result: '成功', amount: 50, requested_at: iso(d(-7)), occurred_at: iso(d(-7)), failure_reason: null, checked_at: iso(d(-7)) },
  { id: 2, bill_id: 2, request_no: 'REQ0002', external_txn_no: null, method_id: 5, refund_of_id: null,
    kind: '收款', result: '待确认', amount: 1700, requested_at: iso(d(-1)), occurred_at: null, failure_reason: null, checked_at: null },
];

// ---------- 提醒（reminder） ----------
const reminders = [
  { id: 1, order_id: 1, appointment_id: null, channel_id: 6, created_by: 4, kind: '试戴提醒', scheduled_at: iso(d(1)), recipient: '13800000002', content: '您的义齿已到试戴阶段，请预约到诊。', delivery_result: '待发送', attempt_count: 0, last_attempt_at: null, sent_at: null, failure_reason: null },
  { id: 2, order_id: 2, appointment_id: null, channel_id: 6, created_by: 4, kind: '取件提醒', scheduled_at: iso(d(0)), recipient: '13800000001', content: '您的义齿已交货，请到诊所领取。', delivery_result: '已发送', attempt_count: 1, last_attempt_at: iso(d(0)), sent_at: iso(d(0)), failure_reason: null },
];

// 预约来源与排班关联：前台排程记「前台」，患者自助记「患者自助」
appointments.forEach(a => { if (!a.source) a.source = '前台'; if (a.schedule_id === undefined) a.schedule_id = null; });


// ---------- 治疗计划（treatment_plan）+ 计划项（plan_item）----------
// 计划项是收费、技工单与执行记录的共同锚点：一颗牙的多次治疗由此连成一条线
const treatmentPlans = [
  { id: 1, plan_no: 'TP0001', patient_id: 1, doctor_id: 2,
    chief_complaint: '左下后牙疼痛', diagnosis: '36 牙髓炎、36-37 牙列缺损',
    stage: '已完成', quoted_amount: 4250, accepted_at: iso(d(-7)), closed_at: iso(d(-3)),
    created_by: 2, created_at: iso(d(-7)) },
  { id: 2, plan_no: 'TP0002', patient_id: 2, doctor_id: 2,
    chief_complaint: '前牙美观修复', diagnosis: '11 牙体缺损',
    stage: '已完成', quoted_amount: 1850, accepted_at: iso(d(-4)), closed_at: iso(d(-2)),
    created_by: 2, created_at: iso(d(-4)) },
  { id: 3, plan_no: 'TP0003', patient_id: 3, doctor_id: 5,
    chief_complaint: '右下后牙冷热刺激痛', diagnosis: '46 深龋',
    stage: '拟定', quoted_amount: 350, accepted_at: null, closed_at: null,
    created_by: 5, created_at: iso(d(-1)) },
];
const planItems = [
  { id: 1, plan_id: 1, tooth_code: '36', price_item_id: 1, phase_no: 1, name: '口腔检查',
    quantity: 1, unit_price: 50, stage: '已执行', encounter_id: 1, bill_id: 1,
    lab_order_id: null, planned_at: iso(d(-7)), executed_at: iso(d(-7)) },
  { id: 2, plan_id: 1, tooth_code: '36', price_item_id: 6, phase_no: 1, name: '根管治疗',
    quantity: 1, unit_price: 600, stage: '已执行', encounter_id: 1, bill_id: null,
    lab_order_id: null, planned_at: iso(d(-7)), executed_at: iso(d(-7)) },
  { id: 3, plan_id: 1, tooth_code: '36', price_item_id: 4, phase_no: 2, name: '固定桥（36-37）',
    quantity: 2, unit_price: 1800, stage: '已执行', encounter_id: 1, bill_id: null,
    lab_order_id: 2, planned_at: iso(d(-7)), executed_at: iso(d(-7)) },
  { id: 4, plan_id: 2, tooth_code: '11', price_item_id: 1, phase_no: 1, name: '口腔检查',
    quantity: 1, unit_price: 50, stage: '已执行', encounter_id: 2, bill_id: null,
    lab_order_id: null, planned_at: iso(d(-4)), executed_at: iso(d(-4)) },
  { id: 5, plan_id: 2, tooth_code: '11', price_item_id: 4, phase_no: 1, name: '全瓷冠修复',
    quantity: 1, unit_price: 1800, stage: '已执行', encounter_id: 2, bill_id: 2,
    lab_order_id: 1, planned_at: iso(d(-4)), executed_at: iso(d(-4)) },
  { id: 6, plan_id: 3, tooth_code: '46', price_item_id: 1, phase_no: 1, name: '口腔检查',
    quantity: 1, unit_price: 50, stage: '待执行', encounter_id: null, bill_id: null,
    lab_order_id: null, planned_at: iso(d(-1)), executed_at: null },
  { id: 7, plan_id: 3, tooth_code: '46', price_item_id: 3, phase_no: 1, name: '补牙',
    quantity: 1, unit_price: 300, stage: '待执行', encounter_id: null, bill_id: null,
    lab_order_id: null, planned_at: iso(d(-1)), executed_at: null },
];

// ---------- 汇总为数据库对象 ----------
const DB = {
  users: USERS, basicOptions, appointmentTypes, clinics, employees, rooms, priceItems, products, dentalLabs,
  patients, schedules, appointments, appointmentEvents, encounters, recalls,
  orders, orderTooths, orderEvents, orderAttachments,
  bills, billLines, payments, reminders,
  treatmentPlans, planItems,
};

// 表的展示名（基础信息模块用）
const TABLE_LABEL = {
  basicOptions: '分类基础选项', appointmentTypes: '预约类型', clinics: '诊所资料',
  employees: '员工', rooms: '诊室', schedules: '医生排班',
  priceItems: '收费价目', products: '义齿产品', dentalLabs: '合作技工所',
  treatmentPlans: '治疗计划', planItems: '计划项',
};

window.SEED = {
  USERS, ROLE_LABEL, ROLE_MODULES, ENUM, DB, TABLE_LABEL, ROLE_MODULES,
  clone() { return JSON.parse(JSON.stringify(DB)); },
};
