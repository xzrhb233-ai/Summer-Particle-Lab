import {materialGroups,materialParameterPatch,referenceYoung} from './material-editor.js';
import {fourGPUExample} from '../mixed/four-gpu-model.js';
import {MIXED_MPM_MODELS} from '../mixed/material-capabilities.js';
import {PART_METHODS,proposeNewPart,addProjectPart,updateProjectPart,prepareProjectMethods,emptyProject} from './part-builder.js';
import {removePart} from './project.js';
import {unifiedExample,unifiedContactExample} from './unified-example.js';

const $=id=>document.getElementById(id);
const en=()=>document.documentElement.lang==='en';
const t=(zh,english)=>en()?english:zh;
const names={mpm:['MPM 固体','MPM solid'],fem:['FEM 弹性体','FEM solid'],rigid:['刚体','Rigid body'],pbf:['PBF 流体','PBF fluid']};
const name=method=>names[method]?.[en()?1:0]??method;
const field=(id,label,type='number')=>`<label for="${id}">${label}</label><input id="${id}" type="${type}" ${type==='number'?'step="any"':''}>`;
const vector=(id,label)=>`<label>${label}</label><div class="gravity-coordinates">${['X','Y','Z'].map((axis,k)=>`<label>${axis}<input id="${id}${k}" aria-label="${label} ${axis}" type="number" step="any"></label>`).join('')}</div>`;
const select=(id,label,options=[])=>`<label for="${id}">${label}</label><select id="${id}">${options.map(([value,text])=>`<option value="${value}">${text}</option>`).join('')}</select>`;

