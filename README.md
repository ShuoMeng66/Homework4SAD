# 口腔诊所管理系统 —— 业务与需求分析报告

中南大学商学院《系统分析与设计》课程作业。

| 项目 | 内容 |
| --- | --- |
| 学校 | 中南大学 |
| 学院 | 商学院 |
| 课程 | 系统分析与设计 |
| 姓名 | 陈荣杰 |
| 学号 | 8305240320 |
| 班级 | 信管 T2401 |
| 报告题目 | 口腔诊所管理系统业务与需求分析报告 |

---

## 一、仓库内容

| 文件 / 目录 | 说明 |
| --- | --- |
| `陈荣杰_8305240320_系统分析与设计报告.pdf` | 最终报告，A4 共 15 页 |
| `report.tex` | LaTeX 源稿，含统一文档模板、全部正文与图 5 的 TikZ 绘图代码 |
| `figures/` | 报告引用的全部图片（PDF 矢量/位图源） |
| `build.bat` | Windows 一键编译脚本 |

## 二、编译方式

需要 TeX Live 2024 或兼容发行版，**必须用 XeLaTeX**（报告使用 `ctexart` + `fontset=windows` 中文字体）：

```bash
xelatex -interaction=nonstopmode report.tex
xelatex -interaction=nonstopmode report.tex   # 第二遍用于生成目录页码
```

Windows 下直接双击 `build.bat` 即可。

> **注意**：请在**纯英文（ASCII）路径**下编译。若目录名含中文，`latexmk` 会因 perl 组件报错
> （`Cannot write file 'report.aux'`），改用 `xelatex` 直接编译则正常。

## 三、报告结构

1. **项目愿景** —— 愿景定义与度量指标
2. **业务建模**
   - 2.1 业务用例
   - 2.2 现状业务序列
   - 2.3 改进后的业务序列
3. **系统需求建模**
   - 3.1 系统用例
   - 3.2 核心数据域
4. **用例规约** —— UC-01 登记患者并预约诊疗、UC-02 录入收费并处理欠款、UC-03 录入义齿订单并追踪交付、UC-04 查询统计与订单提醒
5. **质量需求、追踪与实施**

## 四、图表清单

| 编号 | 名称 | 来源文件 |
| --- | --- | --- |
| 图 1 | 口腔诊所业务用例图 | `figures/01_business_usecase.pdf` |
| 图 2 | 现状业务序列图 | `figures/02_current_sequence.pdf` |
| 图 3 | 改进后的业务序列图 | `figures/03_improved_sequence.pdf` |
| 图 4 | 口腔诊所管理系统用例图 | `figures/04_system_usecase.pdf` |
| 图 5 | 核心数据域关系图 | 由 `report.tex` 中的 TikZ 代码绘制 |
| 图 6 | 用例规约关系图 | `figures/06_usecase_spec.pdf` |
| 封面 | 封面配图 | `figures/cover.pdf` |

## 五、排版说明

全文使用**同一套文档模板**，不中途切换版式：

- 文档类：`ctexart`，A4，12pt，Windows 中文字体
- 版心：四周 2.35cm，所有页面（含插图页）一致
- 页眉页脚：`fancyhdr` 统一，左侧文档名、右侧页码
- 标题：`ctexset` 统一各级标题字号、字重与前后间距
- 图表标题：`captionsetup` 统一，图注在下、表注在上
- 插图：全文六张图共用同一个 `\docgraphic` 命令
  （`width=0.92\textwidth, height=0.86\textheight, keepaspectratio`），
  等比缩放、不裁剪、不拉伸，六张图版心宽度基本一致
