# 来源与权利核查记录

截至 **2026-11-05（America/Chicago）**，本次源码分发范围内的 CAD 与非 CAD 来源登记、有限上游比较及识别出的通知缺口已完成处理。结论、维护者声明和未检查范围见 [源码来源核查报告](SOURCE_RELEASE_REVIEW.md)，文件哈希、参考映射及通知副本见 [源码证据清单](source-release-evidence.json)。

本文件保留已知设计参考、算法谱系和实现参考/适配记录；它不是逐行作者鉴定，不证明全部代码原创、获得完整法律批准或与参考软件等价。依赖版本及许可证据见 [THIRD_PARTY.md](THIRD_PARTY.md) 和 [运行依赖证据](runtime-license-evidence.json)。本次结论适用于源码、项目示例、文档与许可文本；完整二进制、离线包、容器及服务分发条件另行核对。本文件不表示仓库已经公开。

## 设计参考

| 来源 | 已记录的参考范围 | 本轮处理与边界 |
| --- | --- | --- |
| [Grant Kot 的 Tutti Space Program](https://tsp.grantkot.com/) | 初始粒子沙盒的视觉与交互探索 | 已核对本地入口、早期备份及当前上游页面/资源快照；检查范围内未识别出其源码或品牌资产被直接纳入。灵感署名不构成原作复制许可或对方背书。 |
| [LBEILC/RhineLabUI](https://github.com/LBEILC/RhineLabUI/tree/12cc5e4013acb9408f753ff71de6b8492299b7c8) 及其 [DESIGN.md](https://github.com/LBEILC/RhineLabUI/blob/12cc5e4013acb9408f753ff71de6b8492299b7c8/DESIGN.md) | `src/three/workbench.js`、`workbench.css`、`index-wave.js` 的档案索引、细线排版、配色和目录动效参考；当前实现为原生 DOM/CSS | 固定比较快照，保留 LBEILC 的完整 MIT 通知；有限比较识别到通用 CSS 声明重合，未建立实质源码复制链。未引入其字体、音频、三维模型或品牌素材，见 [UI 通知与映射](../third_party/ui/README.md)。 |
| [Jam3/glsl-fast-gaussian-blur](https://github.com/Jam3/glsl-fast-gaussian-blur/tree/5dbb6e97aa43d4be9369bdd88e835f47023c5e2a) | `src/renderer.js` 的 `blurFragment` 使用优化九抽头高斯滤波的五次采样、对应偏移与权重 | 按已知公开实现参考保留 Jam3 的完整 MIT 通知；相同数学系数不能单独证明复制，本地 GLSL 的类型、命名与表达式不同。见 [UI/着色器通知](../third_party/ui/README.md)。 |

Summer 是独立项目，不是上述项目的官方版本。

内联素材已纳入本轮核查：`index.html` 的 favicon、轨道 logo 和 20 个 SVG 图标，`style.css` 的 SVG 噪声纹理，以及 `3d.html` 的图表绘制。图标与本地更名前备份一致；简单加减号和交叉线与公共图标库存在相同笔画，不能据此识别实际复制来源，未登记为 Lucide/Feather 依赖。所查 CSS 使用字体族名称与系统后备字体，未发现随源码分发的字体文件或字体下载声明。维护者对这些素材的来源确认另列如下，不以有限比较替代作者证明。

## 数值方法和公开技术资料

以下链接从历史开发记录和本轮实现比较归集，不表明本项目完整复现了任何论文或软件。Taichi MPM 与 Taichi Elements 的实现参考/适配已保留各自的 [MIT 通知及本地文件映射](../third_party/numerics/README.md)，不能用 Taichi 运行时的 Apache-2.0 代替。固定提交是本轮可复核的比较快照，不是对开发初期实际阅读版本的追认。当前算法、单位、支持范围和验证状态以源码及 [VV.md](VV.md) 为准。

| 范围 | 参考资料 | 记录中的使用边界 |
| --- | --- | --- |
| MLS-MPM / APIC | [Hu 等 MLS-MPM 论文与作者实现](https://yuanming.taichi.graphics/publication/2018-mlsmpm/)、[固定 Taichi MPM 实现](https://github.com/yuanming-hu/taichi_mpm/tree/3a680ab0fdc6e95077f08a91bc9079e1ef41478e)、[APIC 论文](https://www.math.ucla.edu/~cffjiang/research/apic/paper.pdf)、[APIC 技术报告](https://www.math.ucla.edu/~cffjiang/research/apic/tech-doc.pdf) | 固体网格传递、二次权重、仿射速度与共旋转应力；按实现参考/适配保留 Taichi MPM Authors 的 MIT 通知，本地材料、约束与耦合另有扩展。实际参数和稳定性须独立核对。 |
| 雪与砂 | [Stomakhin 等雪 MPM](https://www.disneyanimation.com/publications/a-material-point-method-for-snow-simulation/)、[固定 Taichi Elements 砂返回映射](https://github.com/taichi-dev/taichi_elements/blob/d19678869a28b09a32ef415b162e35dc929b792d/engine/mpm_solver.py) | 雪塑性投影与 Taichi MPM 作者示例对应；砂的对数主应变、膨胀历史、无抗拉分支及 Drucker–Prager 投影与 Taichi Elements 对应。两份独立 MIT 通知已补齐，保留实现参考/适配记录。 |
| PBF 与统一粒子方法 | [Macklin–Müller PBF](https://matthias-research.github.io/pages/publications/pbf_sig_preprint.pdf)、[PBF 人工压力说明](https://blog.mmacklin.com/project/pbf/)、[Unified Particle Physics (2014)](https://matthias-research.github.io/pages/publications/flex.pdf) | 本项目保留各求解算法的混合耦合，不声称等同于论文统一材料表示；人工压力属于数值修正。 |
| MPM 接触 | [Bardenhagen 等接触研究](https://www.sci.utah.edu/~guilkey/MPMPubs/Bardenhagen-ImprovedContact-01.pdf)、[接触法向与间隙研究](https://www.sciencedirect.com/science/article/pii/S0045782520300402)、[刚体–MPM 耦合研究](https://www.cs.ucr.edu/~craigs/papers/2017-rigid-mpm/paper.pdf) | 局部接触近似和问题划分参考，非这些论文的完整实现。 |
| 粒子采样整理 | [MPM 粒子移位与积分误差研究](https://onlinelibrary.wiley.com/doi/full/10.1002/nme.7217) | 成对距离修正并非完整守恒重映射，也不是断裂模型。 |
| 温度塑性与蠕变 | [MOOSE 温度相关屈服](https://mooseframework.inl.gov/releases/moose/v1.0.0/source/materials/ADIsotropicPlasticityStressUpdate.html)、[COMSOL Norton/Arrhenius 模型说明](https://doc.comsol.com/6.4/doc/com.comsol.help.sme/sme_ug_theory.06.039.html) | 温度相关屈服和蠕变方程参考；不依赖这些软件运行时，不代表已标定工程材料。 |
| 塑性生热 | [Abaqus 塑性生热定义](https://docs.software.vt.edu/abaqusv2025/English/SIMACAETHERefMap/simathe-c-plasticheatgen.htm) | 塑性功转热份额参考；硬化储能、离散耗散与完整能量账本须分别检查。 |
| FEM 动力学与热弹性 | [Sandia Sierra/SM 动力学理论](https://www.sandia.gov/files/sierra/SM_Theory_5_30/main/dynamics.html)、[LS-DYNA 显式时间积分](https://www.dynasupport.com/tutorial/ls-dyna-users-guide/time-integration)、[FEniCS 线性热弹性](https://comet-fenics.readthedocs.io/en/latest/demo/thermoelasticity/thermoelasticity.html) | 显式积分、条件稳定性和线性热弹性公式参考；不调用这些软件求解器。 |
| 单边接触与阻尼 | [Itasca 线性接触模型](https://docs.itascacg.com/pfc700/common/contactmodel/linear/doc/manual/cmlinear.html) | 弹簧、阻尼、库仑限制与能量分项；项目采用自身最近点与分裂冲量步骤。 |
| 三角形最近点 | Christer Ericson，[Real-Time Collision Detection](https://realtimecollisiondetection.net/books/rtcd/) 的 Voronoi 区域算法 | `src/fem/contact.js` 的 `closestTriangle` 与 `gpu/mixed_solver.py` 的对应例程具有该算法谱系；本地返回重心权重并处理退化情形。变量与分支相似不能证明实际复制了 Three.js、Bullet 或书中代码，因此不虚构其依赖或授权关系。 |
| 刚体与 GPU 接口 | [Rapier 刚体](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/)、[关节与电机](https://rapier.rs/docs/user_guides/javascript/joints/)、[RigidBody API](https://rapier.rs/javascript3d/classes/RigidBody.html)、[Taichi 后端配置](https://docs.taichi-lang.org/docs/global_settings) | 实际运行时依赖；版本和许可另见 THIRD_PARTY.md。 |
| 自引力 | [Princeton Barnes–Hut 介绍](https://fpretori.scholar.princeton.edu/n-body-simulations-introduction) | 分层自引力近似参考；规模演示不等于精度或性能保证。 |
| 热物性 | [NIST 水物性](https://www.nist.gov/programs-projects/contributions-international-standards-properties-water)、[冰与过冷水](https://www.nist.gov/publications/properties-ice-and-supercooled-water)、[铁热化学](https://webbook.nist.gov/cgi/cbook.cgi?ID=C7439896&Mask=A) | 固定参考近似与代表性参数，不是全温压区间拟合。 |

## CAD 来源核查（2026-11-05）

CAD 的组件、固定源码版本、许可证和本地实现映射已单独记录在 [CAD_LICENSE_REVIEW.md](CAD_LICENSE_REVIEW.md)。维护者明确确认，除安装的 usd-brep、MeshPy 和 NumPy 外，没有另行复制或导入其他软件的 CAD 代码、模型或素材，CAD 代码与示例均在本项目开发过程中生成。该声明与技术证据分别保存，不被表述为独立作者权利证明。

本轮核对了 42 个 CAD 文件、5 个 Python 适配文件对固定上游源码的有限相似性筛查，以及穿孔块示例的精确重建；未识别出须另行登记的第三方复制实现。详细结果与限制见 [CAD 源码证据清单](cad-source-evidence.json)。CAD 之外的数值实现、旧参考资料和内联界面素材已由 [非 CAD 来源核查](SOURCE_RELEASE_REVIEW.md) 补充处理；两个报告均限定为当前源码分发范围，不形成完整运行包的许可放行结论。

## 维护者声明与参考软件

维护者明确确认：除已登记的依赖外，非 CAD 代码、图标与示例均在本项目开发中生成，没有额外复制或导入其他软件的代码或素材；用于参考的商业软件是允许其研究/开发用途的正式授权版本。这些确认记录为维护者声明，不是独立作者权利证明。它们与上述公开方法、实现参考/适配及必要署名并存，不能据此删除通知。

正式授权的使用范围与源码、手册、截图或素材的复制/再分发条件是不同事项。本项目未把这些本地参考资料及授权文件加入源码候选，也不把试用版条件直接套用到已确认的正式授权使用。具体核查边界见 [SOURCE_RELEASE_REVIEW.md](SOURCE_RELEASE_REVIEW.md)。

## 后续维护与分发边界

当前源码范围的来源登记和通知补齐已完成；新增代码、素材、贡献或依赖时继续更新来源映射与许可文本。原生库、传递依赖、完整二进制/离线包及 TetGen/Triangle 的实际分发条件仍按具体发布物另审。运行依赖原文见 [runtime 通知](../third_party/runtime/README.md)。[发布检查表](OPEN_SOURCE_CHECKLIST.md) 中的候选检查、CI、仓库可见性和报告渠道操作仍需分别执行与验证；本记录不宣称这些操作已经完成。
