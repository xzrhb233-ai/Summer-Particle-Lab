# 第三方依赖与参考来源

本文记录当前源码、安装清单、锁文件和已核对发行包的依赖、许可与出处。截至 **2026-11-05**，本次源码分发范围的 CAD 与非 CAD 来源登记及识别出的通知缺口已完成处理，见 [源码来源核查报告](SOURCE_RELEASE_REVIEW.md)、[源码证据清单](source-release-evidence.json) 与 [运行依赖证据](runtime-license-evidence.json)。完整二进制、离线包、容器及服务的分发条件另行核对。

维护者为项目自身拥有权利的代码选择了 [MIT 许可证](../LICENSE)，署名为 `xzrhb233-ai and contributors`。第三方条款继续独立适用；本轮结论不证明全部代码原创、整个依赖栈采用统一许可或已获完整法律批准，也不表示仓库已经公开。

## 直接运行时依赖

| 组件 | 固定版本与用途 | 许可证据 | 本项目入口 |
| --- | --- | --- | --- |
| `@dimforge/rapier3d-compat` | `0.19.3`；刚体/多体动力学，内联 WASM 的 JS 包 | 包元数据为 Apache-2.0；已从与 npm `gitHead`/版本 tag 一致的固定源码补入 [完整 LICENSE](../third_party/runtime/rapier3d-compat-0.19.3/LICENSE) | `package.json`、`pnpm-lock.yaml`、`src/multibody/engine.js`、`src/mixed/rigid-geometry.js` |
| `taichi` | `1.7.4`；可选本机 GPU 求解器 | Apache-2.0；固定源码与安装包许可在换行归一后相同，已保存 [完整 LICENSE](../third_party/runtime/taichi-1.7.4/LICENSE) | `gpu/requirements.txt`、`gpu/runtime.py` |
| `websockets` | `15.0.1`；GPU 服务与浏览器的本机 WebSocket 通信 | BSD-3-Clause；固定源码与安装包许可在换行归一后相同，已保存 [完整 LICENSE](../third_party/runtime/websockets-15.0.1/LICENSE) | `gpu/requirements.txt`、`gpu/server.py`、`gpu/project_server.py`、`gpu/mixed_server.py` |
| `numpy` | `2.5.4`；GPU/CAD 数组运算 | NumPy 主体为 BSD-3-Clause；已安装 wheel 的 `METADATA` 还列出 `0BSD AND MIT AND Zlib AND CC0-1.0`，二进制包含其他组件，须保留其完整 notices；[官方发行页](https://pypi.org/project/numpy/2.5.4/) | `gpu/requirements.txt`、`cad/requirements.txt` |
| `usd-brep` | `1.0.1`；可选 BRep CAD 内核，界面称为 SMLib | NVIDIA 编写部分 Apache-2.0；wheel 同时含 OpenUSD 等第三方组件，详见下文及[官方第三方清单](https://github.com/NVIDIA-Omniverse/usd-brep/blob/main/THIRD_PARTY_NOTICES.md) | `cad/requirements.txt`、`cad/worker.py`、`cad/curves.py`、`cad/surfaces.py` |
| `meshpy` | `2026.1.1`；CAD 的四面体体网格生成 | 封装为 MIT；包中 TetGen、Triangle 各有独立条款；[官方 LICENSE](https://github.com/inducer/meshpy/blob/main/LICENSE) | `cad/requirements.txt`、`cad/meshing.py` 的 `meshpy.tet` 导入 |

版本来自仓库固定依赖和安装包元数据，不把上游 `main` 分支当作固定版本的完整证据。Rapier、Taichi 与 websockets 的源码提交、原文地址、哈希及核对结果见 [运行依赖通知索引](../third_party/runtime/README.md) 和 [runtime-license-evidence.json](runtime-license-evidence.json)。具体发布物仍需核对对应版本的 wheel/npm tarball 及其内含组件。

## CAD：USD BRep、OpenUSD 与网格生成器

**2026-11-05 CAD 专项核查已完成组件、许可原文及源码来源登记**，详见 [CAD_LICENSE_REVIEW.md](CAD_LICENSE_REVIEW.md)。三个安装包与对应 PyPI Windows wheel 逐文件一致；源码提交、包哈希及 36 份原文副本见 [证据清单](cad-dependencies.lock.json) 和 [通知索引](../third_party/cad/README.md)。维护者已确认 CAD 代码与示例在本项目中生成，技术检查与声明分别记录。CAD 之外的来源与通知已由 [源码来源核查](SOURCE_RELEASE_REVIEW.md) 补充处理；两者均未放行完整二进制/闭源商业 CAD 包。

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

Rapier npm 安装目录原先没有单独的 `LICENSE` 文件；本轮已从精确匹配的源码提交 `0fd32c1cbbc7018af36f09b190c16ce72fbb9301` 补入 [Apache-2.0 原文](../third_party/runtime/rapier3d-compat-0.19.3/LICENSE)。官方 npm tarball 的完整性与全部 50 个安装文件已核对一致。源码仓库保存通知文本，不包含 npm 包；安装后由本机服务向浏览器提供 Rapier JS/内联 WASM 是另一个运行路径。再分发该运行内容时仍应随包保留所需通知，并核对实际发布物；三份直接运行依赖许可证不是完整原生/传递依赖清单。

## 设计与概念参考

界面设计、数值文献及实现谱系见 [PROVENANCE.md](PROVENANCE.md)。本轮已补齐下列已记录实现参考的许可文本，并在 [源码证据清单](source-release-evidence.json) 保存本地映射和哈希；产品更名不改变这些参考事实。

- [数值实现通知](../third_party/numerics/README.md)：Taichi MPM Authors 与 Taichi Elements Developers 的独立 MIT 通知。MLS-MPM/APIC、雪与砂的已知实现参考/适配继续保留，不能被 Taichi 运行时的 Apache-2.0 替代。
- [UI/着色器通知](../third_party/ui/README.md)：固定 RhineLabUI 的设计/交互比较快照并保存 LBEILC MIT 原文；为优化高斯滤波的公开实现参考保存 Jam3 MIT 原文。通用 CSS 或标准滤波系数的相同不独立证明复制链。
- 三角形最近点例程已登记 Ericson 的 Voronoi 区域算法谱系；有限相似性不足以认定实际复制了 Three.js 或 Bullet，未虚构这些依赖或许可关系。

维护者确认非 CAD 代码、图标及示例在本项目中生成，没有登记依赖之外的额外复制/导入；参考商业软件是允许其研究/开发用途的正式授权版本。以上作为维护者声明保存，不是独立权利证明，也不覆盖商业手册、截图、源码或素材的再分发权。已知公开实现参考/适配与必要署名照常保留，本地参考资料和授权文件不进入源码候选。内联 favicon、logo、20 个 SVG 图标、纹理和字体入口已检查；简单线段相同未被当作 Lucide/Feather 复制或运行依赖的证据。

### Three.js 与 CDN

`src/three/` 是本项目的三维模块目录名。`src/three/renderer.js` 直接使用 `canvas.getContext('webgl2')`，当前 `package.json`、锁文件、HTML 和运行时 JS 中未发现 Three.js npm 依赖、CDN 脚本或 Three.js vendor 导入。RhineLabUI 上游使用 Three.js，不会因此自动成为本项目的运行时依赖。

当前 Rapier 从本地 `node_modules` 导入。检索到的外部 URL 包括来源署名、文档链接及用户选择的 AI API 地址；它们与 CDN 运行时依赖不同。此结论限于本次检查的入口和源码，不覆盖用户后来导入的文件、模型服务或浏览器扩展。

## 本轮完成范围与后续分发条件

1. 当前源码、项目示例、文档与通知文本的来源登记及本轮识别通知缺口已完成处理；新增贡献、素材或依赖时继续更新证据。根 MIT 不重新授权第三方组件，源码核查不等于全部代码原创或完整法律批准。
2. 完整运行包、离线安装包、容器或服务另按实际内容审查：核对 TetGen/Triangle 的适用许可路径、原生运行库及传递依赖条件。不能沿用源码范围的完成结论作为二进制/闭源商业包放行结论，也不把未制作发布物的条件一概视作当前源码核查未完成。
3. 三份运行依赖原文和 CAD 通知已保存；再分发 Rapier/WASM、USD BRep、NumPy、Taichi 及其内嵌库时，继续核对确切版本、平台和完整组件/通知清单。
4. Python 全量间接依赖、跨平台 wheel 哈希和内嵌运行库的锁定仍未完成。目前固定直接版本，不承诺字节一致或跨硬件数值一致的环境。
5. 仓库可见性、最终提交 CI、私密漏洞报告渠道和正式 release 是独立的发布操作，执行状态见 [发布检查表](OPEN_SOURCE_CHECKLIST.md)；本文件不宣称仓库已经公开或软件包已经发布。

安装步骤见 [INSTALL.md](INSTALL.md)，数值证据的适用范围见 [VV.md](VV.md)。
