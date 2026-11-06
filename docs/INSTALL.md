# 本地安装与复现

基础三维工作台使用 Node.js 提供静态文件和本机 API，物理计算可在浏览器 CPU 上运行。Rapier 随 JavaScript 依赖安装。CAD 和 GPU 是两个独立的可选 Python 环境；不安装它们也可使用基础 CPU 路径。

所有命令均从仓库根目录运行。本文面向源码安装，不要求特定编辑器、AI 编程工具、个人目录或预先生成的运行产物。组件许可和发布前待定事项见 [THIRD_PARTY.md](THIRD_PARTY.md)。

## 环境与支持范围

| 功能 | 需要 | 当前边界 |
| --- | --- | --- |
| Web/CPU 工作台 | Node.js 22.10+（22.x）或 24、pnpm 10.19.0；支持 ES modules、WebAssembly、WebGL 2 的桌面浏览器 | `engines` 范围为 `>=22.10 <25`，复现时采用 22/24；已有 Node.js 24.22.1 的本机检查，其他环境以实际 CI/测试结果为准 |
| CAD 曲线、曲面、BRep、体网格 | 64 位 CPython 3.12；`cad/requirements.txt` | `usd-brep==1.0.1` 上游列出 Windows/Linux；没有列出 macOS wheel 支持 |
| 纯粒子 GPU、MPM/刚体 GPU 项目 | CPython 3.12；`gpu/requirements.txt`；兼容 CUDA 或 Vulkan 的设备/驱动 | 运行时禁止静默回落到 CPU；设备可用性和具体模型能力需实际检查 |
| 混合 FEM/MPM、四域 GPU 服务 | 同上，并需要 CUDA | 当前服务固定初始化 CUDA；不能通过传入 Vulkan 参数启用 |
| AI 建模助手 | 用户选择的兼容 Chat Completions API 或本机模型服务 | 可选；基础模拟不需要 API Key |

