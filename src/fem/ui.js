import {temperatureScale,temperatureExtent} from '../simulation/temperature-display.js';
import {mountMixedMaterial,wireMixedMaterial} from '../mixed/material-ui.js';
import {mountMixedEnergy,wireMixedEnergy,displayMixedEnergy} from '../mixed/ui.js';
import {cantileverProject,dynamicCantileverProject,impactProject,femPart,setPartLoads,FACES} from './model.js';
import {femThermalExample} from '../simulation/part-thermal-example.js';
import {femWorker} from './adapter.js';
import {femRange,femMinimum} from './renderer.js';
import {beamReference,tipDisplacement} from './validation.js';
import {plot as plotSeries} from '../simulation/curve-ui.js';
import {listPartSurfaces} from '../simulation/surface-selections.js';
const $=id=>document.getElementById(id);
const en=()=>document.documentElement.lang==='en';
const text=(zh,eng)=>en()?eng:zh;
const fmt=x=>Number.isFinite(x)?x.toPrecision(5):'—';
const field=(id,label,value)=>`<label for="${id}">${label}</label><input id="${id}" type="number" step="any" value="${value}">`;
const vec=(id,label,v)=>`<label>${label}</label><div class="gravity-coordinates">${['X','Y','Z'].map((a,k)=>`<label>${a}<input id="${id}${k}" aria-label="${label} ${a}" type="number" step="any" value="${v[k]}"></label>`).join('')}</div>`;
const select=(id,label,items)=>`<label for="${id}">${label}</label><select id="${id}">${items.map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select>`;
const get=id=>$(id).valueAsNumber,read=id=>[0,1,2].map(k=>get(id+k)),put=(id,v)=>v.forEach((x,k)=>$(id+k).value=x);
export function mountFEMPanels(folder){
  mountMixedEnergy(folder);
  mountMixedMaterial(folder);
  const geometry=folder('geometry','fem-geometry','FEM 几何、材料与网格');
  geometry.innerHTML+=`<div class="buttons"><button id="fem-example">载入 FEM 悬臂梁算例</button><button id="fem-dynamic-example">载入弯曲后释放算例</button><button id="fem-impact-example">载入小球撞梁算例</button><button id="fem-thermal-example">载入热传导与膨胀算例</button></div><p class="hint">Tet4 · 小变形线弹性 · SI 单位。支持静力、瞬态动力学与球形刚体双向接触；支持导热与热膨胀；CPU 混合算例支持 MPM–FEM 双向接触与换热。</p><fieldset id="fem-edit-fields" style="border:0;padding:0;margin:0">
    <label for="fem-edit-part">FEM 部件</label><select id="fem-edit-part"></select><label for="fem-name">FEM 部件名称</label><input id="fem-name" type="text" value="悬臂梁">
    ${vec('fem-size','FEM 尺寸（m）',[2,.3,.3])}${vec('fem-center','FEM 中心（m）',[1,.8,0])}${vec('fem-rotation','FEM 旋转（度）',[0,0,0])}
    ${field('fem-young','杨氏模量 E（Pa）',2e7)}${field('fem-poisson','泊松比 ν',.3)}${field('fem-density','密度（kg/m³）',1000)}${field('fem-cp','比热容（J/kg/K）',500)}${field('fem-conductivity','导热率（W/m/K）',50)}${field('fem-expansion','线膨胀系数（1/K）',0)}${field('fem-referenceTemperature','无应力参考温度（°C）',20)}
    ${vec('fem-divisions','FEM 每方向划分数',[24,4,4])}<p id="fem-mesh-estimate" class="hint"></p>
    <div class="buttons"><button id="fem-update">应用几何、材料与网格</button><button id="fem-add">添加独立 FEM 部件</button></div><p id="fem-mesh-info" class="hint" role="status"></p></fieldset>`;
  const boundary=folder('loads','fem-boundary','FEM 面约束与载荷');boundary.dataset.femOnly='true';
  boundary.innerHTML+=`<p class="hint">作用于几何面选择集，重划网格后自动匹配。面名称沿部件局部坐标；力向量沿世界坐标。绿色：固定面，橙色：加载面。</p>
    <label for="fem-load-part">FEM 载荷部件</label><select id="fem-load-part"></select>
    ${select('fem-fixed','固定面（XYZ = 0）',FACES.map(f=>[f,f.toUpperCase()]))}${select('fem-loaded','加载面',FACES.map(f=>[f,f.toUpperCase()]))}
    ${select('fem-load-type','FEM 面载荷类型',[['fem-force','面总力（N）'],['fem-pressure','压力（Pa，正值向内）']])}
    ${vec('fem-force','面总力 · 世界坐标（N）',[0,-100,0])}${field('fem-pressure','压力（Pa）',1000)}${vec('fem-gravity','FEM 重力（m/s²）',[0,0,0])}
    <button id="fem-load-apply">应用面约束与载荷</button><p class="hint">面总力按三角形面积分配；压力沿外法线反向施加。每个独立部件至少固定一个完整面。</p>`;
  const solver=folder('solver','fem-solver','FEM 分析与时间积分');solver.dataset.femOnly='true';
  solver.innerHTML+=`${select('fem-analysis','FEM 分析类型',[['linear-static','线弹性静力'],['linear-dynamic','线弹性瞬态动力学']])}
    <p class="hint">静力使用 PCG；动力学使用集中质量与显式时间积分，自动限制稳定步长。瞬态分析支持导热与热应变，静力分析暂不支持温度场。</p>
    ${field('fem-tolerance','相对残差容差',1e-8)}${field('fem-iterations','FEM 最大迭代次数',4000)}
    <div id="fem-dynamic-settings" hidden><label class="check"><input id="fem-thermal" type="checkbox">启用 FEM 温度场</label>
      <div id="mixed-thermal-settings" hidden>${select('mixed-thermal-mode','MPM–FEM 推进模式',[['coupled','力学与温度耦合'],['fixed-geometry','固定几何传热']])}</div>
      <div id="mixed-device-settings" hidden>${select('mixed-device','统一耦合计算设备',[['cpu','浏览器 CPU'],['gpu','Taichi CUDA · 耦合求解']])}${field('mixed-gpu-port','混合 GPU 服务端口',8795)}<p class="hint">运行 start-mixed-gpu.ps1。GPU 支持一对 MPM–FEM，或 MPM / PBF / FEM / 球形刚体各一个。最多 50000 粒子，仅结果帧回传。四方法首版支持接触和热载荷，暂不支持关节、相变、断裂、完整机械能账本及摩擦转热。</p><label class="check"><input id="mixed-energy-diagnostics" type="checkbox">记录 GPU 机械能收支</label><p class="hint">逐子步增加 GPU 能量归约与中间状态记录，仅结果帧回传；关闭不影响塑性与摩擦生热。应用求解设置会重置试验与账本基线。此开关用于 GPU，CPU 混合求解沿用其能量观察器。</p></div>
      ${field('fem-dt','最大物理步长（s）',.0002)}${field('fem-output-interval','结果输出间隔（s）',.01)}${field('fem-safety','稳定步长安全系数',.8)}${field('fem-damping','质量比例阻尼 α（1/s）',.5)}
      ${select('fem-initial-state','FEM 初始变形',[['rest','未变形'],['equilibrium','基准面载荷的静力平衡']])}
      <p class="hint">预载平衡由基准面载荷和重力计算；从 t = 0 起使用时间曲线。C = αM；α = 0 时关闭阻尼。固定面初速度始终为零。</p>
    </div>
    <button id="fem-settings">应用 FEM 求解设置并重置</button>
    <p class="hint">切回静力分析会移除时间曲线及绑定，并清零初速度；保留基准面载荷。</p>
    <div id="fem-static-actions" class="buttons"><button id="fem-solve">求解静力平衡</button><button id="fem-cancel" disabled>取消静力求解</button></div>
    <div id="fem-dynamic-actions" hidden>${field('fem-duration','FEM 追加求解时长（s）',2)}<div class="buttons"><button id="fem-run">运行动力学</button><button id="fem-pause">暂停</button><button id="fem-step">单步推进</button></div><button id="fem-validate-dynamic">验证振动与能量</button></div>
    <p id="fem-status" class="hint" role="status"></p><button id="fem-validate">运行三档网格验证</button><p class="hint">验证独立运行，不替换当前项目。对照悬臂梁理论挠度，并检查支反力、力矩及残差。</p>`;
  const results=folder('results','fem-results','FEM 场量与平衡检查');results.dataset.femOnly='true';
  const dynamics=folder('results','fem-dynamic-results','FEM 振动与能量');dynamics.dataset.femOnly='true';
  dynamics.innerHTML+=`<p class="hint">位移与速度取所选部件第一个加载面的面积平均；能量曲线统计整个 FEM 项目。曲线与导出使用真实位移。</p>
    <p id="fem-dynamic-readout" class="hint" role="status" style="white-space:pre-line"></p>
    <label for="fem-response-axis">响应方向</label><select id="fem-response-axis"><option value="0">X</option><option value="1" selected>Y</option><option value="2">Z</option></select>
    <canvas id="fem-displacement-chart" aria-label="FEM 端面位移时程"></canvas><canvas id="fem-velocity-chart" aria-label="FEM 端面速度时程"></canvas>
    <p class="hint">青：总动能 · 橙：应变能 · 绿：接触储能 · 紫：总耗散 · 灰：外力做功</p><canvas id="fem-energy-chart" aria-label="FEM 能量时程"></canvas>
    <p id="fem-energy-note" class="hint">能量残差 = 刚体与 FEM 动能 + 应变能 + 接触储能 + 总耗散 − 初始能量 − 外力做功 − 热应变做功。总耗散包含 FEM 阻尼、接触压缩阻尼与摩擦。支持回放；三维帧数据预算 64 MiB，标量曲线继续保留。</p>
    <button id="fem-history-csv">导出 FEM 动态时程 CSV</button><p id="fem-dynamic-validation" class="hint" role="status" style="white-space:pre-line"></p><button id="fem-dynamic-report">导出动态验证报告</button>`;
  results.innerHTML+=`<label for="fem-result-part">FEM 结果部件</label><select id="fem-result-part"></select>
    ${select('fem-field','FEM 云图',[['displacement','位移大小（m）'],['vonMises','单元 von Mises 应力（Pa）'],['strain','单元应变张量范数'],['temperature','节点温度（°C）']])}
    <div id="fem-temperature-display" hidden>
      ${select('fem-temperature-mode','温度色标',[['global','全模型统一温度'],['fem','FEM 局部温差（自动放大）'],['manual','固定温度范围']])}
      <div id="fem-temperature-manual" hidden>${field('fem-temperature-min','色标下限（°C）',20)}${field('fem-temperature-max','色标上限（°C）',160)}</div>
      <p id="fem-temperature-note" class="hint" role="status"></p>
    </div>
    ${field('fem-scale','变形显示倍率',5)}<p id="fem-contact-scale" class="hint" hidden>接触耦合使用 1× 真实变形显示；毫米级响应请查看位移云图和时程。</p><label class="check"><input id="fem-wire" type="checkbox" checked>显示表面网格</label><label class="check"><input id="fem-original" type="checkbox" checked>叠加未变形网格</label>
    <div style="height:8px;background:linear-gradient(90deg,#1f4dd9,#40db99,#ff3b14);margin-top:12px"></div><p id="fem-legend" class="hint"></p>
    <p id="fem-readout" class="hint" role="status" style="white-space:pre-line"></p><p class="hint">应力与应变为 Tet4 单元常值，未做节点平滑。显示倍率不改变计算结果；固定端应力峰值对网格敏感。</p>
    <canvas id="fem-convergence" aria-label="FEM residual convergence" style="width:100%;height:130px"></canvas>
    <div class="buttons"><button id="fem-nodes-csv">导出节点 CSV</button><button id="fem-elements-csv">导出单元 CSV</button></div>
    <p id="fem-validation-report" class="hint" role="status" style="white-space:pre-line"></p><button id="fem-validation-json">导出 FEM 验证报告</button>`;
}
export function wireFEM({getProject,load,guard,getFrame,getView,solve,cancel,download,reveal,run,pause,step,getHistory}){
  wireMixedEnergy(getFrame,getHistory,download,guard);
  const mixedMaterial=wireMixedMaterial({getProject,load,guard,getFrame,getHistory,download});
  let report=null,validator=null,dynamicReport=null,lastFrame=null,lastKey='';
  const options=(id,parts)=>{const old=$(id).value;$(id).replaceChildren(...parts.map(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name;o.dataset.userContent='';return o;}));if(parts.some(p=>p.id===old))$(id).value=old;};
  const part=id=>getProject().parts.find(p=>p.id===$(id).value&&p.method==='fem');
  function estimate(){
    const mesh=part('fem-edit-part')?.discretization?.mesh;
    if(mesh){$('fem-mesh-estimate').textContent=text(`CAD Tet4：${mesh.nodes.length} 节点 / ${mesh.elements.length} 单元。请在 CAD 网格工具中重划网格。`,`CAD Tet4: ${mesh.nodes.length} nodes / ${mesh.elements.length} elements. Remesh in CAD tools.`);return;}
    const n=read('fem-divisions'),size=read('fem-size');
    $('fem-mesh-estimate').textContent=`${text('预计节点 / 单元','Estimated nodes / elements')}: ${n.reduce((s,x)=>s*(x+1),1)} / ${6*n.reduce((s,x)=>s*x,1)}\nh = ${size.map((x,k)=>fmt(x/n[k])).join(' × ')} m\n${text('上限：5000 节点 / 24000 单元（全部部件合计）','Limit: 5000 nodes / 24000 elements (all parts)')}`;
  }
  function fill(){
    const p=part('fem-edit-part');if(!p)return;$('fem-name').value=p.name;
    for(const key of ['size','center','rotation'])put('fem-'+key,p.geometry[key]);put('fem-divisions',p.discretization.divisions??[1,1,1]);
    for(let k=0;k<3;k++)$('fem-divisions'+k).disabled=p.geometry.shape==='cad';
    $('fem-add').disabled=p.geometry.shape==='cad';
    for(const key of ['young','poisson','density','cp','conductivity','expansion','referenceTemperature'])$('fem-'+key).value=p.material[key];estimate();
  }
  function fillLoads(){
    const p=getProject(),b=part('fem-load-part');if(!b)return;
    const named=p.loads.some(l=>l.target===b.id&&l.type.startsWith('fem-')&&p.selectionSets.find(s=>s.id===l.selection)?.region.type==='surface');
    $('fem-load-apply').disabled=named;
    $('fem-load-apply').textContent=named?text('请在“命名面与载荷”编辑','Edit in Named surfaces and loads'):text('应用载荷并重置','Apply loads and reset');
    const ls=p.loads.filter(l=>l.target===b.id);
    const fixed=ls.find(l=>l.type==='fem-fixed'),f=ls.find(l=>l.type==='fem-force'||l.type==='fem-pressure');
    for(const [id,load] of [['fem-fixed',fixed],['fem-loaded',f]]){
      const set=p.selectionSets.find(s=>s.id===load?.selection),r=set?.region,items=FACES.map(face=>({id:face,name:face.toUpperCase()}));
      if(r?.type==='surface')items.push({id:r.surface,name:listPartSurfaces(b).find(d=>d.key===r.surface)?.label??set.name});
      if(!set)items.unshift({id:'',name:text('未定义','Not defined')});
      options(id,items);$(id).value=r?.type==='surface'?r.surface:r?.face??'';$(id).disabled=named;
    }
    $('fem-load-type').value=f?.type??'fem-force';
    put('fem-force',f?.force??[0,-100,0]);$('fem-pressure').value=f?.pressure??1000;put('fem-gravity',p.environment.gravity);
  }
  function refresh(){
    mixedMaterial.refresh();
    const p=getProject(),active=p.solver.adapter.startsWith('cpu-fem-'),dynamic=p.solver.analysis==='linear-dynamic';
    $('fem-edit-fields').disabled=!active;
    for(const id of ['fem-edit-part','fem-load-part','fem-result-part'])options(id,p.parts.filter(p=>p.method==='fem'));
    fill();fillLoads();if(active){
      $('fem-analysis').value=p.solver.analysis;$('fem-thermal').checked=p.solver.thermal===true;$('fem-tolerance').value=p.solver.tolerance;$('fem-iterations').value=p.solver.maxIterations;
      $('fem-dt').value=p.solver.dt;$('fem-output-interval').value=p.solver.outputInterval??(p.solver.computeBackend==='gpu'?.01:p.solver.thermalMode==='fixed-geometry'?.1:1/60);$('fem-safety').value=p.solver.safety??.8;$('fem-damping').value=p.solver.damping??.5;
      $('fem-initial-state').value=p.solver.initialState??'rest';$('fem-duration').value=p.solver.duration??2;
      $('fem-status').textContent=text('网格就绪。','Mesh ready.');
    }
    $('mixed-thermal-settings').hidden=p.solver.adapter!=='cpu-fem-mpm';$('mixed-thermal-mode').value=p.solver.thermalMode??'coupled';
    $('mixed-device-settings').hidden=p.solver.adapter!=='cpu-fem-mpm';$('mixed-device').value=p.solver.computeBackend??'cpu';$('mixed-gpu-port').value=p.solver.mixedGpuPort??8795;
    $('mixed-energy-diagnostics').checked=p.solver.diagnostics===true;deviceDiagnostics();
    $('fem-run').textContent=p.solver.thermalMode==='fixed-geometry'?text('运行传热','Run heat transfer'):text('运行动力学','Run dynamics');
    $('fem-field').querySelector('option[value=temperature]').disabled=!dynamic;if(!dynamic&&$('fem-field').value==='temperature')$('fem-field').value='displacement';$('fem-dynamic-settings').hidden=!dynamic;$('fem-dynamic-actions').hidden=!dynamic;$('fem-static-actions').hidden=dynamic;
    const coupled=active&&p.parts.some(b=>b.method!=='fem');
    $('fem-scale').value=coupled?1:dynamic?20:5;$('fem-scale').disabled=coupled;$('fem-contact-scale').hidden=!coupled;
    $('fem-energy-note').hidden=p.solver.adapter==='cpu-fem-mpm';
    lastFrame=null;lastKey='';if(active)display(getFrame());
  }
  $('fem-example').onclick=guard(async()=>{await load(cantileverProject());reveal('geometry','fem-geometry');});
  $('fem-dynamic-example').onclick=guard(async()=>{await load(dynamicCantileverProject());reveal('solver','fem-solver');});
  $('fem-thermal-example').onclick=guard(async()=>{await load(femThermalExample());reveal('loads','project-thermal-loads');});
  $('fem-impact-example').onclick=guard(async()=>{await load(impactProject());reveal('loads','project-contact-pairs');});
  $('fem-analysis').onchange=()=>{$('fem-dynamic-settings').hidden=$('fem-analysis').value!=='linear-dynamic';};
  function deviceDiagnostics(){const four=getProject().parts.some(b=>b.method==='pbf'||b.method==='rigid');$('mixed-energy-diagnostics').disabled=four||$('mixed-device').value!=='gpu';if(four)$('mixed-energy-diagnostics').checked=false;}
  $('mixed-device').onchange=deviceDiagnostics;
  $('fem-edit-part').onchange=fill;$('fem-load-part').onchange=fillLoads;
  for(const id of ['fem-divisions','fem-size'])for(let i=0;i<3;i++)$(id+i).addEventListener('input',estimate);
  function geometry(id){return femPart(id,{name:$('fem-name').value,size:read('fem-size'),center:read('fem-center'),rotation:read('fem-rotation'),divisions:read('fem-divisions'),young:get('fem-young'),poisson:get('fem-poisson'),density:get('fem-density'),cp:get('fem-cp'),conductivity:get('fem-conductivity'),expansion:get('fem-expansion'),referenceTemperature:get('fem-referenceTemperature')});}
  $('fem-update').onclick=guard(()=>{const p=getProject(),b=part('fem-edit-part');if(!b)throw Error('请先选择 FEM 部件');const next=geometry(b.id);next.initial=b.initial;next.boundary=b.boundary;if(b.modeling)next.modeling=structuredClone(b.modeling);if(b.geometry.shape==='cad'){next.geometry.shape='cad';next.geometry.cad=b.geometry.cad;next.discretization=b.discretization;}p.parts[p.parts.findIndex(b=>b.id===next.id)]=next;return load(p);});
  $('fem-add').onclick=guard(async()=>{const p=getProject();if(!p.solver.adapter.startsWith('cpu-fem-'))throw Error('请先载入 FEM 算例');let n=1;while(p.parts.some(b=>b.id==='fem-'+n))n++;const b=geometry('fem-'+n);p.parts.push(b);setPartLoads(p,b);await load(p);$('fem-edit-part').value=b.id;fill();});
  $('fem-load-apply').onclick=guard(()=>{const p=getProject(),b=part('fem-load-part');if(!b)throw Error('请先选择 FEM 部件');
    if(p.loads.some(l=>l.target===b.id&&l.type.startsWith('fem-')&&p.selectionSets.find(s=>s.id===l.selection)?.region.type==='surface'))throw Error('此部件使用命名表面，请在“命名面与载荷”编辑，避免覆盖现有绑定');
    setPartLoads(p,b,{fixed:$('fem-fixed').value,loaded:$('fem-loaded').value,type:$('fem-load-type').value,force:read('fem-force'),pressure:get('fem-pressure')});p.environment.gravity=read('fem-gravity');return load(p);});
  $('fem-settings').onclick=guard(()=>{
    const p=getProject(),dynamic=$('fem-analysis').value==='linear-dynamic';
    if(p.solver.adapter==='cpu-fem-mpm'&&!dynamic)throw Error('MPM–FEM 混合项目仅支持瞬态求解');
    Object.assign(p.solver,{analysis:$('fem-analysis').value,adapter:p.solver.adapter==='cpu-fem-mpm'?'cpu-fem-mpm':dynamic?'cpu-fem-dynamic':'cpu-fem-static',tolerance:get('fem-tolerance'),maxIterations:get('fem-iterations')});
    if(dynamic)Object.assign(p.solver,{thermal:$('fem-thermal').checked,dt:get('fem-dt'),outputInterval:get('fem-output-interval'),safety:get('fem-safety'),damping:get('fem-damping'),duration:get('fem-duration'),initialState:$('fem-initial-state').value});
    else{p.curves=[];p.loadBindings=[];for(const b of p.parts)b.initial.velocity=[0,0,0];}
    if(p.solver.adapter==='cpu-fem-mpm')Object.assign(p.solver,{thermalMode:$('mixed-thermal-mode').value,computeBackend:$('mixed-device').value,mixedGpuPort:get('mixed-gpu-port'),diagnostics:$('mixed-energy-diagnostics').checked});
    return load(p);
  });
  $('fem-run').onclick=guard(run);$('fem-pause').onclick=pause;$('fem-step').onclick=guard(step);
  $('fem-solve').onclick=guard(solve);$('fem-cancel').onclick=guard(cancel);
  for(const id of ['fem-field','fem-scale','fem-wire','fem-original','fem-result-part','fem-temperature-mode','fem-temperature-min','fem-temperature-max'])$(id).onchange=()=>{lastKey='';display(getFrame());};
  $('fem-validate').onclick=guard(async()=>{
    if(validator){validator.free();validator=null;$('fem-validate').textContent=text('运行三档网格验证','Run three-mesh validation');return;}
    const w=validator=femWorker();$('fem-validate').textContent=text('取消网格验证','Cancel mesh validation');
    $('fem-validation-report').textContent=text('正在计算三档独立网格…','Computing three independent meshes…');
    try{report=await w.request('validate');renderReport();reveal('results','fem-results');}
    catch(e){$('fem-validation-report').textContent=e.message;}
    finally{w.free();if(validator===w)validator=null;$('fem-validate').textContent=text('运行三档网格验证','Run three-mesh validation');}
  });
  $('fem-validation-json').onclick=guard(()=>{if(!report)throw Error('请先运行 FEM 网格验证');download(JSON.stringify(report,null,2),'fem-validation.json','application/json');});
  $('fem-validate-dynamic').onclick=guard(async()=>{
    const button=$('fem-validate-dynamic'),w=femWorker();button.disabled=true;
    $('fem-dynamic-validation').textContent=text('正在验证振动频率、能量及时间步收敛…','Validating frequency, energy and time-step convergence…');
    try{dynamicReport=await w.request('validate-dynamic');renderDynamicReport();reveal('results','fem-dynamic-results');}
    finally{w.free();button.disabled=false;}
  });
  function renderDynamicReport(){
    if(!dynamicReport)return;
    $('fem-dynamic-validation').textContent=`${text('独立模态验证','Independent modal validation')}: ${Object.values(dynamicReport.checks).every(Boolean)?'PASS':'CHECK'}\n`+
      `${dynamicReport.reference.size.join(' × ')} m · ${dynamicReport.reference.divisions.join(' × ')} ${text('划分','divisions')}\n`+
      `${text('参考频率','Reference frequency')} ${fmt(dynamicReport.reference.frequency)} Hz\n`+
      dynamicReport.runs.map(r=>`Δt ${fmt(r.dt)} s · f ${fmt(r.frequency)} Hz\n${text('位移误差 / 能量残差','Displacement error / energy residual')} ${(r.maxDisplacementError*100).toFixed(5)}% / ${(r.maxEnergyResidual*100).toFixed(5)}%`).join('\n');
  }
  $('fem-dynamic-report').onclick=guard(()=>{if(!dynamicReport)throw Error('请先运行动态验证');download(JSON.stringify(dynamicReport,null,2),'fem-dynamic-validation.json','application/json');});
  $('fem-response-axis').onchange=()=>{lastKey='';display(getFrame());};
  $('fem-history-csv').onclick=guard(()=>{
    const rows=['time_s,part_id,mean_ux_m,mean_uy_m,mean_uz_m,mean_vx_m_s,mean_vy_m_s,mean_vz_m_s,kinetic_J,strain_energy_J,damping_loss_J,external_work_J,initial_energy_J,energy_residual_J,contact_work_into_part_J,total_kinetic_J,total_elastic_J,total_contact_spring_J,total_loss_J,total_external_work_J,total_energy_residual_J,thermal_work_J,mean_temperature_degC,min_temperature_degC,max_temperature_degC,external_heat_J,heat_residual_J,interface_work_into_FEM_J,energy_scope'];
    for(const f of getHistory())for(const p of f.fem?.parts??[]){const s=p.summary;if(!s?.tip)continue;rows.push([f.time,p.id,...s.tip,...s.tipVelocity,s.kinetic,s.energy,s.dissipated,s.externalWork,s.initialEnergy,s.energyResidual,s.contactWork===null?null:s.contactWork??0,f.fem.dynamics.kinetic,f.fem.dynamics.energy,f.fem.dynamics.contactEnergy??0,f.fem.dynamics.dissipated,f.fem.dynamics.externalWork,f.fem.dynamics.energyResidual,s.thermalWork,s.temperature,s.minTemperature,s.maxTemperature,f.thermal?.externalHeat,f.thermal?.residual,f.fem.dynamics.interfaceWork===null?null:f.fem.dynamics.interfaceWork??0,f.fem.dynamics.energyScope??'rigid-fem-system'].join(','));}
    download(rows.join('\n'),'fem-dynamic-history.csv','text/csv');
  });
  function renderReport(){
    if(!report)return;const passed=Object.values(report.checks).every(Boolean);
    $('fem-validation-report').textContent=`${text('网格验证','Mesh validation')}: ${passed?'PASS':'CHECK'}\n`+
      report.rows.map(r=>`${r.nodes} nodes / ${r.elements} Tet4\nδy = ${fmt(r.dy*1000)} mm · ${text('梁理论误差','Beam theory error')} ${(r.relativeError*100).toFixed(2)}%`).join('\n')+
      `\n${text('细化应改善弯曲偏硬；局部应力峰值不用于判定。','Refinement should reduce bending stiffness error; local stress peaks are not an acceptance measure.')}`;
  }
  function selectedResult(){const f=getFrame();if(!f.fem?.solved)throw Error('请先求解静力平衡');return f.fem.parts.find(p=>p.id===$('fem-result-part').value);}
  $('fem-nodes-csv').onclick=guard(()=>{const p=selectedResult(),rows=['node_id,x_m,y_m,z_m,ux_m,uy_m,uz_m,rx_N,ry_N,rz_N,temperature_degC'];p.nodes.forEach((x,i)=>rows.push([i,...x,...p.displacement.slice(3*i,3*i+3),...p.reaction.slice(3*i,3*i+3),p.temperature?.[i]??''].join(',')));download(rows.join('\n'),'fem-'+p.id+'-nodes.csv','text/csv');});
  $('fem-elements-csv').onclick=guard(()=>{const p=selectedResult(),rows=['element_id,n0,n1,n2,n3,sxx_Pa,syy_Pa,szz_Pa,txy_Pa,tyz_Pa,txz_Pa,exx,eyy,ezz,gxy,gyz,gxz,von_mises_Pa'];p.cells.forEach((c,i)=>rows.push([i,...c,...p.stress[i],...p.strain[i],p.vonMises[i]].join(',')));download(rows.join('\n'),'fem-'+p.id+'-elements.csv','text/csv');});
  function plot(log){
    const c=$('fem-convergence'),r=c.getBoundingClientRect();if(!r.width)return;
    const dpr=Math.min(devicePixelRatio,2);c.width=r.width*dpr;c.height=130*dpr;const ctx=c.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,r.width,130);if(!log.length)return;
    const max=Math.max(1,log.at(-1)[0]),min=Math.min(-1,...log.map(p=>Math.log10(Math.max(1e-14,p[1]))));
    ctx.strokeStyle='#77888b';ctx.strokeRect(35,10,r.width-45,94);ctx.fillStyle=getComputedStyle(document.body).getPropertyValue('--ink')||'#aaa';ctx.font='10px monospace';ctx.fillText('1e0',1,16);ctx.fillText('1e'+Math.floor(min),1,104);ctx.fillText(text('迭代次数','Iteration')+' / '+max,35,123);
    ctx.beginPath();log.forEach(([it,res],i)=>{const x=35+it/max*(r.width-45),y=10+Math.min(1,Math.max(0,Math.log10(Math.max(1e-14,res))/min))*94;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.strokeStyle='#31a5b2';ctx.lineWidth=2;ctx.stroke();
  }
  function display(f){
    mixedMaterial.display(f);
    if(!f?.fem)return;
    const scale=Math.max(0,Math.min(100,Number.isFinite(get('fem-scale'))?get('fem-scale'):1)),field=$('fem-field').value;
    const settings={field,scale,wire:$('fem-wire').checked,original:$('fem-original').checked,temperatureMode:$('fem-temperature-mode').value,temperatureMin:get('fem-temperature-min'),temperatureMax:get('fem-temperature-max')};
    getView().femSettings=settings;
    $('fem-temperature-display').hidden=field!=='temperature';$('fem-temperature-manual').hidden=settings.temperatureMode!=='manual';
    const key=[JSON.stringify(settings),$('fem-result-part').value,en(),$('fem-results').open,$('fem-dynamic-results').open,$('fem-mixed-energy').open,$('fem-response-axis').value].join('|');
    if(lastFrame===f&&lastKey===key)return;lastFrame=f;lastKey=key;displayMixedEnergy(f,getHistory());
    const p=f.fem.parts.find(p=>p.id===$('fem-result-part').value)??f.fem.parts[0];
    if(field==='temperature'){
      const range=temperatureScale(f,settings),actual=temperatureExtent(f,'fem'),prec=x=>x.toPrecision(10);
      $('fem-legend').textContent=`${prec(range.min)} — ${prec(range.max)} °C · ${text('当前温度色标','Current temperature scale')}\nFEM: ${prec(actual.min)} — ${prec(actual.max)} °C · ΔT = ${prec(actual.span)} °C`;
      $('fem-temperature-note').textContent=!range.valid?text('色标上限须大于下限；当前使用全模型自动范围。','Maximum must exceed minimum; using the global automatic range.'):
        settings.temperatureMode==='fem'?text('已放大 FEM 局部温差；红色不代表绝对高温。所有物体共用此色标，超出范围的温度使用端点颜色。','FEM local contrast is amplified; red does not mean a high absolute temperature. All bodies share this scale; temperatures outside it use endpoint colors.'):
        text('MPM / PBF、FEM 与刚体同温同色。全模型模式自动取当前范围，至少显示 1°C 跨度，避免放大微小温差；固定范围可用于比较不同时刻。','MPM / PBF, FEM and rigid bodies use the same temperature colors. Global mode uses the current extent with at least a 1°C span to avoid amplifying tiny differences; use a fixed range to compare times.');
    }else $('fem-legend').textContent=`${fmt(femMinimum(f,field))} — ${fmt(femRange(f,field))} ${field==='displacement'?'m':field==='vonMises'?'Pa':''} · ${text('FEM 统一色标；显示倍率','FEM scale; deformation display')} ${scale}×`;

    if(!p){$('fem-readout').textContent=text('请添加 FEM 部件。','Add a FEM part.');return;}
    $('fem-mesh-info').textContent=`${p.nodes.length} nodes · ${p.cells.length} Tet4\n${text('最小单元质量','Minimum element quality')} ${fmt(p.quality.minQuality)} / 1\nV = ${fmt(p.quality.volume)} m³`;
    const s=p.summary;
    $('fem-readout').textContent=s?[
      `${text('最大位移','Max displacement')}: ${fmt(s.maxDisplacement)} m`,
      `von Mises: ${fmt(s.maxVonMises)} Pa`,
      `${(f.mixed?text('FEM 内力支反力（接触冲量另见接触对）','FEM internal reaction (contact impulses are reported per pair)'):text('支反力','Reaction'))} [${s.reaction.map(fmt).join(', ')}] N`,
      `|ΣF| = ${fmt(Math.hypot(...s.forceBalance))} N`,
      `|ΣM| = ${fmt(Math.hypot(...s.momentBalance))} N·m`,
      `${text('应变能','Strain energy')} ${fmt(s.energy)} J`,
      `${text('迭代 / 残差','Iterations / residual')} ${p.iterations} / ${fmt(p.relativeResidual)}`,
      `${text('求解耗时','Solve time')} ${s.solveMs.toFixed(1)} ms`,...s.warnings].join('\n'):text('尚未求解。网格已生成，可在求解目录运行静力分析。','Not solved. Mesh generated; run static analysis in Solver.');
    const dynamic=f.fem.analysis==='linear-dynamic',ref=dynamic?null:beamReference(getProject());
    if(s&&ref){const dy=tipDisplacement(p)[1];$('fem-readout').textContent+=`\n${text('端面平均位移','Mean end displacement')} Y = ${fmt(dy)} m\n${text('细长梁理论','Beam theory')} ${fmt(ref.dy)} m\n${text('理论差异','Theory difference')} ${(100*Math.abs(dy/ref.dy-1)).toFixed(2)}%`;}
    $('fem-convergence').hidden=dynamic;
    if(dynamic&&s){
      $('fem-readout').textContent=`t = ${fmt(f.time)} s\n${text('最大位移','Max displacement')} ${fmt(s.maxDisplacement)} m\nvon Mises ${fmt(s.maxVonMises)} Pa\n${(f.mixed?text('FEM 内力支反力（接触冲量另见接触对）','FEM internal reaction (contact impulses are reported per pair)'):text('支反力','Reaction'))} [${s.reaction.map(fmt).join(', ')}] N\n${text('惯性修正力平衡','Inertia-corrected force balance')} ${fmt(Math.hypot(...s.forceBalance))} N\n${s.warnings.join('\n')}`;
      const d=f.fem.dynamics,relative=Math.abs(d.energyResidual)/Math.max(1e-15,d.initialEnergy,Math.abs(d.externalWork),Math.abs(d.thermalWork??0),Math.abs(d.interfaceWork??0));
      $('fem-status').textContent=`Δt ${fmt(d.dt)} s / ${text('稳定上限','Stability bound')} ${fmt(d.criticalDt)} s\n${text('已推进子步','Substeps')} ${d.steps}`;
      const project=getProject(),responseLoad=project.loads.find(l=>l.target===p.id&&['fem-force','fem-pressure'].includes(l.type)),responseSet=project.selectionSets.find(set=>set.id===responseLoad?.selection);
      const responseLabel=s.responseSurface?.label??responseSet?.name??text('无面载荷','No surface load');
      $('fem-dynamic-readout').textContent=`t = ${fmt(f.time)} s\n${text('响应表面','Response surface')}: ${responseLabel}\n${text('加载面平均位移','Mean loaded-surface displacement')} [${s.tip.map(fmt).join(', ')}] m\n${text('加载面平均速度','Mean loaded-surface velocity')} [${s.tipVelocity.map(fmt).join(', ')}] m/s\n`+
        `${text('动能 / 应变能','Kinetic / strain energy')} ${fmt(d.kinetic)} / ${fmt(d.energy)} J\n${text('总耗散 / 外力做功','Total loss / external work')} ${fmt(d.dissipated)} / ${fmt(d.externalWork)} J\n`+
        `${text('初始能量','Initial energy')} ${fmt(d.initialEnergy)} J\n${text('能量残差','Energy residual')} ${fmt(d.energyResidual)} J (${Number.isFinite(d.energyResidual)?(relative*100).toFixed(5)+'%':'—'})\nΔt = ${fmt(d.dt)} s · ${d.steps} ${text('子步','substeps')}`;
      if(f.mixed)$('fem-dynamic-readout').textContent+=`\n${text('以上为 FEM 子系统收支；来自 MPM 的界面功','FEM subsystem balance; interface work from MPM')} ${fmt(d.interfaceWork)} J\n${text('完整系统收支请查看“耦合收支与时间步”','See Coupled balance & time steps for the system ledger')}`;
      if(f.thermal?.enabled){$('fem-readout').textContent+=`\nT: ${fmt(s.minTemperature)} – ${fmt(s.maxTemperature)} °C`;$('fem-dynamic-readout').textContent+=`\n${text('热应变做功','Thermal strain work')} ${fmt(d.thermalWork)} J`;}
      if(f.bodies.length)$('fem-dynamic-readout').textContent+=`\n${text('刚体动能 / 接触储能','Rigid kinetic / contact spring energy')} ${fmt(d.rigidKinetic)} / ${fmt(d.contactEnergy)} J\n${text('接触耗散（已计入总耗散）','Contact loss (included in total loss)')} ${fmt(d.contactDissipated)} J`;
      if($('fem-dynamic-results').open){
        const history=getHistory().filter(x=>x.time<=f.time+1e-9),axis=Number($('fem-response-axis').value);
        for(const [id,k,unit] of [['fem-displacement-chart','tip','m'],['fem-velocity-chart','tipVelocity','m/s']])
          plotSeries($(id),[{color:'#22a9b6',points:history.map(x=>[x.time,x.fem.parts.find(x=>x.id===p.id)?.summary?.[k]?.[axis]??NaN])}],unit);
        plotSeries($('fem-energy-chart'),['kinetic','energy','dissipated','externalWork','contactEnergy'].map((k,i)=>({color:['#22a9b6','#e3a048','#b08de2','#718087','#54af64'][i],points:history.map(x=>[x.time,x.fem.dynamics?.[k]??NaN])})),'J');
      }
    }else plot(p.log);
  }
  window.addEventListener('workbench-languagechange',()=>{lastKey='';display(getFrame());renderReport();renderDynamicReport();});
  window.addEventListener('workbench-chapter',()=>{lastKey='';display(getFrame());});
  new ResizeObserver(()=>{lastKey='';display(getFrame());}).observe($('fem-convergence'));
  new ResizeObserver(()=>{lastKey='';display(getFrame());}).observe($('fem-energy-chart'));
  $('fem-mixed-energy').addEventListener('toggle',()=>{lastKey='';display(getFrame());});
  return {refresh,display,edit(id){$('fem-edit-part').value=id;fill();},
    busy(value){$('fem-solve').disabled=value;$('fem-cancel').disabled=!value;$('fem-status').textContent=value?text('正在后台求解静力平衡…','Solving static equilibrium in background…'):text('就绪；结果见场量与平衡检查。','Ready; see fields and equilibrium checks.');}};
}
