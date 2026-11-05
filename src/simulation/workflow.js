import {mountThermalPanels} from './thermal-ui.js';
import {mountContactPanels} from './contact-ui.js';
import {mountFEMPanels} from '../fem/ui.js';
// A workflow chapter is a view of the active study, never a solver switch.
import {mountCurvePanels} from './curve-ui.js';
import {mountReferencePanels} from './reference-ui.js';
import {mountAttachmentPanels} from './attachment-ui.js';
import {mountValidationPanels} from './validation-ui.js';
import {mountUnifiedPanels} from './unified-ui.js';
export const CHAPTERS = [
  ['setup','00','实验配置','EXPERIMENT','项目 / 算例 / 计算设备','项目 场景 后端 CPU GPU 星球 百万 保存 JSON'],
  ['geometry','01','几何与材料','MODELING','四类部件 / 几何 / 材料','计算域 网格 每格 粒子数 坐标 尺寸 旋转 创建 刚体 MPM FEM PBF 本构 温度'],
  ['parts','02','部件与初始条件','INITIAL STATE','统一部件 / 初速 / 初温','部件 命名 初速 平动 转动 固定 释放 比热容'],
  ['loads','03','载荷与边界','BOUNDARIES','载荷 / 连接 / 接触 / 热源','重力 自引力 压板 压缩 热交换 相变 运动副 铰链 弹簧 阻尼 电机 力矩 加热 降温'],
  ['solver','04','求解与性能','SOLVER','时间步 / 迭代 / 耦合','定时 单步 暂停 求解 PBF MPM 多体 FEM 迭代 性能'],
  ['results','05','结果与显示','ANALYSIS','场量 / 时程 / 回放 / 导出','曲线 CSV 导出 应力 塑性 位移 动能 剖切 温度 着色 回放'],
];

