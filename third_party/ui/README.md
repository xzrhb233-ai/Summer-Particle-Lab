# UI and shader reference notices

These are complete upstream license texts retained for the recorded UI design
and shader references. Their inclusion does not assert that the complete local
UI was copied from either project, and does not independently establish the
authorship or licensing of every local source line or asset. The project MIT
license does not replace notices applicable to any third-party material actually
reused.

| Reference | Pinned source | Local scope | Notice |
| --- | --- | --- | --- |
| LBEILC/RhineLabUI | [`12cc5e4013acb9408f753ff71de6b8492299b7c8`](https://github.com/LBEILC/RhineLabUI/tree/12cc5e4013acb9408f753ff71de6b8492299b7c8), particularly [`DESIGN.md`](https://github.com/LBEILC/RhineLabUI/blob/12cc5e4013acb9408f753ff71de6b8492299b7c8/DESIGN.md) | `src/three/workbench.js`, `src/three/workbench.css` and `src/three/index-wave.js`: archive navigation, warm paper colors, fine rules, selection accents and motion concepts. Current code uses native DOM/CSS. The comparison found generic CSS declaration overlap, not a demonstrated substantial source copy. | [MIT, Copyright (c) 2026 LBEILC](rhinelabui-12cc5e4013ac/LICENSE) |
| Jam3/glsl-fast-gaussian-blur | [`5dbb6e97aa43d4be9369bdd88e835f47023c5e2a`](https://github.com/Jam3/glsl-fast-gaussian-blur/tree/5dbb6e97aa43d4be9369bdd88e835f47023c5e2a), [`9.glsl`](https://github.com/Jam3/glsl-fast-gaussian-blur/blob/5dbb6e97aa43d4be9369bdd88e835f47023c5e2a/9.glsl) | `src/renderer.js`, `blurFragment`: the five texture samples use the same optimized nine-tap Gaussian offsets and weights, rounded locally. The local WebGL 2 shader changes names, types and expression structure. Matching mathematical coefficients alone do not establish copying; the upstream notice is retained conservatively. | [MIT, Copyright (c) 2015 Jam3](glsl-fast-gaussian-blur-5dbb6e97aa43/LICENSE) |

The notice files are byte copies of the pinned upstream
[RhineLabUI LICENSE](https://raw.githubusercontent.com/LBEILC/RhineLabUI/12cc5e4013acb9408f753ff71de6b8492299b7c8/LICENSE)
and [Gaussian-blur LICENSE.md](https://raw.githubusercontent.com/Jam3/glsl-fast-gaussian-blur/5dbb6e97aa43d4be9369bdd88e835f47023c5e2a/LICENSE.md).
The shader notice is named `LICENSE` locally; its contents are unchanged.

This source distribution does not include RhineLabUI's fonts, audio, GLB models,
Blender projects or branding assets. Upstream's MIT notice does not grant rights
to unrelated third-party brands or assets described in its repository. The
elementary inline SVG icons are not registered as Lucide or Feather dependencies;
matches of simple line strokes in the comparison did not establish that ancestry.

The maintainer states that the project's non-CAD code, icons and examples were
generated within this project, with no extra copied/imported material beyond
registered dependencies. This is a maintainer statement, not independent proof.
The dated comparison and source hashes are local audit artifacts, not runtime
assets. Broader source-review boundaries are recorded in
[PROVENANCE.md](../../docs/PROVENANCE.md).
