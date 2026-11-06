# Runtime dependency notices

Original license texts for the directly imported non-CAD runtimes are preserved
here. The project MIT license does not replace these licenses. Source commits,
original URLs, hashes and checks are recorded in
[runtime-license-evidence.json](../../docs/runtime-license-evidence.json).

| Runtime | Fixed source commit | License |
| --- | --- | --- |
| Rapier JS / `@dimforge/rapier3d-compat` 0.19.3 | [`0fd32c1cbbc7018af36f09b190c16ce72fbb9301`](https://github.com/dimforge/rapier.js/tree/0fd32c1cbbc7018af36f09b190c16ce72fbb9301) | [Apache-2.0](rapier3d-compat-0.19.3/LICENSE) |
| Taichi 1.7.4 | [`b4b956fdaa67fd3e198527fd607053ecb9bf4aa2`](https://github.com/taichi-dev/taichi/tree/b4b956fdaa67fd3e198527fd607053ecb9bf4aa2) | [Apache-2.0](taichi-1.7.4/LICENSE) |
| websockets 15.0.1 | [`37c9bc0781f0cc5af7c729947ef1833c1e12b70d`](https://github.com/python-websockets/websockets/tree/37c9bc0781f0cc5af7c729947ef1833c1e12b70d) | [BSD-3-Clause](websockets-15.0.1/LICENSE) |

The Rapier npm release's `gitHead` matches its `v0.19.3` tag. The downloaded npm
tarball matches its registry SHA-512 integrity and all 50 installed package
files. Its installed package lacked a separate LICENSE, so the original text
was obtained from that exact source commit. Taichi and websockets source and
installed license files agree after line-ending normalization.

The Git source distribution does not contain these native libraries or npm
packages. Installing and then serving Rapier's JS/embedded WASM locally is a
runtime path separate from the source archive. Keep the upstream notices with
redistributed runtime content. Native/transitive runtime inventories and complete
binary-package distribution need review for the actual platform and artifact;
these three texts are not a full binary software bill of materials.

NumPy and the CAD dependency notices are in [the CAD inventory](../cad/README.md).
Taichi MPM and Taichi Elements implementation references have their own
[MIT notices](../numerics/README.md); they are distinct from the Taichi runtime.
