# 站点规格卡（site-spec）

## 基本信息
- 站点类型：口腔诊所临床与运营管理系统（单页工作站 SPA）
- 视觉风格：瑞士临床医疗工作站风（深海蓝侧栏 + 临床钴蓝交互强调 + 雾石色纸感工作区 + 等宽表格数字）
- 技术栈：前端原生 HTML5 / CSS3 / ES6+（零构建静态托管于 GitHub Pages）；后端 Python 3.12 标准库 `http.server` + `sqlite3`（常驻内存约 16–20 MB）
- 数据策略：强制服务端权威模式——所有鉴权、状态机校验、冲突检测、金额折算、统计聚合与审计留痕均由后端 SQLite 事务执行

## 页面清单（12 个业务模块 + 登录页）

| 模块 ID | 名称 | 核心职责 | 允许访问角色 |
| --- | --- | --- | --- |
| `dashboard` | 今日队列 / 我的概览 | 当日候诊分诊、待处理工作项、个人概览 | 全部已登录角色 |
| `patients` | 患者管理 | 实名建档、检索、待核对档案核实与合并 | `receptionist`、`doctor`（只读）、`admin` |
| `schedule` | 排班号源 | 医生出诊时段、切片时长、停诊与号源余量 | `receptionist`、`doctor`（只读）、`manager`、`admin` |
| `appointments` | 预约管理 / 我的预约 | 三步向导选号、加号留痕、改约历史、患者自助预约 | `receptionist`、`doctor`（只读）、`admin`、`patient`（本人） |
| `recall` | 复诊召回 | 到期召回清单、通知登记、直接转预约闭环 | `receptionist`、`doctor`、`manager`、`admin` |
| `encounters` | 诊疗记录 | 关联预约录入电子病历、建议复查月数联动召回 | `doctor`、`receptionist`（脱敏只读）、`admin` |
| `plans` | 治疗计划 | FDI 牙位分期计划、确认锁价、逐项执行联动收费与技工单 | `doctor`、`admin` |
| `treatment` | 我的治疗 | 本人分期计划、修复件三态进度（制作中/待试戴/可取件）、本人病历 | `patient` |
| `billing` | 收费欠款 / 我的费用 | 调价开单、折扣原因、分次收款、查单核对、退款重算、催收与凭证 | `cashier`、`manager`（只读/催收）、`admin`、`patient`（本人只读） |
| `orders` | 义齿订单 | 8 阶段全链路追踪、多牙位、附件上传下载、幂等回执、试戴返工与更正 | `doctor`、`receptionist`（跟进/交货）、`manager`（跟进/线下结单）、`admin` |
| `reports` | 查询统计 | 表 25 七项指标、小样本提示、明细下钻、CSV 导出、通知排定与重试 | `manager`、`receptionist`（仅提醒）、`admin` |
| `basic` | 基础信息 | 诊所/诊室/员工兼岗/预约类型/价目/产品/技工所/字典/账号/审计日志 | `manager`、`admin`（含系统账号与审计日志） |

## 核心接口契约

| 方法 | 路径 | 用途 | 角色限制 |
| --- | --- | --- | --- |
| `GET` | `/health` | 服务存活、25 张业务表与行数检查 | 公开 |
| `POST` | `/auth/sms-code`、`/auth/login`、`/auth/logout` | 员工口令登录与患者短信验证码登录/登出 | 公开 / 已登录 |
| `GET` | `/bootstrap` | 按当前角色拉取权限隔离与脱敏后的业务快照 | 已登录 |
| `GET` | `/slots`、`/doctor-dates` | 排班切片空闲号源推导与医生月历余量（患者限制 14 天） | 已登录 |
| `POST` | `/patients`、`/patients/verify`、`/patients/merge` | 患者建档、核实与待核对档案合并 | `receptionist`、`admin` |
| `POST` | `/schedules`、`/schedules/toggle` | 新增排班段、停诊/恢复切换 | `receptionist`、`manager`、`admin` |
| `POST` | `/appointments`、`/appointments/stage`、`/appointments/reschedule` | 预约创建（含自助与加号）、状态流转、改约留痕 | 见模块权限 |
| `POST` | `/encounters`、`/recalls/stage` | 录入病历（自动生成召回）、召回状态更新 | `doctor`、`receptionist`、`manager`、`admin` |
| `POST` | `/plans`、`/plans/stage`、`/plans/items/execute`、`/plans/items/cancel`、`/plans/items/lab-order` | 分期治疗计划全生命周期与收费/技工单联动 | `doctor`、`admin` |
| `POST` | `/bills`、`/bills/discount`、`/bills/collection`、`/bills/void` | 开单、整单折扣、催收备注、作废 | `cashier`、`manager`（催收）、`admin` |
| `POST` | `/payments/create`、`/payments/verify`、`/payments/refund` | 分次收款、待确认回执核对、部分/全额退款 | `cashier`、`admin` |
| `POST` | `/orders`、`/orders/stage`、`/orders/receipt`、`/orders/attachments` | 义齿订单草稿、阶段流转、技工所回执、附件上传 | `doctor`、`receptionist`、`manager`、`admin` |
| `GET` | `/orders/attachments/:id` | 鉴权下载随单附件原文件 | `doctor`、`receptionist`、`manager`、`admin` |
| `GET` | `/reports` | 表 25 七项统计指标、小样本标记与原始明细下钻 | `manager`、`admin` |
| `POST` | `/reminders/create`、`/reminders/send` | 通知提醒排定（含患者修复隐私脱敏校验）与发送重试 | `receptionist`、`manager`、`admin` |
| `POST` | `/basic/*` | 基础主数据维护、停用切换与系统账号管理 | `manager`、`admin` |