export function mountProjectWorkflow(sections) {
  const $ = id => document.getElementById(id);
  function folder(chapter, id, title) {
    const d = document.createElement('details'); d.id = id; d.className = 'instrument';
    const s = document.createElement('summary'); s.textContent = title; d.append(s);
    d.dataset.study = 'project'; sections.get(chapter).append(d); return d;
  }
  function mount(id, chapter, title) {
    const d = $(id); if (title) d.querySelector('summary').textContent = title;
    d.dataset.study = 'project'; sections.get(chapter).append(d); return d;
  }
  function range(first, last, target) {
    let node = first; while (node) {const next = node.nextSibling; target.append(node); if (node === last) break; node = next;}
  }
  const label = id => document.querySelector(`label[for="${id}"]`);
  const vectorStart = id => $(id+'0').closest('.gravity-coordinates').previousElementSibling;
  // Existing particle tools remain available through their backend adapter;
  // never show controls for a different study over the active project's view.
  for (const section of sections.values()) for (const child of section.children) child.dataset.study = 'particles';
  const choice = folder('setup','study-panel','项目与求解方案'); delete choice.dataset.study;
  choice.innerHTML += '<label for="study-kind">求解方案</label><select id="study-kind"><option value="project">统一项目 · 刚体 / MPM / 温度</option><option value="particles">粒子实验 · MPM / PBF · CPU / GPU</option></select><p id="study-description" class="hint"></p><p class="hint">切换目录始终查看同一模型。切换求解方案会暂停并保留当前会话；两种方案之间暂不自动迁移模型。</p>';
  sections.get('setup').prepend(choice);
  const preset = mount('mbd-setup','setup','项目算例');
  const compute=folder('setup','project-compute-panel','项目计算设备');
  compute.innerHTML+='<label for="project-compute">统一项目计算设备</label><select id="project-compute"><option value="cpu-coupled">CPU · 力学 / 温度 / 相变</option><option value="taichi-coupled">Taichi GPU + 刚体 CPU · MPM / PBF</option></select><label for="project-gpu-port">GPU 项目服务端口</label><input id="project-gpu-port" type="number" min="8765" max="8799" step="1" value="8769"><button id="project-compute-apply">切换计算设备并重置</button><p id="project-compute-status" class="hint" role="status"></p><p class="hint">GPU：运行 V11 项目服务并等待 GPU PROJECT READY。MPM / PBF、区域连接和传热在 GPU 求解，刚体动力学在 CPU 求解；最多 16384 粒子。支持在线加热、降温和熔化释放；连接选区暂不支持断裂。机械能诊断使用 CPU。小模型可能由 CPU 求解更快。</p>';
  const gravity = folder('loads','project-gravity-panel','项目重力');
  range(vectorStart('mbd-gravity'),$('mbd-gravity2').closest('.gravity-coordinates'),gravity);
  gravity.innerHTML += '<button id="project-gravity-apply">应用重力并重置</button>';
  const solver = folder('solver','project-solver-panel','统一时间与求解');
  const runControls=folder('solver','project-run-panel','模拟控制与进度');
  runControls.append($('project-run-window'));sections.get('solver').prepend(runControls);
  range(label('mbd-dt'),preset.lastChild,solver);
  mount('mbd-model-panel','setup','项目保存与编辑');
  mount('mbd-body-panel','geometry','刚体几何与质量');
  mount('assembly-panel','geometry','参数化刚体装配');
  mount('mbd-specimen-panel','geometry','粒子几何与本构 · MPM / PBF');
  const domain = folder('geometry','project-domain-panel','计算域与 MPM 离散');
  range(vectorStart('coupling-lower'),$('coupling-stiffness'),domain);
  domain.append($('coupling-grid-info'));
  domain.innerHTML += '<button id="project-domain-apply">应用网格设置并重置</button>';
  const contact = mount('mbd-coupling-panel','loads','多物理场接触与传热');
  // Move enablement to solver; contact coefficients stay in Loads/Boundaries.
  solver.querySelector('summary').after($('coupling-enabled').parentElement);
  mount('mbd-joint-panel','loads','连接、约束与驱动');
  const forces = mount('mbd-load-panel','loads','刚体外载荷与接触参数');
  const initial = folder('parts','project-initial-panel','部件初始状态');
  initial.innerHTML += '<p class="hint">先在统一部件列表中选择对象，再读取或修改初始条件。模型编辑会重置求解和时程。</p><label for="project-part-name">部件名称</label><input id="project-part-name" type="text"><label for="project-initial-temperature">初始温度（°C）</label><input id="project-initial-temperature" type="number" step="any">';
  range(vectorStart('mbd-velocity'),$('mbd-angular2').closest('.gravity-coordinates'),initial);
  initial.innerHTML += '<div id="project-thermal-properties"><label for="project-part-cp">比热容（J/kg/K）</label><input id="project-part-cp" type="number" min="1" step="any"><label for="project-part-k">导热率（W/m/K）</label><input id="project-part-k" type="number" min="0" step="any"></div>';
  initial.innerHTML += '<button id="project-initial-read">读取初始状态</button><button id="project-initial-apply">应用初始状态并重置</button>';
  mount('mbd-body-thermal-panel','geometry','刚体热材料');
  mount('mbd-heater-panel','loads','热源与降温');
  const tree = folder('parts','project-parts-panel','统一部件列表');
  tree.innerHTML += '<label for="project-part-select">项目部件</label><select id="project-part-select"></select><p id="project-part-info" class="hint" role="status"></p><div class="buttons"><button id="project-edit-geometry">编辑几何与材料</button><button id="project-edit-initial">编辑初始状态</button></div><button id="project-part-remove">删除部件及关联连接、载荷</button><p class="hint">刚体、MPM、PBF、FEM 共用部件 ID。FEM 可加入 CPU 多方法耦合，也保留独立静力和瞬态分析。</p>';
  sections.get('parts').prepend(tree);
  mount('mbd-results-panel','results','统一结果与回放');
  const extension = folder('solver','project-capabilities-panel','可用求解能力');
  extension.innerHTML += '<p class="hint">刚体：Rapier 约束与接触。MPM：现有 APIC / MPM 本构。温度：粒子传导与刚体有限热容量。力热耦合使用共同时间轴。</p><p class="hint">FEM：Tet4 线弹性静力 / 瞬态动力学、时间曲线、应力 / 位移云图、振动与能量诊断。球形刚体–FEM 双向接触、压缩阻尼与摩擦。支持 FEM 导热、热膨胀及刚体–FEM 接触换热；MPM 与 FEM 共用部件热载荷定义。MPM–FEM 支持 CPU（最多 16384 粒子）及 Taichi CUDA（最多 50000 弹性或温度相关塑性物质点）；CUDA 的接触与传热使用共同时间轴。CPU 支持 MPM、PBF、FEM 与刚体同时耦合；刚体–FEM 接口支持球、长方体、圆柱与圆盘；PBF–FEM 支持壁面摩擦，FEM–FEM 支持接触与换热。四方法 GPU 已支持每种方法一个部件及球形刚体；具体兼容性由项目校验器检查。</p>';
  for (const [id, text] of Object.entries({'mbd-preset':'项目算例','mbd-dt':'项目时间步','mbd-duration':'追加求解时长（s）','mbd-result-body':'结果部件','mbd-result-field':'曲线变量','mbd-json':'统一项目 JSON'})) label(id).textContent=text;
  for (const [id, text] of Object.entries({'mbd-run':'运行','mbd-step':'单步','mbd-reset':'重置','mbd-fit':'适配视角','mbd-load':'载入项目算例'})) $(id).textContent=text;
  for (const id of ['mbd-velocity','mbd-angular']) {
    const start=vectorStart(id);start.textContent=start.textContent.replace('多体','部件');
    for(let i=0;i<3;i++)$(id+i).setAttribute('aria-label',$(id+i).getAttribute('aria-label').replace('多体','部件'));
  }
  $('mbd-model-panel').querySelector('p').textContent='统一保存部件、几何、材料、连接、载荷、网格和求解设置。兼容导入旧版多体 JSON；校验通过才替换当前项目。';
  preset.querySelector('p').textContent='统一项目保存几何、材料、部件、载荷与结果定义。选择动力学耦合或 FEM 静力 / 振动算例。SI 单位：m、kg、s、°C。';
  $('mbd-model-panel').querySelector('p:last-child').textContent='动力学：最多 64 刚体、128 连接及 16384 粒子。FEM：最多 8 个独立部件、5000 节点、24000 Tet4 单元。';
  contact.querySelector('p').textContent='这里设置未指定部件对的默认接触参数。传热开关同时控制粒子内部导热；显式接触对可独立启用或关闭界面换热。';
  mountReferencePanels(folder);mountAttachmentPanels(folder);mountValidationPanels(folder);mountCurvePanels(folder);mountContactPanels(folder);mountFEMPanels(folder);mountThermalPanels(folder);
  $('study-kind').options[0].textContent='统一项目 · MPM / FEM / 刚体 / PBF';
  mountUnifiedPanels(folder,sections);
  for(const id of ['mbd-body-panel','assembly-panel','mbd-specimen-panel','mbd-body-thermal-panel','fem-geometry'])$(id).dataset.advancedModeling='true';
  return choice;
}