export function mountUnifiedPanels(folder,sections){
  const start=folder('setup','unified-start','项目起点');
  start.innerHTML+='<p class="hint">在同一项目添加 MPM、FEM、刚体与 PBF，统一设置部件接触和温度场。</p><div id="unified-counts" class="method-counts" aria-label="各方法部件数量"></div><div class="buttons"><button id="unified-start-modeling">添加或编辑部件</button><button id="unified-start-coupling">查看耦合关系</button></div><p id="unified-backend" class="hint" role="status"></p><details class="unified-extra"><summary>新项目与示例</summary><p class="hint">以下操作替换当前项目并重置结果。需要保留模型时先在“项目保存与编辑”中导出。</p><div class="buttons"><button id="unified-empty">创建空白项目</button><button id="unified-demo">载入四方法耦合示例</button><button id="unified-contact-demo">载入接触增强示例</button><button id="unified-gpu-demo">载入四方法 GPU 示例</button></div></details>';
  sections.get('setup').prepend(start);
  const edit=folder('geometry','unified-parts','新建与编辑部件');
  edit.innerHTML+='<p class="hint">选择方法 → 设置几何和材料 → 添加到当前项目。所有部件使用相同的世界坐标与 SI 单位。</p><div id="unified-methods" class="method-choices" role="group" aria-label="新建部件方法">'+Object.entries(names).map(([method,[label]])=>`<button type="button" data-method="${method}" aria-pressed="false"><strong>${label}</strong><small>${{mpm:'可变形固体 · 物质点',fem:'弹性结构 · 四面体',rigid:'整体运动 · 质量与惯量',pbf:'液体 · 压力与流动'}[method]}</small></button>`).join('')+'</div>'+
    '<label for="unified-edit">编辑项目部件</label><select id="unified-edit"><option value="">＋ 新建部件</option></select><p id="unified-editing" class="hint"></p><button id="unified-edit-parametric" hidden>编辑参数化尺寸</button>'+
    field('unified-name','部件名称','text')+select('unified-shape','几何形状')+vector('unified-size','尺寸（m）')+vector('unified-center','中心位置（m）')+
    '<details class="unified-extra"><summary>旋转与初始状态</summary>'+vector('unified-rotation','旋转（度）')+vector('unified-velocity','初速度（m/s）')+field('unified-temperature','初始温度（°C）')+'</details>'+
    '<div id="unified-rigid-fields">'+field('unified-mass','质量（kg）')+select('unified-motion','运动类型',[['dynamic','自由运动'],['fixed','固定']])+'</div>'+
    '<div id="unified-density-fields">'+field('unified-density','密度（kg/m³）')+'</div>'+
    '<div id="unified-mpm-fields">'+select('unified-model','固体本构',[[0,'共旋转弹性'],[1,'Neo-Hookean 超弹性'],[2,'雪 · 弹塑性'],[3,'砂 · Drucker–Prager'],[4,'理想弹塑性 · J2'],[5,'线性强化 · J2'],[6,'Johnson–Cook'],[7,'简化 Johnson–Cook'],[8,'黏聚岩土'],[9,'泡沫金属'],[10,'温度相关 J2 塑性'],[11,'Norton–Arrhenius 蠕变']])+'</div>'+
    '<div id="unified-fem-fields">'+field('unified-young','杨氏模量 E（Pa）')+field('unified-poisson','泊松比 ν')+vector('unified-divisions','FEM 网格划分数')+select('unified-fixed-face','固定面',[['x-','X− 面'],['x+','X+ 面'],['y-','Y− 面'],['y+','Y+ 面'],['z-','Z− 面'],['z+','Z+ 面']])+'</div>'+
    '<p id="unified-discretization" class="hint"></p><p id="unified-route" class="hint"></p><div class="buttons"><button id="unified-add">添加到项目</button><button id="unified-update" disabled>保存部件修改</button></div><button id="unified-remove" disabled>删除此部件</button><p id="unified-feedback" role="status" class="hint"></p><label class="check"><input id="unified-advanced" type="checkbox">显示专业建模工具</label><p class="hint">修改模型会重置求解和结果；高级本构、计算域、连接和热载荷仍在对应目录中配置。</p>';
  sections.get('geometry').prepend(edit);
  const coupling=folder('loads','unified-coupling','耦合关系总览');
  coupling.innerHTML+='<p class="hint">先创建部件，再检查它们之间的力学接触和热交换。接触只有在表面相遇时产生作用。</p><div id="unified-pair-list" class="coupling-list"></div><p id="unified-coupling-limit" class="hint"></p><div class="buttons"><button id="unified-pair-editor">编辑接触参数</button><button id="unified-heat-editor">设置加热与降温</button></div>';
  sections.get('loads').prepend(coupling);
}

