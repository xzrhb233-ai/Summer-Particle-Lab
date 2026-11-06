# SMLib CAD integration — v0.70.0

## v0.70 · 从命名表面到物理条件和结果

1. 在 **模型 → SMLib CAD 建模 → 参数化零件 · 简易建模** 创建 CPU FEM 零件，检查几何/体网格预览后应用。
2. 打开 **物理条件 → 命名面与载荷**，选择部件，在局部预览中点选表面或使用列表。检查高亮、实际边界三角形数、节点数与面积，保存命名选择集。
3. 为选择集添加固定、面总力（世界 XYZ，N）、压力（Pa，正值向内）、总热功率（W）、恒温（°C）或对流（环境温度与 W/m²/K）。点击 **预览条件修改**，核对数值和温度场开关，再 **应用预览并重置**。热总功率按所选面的面积分配；同一选择集可同时绑定力学和热条件。
4. 求解后在 **结果 → 数值结果查询** 查看真实数值，在 **项目 → 项目版本与运行记录** 保存/恢复版本及有限结果摘要。

支持范围为 **CPU FEM**：长方体六面；参数化 L 形支架外侧平面；四孔板外面及四个孔壁；套筒内壁、外壁、上下端面及部分回转切面。目录中的语义键如 `four-hole-plate:hole:x-:z-` 表示模板中的指定孔壁，不是内核拓扑面号或三角形编号。选择集保存为：

```json
{"id":"heated-hole","name":"左前孔壁","part":"plate","entity":"face","region":{"type":"surface","surface":"four-hole-plate:hole:x-:z-"}}
```

修改参数并重划网格时重新解析同一语义键，载荷仍引用选择集 ID。不存在、失效或无法解析的表面会报错，不能静默改成整个部件。任意导入/布尔 CAD 的通用面命名、GPU CAD Tet4、CAD 刚体和四方法 GPU CAD 尚未接入；旧的六个包围盒平面选择仍可使用。FEM 仍受小变形线弹性、网格容量和充分支撑等既有条件限制。

### AI 命令与结果来源

- `selection.create/update/delete` 编辑选择集；面键只取当前部件 `selectableSurfaces` 目录。
- `load.create/update/delete` 支持 `fem-fixed/fem-force/fem-pressure`、MPM `fixed-selection` 及 `thermal-power/thermal-temperature/thermal-convection`。FEM 面载荷和面热边界使用 `target`、`selection`；热边界也可明确使用内联 `region`。更新保留未指定字段，不能变更类型；删除仍被引用的对象须先处理依赖。
- `curve.create/update/delete` 编辑载荷时间曲线；`binding.create/update/delete` 将曲线绑定到已有瞬态 FEM 面力分量或面压力。它们与 `cad.curve` 参考几何独立。热边界的 `program` 使用 `linear/smooth/step` 时间表，值为总功率或温度。
- `solver.configure {thermal:true}` 明确启用 CPU 瞬态 FEM 或 CPU MPM–FEM 温度场；不会静默切换设备或分析类型。
- `result.query` 支持 `extrema`、`contacts`、`series`。每轮最多 4 项只读查询，不能与修改或运行命令混合；可读取运行中已返回的帧。时程最多 100 点，显示降采样和配置来源。`available:false` / `null` 表示未提供数据；`matchesCurrentConfiguration:false` 表示结果来自另一配置。极值位置使用未变形世界坐标；不返回网格大数组，不推算未计算的安全结论。

```json
{"command":"load.create","args":{"id":"hole-pressure","type":"fem-pressure","target":"plate","selection":"heated-hole","pressure":1000}}
{"command":"result.query","args":{"kind":"extrema","partId":"plate","field":"stress"}}
```

以上是两个独立请求的命令示例：先预览并应用载荷，用户请求求解后再查询结果。物理修改通过同一受限命令、项目副本和严格求解器校验；几何仍先预览后应用。助手没有终端、脚本、任意代码执行或软件修改权限，API Key 仍仅保存在页面内存中。

### 本地版本与示例

应用模型后自动建立本地版本，可命名保存并在重新打开页面后主动恢复；不会自动覆盖当前项目。归档限 **32 个版本 / 100 条运行记录 / 64 MiB**，满额时手动删除，单个项目仍限 **16 MiB**。这是当前浏览器的本地数据库；清理站点数据会影响归档，跨浏览器/电脑请导出 JSON。运行记录只保存来源版本、状态、时间和数值摘要，不保存完整时程或求解器内部状态，不能续算；恢复版本从初始条件开始。Key 和聊天不进入归档。

