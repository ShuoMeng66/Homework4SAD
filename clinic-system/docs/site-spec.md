# 站点规格卡（site-spec）

## 基本信息
- 站点类型：口腔诊所管理系统（业务后台，SPA）
- 视觉风格：专业医疗后台风——蓝白主色、卡片布局、数据表格、状态标签
- 技术栈：前端 HTML/CSS/JS（无构建，静态托管 GitHub Pages）；后端 Python 标准库 http.server + SQLite（部署用户服务器）
- 上线方式：前端 GitHub Pages；后端 Ubuntu 服务器（120.27.207.104）
- 数据策略：强制服务器模式——浏览器只有内存读缓存，数据唯一来源为服务器 SQLite；登录由服务器校验；无本地离线模式

## 页面清单（7 个业务模块 + 登录 + 工作台）

| 页面 | 功能域 | 主要操作 | 角色可见 |
| --- | --- | --- | --- |
| 登录页 login | 鉴权 | 账号密码登录（服务器校验），服务器不可达时阻止进入 | 全部 |
| 工作台 dashboard | 概览 | 今日预约、待处理订单、欠款概览、快捷入口 | 全部（按角色精简） |
| 基础信息 basic | F1 | 价目/颜色/单位/产品/员工/诊所/订单类型/盒子颜色/附件类型 CRUD | admin、manager |
| 患者管理 patients | F2 | 登记、查询、期间查询、联系方式/重要提示、待核对档案 | receptionist、admin |
| 预约管理 appointments | F4 | 预约登记、冲突检查、今日/明日/期间查询、状态流转、改约留痕 | receptionist、doctor、admin |
| 诊疗记录 encounters | 配套 | 录入诊疗、关联预约/患者 | doctor、admin |
| 收费欠款 billing | F3 | 收费录入、价目调用、支付记录、欠款查询、收费单追溯 | cashier、manager、admin |
| 义齿订单 orders | F5 | 订单草稿、牙位/产品/颜色/附件、发送、回执、试戴/交货/返工、状态追踪 | doctor、receptionist、admin |
| 查询统计 reports | F6 | 四项指标+确认周期、样本量、明细入口、订单提醒、导出 | manager、admin |

## 角色权限矩阵（依据表5 + 补充）

| 账号 | 角色 | 可见模块 |
| --- | --- | --- |
| receptionist | 前台接待 | 工作台、患者、预约、订单（查询与提醒）、诊疗（查看） |
| doctor | 口腔医生 | 工作台、预约（查看）、诊疗（录入）、订单（建立与追踪） |
| cashier | 收费员 | 工作台、收费欠款 |
| manager | 诊所负责人 | 工作台、基础信息、收费欠款（欠款）、查询统计、订单提醒 |
| admin | 管理员 | 全部模块 |

默认口令均为 `password`。角色权限在前端菜单拦截 + 后端 API 鉴权双重实现。

## 接口契约（前后端共用）

基础路径：`/api`。所有响应 `{ ok: boolean, data?: any, error?: string }`。

| 方法 | 路径 | 用途 | 权限 |
| --- | --- | --- | --- |
| GET | /health | 健康检查（服务、表数、行数） | 公开 |
| POST | /auth/login | 登录，返回 token+角色 | 公开 |
| GET | /db | 读取全部 20 张表数据（前端内存缓存来源） | 已登录 |
| PUT | /db | 保存全部表数据（前端写操作异步落库） | 已登录 |
| POST | /compute/conflict | BR-01 预约冲突检查与候选时段（权威） | 已登录 |
| POST | /compute/bill | BR-03/04 应收、已收、欠款计算（权威） | 已登录 |
| POST | /compute/transition | BR-06 表17 订单状态机校验（权威） | 已登录 |
| GET | /compute/reports?start=&end= | 表24 五项统计口径（权威） | 已登录 |
| GET | /patients | 患者列表（支持 period/keyword） | receptionist/admin |
| POST | /patients | 登记患者 | receptionist/admin |
| GET | /appointments | 预约查询（today/tomorrow/period/conflict） | receptionist/doctor/admin |
| POST | /appointments | 创建预约（含冲突检查） | receptionist/admin |
| PATCH | /appointments/:id | 状态流转/改约 | receptionist/admin |
| GET | /encounters | 诊疗列表 | doctor/admin |
| POST | /encounters | 录入诊疗 | doctor/admin |
| GET | /bills | 收费单列表 | cashier/manager/admin |
| POST | /bills | 创建收费单+明细+待确认支付 | cashier/admin |
| POST | /payments/:id/result | 记录支付结果 | cashier/admin |
| GET | /debts | 欠款查询 | cashier/manager/admin |
| GET | /orders | 订单列表（试戴/交货/逾期筛选） | doctor/receptionist/admin |
| POST | /orders | 建立订单草稿 | doctor/admin |
| PATCH | /orders/:id/send | 发送订单 | doctor/admin |
| POST | /orders/:id/events | 技工所回执/进展 | doctor/admin |
| PATCH | /orders/:id/stage | 试戴/交货/返工 | doctor/receptionist/admin |
| GET | /reports/summary | 统计指标+样本量 | manager/admin |
| GET | /basic-options | 基础选项（按 kind） | 全角色只读；manager/admin 可写 |
| GET | /reminders | 提醒列表 | manager/receptionist/admin |

数据字段以 PDF 表20~22 为准，前端 mock 与后端 schema 使用同一份字段定义（`js/seed.js` 的 FIELD_SPEC）。

## 目录结构

```
clinic-system/
├── docs/            # requirements.md / site-spec.md / uml/*.puml
├── index.html       # 登录 + SPA 宿主页
├── css/style.css
├── js/
│   ├── api.js       # 内存读缓存 + 异步落库 + 后端计算接口
│   ├── seed.js      # 字段规范 + 种子数据
│   ├── app.js       # 路由、布局、鉴权
│   └── modules/*.js # 各业务页
├── server/          # Python 标准库 + SQLite 轻量存储
│   ├── package.json
│   ├── server.js
│   ├── schema.sql
│   └── deploy.sh
└── README.md
```
