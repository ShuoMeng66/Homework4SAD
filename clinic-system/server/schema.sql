-- =====================================================================
-- 口腔诊所管理系统 数据库逻辑设计（严格依据分析与设计报告第 8 章）
-- 25 张业务数据表、61 个外键、欠款查询视图（v_bill_debt）及全部表 23 约束
-- 另附 2 张系统支撑表（sys_account 登录账号、sys_audit_log 变更审计）
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- 1. 诊所、岗位与基础资料（6 张表）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clinic (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  address VARCHAR(240),
  phone VARCHAR(32),
  active BOOLEAN NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clinic_room (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id BIGINT NOT NULL REFERENCES clinic(id),
  room_code VARCHAR(24) NOT NULL UNIQUE,
  name VARCHAR(60) NOT NULL,
  floor_note VARCHAR(80),
  active BOOLEAN NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS basic_option (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind VARCHAR(24) NOT NULL,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(80) NOT NULL,
  description VARCHAR(240),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT 1,
  UNIQUE(kind, code)
);

CREATE TABLE IF NOT EXISTS employee (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id BIGINT NOT NULL REFERENCES clinic(id),
  employee_no VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  phone VARCHAR(32),
  joined_on DATE,
  left_on DATE,
  active BOOLEAN NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS employee_role (
  employee_id BIGINT NOT NULL REFERENCES employee(id),
  role_id BIGINT NOT NULL REFERENCES basic_option(id),
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP,
  PRIMARY KEY(employee_id, role_id)
);

CREATE TABLE IF NOT EXISTS appointment_type (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  duration_min INTEGER NOT NULL CHECK(duration_min > 0),
  self_bookable BOOLEAN NOT NULL DEFAULT 0,
  price_hint VARCHAR(120),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------
-- 2. 患者、排班、预约与诊疗（8 张表，含治疗计划与复诊召回）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS patient (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_by BIGINT NOT NULL REFERENCES employee(id),
  patient_no VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  birth_date DATE,
  phone VARCHAR(32),
  contact_name VARCHAR(80),
  contact_phone VARCHAR(32),
  important_note TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doctor_id BIGINT NOT NULL REFERENCES employee(id),
  room_id BIGINT NOT NULL REFERENCES clinic_room(id),
  created_by BIGINT NOT NULL REFERENCES employee(id),
  work_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  slot_minutes INTEGER NOT NULL CHECK(slot_minutes > 0),
  stage VARCHAR(16) NOT NULL CHECK(stage IN ('正常', '停诊')),
  note VARCHAR(120),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(doctor_id, work_date, start_time),
  CHECK(end_time > start_time)
);

CREATE TABLE IF NOT EXISTS appointment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id BIGINT NOT NULL REFERENCES patient(id),
  doctor_id BIGINT NOT NULL REFERENCES employee(id),
  room_id BIGINT NOT NULL REFERENCES clinic_room(id),
  type_id BIGINT NOT NULL REFERENCES appointment_type(id),
  created_by BIGINT NOT NULL REFERENCES employee(id),
  schedule_id BIGINT REFERENCES schedule(id),
  appointment_no VARCHAR(32) NOT NULL UNIQUE,
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP NOT NULL,
  source VARCHAR(16) NOT NULL CHECK(source IN ('前台', '患者自助')),
  chief_complaint TEXT,
  stage VARCHAR(24) NOT NULL CHECK(stage IN ('待确认', '已确认', '已到诊', '已完成', '已取消', '爽约')),
  confirmed_at TIMESTAMP,
  arrived_at TIMESTAMP,
  completed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  cancel_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(starts_at < ends_at)
);
CREATE INDEX IF NOT EXISTS idx_appointment_doctor ON appointment(doctor_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointment_room ON appointment(room_id, starts_at);

CREATE TABLE IF NOT EXISTS appointment_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id BIGINT NOT NULL REFERENCES appointment(id),
  changed_by BIGINT NOT NULL REFERENCES employee(id),
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  old_start TIMESTAMP,
  new_start TIMESTAMP,
  old_end TIMESTAMP,
  new_end TIMESTAMP,
  old_stage VARCHAR(24) NOT NULL,
  new_stage VARCHAR(24) NOT NULL,
  reason TEXT
);

CREATE TABLE IF NOT EXISTS encounter (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id BIGINT NOT NULL REFERENCES patient(id),
  clinic_id BIGINT NOT NULL REFERENCES clinic(id),
  doctor_id BIGINT NOT NULL REFERENCES employee(id),
  appointment_id BIGINT UNIQUE REFERENCES appointment(id),
  encounter_no VARCHAR(32) NOT NULL UNIQUE,
  occurred_at TIMESTAMP NOT NULL,
  chief_complaint TEXT NOT NULL,
  diagnosis TEXT,
  treatment_note TEXT,
  recall_months INTEGER CHECK(recall_months IS NULL OR recall_months > 0),
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recall (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id BIGINT NOT NULL REFERENCES patient(id),
  encounter_id BIGINT NOT NULL UNIQUE REFERENCES encounter(id),
  appointment_id BIGINT REFERENCES appointment(id),
  due_date DATE NOT NULL,
  reason VARCHAR(160) NOT NULL,
  stage VARCHAR(16) NOT NULL CHECK(stage IN ('待通知', '已通知', '已预约', '已关闭')),
  notified_at TIMESTAMP,
  note VARCHAR(240),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS treatment_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id BIGINT NOT NULL REFERENCES patient(id),
  doctor_id BIGINT NOT NULL REFERENCES employee(id),
  created_by BIGINT NOT NULL REFERENCES employee(id),
  plan_no VARCHAR(32) NOT NULL UNIQUE,
  chief_complaint TEXT,
  diagnosis TEXT,
  stage VARCHAR(16) NOT NULL CHECK(stage IN ('拟定', '已确认', '执行中', '已完成', '已终止')),
  quoted_amount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK(quoted_amount >= 0),
  accepted_at TIMESTAMP,
  closed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- 3. 收费、支付与欠款（4 张表） + 计划项（plan_item） + 义齿委托（7 张表）
--    按外键依赖顺序建表（SQLite 支持循环外键，开启 FK 检查时延迟核对）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id BIGINT NOT NULL REFERENCES basic_option(id),
  item_code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL CHECK(unit_price >= 0),
  active BOOLEAN NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id BIGINT NOT NULL REFERENCES basic_option(id),
  product_code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  material VARCHAR(80) NOT NULL,
  specification VARCHAR(240),
  requires_attachment BOOLEAN NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS dental_lab (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  contact VARCHAR(80) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  address VARCHAR(240),
  interface_code VARCHAR(64),
  active BOOLEAN NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS plan_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id BIGINT NOT NULL REFERENCES treatment_plan(id),
  price_item_id BIGINT REFERENCES price_item(id),
  encounter_id BIGINT REFERENCES encounter(id),
  bill_id BIGINT REFERENCES bill(id),
  lab_order_id BIGINT REFERENCES dental_order(id),
  phase_no INTEGER NOT NULL DEFAULT 1 CHECK(phase_no >= 1),
  tooth_code VARCHAR(8),
  name VARCHAR(120) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL CHECK(quantity > 0),
  unit_price DECIMAL(12,2) NOT NULL CHECK(unit_price >= 0),
  stage VARCHAR(16) NOT NULL CHECK(stage IN ('待执行', '已执行', '已取消')),
  planned_at TIMESTAMP,
  executed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bill (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issued_by BIGINT NOT NULL REFERENCES employee(id),
  encounter_id BIGINT REFERENCES encounter(id),
  plan_item_id BIGINT REFERENCES plan_item(id),
  bill_no VARCHAR(32) NOT NULL UNIQUE,
  issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK(discount_amount >= 0),
  discount_reason TEXT,
  due_date DATE,
  debt_opened_at TIMESTAMP,
  settled_at TIMESTAMP,
  collection_note TEXT,
  stage VARCHAR(24) NOT NULL CHECK(stage IN ('欠款中', '已结清', '已作废')),
  voided_at TIMESTAMP,
  void_reason TEXT
);

CREATE TABLE IF NOT EXISTS dental_order (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id BIGINT NOT NULL REFERENCES product(id),
  lab_id BIGINT NOT NULL REFERENCES dental_lab(id),
  created_by BIGINT NOT NULL REFERENCES employee(id),
  color_id BIGINT NOT NULL REFERENCES basic_option(id),
  box_color_id BIGINT REFERENCES basic_option(id),
  type_id BIGINT NOT NULL REFERENCES basic_option(id),
  unit_id BIGINT NOT NULL REFERENCES basic_option(id),
  encounter_id BIGINT REFERENCES encounter(id),
  plan_item_id BIGINT REFERENCES plan_item(id),
  order_no VARCHAR(32) NOT NULL UNIQUE,
  repair_requirement TEXT NOT NULL,
  quantity DECIMAL(10,2) NOT NULL CHECK(quantity > 0),
  promised_date DATE NOT NULL,
  stage VARCHAR(24) NOT NULL CHECK(stage IN ('草稿', '已发送', '已接收', '试戴', '质量确认', '已交货', '返工', '取消')),
  dispatch_result VARCHAR(24) NOT NULL DEFAULT '',
  expected_at TIMESTAMP,
  sent_at TIMESTAMP,
  accepted_at TIMESTAMP,
  trial_at TIMESTAMP,
  trial_result VARCHAR(24),
  delivered_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  cancel_reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bill_line (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id BIGINT NOT NULL REFERENCES bill(id),
  price_item_id BIGINT NOT NULL REFERENCES price_item(id),
  dental_order_id BIGINT REFERENCES dental_order(id),
  line_no INTEGER NOT NULL,
  item_name VARCHAR(80) NOT NULL,
  unit VARCHAR(24) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL CHECK(quantity > 0),
  unit_price DECIMAL(12,2) NOT NULL CHECK(unit_price >= 0),
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0 CHECK(discount_amount >= 0 AND discount_amount <= quantity * unit_price),
  description VARCHAR(240),
  UNIQUE(bill_id, line_no)
);

CREATE TABLE IF NOT EXISTS payment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id BIGINT NOT NULL REFERENCES bill(id),
  method_id BIGINT NOT NULL REFERENCES basic_option(id),
  refund_of_id BIGINT REFERENCES payment(id),
  request_no VARCHAR(64) NOT NULL UNIQUE,
  external_txn_no VARCHAR(96) UNIQUE,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  kind VARCHAR(24) NOT NULL CHECK(kind IN ('收款', '退款')),
  result VARCHAR(24) NOT NULL CHECK(result IN ('成功', '失败', '待确认', '退款')),
  amount DECIMAL(12,2) NOT NULL CHECK(amount > 0),
  occurred_at TIMESTAMP,
  failure_reason TEXT,
  checked_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_tooth (
  order_id BIGINT NOT NULL REFERENCES dental_order(id),
  tooth_code VARCHAR(8) NOT NULL,
  repair_note VARCHAR(240),
  PRIMARY KEY(order_id, tooth_code)
);

CREATE TABLE IF NOT EXISTS order_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id BIGINT NOT NULL REFERENCES dental_order(id),
  changed_by BIGINT REFERENCES employee(id),
  source VARCHAR(64) NOT NULL,
  event_no VARCHAR(64) NOT NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  old_stage VARCHAR(24) NOT NULL,
  new_stage VARCHAR(24) NOT NULL,
  reason TEXT,
  external_order_no VARCHAR(64),
  UNIQUE(order_id, source, event_no)
);
CREATE INDEX IF NOT EXISTS idx_order_event_order ON order_event(order_id, occurred_at);

CREATE TABLE IF NOT EXISTS order_attachment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id BIGINT NOT NULL REFERENCES dental_order(id),
  type_id BIGINT NOT NULL REFERENCES basic_option(id),
  uploaded_by BIGINT NOT NULL REFERENCES employee(id),
  file_name VARCHAR(180) NOT NULL,
  storage_key VARCHAR(240) NOT NULL UNIQUE,
  mime_type VARCHAR(80) NOT NULL,
  byte_size BIGINT NOT NULL CHECK(byte_size > 0),
  checksum VARCHAR(64),
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id, file_name)
);

CREATE TABLE IF NOT EXISTS reminder (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id BIGINT NOT NULL REFERENCES basic_option(id),
  created_by BIGINT NOT NULL REFERENCES employee(id),
  order_id BIGINT REFERENCES dental_order(id),
  appointment_id BIGINT REFERENCES appointment(id),
  kind VARCHAR(24) NOT NULL,
  scheduled_at TIMESTAMP NOT NULL,
  recipient VARCHAR(120) NOT NULL,
  content TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  delivery_result VARCHAR(24) NOT NULL CHECK(delivery_result IN ('待发送', '已发送', '失败')),
  last_attempt_at TIMESTAMP,
  sent_at TIMESTAMP,
  failure_reason TEXT,
  CHECK((order_id IS NOT NULL AND appointment_id IS NULL) OR (order_id IS NULL AND appointment_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_reminder_order
  ON reminder(order_id, kind, scheduled_at, recipient) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_reminder_appointment
  ON reminder(appointment_id, kind, scheduled_at, recipient) WHERE appointment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reminder_delivery ON reminder(delivery_result, scheduled_at);

-- ---------------------------------------------------------------------
-- 4. 欠款查询视图（报告 8.1、8.4）
--    先按 bill_id 分别聚合收费明细与有效支付，再关联，避免一对多重复累计
-- ---------------------------------------------------------------------
CREATE VIEW IF NOT EXISTS v_bill_debt AS
SELECT
  b.id AS bill_id,
  b.bill_no,
  b.encounter_id,
  b.plan_item_id,
  b.stage,
  b.discount_amount AS bill_discount,
  ROUND(COALESCE(l.line_sum, 0), 2) AS line_sum,
  ROUND(MAX(0, COALESCE(l.line_sum, 0) - b.discount_amount), 2) AS receivable,
  ROUND(COALESCE(p.net_received, 0), 2) AS received,
  ROUND(MAX(0, MAX(0, COALESCE(l.line_sum, 0) - b.discount_amount) - COALESCE(p.net_received, 0)), 2) AS debt,
  b.debt_opened_at,
  b.due_date,
  b.settled_at,
  b.collection_note
FROM bill b
LEFT JOIN (
  SELECT
    bill_id,
    SUM(quantity * unit_price - discount_amount) AS line_sum
  FROM bill_line
  GROUP BY bill_id
) l ON l.bill_id = b.id
LEFT JOIN (
  SELECT
    bill_id,
    SUM(CASE
      WHEN result = '成功' AND kind = '收款' THEN amount
      WHEN result = '成功' AND kind = '退款' THEN -amount
      ELSE 0
    END) AS net_received
  FROM payment
  GROUP BY bill_id
) p ON p.bill_id = b.id;

-- ---------------------------------------------------------------------
-- 5. 系统认证与审计支撑表（对应表 4 管理员维护账号、表 14 安全性与可追溯性）
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sys_account (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash VARCHAR(128) NOT NULL,
  role_code VARCHAR(24) NOT NULL CHECK(role_code IN ('receptionist', 'doctor', 'cashier', 'manager', 'admin', 'patient')),
  display_name VARCHAR(80) NOT NULL,
  employee_id BIGINT REFERENCES employee(id),
  patient_id BIGINT REFERENCES patient(id),
  active BOOLEAN NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sys_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type VARCHAR(32) NOT NULL,
  entity_id BIGINT NOT NULL,
  action VARCHAR(32) NOT NULL,
  operator_id BIGINT,
  operator_name VARCHAR(80),
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON sys_audit_log(entity_type, entity_id, occurred_at);