export function wireUnifiedProject({getProject,load,guard,reveal,onAdvanced}){
  let method='mpm',selected='',busy=false,initialized=false,undo=null;
  const number=id=>$(id).valueAsNumber,read=id=>[0,1,2].map(k=>number(id+k)),put=(id,v)=>v.forEach((n,k)=>$(id+k).value=n);
  const materialPanel=document.createElement('section');materialPanel.id='unified-material-panel';
  materialPanel.innerHTML='<h3>材料参数</h3><div id="unified-elastic-fields"></div>';
  document.querySelector('label[for="unified-shape"]').before(materialPanel);
  materialPanel.prepend($('unified-density-fields'),$('unified-rigid-fields'),$('unified-mpm-fields'));
  materialPanel.prepend(materialPanel.querySelector('h3'));
  for(const id of ['unified-young','unified-poisson'])$('unified-elastic-fields').append(document.querySelector(`label[for="${id}"]`),$(id));
  $('unified-mpm-fields').insertAdjacentHTML('beforeend',
    field('unified-mpm-young','参考杨氏模量 E₀（Pa，只读）')+field('unified-mpm-poisson','泊松比 ν（固定，只读）')+
    field('unified-mpm-stiffness','共享 MPM 刚度倍率（所有 MPM 部件）')+
    '<p id="unified-elastic-note" class="hint">MPM 当前 E₀ = 10 × 密度 × 刚度倍率，ν 固定为 0.25；尚不支持逐部件独立输入 E、ν。下方强度为相对于 E₀ 的比值。改变倍率会影响全部 MPM 部件。</p>'+
    '<div id="unified-law-parameters"></div>'+field('unified-yield','雪的压缩屈服应变')+field('unified-friction','砂的内摩擦角（度）'));
  $('unified-mpm-young').readOnly=true;$('unified-mpm-poisson').readOnly=true;
  $('unified-mpm-stiffness').min=.25;$('unified-mpm-stiffness').max=40;
  for(const [group,spec] of Object.entries(materialGroups))for(const [key,label] of spec.fields)
    $('unified-law-parameters').insertAdjacentHTML('beforeend',field('unified-law-'+group+'-'+key,label));
  function materialMode(){
    const law=Number($('unified-model').value);
    for(const [group,spec] of Object.entries(materialGroups))for(const [key,,models] of spec.fields){
      const id='unified-law-'+group+'-'+key;$(id).hidden=!models.includes(law);document.querySelector(`label[for="${id}"]`).hidden=!models.includes(law);
    }
    for(const [id,m] of [['unified-yield',2],['unified-friction',3]]){$(id).hidden=law!==m;document.querySelector(`label[for="${id}"]`).hidden=law!==m;}
    $('unified-mpm-young').value=Number.isFinite(number('unified-density')*number('unified-mpm-stiffness'))?referenceYoung(number('unified-density'),number('unified-mpm-stiffness')):'';
  }
  $('unified-model').addEventListener('change',materialMode);
  $('unified-density').addEventListener('input',materialMode);$('unified-mpm-stiffness').addEventListener('input',materialMode);
  function choose(value,part=null){
    method=value;const p=part??proposeNewPart(getProject(),method),g=p.geometry,m=p.material;
    const meta=PART_METHODS.find(x=>x.id===method);
    $('unified-shape').replaceChildren(...meta.shapes.map(shape=>{const o=document.createElement('option');o.value=shape;o.textContent=({box:t('长方体','Box'),sphere:t('球（等径）','Sphere'),ellipsoid:t('椭球','Ellipsoid'),cylinder:t('Y 轴圆柱','Y cylinder'),disc:t('Z 轴圆盘','Z disc'),torus:t('空心轮胎','Torus')})[shape]??shape;return o;}));
    if(g.shape==='cad')$('unified-shape').append(new Option('SMLib CAD 实体','cad'));
    $('unified-shape').disabled=method==='fem'&&g.shape==='cad';
    $('unified-shape').value=g.shape;$('unified-name').value=p.name;
    put('unified-size',g.size);put('unified-center',g.center);put('unified-rotation',g.rotation??[0,0,0]);put('unified-velocity',p.initial.velocity??[0,0,0]);$('unified-temperature').value=p.initial.temperature??20;
    $('unified-mass').value=m.mass??1;$('unified-motion').value=p.boundary.motion??'dynamic';$('unified-density').value=m.density??1000;$('unified-model').value=method==='mpm'?m.model:0;
    $('unified-elastic-fields').hidden=method!=='fem';
    $('unified-mpm-stiffness').value=getProject().solver.stiffness??1;$('unified-mpm-poisson').value=.25;
    for(const [group,spec] of Object.entries(materialGroups))for(const [key] of spec.fields)$('unified-law-'+group+'-'+key).value=m[group]?.[key]??spec.defaults[key];
    $('unified-yield').value=m.yieldStrain??.025;$('unified-friction').value=m.friction??35;materialMode();
    $('unified-young').value=m.young??2e6;$('unified-poisson').value=m.poisson??.3;put('unified-divisions',p.discretization?.divisions??[6,2,3]);
    for(let k=0;k<3;k++)$('unified-divisions'+k).disabled=method==='fem'&&g.shape==='cad';
    const support=getProject()?.loads?.find(l=>l.target===p.id&&l.type==='fem-fixed');
    const region=getProject()?.selectionSets?.find(s=>s.id===support?.selection)?.region;
    $('unified-fixed-face').value=p.boundary.fixedFace??region?.face??(part?'':'x-');
    $('unified-rigid-fields').hidden=method!=='rigid';$('unified-density-fields').hidden=method==='rigid';$('unified-mpm-fields').hidden=method!=='mpm';$('unified-fem-fields').hidden=method!=='fem';
    for(const button of $('unified-methods').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.method===method));
    $('unified-editing').textContent=part?`${t('正在编辑','Editing')}: ${part.name} · ${name(method)} · ${part.id}`:`${t('新建','New')}: ${name(method)}`;
    $('unified-feedback').textContent=p.placementWarning??'';actions();describe();
  }
  function actions(){for(const id of ['unified-add','unified-update','unified-remove'])$(id).disabled=busy||(id!=='unified-add'&&!selected)||(id==='unified-add'&&$('unified-shape').value==='cad');const parametric=!!getProject()?.parts.find(p=>p.id===selected)?.modeling;$('unified-edit-parametric').hidden=!parametric;$('unified-edit-parametric').disabled=busy||!parametric;}
  function fields(){
    let material=method==='rigid'?{mass:number('unified-mass')}:{density:number('unified-density')};
    if(method==='fem')Object.assign(material,{young:number('unified-young'),poisson:number('unified-poisson')});
    if(method==='mpm'){
      const model=Number($('unified-model').value),values={};
      for(const [group,spec] of Object.entries(materialGroups))values[group]=Object.fromEntries(spec.fields.map(([key])=>[key,number('unified-law-'+group+'-'+key)]));
      Object.assign(material,{model,...materialParameterPatch(model,values)});
      if(model===2)material.yieldStrain=number('unified-yield');
      if(model===3)material.friction=number('unified-friction');
    }
    return {method,name:$('unified-name').value,geometry:{shape:$('unified-shape').value,size:read('unified-size'),center:read('unified-center'),rotation:read('unified-rotation')},material,
      initial:{temperature:number('unified-temperature'),velocity:read('unified-velocity')},boundary:method==='rigid'?{motion:$('unified-motion').value}:method==='fem'?{fixedFace:$('unified-fixed-face').value||null}:{},...(method==='fem'?{discretization:{divisions:read('unified-divisions')}}:{})};
  }
  function describe(){
    const p=getProject();if(!p)return;
    if(undo&&undo.after!==JSON.stringify(p))undo=null;
    $('model-undo-remove').disabled=!undo;
    const grid=p.discretization?.mpm;
    $('unified-discretization').textContent=method==='fem'?t('Tet4 四面体网格；划分数决定节点与单元数。','Tet4 mesh; subdivisions determine the node and element counts.'):
      ['mpm','pbf'].includes(method)?(grid?`${t('共享粒子离散','Shared particle discretization')}: h = ${grid.cellSize} m · ${grid.particlesPerAxis**3} ${t('点 / 网格','points / cell')}`:t('首次添加粒子时建立共享计算域与粒子离散。','The first particle part creates a shared domain and particle discretization.')):t('质量和形状决定惯量；固定刚体参与接触，但不随受力移动。','Mass and shape determine inertia. Fixed bodies interact without moving.');
    const selectedPart=p.parts.find(b=>b.id===selected),mesh=selectedPart?.discretization?.mesh;
    if(method==='fem'&&selectedPart?.geometry.shape==='cad'&&mesh)$('unified-discretization').textContent=t(`CAD Tet4：${mesh.nodes.length} 节点 / ${mesh.elements.length} 单元。网格划分在 CAD 网格工具中调整；此处可修改位置、整体尺寸、材料与固定面。固定面仅选取包围盒上的平面三角形。`,`CAD Tet4: ${mesh.nodes.length} nodes / ${mesh.elements.length} elements. Remesh in CAD tools; edit placement, overall size, material and supports here. Supports select planar boundary triangles on local bounding faces.`);
    const combined=p.parts.some(x=>x.method==='fem')||method==='fem';
    const mixedGPU=combined&&p.solver.computeBackend==='gpu';
    $('unified-material-parameters').hidden=method!=='mpm'||!mixedGPU;
    $('unified-material-parameters').disabled=!selected;
    for(const option of $('unified-model').options){
      option.disabled=mixedGPU&&!MIXED_MPM_MODELS.includes(Number(option.value));
      option.textContent=option.textContent.replace(/ · (GPU 联算暂不支持|not in coupled GPU)$/,'')+(option.disabled?t(' · GPU 联算暂不支持',' · not in coupled GPU'):'');
    }
    $('unified-route').textContent=combined?t('CPU 支持多种刚体形状与多 FEM。四方法 GPU 首版支持 MPM、PBF、FEM、球形刚体各一个；从“项目起点”载入 GPU 示例，再编辑部件。','CPU supports multiple shapes and FEM parts. The GPU pilot supports one MPM, one PBF, one FEM and one sphere. Load the GPU example in Project start, then edit its parts.'):t('添加部件会保留已有部件，并建立支持的默认接触对。流体压力通过粒子邻域耦合。','Adding a part preserves existing parts and creates supported default pairs. Fluid pressure couples through particle neighborhoods.');
    if(combined)$('unified-route').textContent+=' '+t('GPU 联算现支持 8 种 MPM 本构：两种弹性、J2、线性强化、Johnson–Cook、简化 Johnson–Cook、温度 J2 和蠕变。金属系列需要新版 GPU 服务；雪、砂、岩土与泡沫仍需 CPU。','Coupled GPU supports 8 MPM laws: two elastic laws, J2, linear hardening, Johnson–Cook, simplified Johnson–Cook, thermal J2 and creep. Metals require the updated service; snow, sand, cohesive soil and foam still require CPU.');
    if(method==='fem'&&selectedPart?.geometry.shape==='cad')$('unified-route').textContent=t('CAD 四面体网格当前使用 CPU，可参与接触与传热。任意非锐角四面体的温度解可能局部超调；可通过细化网格检查。','CAD tetrahedral meshes currently use CPU, including contact and heat transfer. Non-acute tetrahedra may produce local temperature overshoot; inspect mesh refinement.');
  }
  $('unified-mpm-fields').insertAdjacentHTML('beforeend','<button id="unified-material-parameters" type="button">本构参数与塑性生热</button>');
  $('unified-material-parameters').onclick=()=>{reveal('geometry','mixed-thermal-material');$('mixed-material-part').value=selected;$('mixed-material-part').dispatchEvent(new Event('change',{bubbles:true}));};
  $('unified-edit-parametric').onclick=()=>{reveal('geometry','cad-modeler');window.dispatchEvent(new CustomEvent('cad-parametric-edit',{detail:{id:selected}}));};
  async function commit(update){
    busy=true;actions();
    try{
      const before=getProject();let draft=update?updateProjectPart(before,selected,fields()):addProjectPart(before,fields());
      if(method==='mpm'){const stiffness=number('unified-mpm-stiffness');if(!Number.isFinite(stiffness)||stiffness<.25||stiffness>40)throw Error('MPM 刚度倍率须为 0.25–40');draft.solver.stiffness=stiffness;draft=prepareProjectMethods(draft);}
      const id=update?selected:draft.parts.find(x=>!before.parts.some(p=>p.id===x.id)).id;
      await load(draft);selected=id;refresh();choose(method,getProject().parts.find(p=>p.id===id));reveal('geometry','unified-parts');
      $('unified-feedback').textContent=t('已保存部件。可继续添加其他方法，或前往“耦合关系总览”。','Part saved. Add another method or open the coupling overview.');
    }catch(e){$('unified-feedback').textContent=e.message;throw e;}finally{busy=false;actions();}
  }
  $('unified-methods').addEventListener('click',e=>{const b=e.target.closest('button[data-method]');if(b){selected='';$('unified-edit').value='';choose(b.dataset.method);}});
  $('unified-edit').onchange=()=>{selected=$('unified-edit').value;const p=getProject().parts.find(p=>p.id===selected);choose(p?.method??method,p);};
  $('unified-add').onclick=guard(()=>commit(false));$('unified-update').onclick=guard(()=>commit(true));
  async function destructiveEdit(next){
    const previous=getProject(),previousURL=location.href;
    busy=true;actions();
    try{
      await load(next);
      undo={previous,previousURL,after:JSON.stringify(getProject())};
      selected='';refresh();choose('mpm');reveal('geometry','unified-parts');
    }finally{busy=false;actions();}
  }
  $('unified-remove').onclick=guard(async()=>{if(!selected)return;await destructiveEdit(prepareProjectMethods(removePart(getProject(),selected)));});
  $('model-undo-remove').onclick=guard(async()=>{
    if(!undo||undo.after!==JSON.stringify(getProject()))return;
    const saved=undo;await load(saved.previous);undo=null;
    history.replaceState(null,'',saved.previousURL);refresh();choose('mpm');reveal('geometry','unified-parts');
  });
  $('unified-advanced').onchange=()=>onAdvanced($('unified-advanced').checked);
  $('unified-start-modeling').onclick=()=>reveal('geometry','unified-parts');$('unified-start-coupling').onclick=()=>reveal('loads','unified-coupling');
  $('unified-pair-editor').onclick=()=>reveal('loads','project-contact-pairs');$('unified-heat-editor').onclick=()=>reveal('loads','project-thermal-loads');
  $('unified-empty').onclick=guard(async()=>{await destructiveEdit(emptyProject());const url=new URL(location.href);url.searchParams.set('mbd','empty');url.searchParams.delete('projectBackend');url.searchParams.delete('replay');url.searchParams.set('v','0.62.2');url.hash='geometry';history.replaceState(null,'',url);});
  $('unified-demo').onclick=guard(async()=>{await load(unifiedExample());selected='';refresh();choose('mpm');reveal('loads','unified-coupling');});
  $('unified-contact-demo').onclick=guard(async()=>{await load(unifiedContactExample());selected='';refresh();choose('mpm');reveal('loads','unified-coupling');});
  $('unified-gpu-demo').onclick=guard(async()=>{const p=fourGPUExample();p.solver.mixedGpuPort=Number(new URLSearchParams(location.search).get('mixedGpuPort')??8796);await load(p);selected='';refresh();choose('mpm');reveal('loads','unified-coupling');});
  function coupling(p){
    const root=$('unified-pair-list');root.replaceChildren();
    if(p.parts.length<2){const text=document.createElement('p');text.className='hint';text.textContent=t('至少添加两个部件后，这里会显示可用的耦合关系。','Add at least two parts to see available interactions.');root.append(text);}
    for(let i=0;i<p.parts.length;i++)for(let j=i+1;j<p.parts.length;j++){
      const a=p.parts[i],b=p.parts[j],pair=p.contactPairs.find(d=>(d.a===a.id&&d.b===b.id)||(d.b===a.id&&d.a===b.id));
      const methods=[a.method,b.method],particle=x=>['mpm','pbf'].includes(x);
      const fluid=methods.includes('pbf')&&methods.every(particle),rigid=methods.every(x=>x==='rigid'),fem=methods.every(x=>x==='fem');
      const row=document.createElement('div');row.className='coupling-row';
      const title=document.createElement('strong');title.textContent=`${a.name} ↔ ${b.name}`;title.dataset.userContent='';
      const types=document.createElement('small');types.textContent=`${name(a.method)} / ${name(b.method)}`;
      const state=document.createElement('span');state.textContent=pair?`${t('力学','Contact')}: ${pair.mechanical?t('开','on'):t('关','off')} · ${t('换热','Heat')}: ${pair.thermal?t('开','on'):t('关','off')}`:
        fluid?t('粒子邻域压力耦合；导热由全局开关控制','Neighborhood pressure coupling; global conduction setting'):
        rigid?(p.solver.adapter==='cpu-fem-dynamic'?t('此 FEM 适配器未计算刚体间碰撞','Rigid–rigid collision unavailable in this FEM adapter'):t('刚体碰撞；无刚体间导热','Rigid collisions; no rigid–rigid conduction')):
        fem?t('未建立 FEM–FEM 接触对','No FEM–FEM contact pair'):
        methods.includes('fem')?t('未建立接触对','No contact pair'):t('继承默认接触参数','Uses default contact settings');
      row.append(title,types,state);
      if(pair){const edit=document.createElement('button');edit.textContent=t('设置接触与换热','Edit contact & heat');edit.onclick=()=>{$('pair-edit').value=pair.id;$('pair-edit').dispatchEvent(new Event('change'));reveal('loads','project-contact-pairs');};row.append(edit);}
      root.append(row);
    }
    $('unified-coupling-limit').textContent=t('CPU 支持 MPM–FEM、含摩擦的 PBF–FEM、球 / 长方体 / 圆柱 / 圆盘刚体–FEM、FEM–FEM，以及刚体–粒子耦合。MPM–PBF 可逐对设置压力耦合与换热，独立记录压力冲量和热量。四方法 GPU 已支持各一部件及球形刚体，暂不支持关节、相变和断裂。','CPU supports MPM–FEM, frictional PBF–FEM, sphere / box / cylinder / disc rigid–FEM, FEM–FEM, and rigid–particle coupling. MPM–PBF pairs independently control pressure and heat, with per-pair impulse and heat results. The GPU pilot supports one part per method and a sphere, without joints, phase change or fracture.');
  }
  function refresh(){
    const p=getProject();if(!p)return;
    if(undo&&undo.after!==JSON.stringify(p))undo=null;
    $('model-undo-remove').disabled=!undo;
    if(!initialized){initialized=true;choose('mpm');}
    if(!p.parts.some(p=>p.id===selected))selected='';
    const options=[{id:'',name:t('＋ 新建部件','＋ New part')},...p.parts];
    $('unified-edit').replaceChildren(...options.map(part=>{const o=document.createElement('option');o.value=part.id;o.textContent=part.id?`${name(part.method)} · ${part.name}`:part.name;o.dataset.userContent='';return o;}));$('unified-edit').value=selected;
    $('unified-counts').replaceChildren(...Object.keys(names).map(method=>{const item=document.createElement('span');item.textContent=`${name(method)}  ${p.parts.filter(x=>x.method===method).length}`;return item;}));
    const gpu=p.solver.computeBackend==='gpu'||p.solver.adapter==='taichi-coupled';
    $('unified-backend').textContent=`${t('当前计算','Compute')}: ${gpu?'GPU':'CPU'} · ${p.parts.length} ${t('部件','parts')} · ${p.contactPairs.length} ${t('显式接触对','explicit pairs')}`;
    coupling(p);actions();describe();
  }
  function edit(id){const p=getProject().parts.find(p=>p.id===id);if(!p)return;selected=id;refresh();choose(p.method,p);reveal('geometry','unified-parts');}
  window.addEventListener('workbench-languagechange',()=>{if(getProject()){refresh();const p=getProject().parts.find(p=>p.id===selected);$('unified-editing').textContent=p?`${t('正在编辑','Editing')}: ${p.name} · ${name(method)} · ${p.id}`:`${t('新建','New')}: ${name(method)}`;}});
  return {refresh,edit,initialize(){choose('mpm');refresh();}};
}
