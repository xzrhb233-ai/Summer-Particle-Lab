# CAD 第三方许可与源码来源核查

核查日期：**2026-11-05（America/Chicago）**。源码基线：`7401cd51eadc90b9a5cc0ca15afac10a512c9965`。范围：Summer 的 CAD 接口、示例及其三个固定依赖；当前安装环境为 Windows AMD64 / CPython 3.12。这份报告完成组件识别、许可原文核对及有证据支持的来源登记，不为未经检查的平台或完整商业安装包签发授权结论。

## 结论与发布范围

| 项目 | 结论 | 证据与边界 |
| --- | --- | --- |
| SMLib 的实际来源 | **已核实**：使用 NVIDIA `usd-brep==1.0.1` | 官方源码固定到提交；本地包与该版本 PyPI Windows wheel 逐文件一致 |
| CAD 依赖许可 | **已核实并归档** | 36 份原始许可/通知；不能把 NVIDIA 的 Apache-2.0 或 MeshPy 封装的 MIT 当作整个依赖栈的许可 |
| 项目 CAD 代码与示例来源 | **已登记并完成本轮核查** | 42 文件清单、实际 API 调用、示例重建、有限相似性筛查，以及维护者的明确来源声明；不等于独立证明全部作者权利 |
| 本轮拟分发内容 | **源码与许可文本** | 基线 486 个受跟踪文件未含原生 CAD 二进制、wheel 或第三方内核源码；本轮仅补充许可文本、证据和检查工具 |
| 完整 CAD 二进制/离线安装包 | **未放行** | TetGen/Triangle 及内嵌运行库仍须按实际发布物完成分发条件核对；当前未提供或验证其商业授权 |
| 整个平台公开发布 | **不由本报告决定** | CAD 之外的数值实现、界面素材和其他来源仍按 [R17–R20](OPEN_SOURCE_CHECKLIST.md) 单独审核；仓库可见性未改变 |

本轮范围不包含 wheel、原生库、容器、预装环境或闭源成品的再分发。`Install-CAD.ps1` 在使用者机器上安装外部依赖，CI 也独立下载依赖；这项分发事实本身**不是** AGPL 兼容性结论，也不是“分进程调用就豁免”。Summer 自有代码保持 MIT；安装和组合使用的第三方组件保留各自条款。

## 固定依赖、公开源码与发行包

