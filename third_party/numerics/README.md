# 数值实现参考与许可通知

以下通知对应本项目已记录和本轮代码比较识别的公开实现参考。为完整保留这些参考实现的权利声明，随源码提供固定版本的 MIT 许可原文。本目录不表示整个求解器直接来自这些项目，也不宣称已证明所有本地代码独立原创。

| 上游实现与固定提交 | 本地涉及范围 | 比较结果 | 许可原文 |
| --- | --- | --- | --- |
| [Taichi MPM](https://github.com/yuanming-hu/taichi_mpm/tree/3a680ab0fdc6e95077f08a91bc9079e1ef41478e)，`3a680ab0fdc6e95077f08a91bc9079e1ef41478e` | `src/solid-mpm.js`、`src/three/mpm.js`、`src/three/constitutive.js`、`gpu/solver.py` | MLS-MPM/APIC 的二次权重、传递和共旋转应力；雪塑性投影还使用与作者示例对应的非对称伸长限值比例与 `Jp` 限制。本地代码增加了材料、坐标、约束与耦合处理。按实现参考/适配保留通知，不把公式相同本身作为复制证明。 | [Taichi MPM Authors MIT](taichi_mpm-3a680ab0fdc6/LICENSE) |
| [Taichi Elements](https://github.com/taichi-dev/taichi_elements/tree/d19678869a28b09a32ef415b162e35dc929b792d)，`d19678869a28b09a32ef415b162e35dc929b792d` | `src/three/constitutive.js` 的砂塑性分支、`gpu/solver.py` 的对应分支 | 对数主应变、膨胀历史、无抗拉分支及 Drucker–Prager 投影与上游 `sand_projection` 对应；本地实现使用自己的数据结构、参数及数值限制。按实现参考/适配保留通知。 | [Taichi Elements Developers MIT](taichi_elements-d19678869a28/LICENSE) |

比较入口为 [Taichi MPM `mls-mpm88.cpp`](https://github.com/yuanming-hu/taichi_mpm/blob/3a680ab0fdc6e95077f08a91bc9079e1ef41478e/mls-mpm88.cpp)、[解释版](https://github.com/yuanming-hu/taichi_mpm/blob/3a680ab0fdc6e95077f08a91bc9079e1ef41478e/mls-mpm88-explained.cpp)及 [Taichi Elements `engine/mpm_solver.py`](https://github.com/taichi-dev/taichi_elements/blob/d19678869a28b09a32ef415b162e35dc929b792d/engine/mpm_solver.py)。这些提交是本轮固定的比较快照，不是对最初开发时所读提交的追认；初始开发未保存精确上游版本。

两份 `LICENSE` 按上游原始字节复制，SHA-256 如下：

| 文件 | SHA-256 |
| --- | --- |
| `taichi_mpm-3a680ab0fdc6/LICENSE` | `56a5e8e12587f5baef49c1d012f32007ffac2b9a1524e97d6f4f5a6d7b240b7c` |
| `taichi_elements-d19678869a28/LICENSE` | `ce0ce084f4ba8ac93909499c21680567f9a2170d34f1f1443c9f7c7aed12c3fe` |

论文和理论公式的其他参考另见 [来源记录](../../docs/PROVENANCE.md)。Taichi 运行时依赖与这里的 Taichi MPM、Taichi Elements 实现参考是不同项目，不能用运行时许可证代替以上作者通知。此清单不改变其他参考资料和实际发布物的核查范围。
