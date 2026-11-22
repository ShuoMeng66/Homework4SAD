# 口腔诊所管理系统

基于《系统分析与设计报告》（45 页 PDF）实现的诊所业务后台。严格按 PDF 的功能清单、用例规约、业务规则 BR-01~BR-08、订单状态机（表17）与统计口径（表24）实现，不新增报告未提及的功能。

## 访问

- **前端（GitHub Pages）**：https://shuomeng66.github.io/Homework4SAD/clinic-system/
- **后端 API（HTTPS）**：https://api.smart-oscc-ai.top/clinic-api/health
- 登录页勾选"连接服务器（真实后端）"即使用服务器 API；不勾选则为浏览器本地演示模式（localStorage，功能完整、离线可用）。

## 演示账号（密码均为 `password`）

| 账号 | 角色 | 可见模块 |
| --- | --- | --- |
| receptionist | 前台接待 | 工作台、患者、预约、订单、诊疗 |
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

## 目录结构

```
clinic-system/
├── docs/                  # 需求清单、站点规格、UML 源码（待补）
├── index.html             # 登录 + SPA 入口
├── css/style.css          # 专业医疗后台风
├── js/
│   ├── seed.js            # 字段规范与演示数据（前后端口径一致）
│   ├── api.js             # 数据访问层 + 业务规则引擎 + 远程 API 通道
│   ├── app.js             # 登录、鉴权、菜单、路由、UI 工具
│   └── modules/           # 8 个业务模块
├── server/
│   ├── app.py             # FastAPI 后端（20 表 / BR-01~08 / 表24 统计）
│   ├── schema.sql         # 20 张表 + 44 外键 + 约束
│   └── deploy.sh          # systemd 部署脚本
└── README.md
```

## 本地运行

前端：任意静态服务器（如 `python3 -m http.server 8765`），浏览器打开后登录。
后端（可选，需 FastAPI）：`cd server && python3 -m uvicorn app:app --host 127.0.0.1 --port 5100`，首次启动自动建库并写入种子数据。

## 服务器部署

- 后端：systemd 服务 `clinic-api.service`，监听 `127.0.0.1:5100`。
- 反向代理：nginx 443 站点 `location /clinic-api/ → http://127.0.0.1:5100/api/`。
- 重新部署：更新 `/opt/clinic-system/server/app.py` 后 `systemctl restart clinic-api`。
- 日志：`journalctl -u clinic-api -f`。
