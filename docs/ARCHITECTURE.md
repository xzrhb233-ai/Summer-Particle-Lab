# Architecture and extension boundaries

## Runtime paths

```text
Browser: four-entry workbench + WebGL2 renderer
  └─ normalized project document + configuration identity
       ├─ CPU JS workers: FEM / particles / mixed coupling
       ├─ Rapier WASM: rigid-body dynamics
       └─ loopback WebSocket: optional Taichi GPU services
  └─ result frames + compact histories + original configuration
       └─ visualization / queries / archives / independent V&V workers

Browser CAD or AI request
  └─ loopback Node HTTP server
       ├─ /api/cad: fixed Python worker → SMLib / optional TetGen
       └─ /api/ai/chat: selected provider → typed command proposal
            └─ validate / preview / apply through project operations
```

The platform shares a project schema and coordination layers; it is not one identical mathematical solver on every backend. Preserving distinct FEM, PBF and rigid-body algorithms under MPM-oriented orchestration does not make their consistency, precision, time-step restrictions or contact coverage identical.

## Ownership map

| Area | Main responsibility |
| --- | --- |
| `src/simulation/project.js` | Normalize and validate the unified project document |
| `src/simulation/workspace-ui.js` | Coordinate workspace state, loading, time advancement, result origin and history |
| `src/simulation/assistant-commands.js` | Strict command language and allowed operations, not executable model-generated code |
| `src/simulation/assistant-context.js` / `result-query.js` | Bounded current settings and measured-result queries |
| `src/simulation/project-archive.js` | Sanitized browser-local revisions and run summaries; not a full solver checkpoint |
| `src/simulation/cad-*` / `cad/` | Parametric editing, previews, native geometry/meshing and geometry-to-part conversion |
| `src/fem/` | Linear Tet4 assembly, static/dynamic and thermal updates, worker adapters |
| `src/mixed/` / `src/multibody/` | Mixed-method contact/exchanges and rigid-body integration |
| `src/three/` | Browser 3D solver/view adapters, custom WebGL2 rendering and UI |
| `gpu/` | Standalone, project and mixed Taichi services; their protocols are distinct |
| `src/simulation/vv-*` | Measurement interpretation, numerical metrics, independent benchmark/study workers and UI |

## Data and evidence contracts

- Preserve units explicitly. Project geometry uses SI conventions; display millimeters are a UI conversion. Particle normalized stress is not interchangeable with FEM stress in Pa.
- A result retains the configuration that produced it. Edits must not silently relabel old results as current. A preview, submitted job, partial frame or absent field is not a solved measurement.
- Requested step size is an input; actual accepted substeps are evidence. Event cuts, stability limits and contact retries can change them.
- Separate exchange terms, external work, physical dissipation, numerical corrections and uncovered terms. A complete mechanical ledger is not a complete thermodynamic or model-validity statement.
- CAD surfaces can be reference geometry without being physical shells. Explicit FEM meshes, named selection sets and native GPU geometry have separate support constraints.
- Scalar histories and visual frames have finite storage budgets. An archive is not an exact continuation checkpoint; imported projects restart from initial conditions.
- The Summer product name is separate from persistence and transport identifiers. Existing `summer-*` schemas, protocol identifiers and browser storage keys remain unchanged for compatibility. Renaming a label must not silently fork archives or invalidate saved projects.

## Extending the software

Add a capability to the project schema and its validation first; then implement its CPU/GPU capability checks, UI/AI typed operations and measured output. Keep unsupported combinations explicit. A new material needs state-update and energy definitions, units, failure handling and independent tests, not only a menu entry.

Tests, native requirements and V&V coverage are separated so the basic application remains lightweight. See [installation](INSTALL.md), [V&V](VV.md) and [contributing](../CONTRIBUTING.md). The [version milestones](HISTORY.zh-CN.md) summarize capability changes; source references and unresolved rights checks are maintained in [PROVENANCE.md](PROVENANCE.md).

## Refactoring deferred from release preparation

Several historical UI and solver modules are large and contain multiple responsibilities. This preparation pass establishes documentation, test partitions and publication checks without moving numerical kernels en masse. Future refactors should extract project orchestration, UI widgets and backend protocols in separately tested changes, keeping stable project IDs and reproducible comparison outputs.
