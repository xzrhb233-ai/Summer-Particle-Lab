# 第三方依赖与参考来源

本文记录发布前可核验的依赖、许可和出处，范围为当前源码、安装清单、锁文件及已安装发行包的元数据。维护者已为项目自身拥有权利的代码选择 [MIT 许可证](../LICENSE)，署名为 `xzrhb233-ai and contributors`。这不证明整个依赖栈采用统一许可，也不替代尚未完成的来源权利核查；第三方依赖的条款继续独立适用。

## 直接运行时依赖

| 组件 | 固定版本与用途 | 许可证据 | 本项目入口 |
| --- | --- | --- | --- |
| `@dimforge/rapier3d-compat` | `0.19.3`；刚体/多体动力学，内联 WASM 的 JS 包 | 安装包 `package.json` 为 `Apache-2.0`；[官方 JS 仓库 LICENSE](https://github.com/dimforge/rapier.js/blob/master/LICENSE) | `package.json`、`pnpm-lock.yaml`、`src/multibody/engine.js`、`src/mixed/rigid-geometry.js` |
| `taichi` | `1.7.4`；可选本机 GPU 求解器 | 安装包元数据及 [v1.7.4 LICENSE](https://github.com/taichi-dev/taichi/blob/v1.7.4/LICENSE)：Apache-2.0 | `gpu/requirements.txt`、`gpu/runtime.py` |
| `websockets` | `15.0.1`；GPU 服务与浏览器的本机 WebSocket 通信 | 安装包元数据及 [15.0.1 LICENSE](https://github.com/python-websockets/websockets/blob/15.0.1/LICENSE)：BSD-3-Clause | `gpu/requirements.txt`、`gpu/server.py`、`gpu/project_server.py`、`gpu/mixed_server.py` |
| `numpy` | `2.5.4`；GPU/CAD 数组运算 | NumPy 主体为 BSD-3-Clause；已安装 wheel 的 `METADATA` 还列出 `0BSD AND MIT AND Zlib AND CC0-1.0`，二进制包含其他组件，须保留其完整 notices；[官方发行页](https://pypi.org/project/numpy/2.5.4/) | `gpu/requirements.txt`、`cad/requirements.txt` |
| `usd-brep` | `1.0.1`；可选 BRep CAD 内核，界面称为 SMLib | NVIDIA 编写部分 Apache-2.0；wheel 同时含 OpenUSD 等第三方组件，详见下文及[官方第三方清单](https://github.com/NVIDIA-Omniverse/usd-brep/blob/main/THIRD_PARTY_NOTICES.md) | `cad/requirements.txt`、`cad/worker.py`、`cad/curves.py`、`cad/surfaces.py` |
| `meshpy` | `2026.1.1`；CAD 的四面体体网格生成 | 封装为 MIT；包中 TetGen、Triangle 各有独立条款；[官方 LICENSE](https://github.com/inducer/meshpy/blob/main/LICENSE) | `cad/requirements.txt`、`cad/meshing.py` 的 `meshpy.tet` 导入 |

版本来自仓库固定依赖和安装包元数据，不把上游 `main` 分支当作固定版本的完整证据。具体发布物仍应以对应版本的 wheel/npm tarball 内许可文件为准。

## CAD：USD BRep、OpenUSD 与网格生成器

**2026-11-05 CAD 专项核查已完成组件、许可原文及源码来源登记**，详见 [CAD_LICENSE_REVIEW.md](CAD_LICENSE_REVIEW.md)。三个安装包与对应 PyPI Windows wheel 逐文件一致；源码提交、包哈希及 36 份原文副本见 [证据清单](cad-dependencies.lock.json) 和 [通知索引](../third_party/cad/README.md)。维护者已确认 CAD 代码与示例在本项目中生成，技术检查与声明分别记录。本轮限定为源码发布准备，未放行完整二进制/闭源商业 CAD 包，也不替代全项目来源审查。

本项目通过 Python 包 `usd-brep==1.0.1` 调用内核；不是把上游 C++ 源码复制进本仓库。该发行包要求 64 位 CPython 3.12，并捆绑 OpenUSD 25.11。安装与平台条件见[该版本发行说明](https://pypi.org/project/usd-brep/1.0.1/)。

该 wheel 的 `License-Expression` 为：

```text
Apache-2.0 AND LicenseRef-TOST-1.0 AND BSD-2-Clause AND BSD-3-Clause AND MIT AND BSL-1.0
```

因此，“SMLib/USD BRep 是 Apache-2.0”只能概括 NVIDIA 编写部分，不能替代整个 wheel 的第三方条款。OpenUSD 的 TOST-1.0 包含不同于 Apache-2.0 的商标条款；其他组件包括 oneTBB、hwloc、MaterialX、OpenSubdiv、pybind11 等。应以 wheel 的 `THIRD_PARTY_NOTICES.md` 与 `PACKAGE-LICENSES/` 为准，不把这份简表当成完整再分发通知。[上游说明](https://github.com/NVIDIA-Omniverse/usd-brep/blob/main/THIRD_PARTY_NOTICES.md)

`cad/meshing.py` 使用 `meshpy.tet`。MeshPy 的发行包明确区分：

- Python/C++ 封装：MIT。
- TetGen：AGPL-3.0-or-later，另有商业许可路径。
- Triangle：自定义许可，包含关于商业系统分发的限制。本项目当前体网格路径未调用 `meshpy.triangle`，但完整 MeshPy 发行包仍携带 Triangle 组件和通知。

固定版本的 [MeshPy 构建文件](https://github.com/inducer/meshpy/blob/8da82ffd160091dc8f0b5e07dfcccea6fd2bc66a/meson.build) 把 TetGen 与 Triangle 编译到同一个扩展，不能因未调用 Triangle 就把它从发行包清单中删除。内嵌 TetGen 标为 1.6.1；本次没有取得针对该版本的商业授权。完整 AGPL 已从对应源码包补充归档，wheel 内其他 GCC/libstdc++/winpthread 运行库的完整再分发证据尚未补齐。

**当前拟发布物为源码及许可文本，不含 CAD 原生包；完整运行包或服务分发前仍须核对 TetGen 的适用许可路径。** 应按实际源码、二进制、部署方式及所持授权核对义务；此处不是“整个项目必须采用某许可证”或“隔离进程即可豁免”的法律结论。只保留 MeshPy 的 MIT 封装声明会遗漏关键条款。[固定版本 LICENSE](https://github.com/inducer/meshpy/blob/8da82ffd160091dc8f0b5e07dfcccea6fd2bc66a/LICENSE)

## Python 间接依赖与二进制 notices

Taichi 的直接依赖元数据还声明 `colorama`、`dill`、`rich`；Rich 带来 Markdown 解析和语法高亮依赖。审计环境中的解析结果如下，用于识别分发范围，不是跨平台锁文件：

| 已安装组件 | 版本 | 安装包声明 |
| --- | --- | --- |
| colorama | 0.4.6 | BSD-3-Clause，已核对包内完整 LICENSE |
| dill | 0.4.1 | BSD-3-Clause |
| rich | 15.0.0 | MIT |
| markdown-it-py | 4.2.0 | MIT classifier |
| mdurl | 0.1.2 | MIT classifier |
| Pygments | 2.21.0 | BSD-2-Clause |

两个 Python requirements 文件固定直接依赖，尚未固定全部间接依赖、各平台 wheel 哈希及其内嵌库。Taichi 的编译运行时、NumPy 的 BLAS/编译器运行时、USD BRep 的 OpenUSD 组件不能仅凭 Python 包名推导完整许可清单。如果提供离线安装包、容器或预装环境，需要针对实际发布物重新导出组件清单并保留随包许可文件。

可以在安装后查看以下相对位置；POSIX 环境的 `site-packages` 位于对应 Python 版本的 `lib/` 下：

```text
node_modules/@dimforge/rapier3d-compat/package.json
.venv-gpu/Lib/site-packages/taichi-1.7.4.dist-info/LICENSE
.venv-gpu/Lib/site-packages/websockets-15.0.1.dist-info/LICENSE
.venv-gpu/Lib/site-packages/numpy-2.5.4.dist-info/licenses/
.venv-cad/Lib/site-packages/usd_brep-1.0.1.dist-info/licenses/LICENSE
.venv-cad/Lib/site-packages/usd_brep-1.0.1.dist-info/licenses/THIRD_PARTY_NOTICES.md
.venv-cad/Lib/site-packages/usd_brep-1.0.1.dist-info/licenses/PACKAGE-LICENSES/
.venv-cad/Lib/site-packages/meshpy-2026.1.1.dist-info/licenses/LICENSE
```

当前检查的 Rapier npm 安装目录含 `package.json` 中的 Apache-2.0 声明，但没有单独的 `LICENSE` 文件。若重新打包 Rapier/WASM，应从相应上游版本补齐所需许可文本和通知，并核对发布物；本清单中的链接不是随包许可文本的替代品。

## 设计与概念参考

界面设计和数值文献参考见 [PROVENANCE.md](PROVENANCE.md)。该记录不是完整的来源清单；产品名称和界面中的宣传链接调整不改变相关义务。它不是逐行来源鉴定，也不能证明全部历史代码均为原创。

RhineLabUI 上游 [LICENSE](https://github.com/LBEILC/RhineLabUI/blob/main/LICENSE) 为 MIT，署名 LBEILC。当前界面使用原生 DOM/CSS；本次入口检查未发现该项目运行时或 3D 资产导入。若实际复制了源码或资产，需要核实并保留相应通知，不能用“风格参考”替代这一检查。

### Three.js 与 CDN

`src/three/` 是本项目的三维模块目录名。`src/three/renderer.js` 直接使用 `canvas.getContext('webgl2')`，当前 `package.json`、锁文件、HTML 和运行时 JS 中未发现 Three.js npm 依赖、CDN 脚本或 Three.js vendor 导入。RhineLabUI 上游使用 Three.js，不会因此自动成为本项目的运行时依赖。

当前 Rapier 从本地 `node_modules` 导入。检索到的外部 URL 包括来源署名、文档链接及用户选择的 AI API 地址；它们与 CDN 运行时依赖不同。此结论限于本次检查的入口和源码，不覆盖用户后来导入的文件、模型服务或浏览器扩展。

## 发布前尚待确定

1. 根项目已选择 MIT 并添加 LICENSE；仍需完成代码与贡献的权利核查。该许可不重新授权第三方组件，第三方清单也不构成来源授权证明。
2. CAD 的本轮分发范围已确定为源码及许可文本，依赖身份、许可原文和 CAD 来源核查见专项报告。若制作完整运行包或商业部署，另行完成 TetGen/Triangle 的适用授权及原生运行库再分发证据，不能沿用“源码审查通过”作为二进制放行结论。
3. 是否提供二进制/离线包。若提供，需补齐实际包的组件与许可文本，尤其是 Rapier、USD BRep、NumPy 和 Taichi 内嵌库。
4. CAD 已记录维护者来源确认、42 文件证据和有限上游比较；其余源码与素材仍需核对，包括 [PROVENANCE.md](PROVENANCE.md) 中的算法和 UI 参考，以及本地保存、不随源码发布的其他参考资料记录。产品已更名 Summer；旧名称的移除不完成权利核实，也不构成权利转让。
5. Python 间接依赖和跨平台 wheel 哈希锁定。目前可以复现直接版本约束，不能承诺字节一致或跨硬件数值一致的环境。

安装步骤见 [INSTALL.md](INSTALL.md)，数值证据的适用范围见 [VV.md](VV.md)。
