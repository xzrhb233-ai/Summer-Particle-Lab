// UI-only localization. Physics identifiers, form values and user part names are untouched.
import {multibodyMessages} from '../multibody/locale.js';
import {projectMessages} from '../simulation/locale.js';
import {femMessages} from '../fem/locale.js';
import {unifiedMessages} from '../simulation/unified-locale.js';
const messages={
  ...multibodyMessages,
  ...projectMessages,
  ...femMessages,
  ...unifiedMessages,
  '本构参数与塑性生热':'Constitutive parameters & plastic heat',
  'A · 初始屈服强度 / E₀':'A · Initial yield / E₀','B · 硬化系数 / E₀':'B · Hardening / E₀','n · 硬化指数':'n · Hardening exponent','C · 应变率系数':'C · Strain-rate coefficient','参考塑性应变率（1/s）':'Reference plastic strain rate (1/s)','JC 参考温度（°C）':'JC reference temperature (°C)','JC 熔化参考温度（°C）':'JC melting reference (°C)','m · 热软化指数':'m · Thermal softening exponent',
  'A、B 相对于参考模量 E₀。完整 JC 包含应变率和温度软化；简化 JC 不含屈服强度的温度项。熔化参考温度不会自动启用相变。':'A and B use reference modulus E₀. Full JC includes rate and temperature softening; simplified JC omits the temperature strength term. The melting reference does not enable phase change.',
  'GPU 联算暂不支持':'not in coupled GPU',
  '模型':'Model','物理条件':'Physics','结果':'Results','项目':'Project',
  '项目与算例':'Projects & examples','关闭项目菜单':'Close project menu','新建项目与示例':'New project & examples',
  '显示高级设置':'Show advanced settings','收起高级设置':'Hide advanced settings',
  '计算设备':'Compute device','时间步':'Time step','自动 · 推荐上限':'Automatic · recommended cap','自定义最大时间步':'Custom maximum time step',
  '高级设置与连接':'Advanced settings & connection','本地 GPU 服务端口':'Local GPU service port',
  '按模型自动选择现有后端；GPU 服务需已启动。不支持的配置会明确报错。':'The backend is selected for the model. Start the GPU service first. Unsupported configurations report an error.',
  '模拟上下文 JSON':'Simulation context JSON','关闭上下文':'Close context',
  '只读快照，包含已应用项目、待应用输入及结果来源。尚未开放 AI 执行命令。':'Read-only snapshot with the applied project, pending inputs and result provenance. AI command execution is not enabled.',
  '范围尺寸':'Domain dimensions','网格数量':'Grid cells','每格粒子':'Particles per cell','体积 V':'Volume V','预计粒子':'Estimated particles','可用容量':'Available capacity','旋转后包围盒':'Rotated bounding box',
  '采样点触及边界缓冲区，请将几何稍向计算域内部移动':'Samples touch the boundary buffer. Move the geometry slightly inside the domain.',
  '计算域与背景网格':'Domain & background grid',
  '坐标使用仿真长度单位。计算域决定边界，网格尺寸决定 MPM 分辨率；PBF 邻域半径仍为 8。':'Coordinates use simulation length units. The domain defines boundaries; cell size controls MPM resolution. The PBF support radius remains 8.',
  '计算域最小坐标':'Domain minimum','计算域最大坐标':'Domain maximum',
  'MPM 网格尺寸 h':'MPM cell size h','每轴粒子数 n（每格 n³）':'Particles per axis n (n³ per cell)',
  '应用计算域与网格':'Apply domain & grid','显示背景网格底面':'Show background grid on floor','视角适配计算域':'Fit view to domain',
  '粒子间距 Δp = h / n，支持 1–4；每轴最多 60 个网格。完整填充单元有 n³ 个初始点，边缘单元按几何裁切。采样数量仅影响之后新建的几何，已有粒子不会重新采样。缩小计算域时若容不下已有粒子会拒绝操作。':'Particle spacing Δp = h / n, supported range 1–4; at most 60 cells per axis. Full cells start with n³ points; boundary cells are clipped to the geometry. Sampling changes affect future geometry only. Domain changes that exclude existing particles are rejected.',
  '位置描述方式':'Position specification','中心 + 尺寸':'Center + dimensions','最小角 + 最大角':'Minimum + maximum corners',
  '未旋转包围盒最小角':'Unrotated bounding box minimum','未旋转包围盒最大角':'Unrotated bounding box maximum',
  '旋转角度（度，X → Y → Z）':'Rotation (degrees, X → Y → Z)','预览几何轮廓':'Preview geometry outline',
  '最小角必须小于最大角':'Minimum corners must be below maximum corners.',
  '计算域参数无效':'Invalid domain parameters.',
  '计算域坐标必须为三个有限数值':'Domain coordinates must contain three finite values.',
  '网格尺寸需为 4–16，每轴粒子数为 1–4，粒子间距需为 1–4':'Cell size must be 4–16, particles per axis 1–4, and spacing 1–4.',
  '计算域须位于 −240 至 240 内，每轴最多 60 个网格且至少一个网格':'The domain must fit within −240 to 240, with 1–60 cells along each axis.',
  '旋转角度需在 −360° 至 360° 之间':'Rotation angles must be between −360° and 360°.',
  '几何中心与尺寸无效':'Invalid geometry center or dimensions.',
  '旋转后的几何超出计算域，请调整位置、尺寸或计算域':'The rotated geometry exceeds the domain. Adjust position, dimensions, or domain bounds.',
  '几何候选采样超过 400 万，请增大粒子间距或减小尺寸':'Over four million candidate samples. Increase particle spacing or reduce dimensions.',
  '粒子容量不足，请增大粒子间距或减小几何':'Particle capacity exceeded. Increase spacing or reduce the geometry.',
  '几何内没有采样点，请减小粒子间距或增大尺寸':'No samples fall inside the geometry. Reduce spacing or increase dimensions.',
  '材料、初始条件或部件容量无效':'Invalid material, initial conditions, or part capacity.',
  '新计算域无法容纳已有粒子；请扩大范围或在空场景设置':'The new domain excludes existing particles. Enlarge it or configure an empty scene.',
  '当前压板超出新计算域，请先关闭压板':'The current platen is outside the new domain. Disable the platen first.',
  '计算域与网格已应用，采样参数用于之后新建的几何':'Domain and grid applied. Sampling parameters affect future geometry.',
  '计算域设置失败':'Domain configuration failed.',
  '当前 GPU 服务尚未加载精确建模与网格设置。请启动新版 start-gpu.ps1；保留旧实验时请使用另一个端口。':'This GPU service does not support precise modeling and grid settings. Start the updated start-gpu.ps1; use another port to preserve existing experiments.',
  '仅在新建时扰动位置，精确建模和拖绘共用此设置。最大位移为粒子间距乘以扰动强度；不改变粒子数量与质量。同一种子可复现分布，关闭或设为 0 恢复规则点阵。':'Jitter applies once to both parametric and drawn geometry. Maximum displacement equals spacing times noise amplitude. Count and mass are unchanged. The same seed reproduces the distribution; disable it for a regular lattice.',
  '使用本页的材料、本构和温度；名称与平动初速沿用部件设置。采样间距来自已应用的网格参数，旋转后的几何须完全位于计算域内。体积按解析几何计算，总质量不随采样细化改变；曲面边界由有限粒子近似。':'Uses the selected material, model, temperature and part initial conditions. Spacing comes from the applied grid settings; rotated geometry must fit inside the domain. Analytic volume preserves total mass under refinement; finite particles approximate curved surfaces.',
  '固体采样防聚集':'Solid sampling regularization',
  '缓慢整理同一部件中过密的 MPM 固体采样点，保持速度和本构历史。属于数值稳定化，可能改变局部形变；精确力学对比可关闭。':'Gradually separates crowded MPM samples within each part, preserving velocity and constitutive history. This numerical stabilization can change local deformation; disable it for mechanical comparisons.',
  '当前 GPU 服务尚未加载固体采样稳定化。请启动新版 start-gpu.ps1；保留旧实验时请使用另一个端口。':'This GPU service has not loaded solid sampling stabilization. Start the updated start-gpu.ps1; use another port to keep the existing experiment.',
  '本机 GPU 服务端口':'Local GPU service port',
  '每个服务只运行一个实验。保留旧实验时，可启动另一个端口的服务，再连接该端口。':'Each service runs one experiment. To keep an existing experiment, start another service on a different port and connect to it.',
  'GPU 服务端口必须是 8765–8799 之间的整数。':'GPU service port must be an integer from 8765 to 8799.',
  'GPU 正被另一个标签页使用。请关闭该 GPU 页面，或切换到 CPU。':'Another tab is using this GPU service. Close that GPU tab, use a separate service port, or switch to CPU.',
  '当前 GPU 服务尚未加载稳定相变修复。请重启 start-gpu.ps1，或使用 CPU 后端。':'This GPU service has not loaded the stable phase-change fix. Restart start-gpu.ps1 or use CPU.',
  '计算后端未连接':'Compute backend disconnected','查看计算后端':'View compute backend',
  '流体短程抗聚集':'Short-range fluid anti-clumping',
  '缓解液面粒子串珠与团聚。仅作用于 PBF 液体，可能使液滴更分散。':'Reduces beading and clustering near the free surface. Applies only to PBF liquids and may spread droplets further.',
  '熔化与凝固':'Melting & freezing','允许熔化与凝固（MPM ↔ PBF）':'Allow melting and freezing (MPM ↔ PBF)',
  '熔点 °C（独立于热软化温度）':'Melting point °C (separate from softening)','熔化潜热 J/kg':'Latent heat of fusion J/kg',
  '吸收完潜热后进入 PBF，释放完潜热后回到所选 MPM 本构。相变时清除旧应力与塑性历史；质量和总焓保持。两相暂用相同密度与比热，不模拟沸腾。':'Switch to PBF after absorbing latent heat and return to the chosen MPM model after releasing it. Switching clears old stress and plastic history while retaining mass and total enthalpy. Both phases share density and specific heat; boiling is not modeled.',
  '用于新建 MPM 部件。关闭时，加热只改变温度与本构响应，不会自动变成流体。':'Applies to new MPM parts. When disabled, heating changes temperature and constitutive response without switching to fluid.',
  '相变参数无效，请检查熔点与潜热范围。':'Invalid phase parameters. Check the melting point and latent heat ranges.',
  '相变演示：熔点 120°C，潜热 120 kJ/kg。左侧 20°C 使用 MPM；右侧 180°C 已熔化，使用 PBF。用加热或降温笔完成相变，观察固液数量。':'Phase-change demo: melting point 120°C, latent heat 120 kJ/kg. Left samples at 20°C use MPM; right samples at 180°C are melted and use PBF. Heat or cool them and watch the phase counts.',
  '此场景只比较固体热软化与蠕变，不包含熔化。需要热时流动，请选择“熔化与凝固”场景。':'This scene compares solid softening and creep without melting. Choose Melting & freezing for hot fluid behavior. ',
  '当前 GPU 服务不支持自定义熔化。请重启 start-gpu.ps1，或使用 CPU 后端。':'This GPU service does not support custom melting. Restart start-gpu.ps1 or use the CPU backend.',
  '粒子立体光照':'Particle sphere lighting','球面阴影与高光；关闭后显示原始色阶，便于对照温度图例。':'Sphere shading and highlights; disable for unshaded colors matching the temperature legend.',
  '物质点观察':'Material point inspection','粒子显示大小':'Particle display size','显示物质点中心（MPM 固体）':'Show material point centers (MPM solids)',
  '中心模式用小圆点显示固体采样位置。暂停后切换，配合旋转和剖切，可区分显示球重叠与点中心聚集。显示大小不代表物理粒径，不改变质量、体积、接触或计算结果。':'Center mode shows solid samples as small dots. Pause and toggle it, then orbit or clip to distinguish overlapping display spheres from clustered centers. Display size is not a physical diameter and does not change mass, volume, contact or simulation results.',
  '初始扰动不保证运动后仍均匀分布。压缩后显示球可能重叠，可在“结果与显示 → 物质点观察”检查点中心。':'Initial noise does not guarantee uniform spacing during motion. Display spheres can overlap under compression; inspect centers in Results & display → Material point inspection.',
  '温度本构对比':'Thermal constitutive comparison','冷热试样':'Cold / hot samples','温度相关 J2 塑性':'Temperature-dependent J2 plasticity','Norton–Arrhenius 蠕变':'Norton–Arrhenius creep','青柠色':'Lime','红色':'Red','温度 J2':'Thermal J2','蠕变':'Creep',
  '红色 · 加热降低屈服强度，冷却恢复强度；永久形变保留。':'Red · Heating lowers yield strength; cooling restores strength. Permanent deformation is retained.',
  '青柠色 · 受力下持续蠕变，加热加速、冷却减慢；使用实时温度。':'Lime · Creep under stress accelerates with heating and slows with cooling, using live particle temperature.',
  '读取粒子实时温度：加热、降温和接触传热均有效。冷却不会消除永久形变。':'Uses live particle temperature from heating, cooling and contact heat transfer. Cooling retains permanent deformation.',
  '参考温度 Tref °C':'Reference temperature Tref °C','热软化终点 Thot °C':'Softening endpoint Thot °C','高温残余强度比':'Hot residual strength ratio','冷态屈服 A/E':'Cold yield stress A/E','冷态硬化 H/E':'Cold hardening H/E','参考蠕变率 1/s':'Reference creep rate 1/s','活化能 Q（J/mol）':'Activation energy Q (J/mol)','蠕变应力指数 n':'Creep stress exponent n','参考应力 σref/E':'Reference stress σref/E',
  '参数仅用于新建部件。热软化与蠕变不等于熔化；需要流体时，请另行开启“允许熔化与凝固”。':'Parameters apply to new parts. Thermal softening and creep do not imply melting; enable melting and freezing separately to obtain fluid behavior.',
  '参数无效：Thot 必须高于 Tref，所有参数须在范围内。':'Invalid parameters: Thot must exceed Tref and all values must be within range.',
  '恢复温度本构参数':'Reset thermal model parameters','选择加热笔':'Select heating brush','选择降温笔':'Select cooling brush',
  '在试样上按住鼠标施加热量；暂停时也可改温度，继续模拟后力学响应生效。':'Hold the mouse on a sample to apply heat. Temperature can change while paused; mechanics responds when simulation resumes.',
  'σy/E = (A/E + H/E · εp) · f(T)；f(Tref)=1，f(Thot)=残余强度比':'σy/E = (A/E + H/E · εp) · f(T); f(Tref)=1, f(Thot)=hot strength ratio',
  '红色：温度相关 J2；青柠色：蠕变。左冷 20°C、右热 180°C。下压并保持压板，用加热/降温笔改变响应，温度着色查看热场。':'Red: thermal J2. Lime: creep. Left is cold (20°C), right is hot (180°C). Lower and hold the platen, then heat or cool the samples. Temperature coloring shows the thermal field.',

  '岩土与泡沫压缩':'Soil & foam compression','随机采样':'Randomized sampling','黏聚岩土':'Cohesive soil','泡沫金属':'Metal foam','棕色':'Brown','玫红色':'Magenta','岩土':'Soil','泡沫':'Foam',
  '棕色 · 压力相关剪切屈服、独立剪胀与拉伸截断，可保留塑性体积变化。':'Brown · Pressure-sensitive shear yielding, independent dilation and a tension cutoff; retains plastic volume changes.',
  '玫红色 · 静水压力也能引起屈服，压缩留下永久体积变化，压密后强化。':'Magenta · Hydrostatic pressure can cause yielding; permanent compaction and densification hardening.',
  '以下强度为 Cauchy 应力除以 E。参数用于新建部件；塑性体积变化会保留。':'Strengths below are Cauchy stress divided by E. Parameters apply to new parts; plastic volume changes are retained.',
  '黏聚截距 k/E':'Cohesion intercept k/E','压力系数 qφ':'Pressure slope qφ','剪胀系数 qψ':'Dilation slope qψ','拉伸上限 σt/E':'Tension cutoff σt/E','泡沫屈服形状 α':'Foam yield shape α','初始平台强度 σp/E':'Initial plateau stress σp/E','线性压密系数 γ/E':'Linear densification γ/E','非线性压密系数 α₂/E':'Nonlinear densification α₂/E','压密指数 β':'Densification exponent β','压密应变 εD':'Densification strain εD',
  '参数无效：qψ ≤ qφ，且 qφ × σt/E ≤ k/E；其余参数须在范围内。':'Invalid parameters: qψ ≤ qφ and qφ × σt/E ≤ k/E. All values must be within range.',
  '恢复岩土与泡沫参数':'Reset soil & foam parameters',
  '拉应力为正；qψ 控制非关联剪胀。拉伸截断是塑性限制，不会删除粒子或生成裂纹。':'Tension is positive; qψ controls non-associated dilation. The tension cutoff limits plastic stress without deleting particles or creating cracks.',
  '关联塑性流动与压密强化；累积量为功共轭等效塑性应变。保留永久压缩，不包含体积失效、孔隙成核或断裂。':'Associated plastic flow and densification hardening; the accumulated strain is work-conjugate. Retains permanent compaction; excludes volumetric failure, void nucleation and fracture.',
  '棕色：低/高剪胀岩土。玫红色：低/高平台强度泡沫。试样使用 20% 随机扰动；下压压板，对比剪胀和永久压密。':'Brown: low/high dilation soil. Magenta: low/high plateau stress foam. Samples use 20% position noise. Lower the platen to compare dilation and permanent compaction.',
  '生成时添加随机扰动':'Randomize particle positions on creation','扰动强度（占粒子间距）':'Noise amplitude (fraction of spacing)','随机种子':'Random seed','换一组随机分布':'Choose another random seed',
  '仅在新建时扰动位置，精确建模和拖绘共用此设置。20% 对应最大位移 0.8；不改变粒子数量与质量。同一种子可复现分布，关闭或设为 0 恢复规则点阵。已有粒子与预设场景不会自动改变。':'Applies once on creation, to both parametric and drawn geometry. At 20%, maximum displacement is 0.8. Count and mass stay unchanged. The same seed reproduces the layout; disable or set to 0 for a regular lattice. Existing particles and scene presets are unchanged.',
  '金属塑性压缩':'Metal plasticity compression','四种新本构':'Four new constitutive models',
  '理想弹塑性':'Perfect plasticity','理想塑性':'Perfect plasticity','线性强化':'Linear hardening','简化 Johnson–Cook':'Simplified Johnson–Cook','简化 JC':'Simplified JC',
  '珊瑚色':'Coral','橙色':'Orange','青色':'Cyan','蓝色':'Blue',
  '蓝色 · 达到屈服强度后产生永久形变，屈服强度不随塑性应变增加。':'Blue · Permanent deformation above a constant yield strength.',
  '珊瑚色 · 塑性应变越大，屈服强度越高；卸载保留永久形变。':'Coral · Yield strength grows with plastic strain. Permanent deformation remains after unloading.',
  '橙色 · 加工硬化、应变率强化与温度软化共同决定屈服强度。':'Orange · Yield strength depends on strain hardening, strain rate and thermal softening.',
  '青色 · 保留加工硬化和应变率强化，不含温度软化项。':'Cyan · Strain hardening and rate strengthening, without thermal softening.',
  '强度除以当前杨氏模量 E；不是 Pa。参数只用于新建部件，各部件独立保存。':'Strength is divided by the current Young’s modulus E, not expressed in Pa. Parameters apply to new parts and are stored separately per part.',
  '初始屈服 A/E':'Initial yield A/E','强化系数 B/E（线性模型为 H/E）':'Hardening B/E (linear: H/E)','硬化指数 n':'Hardening exponent n','应变率系数 C':'Rate coefficient C','参考应变率（1/s）':'Reference strain rate (1/s)','参考温度（°C）':'Reference temperature (°C)','软化终点温度（°C）':'Softening endpoint (°C)','热软化指数 m':'Thermal exponent m',
  '恢复本构默认参数':'Reset material parameters','参数无效：请检查数值范围，软化终点必须高于参考温度。':'Invalid parameters: check the ranges. The softening endpoint must exceed the reference temperature.',
  'J2 等容塑性；累积量为等效塑性应变。':'Isochoric J2 plasticity; the accumulated value is equivalent plastic strain.',
  'r 最低为 1。温度来自粒子热场；软化终点只消除剪切屈服强度，不触发熔化。暂不计算塑性耗散生热。':'r is clamped to at least 1. Temperature comes from the particle heat field. The endpoint removes shear yield strength without triggering melting. Plastic heating is not included.',
  'r 最低为 1。简化模型忽略温度软化；仍参与接触传热。':'r is clamped to at least 1. The simplified model ignores thermal softening but still exchanges heat on contact.',
  '蓝：理想塑性；珊瑚：线性强化（20°C）。橙：Johnson–Cook；青：简化模型（均为 650°C）。在载荷目录下降压板，比较屈服、硬化与热软化。':'Blue: perfect plasticity; coral: linear hardening (20°C). Orange: Johnson–Cook; cyan: simplified JC (both 650°C). Lower the platen under Loads to compare yielding, hardening and thermal softening.',
  '创建失败：检查本构或生成参数、计算域、尺寸、粒子容量和部件数（最多 127 个）':'Creation failed. Check material or sampling parameters, domain bounds, dimensions, particle capacity and the 127-part limit.',
  '深海':'Deep sea','浅雾':'Light mist','夜蓝':'Night blue','/步':'/step',
  '外观与语言':'Appearance & language','外观 / 语言':'Appearance','关闭外观设置':'Close appearance settings','面板配色':'Panel palette','画布背景颜色':'Canvas background','界面语言 / Language':'Language','雾白玻璃':'Frosted white','暖砂玻璃':'Warm sand','冰蓝玻璃':'Ice blue','深石墨玻璃':'Graphite','立即生效并自动保存；不会重置当前实验。':'Changes apply and save immediately without resetting the experiment.','恢复默认外观':'Reset appearance',
  '实验台目录':'Workspace index','检索目录':'Search workspace','检索功能…':'Find a control…','清空目录检索':'Clear search','未找到对应功能。试试“重力”“材料”或“CSV”。':'No matching controls. Try gravity, material or CSV.',
  '实验配置':'Experiment','几何与材料':'Geometry & materials','部件与初始条件':'Parts & initial state','载荷与边界':'Loads & boundaries','求解与性能':'Solver & performance','结果与显示':'Results & display','场景 / 计算后端':'Scene / backend','几何 / 本构 / 离散':'Geometry / material / sampling','部件 / 速度 / 固定':'Parts / velocity / constraints','重力 / 压板 / 传热':'Gravity / platen / heat','时间步 / 精度 / 耗时':'Time step / accuracy / timing','时程 / 着色 / 导出':'History / color / export',
  '预设实验':'Scene presets','计算设备':'Compute backend','运行说明':'Runtime notes','材料与本构':'Material & constitutive model','精确几何建模':'Parametric geometry','拖绘体积':'Draw a volume','部件选择与命名':'Select & name parts','平动与转动初速':'Initial linear & angular velocity','固定与释放':'Pin & release','热传导与相变':'Heat transfer & phase change','场量与剖切':'Fields & clipping',
  '收起参数面板':'Hide parameter panel','展开参数面板':'Show parameter panel','收起参数':'Hide panel','展开参数':'Show panel','暂停':'Pause','继续':'Resume','重置场景':'Reset scene','复位视角':'Reset view','打开二维模式 ↗':'Open 2D ↗','实时统计':'Live statistics','三维实验控制':'3D experiment controls','三维粒子实验画布':'3D particle viewport','三维工具':'Viewport tools','实验流程':'Experiment workflow','三维实验':'3D experiment',
  '计算后端（切换会重置场景）':'Backend (switching resets the scene)','浏览器 Worker':'Browser Worker','Taichi 本地服务':'Local Taichi service','重新连接 GPU（重置场景）':'Reconnect GPU (reset scene)','场景':'Scene',
  'PBF 流体星球':'PBF fluid planet','百万 PBF 压力测试':'Million-particle PBF benchmark','软体悬臂 + 水池':'Elastic cantilever + pool','四种本构压缩试验':'Four-model compression','四种本构对比':'Four constitutive models','万粒子材料塔':'Material towers','冷热水相遇':'Hot & cold water','空白三维空间':'Empty 3D space',
  '作用部件':'Target part','全部部件':'All parts','暂无粒子':'No particles','暂无部件数据':'No part data','等待部件数据…':'Waiting for parts…','部件名称':'Part name','输入名称':'Enter a name','重命名所选':'Rename selected','平动速度（单位/s）':'Linear velocity (unit/s)','角速度（rad/s）':'Angular velocity (rad/s)','赋予所选部件速度':'Apply velocity','固定所选':'Pin selected','释放所选':'Release selected',
  '围绕所选部件总质心转动。赋速替换当前速度；固定点保持不动。释放时速度归零。建议暂停后设置初始条件。':'Rotation is about the selected center of mass. Applying velocity replaces current motion; pinned points stay fixed. Releasing clears velocity. Pause before setting initial conditions.',
  '几何形状':'Shape','长方体':'Box','球体 / 椭球':'Sphere / ellipsoid','Y 轴圆柱 / 椭圆柱':'Y-axis cylinder / elliptic cylinder','几何中心':'Geometry center','几何尺寸（直径 / 高度）':'Dimensions (diameter / height)','创建精确几何':'Create geometry','设置名称与初速 ↗':'Set name & initial velocity ↗','进入拖绘模式 ↗':'Draw in viewport ↗',
  '使用本页的材料、本构和温度；名称与平动初速沿用“部件与初始条件”中的输入。粒子间距 4，几何需完全位于计算域内。':'Uses the material, model and temperature on this page, plus the name and linear velocity from Parts & initial state. Particle spacing is 4. The entire shape must fit inside the domain.',
  '求解控制':'Run controls','追加模拟时长（s）':'Additional simulation time (s)','定时求解':'Run for duration','单步推进':'Single step','单次最多推进 1/60 模拟秒；触及子步预算时推进更短，以实际时间为准。':'Advances up to 1/60 simulation second. The substep budget may shorten the actual advance.','稳定时间步系数':'Stable time-step scale','PBF 迭代次数':'PBF iterations','到达目标模拟时间自动暂停。':'Automatically pauses at the target simulation time.','定时求解完成，已自动暂停。':'Timed run completed. Automatically paused.','系数越小、迭代越多，计算越慢。':'Smaller steps and more iterations increase computation time.',
  '部件时程':'Part time history','当前对象：':'Current target: ','曲线跟随当前选中的部件。':'The plot follows the selected part.','选择作用部件 ↗':'Select target part ↗','曲线变量':'Plot variable','最大位移':'Maximum displacement','最大速度':'Maximum speed','动能（模拟单位）':'Kinetic energy (simulation units)','最大相对应力':'Maximum relative stress','最大塑性历史':'Maximum plastic history','最小采样间隔（模拟 s）':'Minimum sample interval (simulation s)','所选部件时程曲线':'Selected part time history','清空曲线':'Clear history','导出 CSV':'Export CSV',
  '记录实际收到的模拟时刻，最多保留 2,000 点。统计覆盖全部物理粒子；位移相对于创建位置，动能不含弹性能。切换部件或重置场景会清空曲线。':'Records actual received simulation times, retaining up to 2,000 samples. Statistics include all simulated particles. Displacement is relative to creation; kinetic energy excludes elastic energy. Changing the part or resetting clears the plot.',
  '重力场':'Gravity field','重力模式':'Gravity mode','跟随场景默认':'Scene default','无重力':'No gravity','定向重力':'Uniform gravity','粒子自引力':'Particle self-gravity','中心吸引':'Central attraction','中心排斥':'Central repulsion','重力强度':'Gravity strength','重力方向':'Gravity direction','向下':'Down','向上':'Up','向左':'Left','向右':'Right','向前':'Forward','向后':'Backward','力场中心（世界坐标）':'Field center (world coordinates)','力场中心':'Field center','中心归零':'Center at origin','软化半径':'Softening radius','恢复场景默认重力':'Restore scene gravity',
  '不施加重力；现有速度、接触和边界仍然生效。':'Gravity is disabled. Existing motion, contact and boundaries remain active.','沿选定方向施加恒定加速度。1× 为 24 模拟单位；蒸汽保留反向浮升。':'Constant acceleration in the chosen direction. 1× is 24 simulation units; vapor retains opposite buoyancy.','按全部粒子的质量分布计算三维自引力。1× 为 G=2；百万粒子开启后耗时会增加。':'3D self-gravity uses the mass of every particle. 1× means G=2. Enabling it at one million particles increases computation time.','向指定中心吸引，随距离减弱。十字标记为中心；软化半径越大，近处作用越温和。':'Attraction toward the crosshair decreases with distance. Larger softening reduces the force near the center.','从指定中心向外排斥，随距离减弱。十字标记为中心；这是外加力场。':'Repulsion from the crosshair decreases with distance. This is an externally prescribed field.','当前强度为 0，重力已关闭。':'Strength is zero; gravity is disabled.',
  '压缩试验台':'Compression platen','启用水平压板':'Enable horizontal platen','下压':'Compress','抬起':'Raise','保持位置':'Hold position','目标高度':'Target height','移动速度':'Travel speed','压板未启用':'Platen disabled','压板反力与位移曲线':'Platen force versus displacement',
  '压板覆盖整个容器，灰线为当前位置，暗金线为目标。暂停时只设定目标，继续后移动；反力采用模拟单位，非工程标定值。':'The platen spans the container. Gray shows its position; gold marks its target. When paused, only the target changes. Forces use uncalibrated simulation units.',
  '压板仅适用于容器实验；星球和百万粒子场景中不显示压板控制。':'The platen is available in container experiments. Its controls are hidden for planet and million-particle scenes.',
  '力学着色':'Mechanical coloring','材料颜色':'Material colors','相对应力 · σeq / E':'Relative stress · σeq / E','累积塑性应变':'Accumulated plastic strain','色阶上限':'Color scale maximum','性能面板':'Performance','等待首个物理步…':'Waiting for the first physics step…',
  '旋转视角':'Orbit','创建体积':'Draw','拖拽形变':'Deform','删除':'Erase','加热':'Heat','冷却':'Cool','固定':'Pin','释放':'Release',
  '拖动旋转，滚轮缩放；右键始终旋转视角。':'Drag to orbit; scroll to zoom. Right-drag always orbits.','在选定平面拖出矩形，松手生成有厚度的三维物体。':'Drag a rectangle on the selected plane; release to create a volume.','点住物体表面拖动；弹性材料回弹，塑性材料保留部分形变。':'Drag a surface. Elastic materials recover; plastic materials retain deformation.','在物体表面拖动，删除拾取位置附近的粒子。':'Drag across a surface to erase nearby particles.','按住物体表面加热；温度着色可观察热量传播。':'Hold on a surface to heat it. Temperature coloring reveals heat transfer.','按住物体表面冷却；水降温并释放潜热后凝固成冰。':'Hold to cool. Water freezes after cooling and releasing latent heat.','点击物体表面，固定附近粒子。金色外圈表示已固定。':'Click a surface to pin nearby particles. Gold rings mark pinned points.','点击固定位置，释放附近粒子。':'Click a pinned area to release nearby particles.',
  '创建材料':'Material for new particles','MPM 材料 · 可选本构':'MPM solid · selectable model','水 · PBF 流体':'Water · PBF fluid','冰 · MPM 固体':'Ice · MPM solid','熔岩 · PBF 流体':'Lava · PBF fluid','固体本构（新建 MPM 材料）':'Constitutive model (new MPM solids)','共旋转弹性':'Corotated elasticity','Neo-Hookean 超弹性':'Neo-Hookean hyperelasticity','雪 · 弹塑性':'Snow · elastoplastic','砂 · Drucker–Prager':'Sand · Drucker–Prager','紫色':'Purple','绿色':'Green','白色':'White','金色':'Gold',
  '紫色 · 形变后回弹，适合软体与悬臂。':'Purple · elastic recovery, suitable for soft bodies and cantilevers.','绿色 · 非线性大形变弹性，适合橡胶状物体。':'Green · nonlinear large-deformation elasticity for rubber-like bodies.','白色 · 超过屈服后留下永久形变，压实后硬化。':'White · permanent strain beyond yield, with compaction hardening.','金色 · 无抗拉强度，受压摩擦承载，可塌落堆积。':'Gold · no tensile strength; frictional compression allows collapse and piling.','冰使用共旋转弹性，融化后切换 PBF。':'Ice uses corotated elasticity and switches to PBF when melted.','流体使用 PBF，不使用固体本构。':'Fluids use PBF, without a solid constitutive model.',
  '压缩屈服应变':'Compressive yield strain','内摩擦角':'Internal friction angle','绘制平面':'Drawing plane','XY 平面':'XY plane','XZ 平面':'XZ plane','YZ 平面':'YZ plane','初始温度 °C':'Initial temperature °C','平面位置':'Plane position','体积厚度':'Volume depth','创建时固定 X 最小面':'Pin minimum-X face on creation','固体刚度':'Solid stiffness','接触传热与相变':'Contact heat transfer & phase change','温度着色':'Temperature coloring','温度色阶上限':'Temperature scale maximum','剖切观察（隐藏 Z 更大的一侧）':'Clip view (hide points above Z)','剖切位置':'Clip Z position',
  '刚度系数作用于整个场景；材料、本构和初始温度用于新建粒子。':'The stiffness scale affects the whole scene. Material, model and initial temperature apply to newly created particles.',
  'GPU 上限 1,000,000；CPU 上限 20,000。超过 100,000 时抽样预览，全部粒子仍参与物理。GPU 需运行项目中的 start-gpu.ps1；当前本地服务一次接入一个 GPU 页面。物理耗时与画面 FPS 分开显示。十二种固体本构共享基础热物性；雪与砂为本构演示，冰可融化成水。':'GPU capacity: 1,000,000; CPU: 20,000. Above 100,000, preview rendering is sampled but every particle is simulated. Run start-gpu.ps1 for GPU mode; one GPU page can connect at a time. Physics time is separate from rendering FPS. The twelve solid models share basic thermal properties; snow and sand demonstrate constitutive behavior, and ice can melt into water.',
  '20,000 个 PBF 水粒子 · 三维自引力 · 无地板。可拖动表面、剖切或关闭自引力。':'20,000 PBF water particles with 3D self-gravity and no floor. Drag the surface, clip the view or disable self-gravity.','1,000,000 个 PBF 粒子实际求解；预览其中 100,000 个。默认无引力；可在重力场面板修改。计算速度取决于显卡。':'All 1,000,000 PBF particles are simulated; 100,000 are rendered. Gravity is off by default and can be changed in Gravity field. Speed depends on the GPU.',
  '固体着色；流体显示灰色。超过上限显示红色。':'Solids are colored; fluids appear gray. Values above the maximum are red.','（von Mises，不含静水压）':'(von Mises; excludes hydrostatic pressure)','右键旋转 / 滚轮缩放 / 空格暂停':'Right-drag: orbit / Scroll: zoom / Space: pause',
  '部件已生成，可在部件面板设置初始条件':'Part created. Set initial conditions in the Parts section.','创建失败：检查计算域、尺寸、粒子容量和部件数（最多 127 个）':'Creation failed. Check domain bounds, dimensions, particle capacity and the 127-part limit.','操作已生效':'Applied','操作未执行，请检查所选部件、参数或暂停状态':'Not applied. Check the target part, parameters or paused state.','目标已设定，继续模拟后压板开始移动':'Target set. Resume to move the platen.','请输入范围内的三个有限数值':'Enter three finite values within the allowed range.','各方向尺寸至少为 4':'Each dimension must be at least 4.','模拟时长需大于 0 且不超过 600 秒':'Duration must be greater than 0 and at most 600 seconds.','视线接近平面边缘，请旋转视角后再绘制':'Rotate the view before drawing on this edge-on plane.','请点在可见物体表面':'Click a visible surface.','请先继续模拟，再拖拽变形':'Resume the simulation before dragging.',
  '无法连接 Taichi 服务。请运行 start-gpu.ps1，等待 GPU READY 后重新连接。CPU 模式仍可用。':'Cannot connect to Taichi. Run start-gpu.ps1 and reconnect after GPU READY. CPU mode remains available.','Taichi 服务连接已断开，模拟已停止。可重新连接或切换 CPU。':'Taichi disconnected; simulation stopped. Reconnect or switch to CPU.','Taichi 服务尚未就绪，请等待 GPU READY 后重新连接。':'Taichi is not ready. Reconnect after GPU READY.',
  '正在连接本机 Taichi GPU 服务…':'Connecting to local Taichi GPU…','正在连接本机 Taichi 服务…':'Connecting to local Taichi…','正在启动计算后端…':'Starting compute backend…','正在连接求解器…':'Connecting to solver…','等待计算后端…':'Waiting for backend…','GPU 连接已停止':'GPU connection stopped','图形连接中断，请刷新三维页面。':'Graphics connection lost. Reload the 3D page.',
  // Fragments used by numerical readouts and runtime diagnostics.
  '已暂停 · 以下为上一步':'Paused · last step shown','（计时含 GPU 同步）':'(includes GPU synchronization)','本构 / 稳定步长':'Constitutive / stable step','传递 / 塑性返回':'Transfer / plastic projection','本构 / 塑性':'Constitutive / plasticity','粒子 ↔ 网格':'Particles ↔ grid','网格 / 压板':'Grid / platen','流体 / 接触':'Fluid / contact','传热计算':'Heat transfer','力学诊断':'Stress diagnostics','其余物理':'Other physics','物理合计':'Physics total','回读 / 打包':'Readback / packing','快照打包':'Snapshot packing','模拟速度':'Simulation speed','为实时':'is real time','实际高度':'Actual height','接触反力':'Contact force','最大 σeq/E':'Max σeq/E','累积塑性':'Accumulated plasticity','相对应力':'Relative stress','（最近 300 步）':'(last 300 steps)','反力':'Force','位移':'Displacement','已暂停':'Paused','暂停中':'Paused','连续求解':'Continuous run','目标':'Target','当前':'Current','质心':'Center of mass','模拟中':'Running','MPM 固体':'MPM solids','流体 / 气体':'Fluid / gas','弹性':'Elastic','超弹':'Hyperelastic','雪':'Snow','砂':'Sand','重力：':'Gravity: ','定向':'Uniform','关闭':'Off','预览':'Preview','全量计算':'All simulated','自引力':'Self-gravity','总质量':'Total mass','总焓':'Total enthalpy','传热':'Heat','物理':'Physics','渲染':'Rendering','求解':'solve','子步':'substeps','粒子':'particles',' 点':' samples','三维模拟启动失败：':'3D startup failed: ','GPU 连接失败：':'GPU connection failed: ','无法读取 GPU 帧：':'Cannot read GPU frame: ','无效帧头':'Invalid frame header','无效粒子帧':'Invalid particle frame',
};
const keys=Object.keys(messages).sort((a,b)=>b.length-a.length);
const pattern=new RegExp(keys.map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');
export function translateText(text){return text.replace(pattern,match=>messages[match]);}

export function installLocale(initial='zh'){
  let language='zh';const texts=new WeakMap(),attributes=new WeakMap();
  const skip=e=>e?.closest('script,style,[data-user-content],#part-select3 option:not([value="-1"])');
  function text(node){
    if(!node.parentElement||skip(node.parentElement))return;
    let state=texts.get(node);if(!state||node.data!==state.output)state={source:node.data,output:node.data};
    const output=language==='en'?translateText(state.source):state.source;
    if(node.data!==output)node.data=output;state.output=output;texts.set(node,state);
  }
  function attrs(element){
    if(skip(element))return;let record=attributes.get(element);if(!record){record={};attributes.set(element,record);}
    for(const attr of ['aria-label','placeholder','title'])if(element.hasAttribute(attr)){
      const current=element.getAttribute(attr);let state=record[attr];if(!state||current!==state.output)state={source:current,output:current};
      const output=language==='en'?translateText(state.source):state.source;
      if(current!==output)element.setAttribute(attr,output);state.output=output;record[attr]=state;
    }
  }
  function visit(node){
    if(!node.isConnected)return;
    if(node.nodeType===Node.TEXT_NODE){text(node);return;}
    if(node.nodeType!==Node.ELEMENT_NODE||skip(node))return;
    attrs(node);for(const child of node.childNodes)visit(child);
  }
  const options={subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','placeholder','title']};
  const observer=new MutationObserver(records=>{
    observer.disconnect();
    for(const record of records){
      if(record.type==='childList'){for(const node of record.addedNodes)visit(node);}
      else if(record.type==='attributes')attrs(record.target);
      else text(record.target);
    }
    observer.observe(document.body,options);
  });
  function setLanguage(value){
    const next=value==='en'?'en':'zh';if(next===language&&document.documentElement.lang===next)return;
    observer.disconnect();language=next;document.documentElement.lang=language;visit(document.body);observer.observe(document.body,options);
    window.dispatchEvent(new Event('workbench-languagechange'));
  }
  observer.observe(document.body,options);setLanguage(initial);
  return {setLanguage};
}
