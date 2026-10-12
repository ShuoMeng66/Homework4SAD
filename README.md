# 口腔诊所管理系统

中南大学商学院《系统分析与设计》课程项目，完整流程涵盖 **需求分析 → 系统设计 → 编码开发 → 测试交付**。

## 项目简介

本项目面向中小型口腔诊所的日常经营场景，目标是建立一套覆盖 **患者登记与预约、诊疗记录、收费与欠费处理、义齿订单追踪、经营查询统计** 的信息化管理系统，替代目前依赖纸质台账与人工记忆的作业方式。

> **当前进度**：本仓库本次提交的是**系统分析与设计阶段的设计报告**，编码开发部分尚未开始，后续实现会继续补充到本仓库。

## 作者信息

| 项目 | 内容 |
| --- | --- |
| 学校 | 中南大学 |
| 学院 | 商学院 |
| 课程 | 系统分析与设计 |
| 姓名 | 陈荣杰 |
| 学号 | 8305240320 |
| 班级 | 信管 T2401 |

## 文件划分

| 路径 | 说明 | 阶段 |
| --- | --- | --- |
| `陈荣杰_8305240320_系统分析与设计报告.pdf` | 设计报告最终版，A4 共 15 页 | 设计 |
| `report.tex` | 报告 LaTeX 源稿（统一文档模板、全部正文，含图 5 的 TikZ 绘图代码） | 设计 |
| `figures/` | 报告引用的全部插图 | 设计 |
| `build.bat` | Windows 下一键编译脚本 | 设计 |

### `figures/` 目录

| 文件 | 对应图 |
| --- | --- |
| `cover.pdf` | 封面配图 |
| `01_business_usecase.pdf` | 图 1　口腔诊所业务用例图 |
| `02_current_sequence.pdf` | 图 2　现状业务序列图 |
| `03_improved_sequence.pdf` | 图 3　改进后的业务序列图 |
| `04_system_usecase.pdf` | 图 4　口腔诊所管理系统用例图 |
| `06_usecase_spec.pdf` | 图 6　用例规约关系图 |

> 图 5（核心数据域关系图）为矢量图形，由 `report.tex` 中的 TikZ 代码直接绘制，因此没有独立文件。

## 编译方式

需要 TeX Live 2024 或兼容发行版，**必须使用 XeLaTeX**（报告基于 `ctexart` + `fontset=windows` 中文字体）。

```bash
xelatex -interaction=nonstopmode report.tex
xelatex -interaction=nonstopmode report.tex   # 第二遍用于生成目录页码
```

Windows 下可直接双击 `build.bat`。

> 请在**纯英文（ASCII）路径**下编译。目录名含中文时 `latexmk` 会因 perl 组件报错（`Cannot write file 'report.aux'`），改用 `xelatex` 直接编译则正常。
