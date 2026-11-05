# Contributing

Public contribution intake is pending selection of the project license and completion of the release checklist. Once those are resolved, the following workflow describes the intended review standard.

## Reproduce first

1. Follow [INSTALL.md](docs/INSTALL.md); start from the CPU workbench unless the issue requires a specific native backend.
2. Record the source revision, operating system, Node/Python versions, actual device, and selected adapter. A URL saying `backend=gpu` is not sufficient evidence of the device used.
3. Supply a small project JSON, exact steps and expected versus measured behavior. Remove credentials, personal information and confidential geometry or experiment data.
4. For solver problems, report geometry/units, material parameters, mesh and particle resolution, requested **and actual** time steps, physical comparison time, contact and thermal settings, and relevant diagnostics.

## Keep changes reviewable

- Keep a change focused and preserve CPU/GPU capability checks; unsupported combinations must fail clearly.
- Modeling and simulation commands belong in the typed project/command schemas. Do not add arbitrary source, shell, `eval`, file access or network tools to the assistant.
- Validate before replacing the active project. Retain provenance and distinguish a submitted run from a completed result.
- For numerical changes, describe the governing assumptions, units and conservation terms, and provide an independent reference or discriminating test. A regression matching the old implementation alone is insufficient.
- Label synthetic data, demonstration parameter distributions and unvalidated approximations. Never relabel missing measurements or inconclusive refinement as a pass.
- When using AI to prepare a change, review the code, sources and licenses and include the actual commands/results used for verification. Generated test claims are not evidence.

## Required local checks

```sh
pnpm check:repo
pnpm test
```

Run `pnpm test:cad` for native CAD changes and `pnpm validate:vv` for affected CPU numerical paths. See [V&V](docs/VV.md) for interpretation. GPU changes require an actual named device run with configuration, precision, initialization/warm-up, compute/transfer timing and limits recorded; core CI does not replace that work.

The test runner maintains explicit native-case classification. Update it deliberately when a test adds a native dependency. Do not hide missing environments with new silent skips. Keep generated logs and datasets under ignored `artifacts/` or temporary test directories; share a reviewed minimal reproducer when needed.

A review description should state the problem, resulting behavior, tests actually run, measurements and remaining limitations. Cite the original source for formulas, algorithms, copied code or assets, and keep the [source review record](docs/PROVENANCE.md) current. Do not import proprietary manuals, application binaries or third-party source without verified permission and attribution.

Security reports follow [SECURITY.md](SECURITY.md), not an issue containing a credential or exploit against a public service. Publishing, tagging, pushing, changing license terms and disclosing security reports are separate maintainer decisions.
