# Summer Particle Lab

A local, browser-based multiphysics workbench for exploring **MPM solids, FEM, PBF fluids, rigid bodies and thermal coupling**. It includes optional native CAD modeling, a restricted AI command interface, and tools for numerical verification and experimental comparison.

**Status: research software, v0.71.0; preparing for public release.** Project-owned code is licensed under [MIT](LICENSE). Third-party redistribution and source-rights reviews are still pending, so this repository remains private during release preparation. See the [release checklist](docs/OPEN_SOURCE_CHECKLIST.md) and [third-party inventory](docs/THIRD_PARTY.md).

## Start with the CPU workbench

Use Node.js **22.10+ (22.x) or 24.x** and pnpm **10.19.0**. No GPU, Python environment, CAD installation, API key or external model account is needed for the basic browser simulation.

```sh
pnpm install --frozen-lockfile
pnpm start
```

Open [the empty 3D project](http://127.0.0.1:5173/3d.html?scene=empty&backend=cpu&study=project&mbd=empty#geometry). The four workspace entries are **Model → Physics → Solve → Results**. Begin with a built-in example, set its physical end time and time step, run it, and inspect the results and V&V panel.

The server listens on `127.0.0.1:5173`. It is designed for one user's local workstation, not for public hosting or a shared multi-user service. The [installation guide](docs/INSTALL.md) covers optional CAD, CUDA/Vulkan backends, Windows launchers, and platform limitations. CPU rendering requires a WebGL2-capable browser.

## What is implemented—and what is not established

| Area | Current implementation | Important scope |
| --- | --- | --- |
| Solids and fluids | MPM solids, PBF fluids, constitutive models and thermal/phase behavior | CPU/GPU feature support differs; a material or coupling being selectable does not establish its accuracy |
| FEM | Linear Tet4 static and transient mechanics, explicit CAD meshes, thermal loads | Small-deformation formulation; not a validated general finite-strain FEM solver |
| Rigid bodies and coupling | Rapier on CPU; several native Taichi particle/FEM/rigid coupling paths | GPU geometry, component counts and energy diagnostics have path-specific limits |
| CAD | SMLib primitives, booleans, curves, surfaces, parametric templates and TetGen volume meshes | Optional Python/native installation; open reference surfaces are not automatically physical shells or solids |
| AI assistant | Typed, allowlisted modeling, solver controls and result queries | Optional user-selected provider; no arbitrary code, shell, source editing or filesystem tool |
| V&V | Six CPU benchmarks, bounded FEM time refinement, CSV comparisons, small parameter ensembles and evidence reports | No universal correctness classifier; current GPU and engineering-model coverage is incomplete |

Use the **Results → 结果可信度 · V&V** panel to distinguish measured abnormalities, applicability risks, checks within a stated threshold, and quantities that were not assessed. In particular, cell-crossing noise, volumetric locking and numerical fracture require discriminating comparisons; appearance or a small energy residual alone cannot diagnose their cause.

The [V&V guide](docs/VV.md) records definitions, assumptions and remaining coverage. The bounded beam example currently reports **inconclusive** spatial convergence; this is retained as evidence, not converted into a pass. No supplied experimental dataset has established physical validation for this project.

## Checks for contributors

```sh
pnpm check:repo       # source hygiene, document presence, sanitized candidate manifest
pnpm test            # core JS tests; explicitly excludes native CAD cases
pnpm test:cad        # actual native CAD cases; missing environment is an error
pnpm test:all        # core + native CAD, requiring the CAD environment
pnpm validate:vv     # independent CPU V&V report in artifacts/
pnpm check:release   # stricter publication gate; missing project LICENSE blocks it
```

The test runner discovers files without shell wildcard expansion. Run `node scripts/test.mjs --list` to inspect the core/native classification. Core tests with GPU-related names exercise JavaScript adapters or CPU/mock paths; they do **not** claim a GPU hardware run. The [CI workflow](.github/workflows/ci.yml) runs Node 22/24 core jobs on Linux and Windows, plus a separate Linux native CAD job. All five jobs [passed on commit `aa104ea`](https://github.com/xzrhb233-ai/Summer-Particle-Lab/actions/runs/42133095524) on 2026-11-05; subsequent revisions need their own checks.

Local release-preparation evidence (Windows, Node 24.22.1): **726/726** selected tests passed with zero skips. An isolated pnpm 10.19.0 cold install preserved the lockfile and passed CPU FEM, Rapier and HTTP smoke checks. Details and unexecuted checks are in the [release checklist](docs/OPEN_SOURCE_CHECKLIST.md).

Local reports, recordings, virtual environments, caches and scratch files are excluded from release candidates. They are kept on disk and can be regenerated. Secret-pattern checks are a supplement to manual review and a dedicated history scan; they are not proof that a repository contains no secrets.

## Project map

| Location | Responsibility |
| --- | --- |
| `src/simulation/` | Unified project schema, workspace, modeling/AI commands, archives and V&V |
| `src/fem/`, `src/mixed/`, `src/multibody/` | FEM, mixed coupling and rigid-body execution |
| `src/three/` | Native WebGL2 3D renderer and workbench; this is not a Three.js dependency |
| `gpu/` | Optional native Taichi services, solvers and hardware validation scripts |
| `cad/` | Native geometry worker, meshing, examples and pinned direct dependencies |
| `tests/`, `scripts/` | Regression tests, reproducible runners and release checks |
| `docs/` | Installation, architecture, V&V, dependencies, provenance and version milestones |

See [architecture and data flow](docs/ARCHITECTURE.md), [contribution guidance](CONTRIBUTING.md), [security boundaries](SECURITY.md), and the [version milestones](docs/HISTORY.zh-CN.md). Existing project/schema identifiers remain compatible; changing the product name does not migrate or invalidate saved projects.

## Attribution and release licensing

Design references, numerical sources and the outstanding source-rights review are recorded in [PROVENANCE.md](docs/PROVENANCE.md). Summer is an independent project; the product rename does not change third-party rights or imply affiliation or endorsement.

The maintainer selected the [MIT License](LICENSE) for project-owned code, allowing commercial use, modification and distribution, including closed-source reuse, while retaining the copyright and license notices. This grant does not relicense third-party code, dependencies or assets and does not certify that the source-rights review is complete.

Dependencies retain their own licenses. In particular, the MeshPy wheel includes TetGen and Triangle with terms separate from the Python wrapper; USD BRep packages also contain third-party components. The project MIT license does not make the complete stack MIT. See [THIRD_PARTY.md](docs/THIRD_PARTY.md) before distributing source bundles, native wheels or packaged applications.
