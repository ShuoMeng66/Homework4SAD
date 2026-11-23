# 口腔诊所管理系统

基于《系统分析与设计报告》（45 页 PDF）实现的诊所业务后台。严格按 PDF 的功能清单、用例规约、业务规则 BR-01~BR-08、订单状态机（表17）与统计口径（表24）实现，不新增报告未提及的功能。

## 访问

- **在线系统**：https://shuomeng66.github.io/Homework4SAD/
- **后端 API（HTTPS）**：https://api.smart-oscc-ai.top/clinic-api/health

**强制服务器模式**：系统启动时必须从服务器读取表数据，登录由服务器校验，数据只存服务器 SQLite，浏览器仅保留内存读缓存与登录会话，不再有本地离线模式。登录页无"连接服务器"开关；服务器不可达时会显示错误并阻止进入。

## 登录账号（密码均为 `password`）

| 账号 | 角色 | 可见模块 |
| --- | --- | --- |
| receptionist | 前台接待 | 工作台、患者、排班、预约、召回、订单、诊疗 |
| doctor | 口腔医生 | 工作台、预约、诊疗、订单 |
| cashier | 收费员 | 工作台、收费欠款 |
| manager | 诊所负责人 | 工作台、基础信息、收费欠款、订单、查询统计 |
| admin | 管理员 | 全部 |

## 功能模块与 PDF 对应

| 模块 | PDF 依据 |
| --- | --- |
| 基础信息 | 表6 F1、表16、表19、8.2 基础选项 |
| 患者管理 | 表6 F2、UC-01 表9、表19 |
| 预约管理（冲突检查/状态/改约留痕） | 表6 F4、BR-01/02、6.2、表22 |
| 诊疗记录 | 表16 配套用例、表20 encounter、8.7 跨表一致性 |
| 收费欠款（应收/已收/欠款/追溯） | 表6 F3、UC-02 表10、BR-03/04、6.3、8.4 |
| 义齿订单（状态机/回执去重/试戴返工交货） | 表6 F5、UC-03 表11、BR-05/06、表17、6.4 |
| 查询统计（五项指标/样本量/明细/提醒/导出） | 表6 F6、UC-04 表12、BR-07/08、表24 |
| 订单提醒 | 表6、6.5、表18 |

详见 [`docs/requirements.md`](docs/requirements.md)（逐项需求与出处）与 [`docs/site-spec.md`](docs/site-spec.md)（页面清单、权限矩阵、接口契约）。

## 设计依据（作业要求的 9 类图）

三张最终图已归档到 `docs/design/`，并有可编辑源码 `docs/uml/`：

| 图 | PDF | 可编辑源码 | 系统对应 |
| --- | --- | --- | --- |
| 系统用例图 | `系统用例图.pdf` | `system-usecase.puml` | 4 类内部角色 + 4 个核心用例 + 3 类系统参与者 |
| 核心分析类图 | `核心分析类图.pdf` | `analysis-classes.puml` | 7 boundary / 4 control / 实体类及多重性关系 |
| 登记患者并预约诊疗序列图 | `登记患者并预约诊疗序列图.pdf` | `uc01-sequence.puml` | UC-01 身份待核对分支、时段冲突与候选时段分支、改约留痕 |

订单状态机图不属于作业要求的 9 类图，已从待改清单移除；状态机本身仍按报告表 17 在代码中完整实现。

## 目录结构

```
clinic-system/
├── docs/
│   ├── design/            # 三张最终设计图 PDF（系统用例图、核心分析类图、UC-01 序列图）
│   ├── uml/               # 三份可编辑 UML 源码，对应上述设计图
│   ├── requirements.md    # 逐项需求与 PDF 出处
│   └── site-spec.md       # 页面清单、权限矩阵、接口契约
├── index.html             # 登录 + SPA 入口
├── assets/                # 登录页诊所照片 + 自托管展示字体
├── css/style.css          # 临床编辑风：暖纸底 + 深墨绿 + 单一朱红强调
├── js/
│   ├── seed.js            # 字段规范与初始化数据（前后端口径一致）
│   ├── api.js             # 内存读缓存 + 异步落库 + 后端权威计算调用
│   ├── app.js             # 登录、鉴权、菜单、路由、UI 工具
│   └── modules/           # 10 个业务模块
├── server/
│   ├── store.py           # 轻量表格存储服务（标准库 http.server + sqlite3）
│   ├── seed.json          # 20 表种子数据，首次启动自动初始化
│   ├── app.py             # 旧版 FastAPI 实现，仅作设计留档，不运行
│   ├── schema.sql         # 20 张表 + 44 外键 + 约束（设计依据）
│   └── deploy.sh          # 旧版部署脚本，仅作留档
└── README.md
```

## 架构分工

| 位置 | 负责 | 依据 |
| --- | --- | --- |
| 前端内存缓存 | 简单 CRUD、列表筛选、界面状态 | 表20~22 字段口径 |
| 后端 `/api/compute/*` | BR-01 冲突与候选时段、BR-03/04 欠款计算、BR-06 表17 状态机、表24 五项统计 | 需要全局一致视角的规则 |
| 后端 `/api/db` | 20 张表数据的读取与整库保存（SQLite WAL） | 强制服务器存储 |

标准库服务常驻内存约 23MB（旧 FastAPI 约 50MB），systemd 设 `MemoryMax=128M`，避免占用服务器宝贵 RAM。

## 本地运行

前端：任意静态服务器（如 `python3 -m http.server 8765`）。
后端：`cd server && CLINIC_PORT=5199 python3 store.py`，首次启动用 `seed.json` 初始化；前端默认连线上 API，本地测试可设 `window.CLINIC_CONFIG = {apiBase:'http://127.0.0.1:5199'}`。

## 服务器部署

- 后端：systemd 服务 `clinic-store.service`，监听 `127.0.0.1:5100`。
- 反向代理：nginx 443 站点 `location /clinic-api/ → http://127.0.0.1:5100/api/`。
- 重新部署：更新 `/opt/clinic-system/server/store.py` 后 `systemctl restart clinic-store`。
- 日志：`journalctl -u clinic-store -f`。
