# 来源与权利核查记录

本文件记录 Summer 的设计参考和公开数值文献，供维护与发布前复核。它不是完整的来源清单，也不是逐行来源鉴定，不证明全部代码原创、已获授权或与参考软件等价。依赖版本及许可证据另见 [THIRD_PARTY.md](THIRD_PARTY.md)。

## 设计参考

| 来源 | 已记录的参考范围 | 尚待核实的边界 |
| --- | --- | --- |
| [Grant Kot 的 Tutti Space Program](https://tsp.grantkot.com/) | 初始粒子沙盒的视觉与交互探索 | 未核实可适用于上游源码、素材或品牌的授权；灵感署名不构成复制许可或对方背书。 |
| [LBEILC/RhineLabUI](https://github.com/LBEILC/RhineLabUI) 及其 [DESIGN.md](https://github.com/LBEILC/RhineLabUI/blob/main/DESIGN.md) | 档案索引、细线排版、配色及目录交互的设计参考；当前实现为原生 DOM/CSS | 上游 MIT 许可与相关通知见 THIRD_PARTY.md；没有运行时导入不等于已证明所有片段和素材均为原创。 |

Summer 是独立项目，不是上述项目的官方版本。

## 数值方法和公开技术资料

以下链接从历史开发记录归集，用于定位当时参考的来源；并不表明本项目完整复现了任何论文或软件。当前算法、单位、支持范围和验证状态以源码及 [VV.md](VV.md) 为准。

| 范围 | 参考资料 | 记录中的使用边界 |
| --- | --- | --- |
| MLS-MPM / APIC | [Hu 等 MLS-MPM 论文与作者实现](https://yuanming.taichi.graphics/publication/2018-mlsmpm/)、[APIC 论文](https://www.math.ucla.edu/~cffjiang/research/apic/paper.pdf)、[APIC 技术报告](https://www.math.ucla.edu/~cffjiang/research/apic/tech-doc.pdf) | 固体网格传递、仿射速度及惯量定义；实际数值参数和稳定性须独立核对。 |
| 雪与砂 | [Stomakhin 等雪 MPM](https://www.disneyanimation.com/publications/a-material-point-method-for-snow-simulation/)、[Taichi Elements 砂返回映射](https://github.com/taichi-dev/taichi_elements/blob/master/engine/mpm_solver.py) | 本构与塑性返回参考；如复用了实现片段，需核实对应版本许可和通知。 |
| PBF 与统一粒子方法 | [Macklin–Müller PBF](https://matthias-research.github.io/pages/publications/pbf_sig_preprint.pdf)、[PBF 人工压力说明](https://blog.mmacklin.com/project/pbf/)、[Unified Particle Physics (2014)](https://matthias-research.github.io/pages/publications/flex.pdf) | 本项目保留各求解算法的混合耦合，不声称等同于论文统一材料表示；人工压力属于数值修正。 |
| MPM 接触 | [Bardenhagen 等接触研究](https://www.sci.utah.edu/~guilkey/MPMPubs/Bardenhagen-ImprovedContact-01.pdf)、[接触法向与间隙研究](https://www.sciencedirect.com/science/article/pii/S0045782520300402)、[刚体–MPM 耦合研究](https://www.cs.ucr.edu/~craigs/papers/2017-rigid-mpm/paper.pdf) | 局部接触近似和问题划分参考，非这些论文的完整实现。 |
| 粒子采样整理 | [MPM 粒子移位与积分误差研究](https://onlinelibrary.wiley.com/doi/full/10.1002/nme.7217) | 成对距离修正并非完整守恒重映射，也不是断裂模型。 |
| 温度塑性与蠕变 | [MOOSE 温度相关屈服](https://mooseframework.inl.gov/releases/moose/v1.0.0/source/materials/ADIsotropicPlasticityStressUpdate.html)、[COMSOL Norton/Arrhenius 模型说明](https://doc.comsol.com/6.4/doc/com.comsol.help.sme/sme_ug_theory.06.039.html) | 温度相关屈服和蠕变方程参考；不依赖这些软件运行时，不代表已标定工程材料。 |
| 塑性生热 | [Abaqus 塑性生热定义](https://docs.software.vt.edu/abaqusv2025/English/SIMACAETHERefMap/simathe-c-plasticheatgen.htm) | 塑性功转热份额参考；硬化储能、离散耗散与完整能量账本须分别检查。 |
| FEM 动力学与热弹性 | [Sandia Sierra/SM 动力学理论](https://www.sandia.gov/files/sierra/SM_Theory_5_30/main/dynamics.html)、[LS-DYNA 显式时间积分](https://www.dynasupport.com/tutorial/ls-dyna-users-guide/time-integration)、[FEniCS 线性热弹性](https://comet-fenics.readthedocs.io/en/latest/demo/thermoelasticity/thermoelasticity.html) | 显式积分、条件稳定性和线性热弹性公式参考；不调用这些软件求解器。 |
| 单边接触与阻尼 | [Itasca 线性接触模型](https://docs.itascacg.com/pfc700/common/contactmodel/linear/doc/manual/cmlinear.html) | 弹簧、阻尼、库仑限制与能量分项；项目采用自身最近点与分裂冲量步骤。 |
| 刚体与 GPU 接口 | [Rapier 刚体](https://rapier.rs/docs/user_guides/javascript/rigid_bodies/)、[关节与电机](https://rapier.rs/docs/user_guides/javascript/joints/)、[RigidBody API](https://rapier.rs/javascript3d/classes/RigidBody.html)、[Taichi 后端配置](https://docs.taichi-lang.org/docs/global_settings) | 实际运行时依赖；版本和许可另见 THIRD_PARTY.md。 |
| 自引力 | [Princeton Barnes–Hut 介绍](https://fpretori.scholar.princeton.edu/n-body-simulations-introduction) | 分层自引力近似参考；规模演示不等于精度或性能保证。 |
| 热物性 | [NIST 水物性](https://www.nist.gov/programs-projects/contributions-international-standards-properties-water)、[冰与过冷水](https://www.nist.gov/publications/properties-ice-and-supercooled-water)、[铁热化学](https://webbook.nist.gov/cgi/cbook.cgi?ID=C7439896&Mask=A) | 固定参考近似与代表性参数，不是全温压区间拟合。 |

## 发布前复核

维护者需确认具体复制片段、算法实现、素材和贡献的来源，记录许可依据与所需通知，并完成 [发布检查 R17–R20](OPEN_SOURCE_CHECKLIST.md)。现有来源表不构成授权证明，也未覆盖全部参考资料。
