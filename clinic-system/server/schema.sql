-- 口腔诊所管理系统 数据库结构
-- 依据：报告 PDF 表20（对象到关系表映射）、表21（44 外键）、表22（唯一性与检查）
-- 20 张表；字段类型用通用 SQL 名称；id 为主键（订单牙位、员工岗位用复合主键）

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS reminder;
DROP TABLE IF EXISTS order_attachment;
DROP TABLE IF EXISTS order_event;
DROP TABLE IF EXISTS order_tooth;
DROP TABLE IF EXISTS payment;
DROP TABLE IF EXISTS bill_line;
DROP TABLE IF EXISTS bill;
DROP TABLE IF EXISTS dental_order;
DROP TABLE IF EXISTS dental_lab;
DROP TABLE IF EXISTS product;
DROP TABLE IF EXISTS price_item;
DROP TABLE IF EXISTS encounter;
DROP TABLE IF EXISTS appointment_event;
DROP TABLE IF EXISTS appointment;
DROP TABLE IF EXISTS patient;
DROP TABLE IF EXISTS basic_option;
DROP TABLE IF EXISTS employee_role;
DROP TABLE IF EXISTS employee;
DROP TABLE IF EXISTS clinic_room;
DROP TABLE IF EXISTS clinic;

CREATE TABLE clinic (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  address VARCHAR(240),
  phone VARCHAR(32),
  active BOOLEAN NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE clinic_room (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id BIGINT NOT NULL REFERENCES clinic(id),
  room_code VARCHAR(24) NOT NULL UNIQUE,
  name VARCHAR(60) NOT NULL,
  floor_note VARCHAR(80),
  active BOOLEAN NOT NULL DEFAULT 1
);
CREATE TABLE basic_option (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind VARCHAR(24) NOT NULL,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(80) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT 1,
  description VARCHAR(240),
  UNIQUE(kind, code)  -- UK* 联合唯一，表22
);
CREATE TABLE employee (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinic_id BIGINT NOT NULL REFERENCES clinic(id),
  employee_no VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  phone VARCHAR(32),
  active BOOLEAN NOT NULL DEFAULT 1,
  joined_on DATE,
  left_on DATE
);
CREATE TABLE employee_role (
  employee_id BIGINT NOT NULL REFERENCES employee(id),
  role_id BIGINT NOT NULL REFERENCES basic_option(id),
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP,
  PRIMARY KEY(employee_id, role_id)  -- 复合主键，拆解多对多
);
CREATE TABLE patient (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_no VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  birth_date DATE,
  phone VARCHAR(32),
  contact_name VARCHAR(80),
  contact_phone VARCHAR(32),
  important_note TEXT,
  created_by BIGINT REFERENCES employee(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE appointment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_no VARCHAR(32) NOT NULL UNIQUE,
  patient_id BIGINT NOT NULL REFERENCES patient(id),
  doctor_id BIGINT NOT NULL REFERENCES employee(id),
  room_id BIGINT NOT NULL REFERENCES clinic_room(id),
  type_id BIGINT NOT NULL REFERENCES basic_option(id),
  created_by BIGINT REFERENCES employee(id),
  chief_complaint TEXT,
  starts_at TIMESTAMP NOT NULL,
  ends_at TIMESTAMP NOT NULL,
  stage VARCHAR(24) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMP,
  arrived_at TIMESTAMP,
  completed_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  cancel_reason TEXT,
  CHECK(starts_at < ends_at)
);
CREATE INDEX idx_appt_doctor ON appointment(doctor_id, starts_at);
CREATE INDEX idx_appt_room ON appointment(room_id, starts_at);
CREATE TABLE appointment_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  appointment_id BIGINT NOT NULL REFERENCES appointment(id),
  changed_by BIGINT REFERENCES employee(id),
  old_start TIMESTAMP, new_start TIMESTAMP,
  old_end TIMESTAMP, new_end TIMESTAMP,
  old_stage VARCHAR(24), new_stage VARCHAR(24),
  reason TEXT,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE encounter (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  encounter_no VARCHAR(32) NOT NULL UNIQUE,
  patient_id BIGINT NOT NULL REFERENCES patient(id),
  clinic_id BIGINT NOT NULL REFERENCES clinic(id),
  doctor_id BIGINT NOT NULL REFERENCES employee(id),
  appointment_id BIGINT UNIQUE REFERENCES appointment(id),
  occurred_at TIMESTAMP NOT NULL,
  chief_complaint TEXT NOT NULL,
  diagnosis TEXT, treatment_note TEXT,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE price_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  unit_id BIGINT NOT NULL REFERENCES basic_option(id),
  unit_price DECIMAL(12,2) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE bill (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_no VARCHAR(32) NOT NULL UNIQUE,
  encounter_id BIGINT NOT NULL REFERENCES encounter(id),
  issued_by BIGINT REFERENCES employee(id),
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_reason TEXT,
  issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  due_date DATE,
  debt_opened_at TIMESTAMP,
  settled_at TIMESTAMP,
  collection_note TEXT,
  stage VARCHAR(24) NOT NULL,
  voided_at TIMESTAMP,
  void_reason TEXT
);
CREATE TABLE bill_line (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id BIGINT NOT NULL REFERENCES bill(id),
  line_no INTEGER NOT NULL,
  price_item_id BIGINT NOT NULL REFERENCES price_item(id),
  dental_order_id BIGINT REFERENCES dental_order(id),
  item_name VARCHAR(80) NOT NULL,
  unit VARCHAR(24) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL CHECK(quantity > 0),
  unit_price DECIMAL(12,2) NOT NULL CHECK(unit_price >= 0),
  discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  description VARCHAR(240),
  UNIQUE(bill_id, line_no)
);
CREATE TABLE payment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id BIGINT NOT NULL REFERENCES bill(id),
  request_no VARCHAR(64) NOT NULL UNIQUE,
  external_txn_no VARCHAR(96) UNIQUE,
  method_id BIGINT NOT NULL REFERENCES basic_option(id),
  refund_of_id BIGINT REFERENCES payment(id),
  kind VARCHAR(24) NOT NULL,
  result VARCHAR(24) NOT NULL,
  amount DECIMAL(12,2) NOT NULL CHECK(amount > 0),
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  occurred_at TIMESTAMP,
  failure_reason TEXT,
  checked_at TIMESTAMP
);
CREATE TABLE product (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  material VARCHAR(80) NOT NULL,
  unit_id BIGINT NOT NULL REFERENCES basic_option(id),
  specification VARCHAR(240),
  requires_attachment BOOLEAN NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT 1
);
CREATE TABLE dental_lab (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lab_code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  contact VARCHAR(80) NOT NULL,
  phone VARCHAR(32) NOT NULL,
  address VARCHAR(240),
  interface_code VARCHAR(64),
  active BOOLEAN NOT NULL DEFAULT 1
);
CREATE TABLE dental_order (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no VARCHAR(32) NOT NULL UNIQUE,
  encounter_id BIGINT NOT NULL REFERENCES encounter(id),
  product_id BIGINT NOT NULL REFERENCES product(id),
  lab_id BIGINT NOT NULL REFERENCES dental_lab(id),
  created_by BIGINT REFERENCES employee(id),
  color_id BIGINT NOT NULL REFERENCES basic_option(id),
  box_color_id BIGINT REFERENCES basic_option(id),
  type_id BIGINT NOT NULL REFERENCES basic_option(id),
  unit_id BIGINT NOT NULL REFERENCES basic_option(id),
  quantity DECIMAL(10,2) NOT NULL,
  repair_requirement TEXT NOT NULL,
  promised_date DATE NOT NULL,
  stage VARCHAR(24) NOT NULL,
  dispatch_result VARCHAR(24),
  expected_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP, accepted_at TIMESTAMP, trial_at TIMESTAMP,
  trial_result VARCHAR(24), delivered_at TIMESTAMP,
  cancelled_at TIMESTAMP, cancel_reason TEXT
);
CREATE TABLE order_tooth (
  order_id BIGINT NOT NULL REFERENCES dental_order(id),
  tooth_code VARCHAR(8) NOT NULL,
  repair_note VARCHAR(240),
  PRIMARY KEY(order_id, tooth_code)
);
CREATE TABLE order_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id BIGINT NOT NULL REFERENCES dental_order(id),
  source VARCHAR(64) NOT NULL,
  event_no VARCHAR(64) NOT NULL,
  changed_by BIGINT REFERENCES employee(id),
  old_stage VARCHAR(24), new_stage VARCHAR(24),
  reason TEXT, external_order_no VARCHAR(64),
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id, source, event_no)
);
CREATE INDEX idx_orderevent_order ON order_event(order_id, occurred_at);
CREATE TABLE order_attachment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id BIGINT NOT NULL REFERENCES dental_order(id),
  type_id BIGINT NOT NULL REFERENCES basic_option(id),
  uploaded_by BIGINT REFERENCES employee(id),
  file_name VARCHAR(180) NOT NULL,
  storage_key VARCHAR(240) NOT NULL UNIQUE,
  mime_type VARCHAR(80) NOT NULL,
  byte_size BIGINT NOT NULL CHECK(byte_size > 0),
  checksum VARCHAR(64),
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE reminder (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id BIGINT REFERENCES dental_order(id),
  appointment_id BIGINT REFERENCES appointment(id),
  channel_id BIGINT NOT NULL REFERENCES basic_option(id),
  created_by BIGINT REFERENCES employee(id),
  kind VARCHAR(24) NOT NULL,
  scheduled_at TIMESTAMP NOT NULL,
  recipient VARCHAR(120) NOT NULL,
  content TEXT NOT NULL,
  delivery_result VARCHAR(24) NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMP, sent_at TIMESTAMP, failure_reason TEXT,
  UNIQUE(order_id, kind, scheduled_at, recipient),
  UNIQUE(appointment_id, kind, scheduled_at, recipient),
  CHECK((order_id IS NOT NULL AND appointment_id IS NULL) OR (order_id IS NULL AND appointment_id IS NOT NULL))
);
