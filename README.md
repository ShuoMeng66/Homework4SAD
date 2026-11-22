# 口腔诊所管理系统 · 系统分析与设计报告

中南大学商学院《系统分析与设计》课程作业。

## 基本信息

| 项目 | 信息 |
| --- | --- |
| 姓名 | 陈荣杰 |
| 学号 | 8305240320 |
| 班级 | 信管 T2401 |
| 选题 | 口腔诊所管理系统 |

## 系统链接

> **在线系统**：https://shuomeng66.github.io/Homework4SAD/
>
> 后端 API：https://api.smart-oscc-ai.top/clinic-api/health

系统在登录页可切换"连接服务器（真实后端）"：勾选走服务器 API，不勾选为浏览器本地演示模式。演示账号见 [`clinic-system/README.md`](clinic-system/README.md)，密码均为 `password`。

## 仓库内容

- `口腔诊所管理系统系统分析与设计报告.pdf`：完整报告 PDF。
- `report.tex`、`analysis_design.tex`、`database_foreign_keys.tex`：LaTeX 源文件。
- `fig/`：报告引用的模型图 PDF（保留中文文件名）。
- `clinic-system/`：按报告实现的系统源码（前端 + FastAPI 后端 + 需求/UML 文档）。

报告围绕患者登记、预约诊疗、费用结算和义齿委托业务，完成业务建模、需求分析、分析模型与数据库逻辑设计。