| 包 | 官方源码版本 | 本项目使用 |
| --- | --- | --- |
| `usd-brep==1.0.1` | [`3fd5b9548d19aa8c12c29bc9637a96d42a06f8a5`](https://github.com/NVIDIA-Omniverse/usd-brep/tree/3fd5b9548d19aa8c12c29bc9637a96d42a06f8a5)，对应 `v1.0.1` | BRep 基元、布尔、拉伸/回转、曲线/曲面、表面网格及 USDA 输出 |
| `meshpy==2026.1.1` | [`8da82ffd160091dc8f0b5e07dfcccea6fd2bc66a`](https://github.com/inducer/meshpy/tree/8da82ffd160091dc8f0b5e07dfcccea6fd2bc66a)，对应 `v2026.1.1` | `meshpy.tet` 约束四面体网格 |
| `numpy==2.5.4` | [`a3d0ef1df045b858e68115001fdabc930bb3b68c`](https://github.com/numpy/numpy/tree/a3d0ef1df045b858e68115001fdabc930bb3b68c)，对应 `v2.5.4` | 数组、几何和网格数值处理 |

[cad-dependencies.lock.json](cad-dependencies.lock.json) 记录发行包名、下载 URL、SHA-256、源码提交、已安装文件比较及许可副本路径。它是**本次证据锁定文件**，不是跨平台的 `pip --require-hashes` 安装锁，也不是二进制可重现构建证明。

检查方法：从 PyPI 对应版本的 JSON 元数据取得 Windows wheel，下载后验证 SHA-256；比较 wheel 与本地安装文件，另行校验本地 `RECORD`。排除安装器会重建的 `RECORD` 后，USD BRep **205**、MeshPy **17**、NumPy **944** 个发行文件分别相同，无缺失或不同项。本地 `RECORD` 校验也未发现异常。公开源码包可取得，不代表已独立从源码重建了这些二进制。

### USD BRep / SMLib

NVIDIA 编写部分为 Apache-2.0，完整 wheel 声明：

```text
Apache-2.0 AND LicenseRef-TOST-1.0 AND BSD-2-Clause AND BSD-3-Clause AND MIT AND BSL-1.0
```

OpenUSD 使用 TOST-1.0，其他包具有各自通知。保留了 wheel 的 `LICENSE`、`THIRD_PARTY_NOTICES.md` 和全部 15 个 `PACKAGE-LICENSES` 文件，共 **17 份**。固定源码提交中的前两份文件与 Windows wheel 仅有 LF/CRLF 差异，规范化行尾后完全相同。副本保留 wheel 原始字节，不修改版权和许可文本。

上游 notices 还讨论部分工具/提案使用的组件；不能仅因它们在源码 notices 中出现，就声称 Summer 安装或分发了这些可选工具。具体运行包仍须以其实际文件为准。[固定版本 notices](https://github.com/NVIDIA-Omniverse/usd-brep/blob/3fd5b9548d19aa8c12c29bc9637a96d42a06f8a5/THIRD_PARTY_NOTICES.md)

### MeshPy / TetGen / Triangle

MeshPy Python/C++ 封装为 MIT。其[固定版本 LICENSE](https://github.com/inducer/meshpy/blob/8da82ffd160091dc8f0b5e07dfcccea6fd2bc66a/LICENSE) 同时列出 TetGen 的 **AGPL-3.0-or-later / 商业授权路径**和 Triangle 的自定义条款。当前体网格调用 `meshpy.tet`，没有 `meshpy.triangle` 调用；但[构建文件](https://github.com/inducer/meshpy/blob/8da82ffd160091dc8f0b5e07dfcccea6fd2bc66a/meson.build) 把两者编译进同一个 `_internals` 原生扩展，不能据调用路径断言发行包不含 Triangle。

- TetGen：wheel 的 LICENSE 是概述；完整 AGPL 从对应 MeshPy sdist 的 `src/cpp/tetgen-LICENSE` 原样补入。采用 AGPL 路径时，需要按实际组合和分发/服务方式核对适用义务，不能只附一份许可证就当作全部满足。[固定版本完整条款](https://github.com/inducer/meshpy/blob/8da82ffd160091dc8f0b5e07dfcccea6fd2bc66a/src/cpp/tetgen-LICENSE)
- 商业授权：内嵌 `tetgen.h` 标为 **1.6.1**；核查时 [WIAS 许可 FAQ](https://www.wias-berlin.de/software/tetgen/FAQ-license.jsp?lang=0) 明确列出商业授权到 1.6.0。没有取得针对这个内嵌版本和使用方式的授权文件，不能声称已可按商业授权分发。
- Triangle：包含商业系统再分发须与作者直接安排的条件。其“不直接提供代码、只告知免费获取方式”的说明不应被扩大为对整个组合程序的统一法律结论。[作者说明](https://www.cs.cmu.edu/~quake/triangle.html)
- Windows wheel 还包含 GCC、libstdc++、winpthread DLL，随包仅有上述概述文件；这些运行库的完整再分发证据尚未补齐。因此本报告不放行该 wheel 的重新打包。

### NumPy

NumPy 主体为 BSD-3-Clause；归档了该 wheel 声明的全部 **17 份**许可文件。顶层通知还包含 OpenBLAS、LAPACK、GCC 运行库及 GCC Runtime Library Exception 等信息，不能只抄包元数据的许可表达式。[Windows wheel 原始通知副本](../third_party/cad/numpy-2.5.4/LICENSE.txt)

该 Windows wheel 另含 `msvcp140` 运行库；本轮没有独立确认其完整二进制来源与再分发权利。归档全部“随包许可文件”不等于证明发行包的所有法律材料均齐备。Linux/macOS wheel 内含库没有按这个 Windows 清单推定通过。

## 项目 CAD 源码与示例

维护者在 **2026-11-05** 明确确认：除安装的 usd-brep、MeshPy 和 NumPy 外，没有额外复制或导入其他软件的 CAD 代码、模型或素材；CAD 代码与示例均在本项目开发过程中生成。本报告把这项内容记为**维护者声明**，与下列可重做的技术证据分别保留。

| 本地范围 | 观察到的来源/作用 | 核对结果 |
| --- | --- | --- |
| `Install-CAD.ps1`、`cad/requirements.txt` | 固定第三方包的安装入口 | 下载依赖到忽略的环境；未把它们的内核源码放进 Git |
| `cad-server.mjs`、`cad/worker.py` | 受限 JSON 网关、固定 Python worker、原生 BRep API 调用 | 项目适配层；内核来自外部包 |
| `cad/curves.py`、`surfaces.py`、`profiles.py` | 曲线/曲面/闭合轮廓校验与原生构造 | 调用公开接口；没有发现上游 C/C++ 内核实现导入 |
| `cad/meshing.py` | 表面清理、孔腔处理、TetGen 调用、输出检查 | 实际使用 `meshpy.tet.MeshInfo/Options/build` |
| `src/three/cad-*`、`src/simulation/cad-*` | 浏览器校验、模板、编辑、预览和应用 | 本项目工作流和有界协议；未识别出直接复制的官方示例实现 |
| `cad/examples/perforated-block.json` | 穿孔块配方及生成的几何 | 用当前内核重建后，全部 10 个 `geometry.cad` 字段相同：72 顶点、432 索引、体积 `0.20465708470119137` |
| CAD 相关测试 | 解析几何、回读、原生操作和边界校验 | 清单记录测试文件；测试通过不能替代来源授权 |

[cad-source-evidence.json](cad-source-evidence.json) 保存这 **42 个文件在基线提交中的 Git blob 与 SHA-256**，并记录示例重建结果和维护者声明。哈希基于提交内容，而非可能转换行尾的工作区；后续文件修改不应重写这次历史证据。

有限相似性筛查比较了本地 5 个 CAD Python 文件与固定版本 USD BRep 的 81、MeshPy 的 31、NumPy 的 1070 个 Python 源文件：排除注释/import 后，连续 5 个规范化非空行且总长度至少 120 字符的匹配数为 **0**。它能说明这个范围内未检出相同代码块，不能排除改写、更短片段、其他语言或未搜索来源。既有开发备份与 CAD 版本记录也已核对；不会以更名或删除关键词代替来源证据。

Git 从整体导入 `cf0f848` 开始，缺少更早的提交链；因此来源结论依赖技术检查与维护者声明的组合，不声称完成全世界源码比对或独立作者权利鉴定。CAD 外的数值模型、旧参考资料、favicon/图标和界面风格不在本轮结项范围。

## 后续分发规则与复核

1. **当前源码范围**：保留自有代码 MIT、这份报告、证据清单和第三方原始通知；不把整个安装栈宣传成“全部 MIT”或“可无条件闭源再分发”。本次没有修改 CAD 算法或移除体网格功能。
2. **拟制作完整运行包时**：对确切版本选择并满足 TetGen 的适用许可路径，核对 Triangle 商业分发条件，补齐原生运行库的来源和通知，再审核组合程序与对应源码义务。若目标是完整闭源商业包且无法取得所需权利，再评估替换网格后端；本轮未替换。
3. **升级依赖时**：重新获取版本、wheel/sdist、固定源码提交，核对实际许可和本地调用后更新清单及副本；禁止只更新版本字符串或复制新版 `main` 文档。
4. **自动门槛**：`pnpm check:release` 检查必需来源文档、CAD pins 与证据一致性、许可副本 SHA-256，以及混入原生包/二进制的候选；它不决定作者权利、许可证兼容性或 GitHub 可见性。

36 份归档文本的来源索引见 [third_party/cad/README.md](../third_party/cad/README.md)。全项目其余事项仍见 [THIRD_PARTY.md](THIRD_PARTY.md)、[PROVENANCE.md](PROVENANCE.md) 和 [OPEN_SOURCE_CHECKLIST.md](OPEN_SOURCE_CHECKLIST.md)。