当前 Python 环境使用 CPython 3.12.10。NumPy 2.5.4 要求 Python ≥3.12，USD BRep 1.0.1 要求 Python ≥3.12 且 <3.13，因此本指南统一使用 3.12。Windows 的 CAD 内核还需要 [Microsoft Visual C++ Redistributable](https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist)。[USD BRep 1.0.1 平台说明](https://pypi.org/project/usd-brep/1.0.1/)

`.ps1` 启动器面向 Windows PowerShell。Node 服务与 CAD 路径有 POSIX 分支，但本文没有声明已完成 Linux/macOS 的全功能测试。GPU 上游可用后端也不代表本项目全部算例已在该后端通过。

## 1. 启动基础工作台

安装 Node.js 22 或 24 后，按仓库 `packageManager` 固定版本安装 pnpm。可使用 npm 的全局安装方式，已有正确版本时跳过此步：[pnpm 官方安装说明](https://pnpm.io/installation)。

```text
npm install --global pnpm@10.19.0
```

确认命令在终端 PATH 中可用，再按锁文件安装：

```text
node --version
pnpm --version
pnpm install --frozen-lockfile
pnpm start
```

浏览器打开：

- [三维空白项目](http://127.0.0.1:5173/3d.html?scene=empty&backend=cpu&study=project&mbd=empty#geometry)
- [二维粒子沙盒](http://127.0.0.1:5173/)

保留启动终端，按 `Ctrl+C` 停止服务。Windows 也可在依赖已安装后执行 `./Start-Summer.ps1`。推荐先用 `pnpm start`，便于直接查看启动错误。项目使用浏览器原生模块，不需要额外打包步骤；不要通过 `file://` 打开 HTML。

`pnpm-lock.yaml` 固定 Rapier 0.19.3 并记录包完整性。`npm install` 不读取该 pnpm 锁文件；需要对齐这份环境时应使用上述 pnpm 命令。

Web 服务默认仅监听 `127.0.0.1:5173`。可选 GPU 服务当前只接受这个 Web 端口对应的 `127.0.0.1`/`localhost` 来源；随意修改 Web 端口会导致 GPU 来源检查失败。本指南按本机使用配置，不覆盖公网部署。

## 2. 可选 CAD 环境

该环境从外部包源安装完整 USD BRep、MeshPy 与 NumPy；其中 MeshPy 的原生扩展同时含 TetGen 和 Triangle。项目自有代码的 MIT 不替代它们的条款。固定版本、许可副本与源码来源已完成本轮登记，见 [CAD 许可核查](CAD_LICENSE_REVIEW.md)；该核查不批准把完整环境制作成闭源商业安装包。

Windows PowerShell：

```powershell
py -3.12 -m venv .venv-cad
./.venv-cad/Scripts/python.exe -m pip install -r cad/requirements.txt
./.venv-cad/Scripts/python.exe -m pip check
./.venv-cad/Scripts/python.exe -c "import usd_brep, meshpy.tet, numpy; print('CAD imports OK')"
```

也可以运行 `./Install-CAD.ps1`，它创建同名虚拟环境并安装相同 requirements。Python 已存在时，该脚本不会自动更换解释器；旧环境版本不正确时，应另建干净的 Python 3.12 环境并重新安装。

Linux 的对应命令如下，仅作为源代码支持路径说明；需确认所选平台有对应 wheel：

```sh
python3.12 -m venv .venv-cad
.venv-cad/bin/python -m pip install -r cad/requirements.txt
.venv-cad/bin/python -m pip check
.venv-cad/bin/python -c "import usd_brep, meshpy.tet, numpy; print('CAD imports OK')"
```

CAD 由 Node 服务按请求启动 `cad/worker.py`，无需单独长期运行一个 CAD 服务。进入三维工作台的 CAD 建模功能，先创建简单盒体，核对几何预览，再生成网格。详细工作流见 [cad/README.md](../cad/README.md)。

USD BRep wheel 自带 OpenUSD 运行时；本项目不需要额外安装 `usd-core`。尤其不要把另一个 OpenUSD 25.11 构建加入同一环境，上游说明同版本符号冲突可导致崩溃。`usd-brep[validation]` 也不在本项目 requirements 中。[发行包说明](https://pypi.org/project/usd-brep/1.0.1/)

## 3. 可选 GPU 环境

先在独立环境安装固定的直接版本。Windows PowerShell：

```powershell
py -3.12 -m venv .venv-gpu
./.venv-gpu/Scripts/python.exe -m pip install -r gpu/requirements.txt
./.venv-gpu/Scripts/python.exe -m pip check
./.venv-gpu/Scripts/python.exe -c "import taichi, websockets, numpy; print('GPU imports OK')"
```

Linux 则使用 `python3.12 -m venv .venv-gpu`，后续解释器路径改为 `.venv-gpu/bin/python`。导入成功只验证 Python 包可加载，还没有验证 GPU 驱动、内核编译或模型结果。

保持 `pnpm start` 运行，在另一个终端按所需功能选择**一个** GPU 服务：

| 功能 | Windows PowerShell 命令 | 页面/模型端口 |
| --- | --- | --- |
| 纯粒子沙盒 | `./.venv-gpu/Scripts/python.exe gpu/server.py --arch cuda --port 8765` | 沙盒 GPU 端口设为 `8765` |
| MPM/刚体项目 | `./.venv-gpu/Scripts/python.exe gpu/project_server.py --arch cuda --port 8769` | 项目 GPU 端口设为 `8769` |
| FEM/MPM 混合模型 | `./.venv-gpu/Scripts/python.exe gpu/mixed_server.py --port 8795` | 混合 GPU 端口设为 `8795` |
| 四域统一 GPU 模型 | `./.venv-gpu/Scripts/python.exe gpu/mixed_server.py --port 8796` | 四域示例默认端口 `8796` |

前两类服务可将 `--arch cuda` 改为 `--arch vulkan`。后两类是同一个 CUDA 服务，按页面端口选择运行，无需为了四域模型另装一套 Python 包。Windows 另有 `start-gpu.ps1`、`start-project-gpu.ps1` 和 `start-mixed-gpu.ps1` 包装脚本；已有环境升级时请显式重跑 requirements 安装，不要把脚本的“可导入”检测当作版本对齐。

示例入口：

- [纯粒子 GPU](http://127.0.0.1:5173/3d.html?scene=empty&backend=gpu&gpuPort=8765)
- [GPU 项目工作台](http://127.0.0.1:5173/3d.html?scene=empty&backend=cpu&study=project&projectBackend=gpu&projectGpuPort=8769)
- [FEM/MPM GPU 示例](http://127.0.0.1:5173/3d.html?scene=empty&backend=cpu&study=project&mbd=mpm-fem-10k&mixedGpuPort=8795)
- [四域 GPU 示例](http://127.0.0.1:5173/3d.html?scene=empty&backend=cpu&study=project&mbd=unified-gpu&mixedGpuPort=8796)

首次初始化会编译 Taichi 内核，等待服务就绪提示及页面后端状态。项目 GPU 还会通过 PATH 中的 `node` 启动 Rapier 桥接，因此必须先完成 JavaScript 依赖安装。服务使用仓库内 `.taichi-cache` 存放编译缓存。当前运行时设置 2 GB 的 Taichi 设备内存参数，这不等于全部模型仅需 2 GB 显存，也不保证特定硬件性能。

选中 GPU 后若初始化失败，查看服务终端里的架构/驱动错误；程序不会把请求悄悄改成 CPU 计算。可返回基础 CPU 项目继续使用受支持的功能。不同 GPU 模式有不同几何、材料、耦合与输出限制，不能仅凭服务连通推断模型等价。

## 4. 可选 AI 助手

主 Web 服务已提供 `/api/ai/chat` 网关，无需为普通使用另启服务。在工作台助手中填写所选服务的 API 基础地址、模型和必要的密钥；本机兼容服务可使用回环 HTTP 地址。请求由本机 Node 网关转发到所选服务。需要使用该功能时才配置凭证，不要把凭证写入源码、示例项目或公开问题报告。

`pnpm start:ai` 是单独的兼容网关入口，默认使用 `5180`；基础安装通常不需要。API 服务、模型访问权和计费由所选服务提供方管理，不属于本仓库依赖安装。

## 5. 检查安装与复现结果

基础检查：

```text
pnpm test
pnpm run validate:vv
```

`pnpm test` 明确运行 core 套件并排除登记的原生 CAD 案例，不依据是否安装 Python 自动改变测试范围。`pnpm test:cad` 和 `pnpm test:all` 在运行前强制检查 `.venv-cad`，缺失即失败；选定案例出现 skip/TODO/取消/空运行也视为失败。`validate:vv` 运行有明确参考和边界的小型数值检查，结果解释见 [VV.md](VV.md)，不等于所有模型均适用于工程预测。GPU 的导入检查与 CPU 测试也不能替代设备上的 GPU 算例测试。运行 `pnpm check:repo` 检查当前发布候选，`pnpm check:release` 额外要求根项目许可证已确定。

复现报告至少记录：仓库提交/发布版本、Node/pnpm/Python 版本、所用 requirements 和锁文件、操作系统、浏览器、GPU/驱动/后端、项目 JSON、网格与粒子数量、时间步、求解终止条件，以及实际执行的测试命令和输出。分享日志前移除凭证和个人路径。

直接 Python 依赖已固定为：

```text
GPU: taichi==1.7.4, websockets==15.0.1, numpy==2.5.4
CAD: usd-brep==1.0.1, meshpy==2026.1.1, numpy==2.5.4
```

这些 pins 不覆盖全部间接依赖和 wheel 哈希。需要长期归档或离线复现时，应在目标平台记录完整解析环境、安装包哈希、驱动和许可证通知；不同设备、并行归约或编译器版本仍可能产生数值差异。本次文档核查使用现有环境与发行包元数据，没有执行全新机器安装或宣称跨平台复现已经通过。

## 常见安装问题

| 现象 | 检查方法 |
| --- | --- |
| 页面找不到 Rapier、WASM 或模块 | 在仓库根目录运行 `pnpm install --frozen-lockfile`，通过 HTTP 服务打开页面 |
| 三维视图提示缺少 WebGL 2 | 检查浏览器硬件加速和设备的 WebGL 2 支持；Python GPU 服务不能补充浏览器渲染能力 |
| CAD 提示未安装或 DLL 加载失败 | 核对 `.venv-cad`、64 位 Python 3.12、Windows VC++ 运行库及 CAD 导入检查 |
| pip 找不到匹配的 usd-brep wheel | 核对 Python 版本、系统和 CPU 架构；不要把包缺失误判为 CAD 模型错误 |
| GPU 连接失败 | 核对对应服务已启动、页面端口、默认 Web 端口及服务终端信息 |
| GPU 包可导入但初始化失败 | 核对所选 CUDA/Vulkan 架构和驱动；混合服务只支持 CUDA |
| 更新源码后仍使用旧 Python 依赖 | 用对应虚拟环境显式执行 `-m pip install -r .../requirements.txt` 和 `-m pip check` |