export function applyStudyVisibility(study) {
  const fem=document.body.classList.contains('fem-active'),allowed=new Set(['cad-modeler','unified-start','unified-parts','unified-coupling','mbd-setup','mbd-model-panel','project-parts-panel','fem-geometry','fem-boundary','fem-solver','fem-results','project-capabilities-panel']);
  if(document.body.classList.contains('fem-dynamic'))for(const id of ['project-run-panel','project-thermal-loads','project-thermal-results','project-initial-panel','project-curves-panel','project-load-bindings','project-load-results','fem-dynamic-results','mbd-body-panel','project-contact-pairs','project-contact-results'])allowed.add(id);
  if(document.body.classList.contains('mixed-active'))for(const id of ['mbd-body-panel','mbd-specimen-panel','mbd-coupling-panel','project-domain-panel','project-gravity-panel','fem-mixed-energy','mixed-thermal-material'])allowed.add(id);
  for (const node of document.querySelectorAll('[data-study]')) node.hidden = node.dataset.study !== study||
    (node.dataset.study==='project'&&(fem?!allowed.has(node.id):!!node.dataset.femOnly))||
    (node.dataset.advancedModeling==='true'&&!document.body.classList.contains('modeling-advanced'));
  for (const section of document.querySelectorAll('.archive-chapter')) {
    let order = 0;
    for (const folder of section.querySelectorAll(':scope > details')) if (!folder.hidden) {
      folder.dataset.order = String(++order).padStart(2,'0'); folder.querySelector('summary').dataset.order=folder.dataset.order;
    }
  }
}