[孔壁受压与加热示例](http://127.0.0.1:5173/3d.html?scene=empty&backend=cpu&study=project&mbd=named-surfaces&v=0.70.0#loads) 由真实 SMLib/TetGen 生成四孔板：固定左侧外面，在左前孔壁施加 **1000 Pa 压力和 100 kW 总热功率**，运行目标为 **0.04 s**。也可在“命名面与载荷”载入。它用于核对几何、选择、载荷、求解与结果来源的完整流程，不代表网格收敛或工程适用性已经验证。

The workbench calls NVIDIA's `usd-brep==1.0.1` wheel (SMLib) in a dedicated
Python 3.12 virtual environment. SMLib supplies BRep solids, native curves,
editable parametric reference surfaces and surface tessellation;
MeshPy/TetGen supplies constrained tetrahedral meshes.
Official kernel project: https://github.com/NVIDIA-Omniverse/usd-brep

## Install and launch

Run `Install-CAD.ps1`, then restart `Start-Summer.ps1` / `pnpm start`.
The installer uses `cad/requirements.txt`: `usd-brep==1.0.1`,
`meshpy==2026.1.1` and `numpy==2.5.4`. Run it again when upgrading an older CAD
environment so that the tetrahedral mesher is installed as well.
The Windows wheel needs CPython 3.12 and the Microsoft Visual C++ runtime.
The CAD service is part of the loopback web server; no extra port is needed.
The independent environment avoids OpenUSD/Taichi dependency conflicts.

Open **模型 → SMLib CAD 建模**. Save each primitive's parameters, then generate
the preview. The built-in example subtracts a Y-axis cylinder from a box.
Operations run sequentially: base, then union / difference / intersection.
The modeler accepts at most eight box/sphere/Y-cylinder/extrusion/revolution features,
including XYZ rotations, and rejects invalid or empty solids.

## Geometry and simulation

- SMLib creates the BRep, checks closed-solid topology, integrates its volume,
  and tessellates the display surface. Partial tessellation is not accepted.
- `geometry.cad` stores the versioned ordered construction recipe, kernel
  volume, original bounds and indexed preview mesh. Project JSON preserves it.
- MPM and PBF sample the same analytic CSG recipe on the existing background
  lattice. This preserves cavities without relying on triangle ray tests.
  Per-particle volume sums to the SMLib volume, including authoring scale.
  The surface mesh is visualization only, not FEM volume elements.
- XYZ rotation and size in the regular part editor transform the completed
  CAD body; primitive transforms in the CAD panel act before booleans.
- Initial jitter is rejected when it crosses a CAD boundary, including holes.
- CPU MPM/PBF and their existing CPU interfaces use this sampling path.
  CPU FEM uses a separately generated Tet4 mesh, described below. GPU CAD
  sampling, GPU CAD FEM and complex rigid CAD colliders remain unsupported.
  Unsupported devices fail explicitly; a CAD body is never replaced by its box.
- USDA export recreates the saved CAD-panel recipe and exports the exact
  BRep. It exports this CAD draft, not an edited/deformed simulation body.
  STEP, IGES, mesh import, fillets and path sweeps are not part of this release.
- AI commands now author and rebuild CAD recipes through `cad.create` and
  `cad.update`, in addition to whole-part transforms via `part.update`.

Thin features smaller than the particle spacing may receive no samples. The
preview reports sampled point count; use several particle spacings across a
hole or wall. This is a geometric discretization limit, not a boolean failure.

## Parametric parts and local edits (v0.69)

The default CAD panel opens **参数化零件 · 简易建模**. Existing freeform CSG,
profiles, curves, surfaces and meshes remain under **自由建模与高级几何**.

1. Choose L bracket, sleeve or four-hole plate, choose meters/millimeters for
   displayed dimensions, and edit the labeled parameters. Units are converted
   to SI; the solver's units do not change.
2. Choose CPU MPM, PBF or FEM. FEM accepts a target mesh size in meters and
   defaults to a fixed local `y-` face. Placement is available in a collapsed
   section. Existing parts keep their placement during parameter edits.
3. **预览建模 / 修改** builds real SMLib geometry and, for FEM, TetGen cells.
   Check the preview and parameter old/new values; **应用到项目** commits it.
   No part is inserted just by previewing. **显示四面体网格** switches a prepared
   FEM preview to wireframe. Material and support settings remain editable in
   the unified part editor.
4. Select an existing parametric part, use **读取当前选中部件**, or click
   **编辑参数化尺寸** in the main part editor. Change only the required values
   and preview again. This updates the same ID, preserving unspecified material,
   initial conditions, support/load/contact settings and actual placement.
   FEM is remeshed using saved mesh options unless explicitly changed.
5. **撤销本次修改** restores the preceding authoring document if no intervening
   project edits occurred. It does not restore old simulation histories.

| Template | Named parameters (lengths in m, angle in degrees) |
| --- | --- |
| `l-bracket` | `width`, `height`, `legThickness`, `depth`; XY L profile extruded along Z |
| `sleeve` | `innerRadius`, `outerRadius`, `height`, `angle`; revolution around Y |
| `four-hole-plate` | `width` (X), `height` (Z), `thickness` (Y), `holeDiameter`, `pitchX`, `pitchZ`; pitches are hole-center distances |

The shared template metadata supplies defaults, labels and bounds to both the
manual form and AI context. Fit rules reject overlapping/tangent holes, holes
outside the plate, reversed sleeve radii and legs as thick as the bracket.
These checks do not prove that a chosen mesh or particle spacing resolves every
thin feature; the existing capacity, sampling and solver checks still apply.

The authoring record is separate from the strict native recipe:

```json
{"modeling":{"schema":"summer-parametric/1","template":"four-hole-plate","parameters":{"width":0.9,"height":0.7,"thickness":0.16,"holeDiameter":0.14,"pitchX":0.5,"pitchZ":0.4}}}
```

Recipes are compiled in local coordinates with centered bounds; actual placement
is in `geometry.center/rotation`. JSON round-trips and legacy physical editors
retain this record. Its compiled recipe must match the stored native recipe.
Replacing the raw CAD recipe deliberately detaches the parametric record.
Manually authored old CAD bodies are not reverse-engineered into template
parameters. Whole-part scaling preserves provenance, but parameter updates
reject until `geometry.size` matches the original CAD bounds again, because
stored parameters describe original local dimensions.

The AI can create and locally update these parts using bounded commands:

```json
{"command":"cad.parametric.create","args":{"id":"plate","method":"fem","template":"four-hole-plate","parameters":{"width":0.8,"height":0.6,"thickness":0.1,"holeDiameter":0.08,"pitchX":0.5,"pitchZ":0.3},"center":[0,0.7,0],"meshOptions":{"targetSize":0.15}}}
{"command":"cad.parametric.update","args":{"id":"plate","parameters":{"holeDiameter":0.12}}}
```

Creation fills unspecified template parameters from documented defaults. An
update supplies only changed parameter keys and cannot change template or
placement. Both accept the existing supported CAD material/initial/support
fields; unspecified values are retained on update. **交给 AI 继续建模** attaches
the current draft and opens an editable prompt without sending it. The assistant
receives named parameters, actual placement and capability metadata, not mesh
arrays. Errors include bounded field diagnostics for a subsequent corrective
request; this release does not add an autonomous retry loop. Preview application
and undo reuse the same closed protocol as existing CAD operations.

Prepared plans reject changed projects. A manual parameter draft also rejects
changes to its source parameters, placement or name by another editor until it
is explicitly reread, so stale form values cannot revert another edit.

Tests: `cad-parametric.test.mjs`, `assistant-parametric.test.mjs`, and
`workspace-parametric-summary.test.mjs`, plus the existing CAD/FEM/assistant
regression suites. Native tests exercise all three templates, JSON/legacy
preservation, partial updates, remeshing, transform application exactly once,
mesh option retention, invalid parameters, cancellation and stale operations.

## Native construction curves

Open **模型 → SMLib CAD 建模 → 曲线建模**. Choose the type, edit its definition,
then click **生成曲线**. The local SMLib kernel constructs and evaluates the
curve and computes its length; the preview is not a browser-only approximation
used in place of the CAD curve.

| Type | Definition |
| --- | --- |
| Line | Exactly two world-space endpoints |
| Circle | Center, radius, XYZ rotation; initially in the XY plane |
| Arc | Circle parameters plus start/end angles, with a positive sweep below 360° |
| Bézier | 2–9 control points; first and last are endpoints |
| B-spline | 2–32 control points, degree 1–5 and below the point count; clamped uniform knots |

Coordinates are meters and rotation/arc angles are degrees. The 8–512 display
segments affect the sampled preview and JSON export, not SMLib's length
calculation. Preview bounds are sampled bounds, not an exact extremum solver.

**保存到项目** stores the definition and sampled points in `project.cadCurves`
(up to 32 curves), and the main view displays them. **读取所选曲线** restores a
saved definition for editing; **新建曲线** keeps the inputs but detaches them
from the saved identity. Updates and deletion preserve physical parts and
`project.curves`, which is the separate collection of load/time curves.
Saving a project edit resets simulation results. Export produces curve JSON.

Construction curves are reference geometry. They do not become beam elements,
physical constraints, contact objects or solids. Directly selecting these
reference curves for extrusion/revolution, path sweep, surface filling and
custom knot/weight editing is not exposed yet. The separate closed polygon
profile workflow below creates solids using native linear/rotational sweeps.

## Closed polygon extrusion and revolution (v0.68)

Choose **轮廓拉伸 · L 形支架** or **轮廓旋转 · 空心套筒** under the solid
templates, then click **载入模板**. Alternatively choose the corresponding
entry in **工具体** for the current feature. The profile editor provides a
numbered 2D outline, a coordinate table, midpoint insertion and point deletion.
The last point joins the first implicitly. **批量编辑轮廓坐标** accepts a JSON
array of two-dimensional coordinates; apply or restore that text before saving
the feature. Pending text cannot silently build the old profile.

Save the feature, generate the CAD preview, then either add CPU MPM/PBF or
generate a surface/volume mesh in **表面网格与 FEM 体网格**. A volume mesh can
be inserted as a CPU FEM part. Existing boolean steps, rotations, export,
part editing and AI preview/application continue to apply.

The `summer-cad/1` recipe keeps old primitive records unchanged and additionally
accepts the following feature fields (together with `operation`, `center` and
`rotation`):

```json
{"shape":"extrude","profile":[[-0.4,-0.3],[0.4,-0.3],[0.4,0.3],[-0.4,0.3]],"depth":0.25}
{"shape":"revolve","profile":[[0.2,-0.3],[0.4,-0.3],[0.4,0.3],[0.2,0.3]],"angle":360}
```

- Extrusion uses local XY profile coordinates and Z from `-depth/2` to
  `+depth/2`; depth is 0.01–12 m.
- Revolution uses local radius/height `[r,y]`, with `r >= 0`, around +Y.
  It starts at +X (Z = 0); positive right-handed angles rotate toward -Z.
  Angle is 1–360 degrees, and partial sweeps have native end caps.
- `center` translates the local coordinate origin; the profile is not
  automatically recentered. XYZ rotations occur before this translation.
  Profile features do not have a `size` field.
- A profile has 3–32 finite vertices in ±6 m, each axis spanning 0.01–12 m.
  Repeated points (including a repeated first point), self-intersections,
  overlapping edges, zero-area regions and negative radii are rejected.
  Concave simple polygons and either winding are accepted. Profile holes are
  expressed through subsequent boolean differences, not extra polygon rings.

SMLib constructs line curves and uses native capped `linear_sweep` or
`rotational_sweep`. It verifies the resulting closed solid and computes its
volume. CPU particle sampling uses an analytic point-in-polygon test plus
depth/angular bounds, composed with the full CSG tree. It does not substitute
a convex hull or use display triangles to fill the material. The same native
boundary feeds the existing constrained Tet4 mesher, including internal voids.

`cad.create`, `cad.update` and `cad.mesh` support these features. For example:
“用闭合六点轮廓创建拉伸 L 形 MPM 支架，外宽0.8 m、高0.6 m、腿厚0.2 m，
沿 Z 拉伸0.5 m，偏移到(0,0.7,0)，先预览。” Or: “用 R–Y 轮廓建立内半径
0.2 m、外半径0.4 m、高0.6 m的套筒，绕 Y 旋转360°，生成0.15 m目标尺寸的
FEM体网格，固定 y-，先预览，不运行。”

These are polygon profiles, not a constrained sketch solver or arbitrary
NURBS-loop conversion. Path sweep, loft, fillet, surface stitching/thickening,
GPU CAD and complex CAD rigid colliders remain outside this release.
`tests/cad-profile-geometry.test.mjs`, `tests/cad-profile-kernel.test.mjs`
and `tests/assistant-profile.test.mjs` verify native volumes/bounds, partial
sweeps and axis points, transforms/booleans, cavity-preserving Tet4, analytic
MPM/PBF sampling, CPU FEM stepping, AI updates and stale/cancelled operations.

## Surface and volume meshes

1. Save the solid's feature steps or read an existing CAD part.
2. Open **表面网格与 FEM 体网格**, choose surface or volume, and set the target
   size. Curve-angle and chord-height tolerances control curved boundaries.
3. Click **生成网格**, inspect the wireframe and the reported counts. Volume
   meshes additionally report volume error, minimum mean-ratio shape quality
   (1 for a regular tetrahedron), minimum altitude and invalid-element counts.
4. Export VTK for triangle/Tet4 connectivity or OBJ for the boundary triangles.
   The volume Y-cut slider filters whole tetrahedra by centroid for inspection;
   it does not generate new elements on a cut plane.

Surface triangles come from the SMLib tessellator. Volume meshing welds seams,
validates an orientable closed manifold surface, identifies enclosed cavities
and sends the boundary to TetGen as a constrained piecewise linear complex.
Through-holes, enclosed voids and separate bodies remain in the volume mesh;
there is no bounding-box fill or centroid-only clipping of an unrelated mesh.
Curved boundaries use the tessellated surface, so their volume differs slightly
from the exact BRep. The UI reports that difference rather than claiming an
exact curved Tet4 boundary.

The target size is a refinement scale, not a guaranteed maximum edge length.
Surface output is capped at 50000 vertices / 100000 triangles. FEM volume
output is capped at 5000 nodes / 24000 Tet4 elements. Capacity estimates reject
obviously excessive requests before native tessellation/refinement; generated
output is checked again. Thin features and curvature may demand a coarser
requested size or simplified geometry to fit these limits. Quality metrics
and volume error do not establish mechanical or thermal convergence.

Mesh generation uses the original recipe coordinates. If an existing part has
later been moved/scaled/rotated, reading its recipe and generating a mesh does
not bake those whole-part transforms into the draft. Apply placement after
creating the FEM part, or rebuild the recipe in the intended coordinates.

## Add a CAD mesh to CPU FEM

Generate a volume mesh, expand **加入 CPU FEM**, set its name, Young's modulus,
Poisson ratio, density and fixed face, then click **新增 FEM 部件**. Defaults are
E = 100000 Pa, ν = 0.3, density = 1000 kg/m³ and fixed face `y-`. The operation
adds a new part, preserving existing parts; it does not convert or delete an
MPM/PBF original. A coincident duplicate will fail the initial contact check.
For a standalone FEM example start from an empty project; for an assembly,
change the draft placement first. Failed strict FEM insertion preserves the
previous project/runtime instead of reporting a successful simulation preview.

CAD FEM uses the existing small-strain linear-elastic Tet4 CPU solvers: static
PCG, explicit transient dynamics, supported rigid/particle/FEM contacts and
heat transfer. The active solver's existing coupling restrictions still apply.
The unified part editor changes material and whole-part placement while keeping
the explicit mesh; its box subdivision fields are disabled for CAD. Use the
CAD mesh tool to change resolution. GPU custom tetrahedral meshes are not wired
to the current kernel.

`discretization.mesh` contains `schema: "summer-tet4/1"`, `coordinates: "cad"`,
`nodes`, `elements`, `surface` and `source: {recipe, lower, upper}`. Nodes are in
the original CAD bounds; placement maps them into the part's current size,
rotation and center. Editing CAD features requires a fresh mesh; stale source
metadata, flipped/degenerate cells, duplicate cells, orphan nodes and mismatched
boundaries are rejected. Solver limits apply to the sum over all FEM parts.

Legacy face selections `x-/x+/y-/y+/z-/z+` select actual planar boundary triangles on
the corresponding local bounding plane. They do not select an entire curved
side. Each disconnected mesh component needs at least three non-collinear
fixed nodes. A Y-cylinder supports `y-` or `y+`; a sphere has no full planar
support and cannot currently be solved using this face-only support editor.
Mechanical face loads and face heating use the same selections; whole-surface
convection integrates the actual triangulated surface, including cavity walls.
Version 0.70 additionally supports the named template surfaces documented above,
including individual four-hole-plate walls and sleeve inner/outer walls on CPU FEM.

Thermal conduction preserves the standard signed Tet4 conductivity matrix.
Pairwise heat exchange is conservative and its explicit step is bounded using
absolute conductance row sums. Non-acute meshes do not guarantee a discrete
temperature maximum principle and may exhibit local overshoot; inspect quality
and mesh refinement. A small mesh altitude can also tighten contact/motion
limits. No mass scaling or invented positive conductivity is applied.

Project JSON stores curves, CAD recipes and complete FEM connectivity. **保存模型
JSON** exports a formatted document; **应用 JSON 并重置** accepts up to **16 MiB
of UTF-8 text**, including a UTF-8 BOM. Large valid meshes therefore round-trip
without the former 500000-character limit. Parsing does not bypass solver,
material, reference or topology validation.

## Isolation

`POST /api/cad` accepts JSON from the workbench's own origin. The server spawns
a fixed worker with `shell:false`; clients cannot supply code, module names,
file paths or process arguments. At most one job runs at once, with a 45-second
deadline and bounded input/output. USDA export uses a worker-owned temporary
directory. No model or API key is sent to NVIDIA or another remote service.

## Verification

`node --test tests/cad.test.mjs` tests real kernel volume/topology, union and
intersection, through-hole occupancy, project round-trip, jitter, MPM/PBF
initialization and finite stepping, USDA export, invalid input and HTTP origin
checks. Kernel tests are explicitly skipped if the dedicated environment is
absent; they are not replaced with a fake kernel.

## Licensing

The NVIDIA-authored portions of USD BRep/SMLib are licensed under Apache-2.0.
The `usd-brep==1.0.1` wheel also bundles OpenUSD (TOST-1.0) and other components
with their own terms; Apache-2.0 alone does not describe the entire binary
distribution. Its LICENSE, THIRD_PARTY_NOTICES.md and PACKAGE-LICENSES remain
in the installed wheel's dist-info directory. See the dependency and source
inventory in [docs/THIRD_PARTY.md](../docs/THIRD_PARTY.md).

MeshPy's wrapper is MIT-licensed, while the bundled TetGen component uses
**AGPL-3.0-or-later / commercial dual licensing**. This is a separate component
and is not covered by SMLib's Apache license. The installed
`meshpy-2026.1.1.dist-info/licenses/LICENSE` contains the wrapper, TetGen and
Triangle notices. The volume path uses TetGen; it does not call Triangle.
Retain upstream notices and review the selected distribution terms when
bundling the dependencies.

The [2026-11-05 CAD license/source review](../docs/CAD_LICENSE_REVIEW.md) pins
upstream revisions and verified Windows wheel hashes and retains 36 original
license texts. Although this application calls only `meshpy.tet`, the examined
MeshPy build combines TetGen and Triangle in one extension. The repository's
source-only scope is distinct from redistributing its complete native runtime;
no commercial license or full binary redistribution clearance is asserted.

## AI modeling workflow (v0.66)

1. Open **AI 助手**, configure the provider, model and memory-only API key.
2. Describe dimensions, units, position, material and boolean features. The
   built-in example buttons fill editable prompts without sending them.
3. The model returns only whitelisted declarative commands. The application
   calls the local SMLib/TetGen service, validates the requested geometry and
   discretization, and shows pending solids, curves or mesh results.
4. Review the rotatable preview and click **应用这些操作**. CAD commands always
   require this preview application even when automatic execution is enabled.
   Existing parts remain unless explicitly included in deletion commands.
5. Continue with instructions such as “把这个部件的贯通孔直径改为0.4 m，保留材料”.
   **查看已应用 CAD 步骤** opens the original construction tree in the CAD panel.
   **撤销上次 AI 修改** restores the project settings; previous simulation history
   is not restored. An edit resets the simulation; it does not run unless asked.

The CAD panel has templates for a through-hole block, pipe, L-bracket and
four-hole plate. Save a feature before switching/reordering it. The first base
feature cannot be deleted or moved. **让 AI 编辑这些步骤** attaches the saved draft
and its source part; it opens a prompt but does not transmit or apply anything.

Solid creation/update supplies the entire ordered recipe (max eight features;
max four geometry build jobs per turn). `cad.create` requires a unique id and
`method: "mpm"`, `"pbf"` or `"fem"`.
`cad.update` targets an existing CAD part and retains its id, unspecified
materials, method, loads and contact pairs. Recipes are constructed in WORLD coordinates;
updates replace the part geometry with the new kernel bounds and zero whole-part
rotation. Stored recipes describe the original CAD, before later whole-part
translation/scaling/rotation. Use `part.update` for whole-part transforms.
Nonuniformly scaled spheres/cylinders cannot always be baked into the supported
primitive recipe; the assistant must explain this instead of substituting one.

| Command | Purpose |
| --- | --- |
| `cad.create` with `method: "fem"` | Build the recipe, generate a true volume mesh and prepare a new CPU FEM part |
| `cad.update` of an existing FEM CAD part | Rebuild the replacement recipe and regenerate its tetrahedral connectivity; does not change its method |
| `cad.mesh` | Preview/export a mesh of an existing CAD part by ID; does not edit that part or run a simulation |
| `cad.curve.create/update/delete` | Manage reference curves independently of physical parts and load histories |

FEM CAD commands accept `meshOptions` such as
`{"kind":"volume","targetSize":0.15,"angleTolerance":15,"chordTolerance":0.002}`,
plus supported FEM material/initial/support parameters. `cad.mesh` instead uses
`{id, options}`, with `options.kind` equal to `"surface"` or `"volume"`.
Curve commands use `{id, name, spec}` for creation and `{id, spec, name?}` for
update; deletion needs `{id}`. `spec.kind` is `line/circle/arc/bezier/bspline`.
Only the native service creates mesh arrays; the model cannot submit executable
code or fabricated vertices/elements.

Example requests:

- “建立一条三次 Bézier 参考曲线，控制点为 (0,0,0)、(0,1,0)、(1,1,0)、(1,0,0)，先预览。”
- “为部件 cad-block 生成目标尺寸 0.15 m 的四面体网格，只预览，不创建重复部件。”
- “在空白项目创建带 Y 向贯通孔的 FEM 块，外形 0.8×0.5×0.6 m，中心 (0,0.7,0)，孔径 0.3 m；E=100000 Pa，ν=0.3，密度1000，固定 y-，网格目标0.15 m。先预览，不运行。”

Context sent to the model includes the feature tree and actual placement but
omits CAD vertices/indices, Tet4 connectivity and curve sample arrays; it includes
feature/curve definitions, placement and mesh counts. Invalid trees, out-of-domain or unsampled geometry,
unsupported methods/devices, cancellation and changes to the project during
preparation cannot partially commit a plan. Model-generated paths, scripts,
meshes and unsupported fields are rejected. The API gateway and CAD worker stay
separate; no API key is sent to the CAD worker.

Verification includes `tests/cad-curves.test.mjs`, `tests/cad-volume-mesh.test.mjs`,
`tests/cad-fem.test.mjs`, `tests/cad-tools.test.mjs`,
`tests/assistant-cad-tools.test.mjs`, `tests/assistant-context.test.mjs` and
`tests/project-io.test.mjs`, alongside the original CAD/assistant and FEM tests.
The real through-hole mesh has been advanced with CPU mechanics and face
heating: 100 W for 0.0001 s adds 0.01 J. Tests cover enclosed voids, disconnected
support, positive cells, thermal conservation, transformed placement, stale
results, failed operations and formatted project round-trips above 500 kB.
When browser QA uses the explicit local response fixture in
`tests/assistant-ui-provider.mjs`, it is identified as a fixture and the real
SMLib kernel still generates geometry; the fixture is never enabled in the
production gateway.

## Native editable reference surfaces (v0.67)

Open **模型 → SMLib CAD 建模 → 自由曲面建模**. This is a new open-surface
authoring path alongside the existing solid and curve tools. SMLib constructs
the mathematical surface and evaluates its points, derivatives and normals.
The browser displays those native samples; it does not replace the kernel
with a separately invented surface.

| Kind | Control net | Native degree and construction |
| --- | --- | --- |
| `bilinear` — 四角曲面 | Exactly 2 × 2 | Degree 1 in U and V, using the native corner-patch constructor |
| `bezier` — Bézier 曲面 | Exactly 4 × 4 | Bicubic Bézier patch through the native control-net constructor |
| `bspline` — B 样条曲面 | Independently 4–8 rows and 4–8 columns | Bicubic B-spline with the native constructor's clamped uniform knots |

The installed `usd-brep==1.0.1` surface binding exposes these fixed degrees.
There is no arbitrary degree, custom knot or rational weight control. In
particular, 2 × 2 and 3 × 3 nets are not passed to the fixed bicubic constructor;
the dedicated four-corner API supplies the bilinear case.

### Manual workflow

1. Choose the surface type and a **马鞍面 / 拱顶 / 波浪** starting shape. For a
   B-spline, choose the U and V control-point counts. **重建草稿控制网** replaces
   the current draft with the chosen template; saved project surfaces remain.
2. Select **第 U 行** and **第 V 列**, then edit that control point's X/Y/Z
   position. Positions are world coordinates in meters, bounded to ±100 m.
   The selectors display one-based row/column numbers. **完整控制网 JSON** uses
   ordinary zero-based JSON arrays of the form `[U row][V column][X,Y,Z]`.
3. Set **U / V 网格分段** and click **生成曲面与网格**. Both counts are integers
   from 4 through 64, defaulting to 16. Their product controls display/export
   sampling, not the mathematical control net. A surface contains
   `(segmentsU + 1) × (segmentsV + 1)` sample nodes and
   `2 × segmentsU × segmentsV` triangles, capped at 4225 nodes / 8192 triangles.
4. Inspect the shaded surface with **显示网格** and **显示控制网**. The reported
   area is the sum of triangle areas, and the bounds enclose sampled points;
   both are approximations, explicitly marked in the saved data.
5. Click **保存参考曲面** to add it to the main project view. **读取曲面** restores
   a saved control net for editing; **更新参考曲面** replaces that saved surface.
   **新建曲面** starts a new identity from the current draft. Deletion and
   updates operate on surfaces separately from parts, curves and load histories.

The worker rejects invalid/ragged control nets, unknown fields, excessive
sampling, singular derivatives and collapsed or inconsistently oriented sample
triangles. Singular boundary derivatives require a scale-aware check because
the native evaluator regularizes some zero tangents to a small epsilon.
These checks do not certify that a general freeform patch has no global
self-intersections. Inspect the shape and refine the sampling if necessary.

### Persistence and exports

`project.cadSurfaces` stores up to 16 entries of `{id, name, data}`. The data has
`schema: "summer-cad-surface/1"`, `kernel: "SMLib"`, `spec`, fixed `degreeU/V`,
native sampled `nodes` and unit `normals`, indexed triangle `elements`,
`area`, `bounds`, `areaApproximate: true`, `boundsApproximate: true` and
`closed: false`. Nodes are U-major: node `(i,j)` has index
`i × (segmentsV + 1) + j`. Triangle winding follows the native U × V normal.

Project JSON, solver-document normalization and edits through the legacy forms
retain this authoring data. The physics-only legacy projection omits reference
surfaces; it does not create extra bodies, loads or constraints. Saving a
project edit resets prior simulation results under the existing model workflow.

- **导出 OBJ** writes surface vertices, unit vertex normals and one-based
  `vertex//normal` face indices.
- **导出 VTK** writes `POLYDATA`, zero-based triangle polygons and `POINT_DATA`
  normals. It does not label these triangles Tet4 or shell finite elements.
- **导出定义 JSON** writes the native surface definition and sampled results.
  The exact mathematical patch can be reconstructed from its bounded control
  net by the local SMLib worker; increasing display segments does not add
  control points or change that patch.

An open reference surface has no closed solid volume. It is not currently an
MPM/PBF material region, rigid collision boundary, FEM shell or FEM solid, and
cannot be passed to the closed-solid TetGen volume mesher. Surface thickening,
trimming, stitching, curve-driven sweeps and shell mechanics are not exposed
by this release. The existing closed-solid CAD/FEM workflow remains separate.

### AI surface workflow

**交给 AI 编辑曲面** attaches the current control-net definition to an editable
assistant prompt. It does not itself send the request or apply a model edit.
The assistant uses the bounded commands:

- `cad.surface.create {id, name, spec}`
- `cad.surface.update {id, name?, spec}`
- `cad.surface.delete {id}`

The `spec` whitelist contains only `kind`, `controlPoints`, `segmentsU` and
`segmentsV`. Updates supply the full replacement control net. IDs belong to
the reference-surface collection, separately from physical-part and curve IDs.
All three geometry tools share the existing maximum of four native build jobs
per assistant turn. Model-generated node/triangle arrays, scripts, paths and
unsupported degree fields are rejected. Native surface previews are reviewed
before application; ordinary project settings and other geometry stay intact.

For example: “建立一个双三次 Bézier 马鞍参考曲面，范围 X=-0.6 到0.6 m、
Z=-0.5 到0.5 m，中心高度0.7 m，U/V各24段；先预览，不运行模拟。”
To revise it: “把参考曲面 surface-1 的第2行第3列控制点提高0.1 m，保留其他点。”
The model must interpret those human row/column numbers against the full
control-net definition and submit the corresponding replacement array.

### Surface verification

`tests/cad-surfaces.test.mjs` calls the actual kernel and verifies an inclined
plane's analytic area and normals, a Bézier `z = u v` patch against analytic
coordinates/normals and independent area quadrature, a rectangular B-spline
against independent Cox–de Boor basis evaluation, shared-edge winding and open
boundary counts, and malformed/degenerate-input rejection.
`tests/cad-surface-tools.test.mjs` checks native results through the browser
validator, JSON/legacy-edit retention, OBJ/VTK indices and normals, bounded
client requests, mismatched responses and cancellation during both HTTP fetch
and response-body parsing. Native tests are skipped explicitly only when the
dedicated CAD environment is absent.
