import {PARAMETRIC_TEMPLATES,createParametricSpec} from './cad-parametric.js';
import {prepareAssistantPlan,executePlan,assistantErrorDiagnostics} from './assistant-commands.js';
import {buildCAD,buildMesh} from './cad-client.js';
import {mountCADPreview} from './cad-preview.js';

const clone=v=>structuredClone(v);
export function wireParametricCAD({parent,getProject,load,loadFEM=load,busy,assertApplied,editPart}){
  const section=document.createElement('details');section.id='cad-parametric-modeler';section.open=true;
  section.innerHTML=`<summary>参数化零件 · 简易建模</summary>
    <p class="hint">选择零件并填写尺寸 → 预览修改 → 应用。尺寸和 AI 使用同一份参数；修改已有部件会保留位置、材料与接触设置。</p>
    <label for="parametric-source">新建 / 编辑参数化部件</label><select id="parametric-source"><option value="">＋ 新建零件</option></select>
    <div class="buttons"><button id="parametric-read">读取当前选中部件</button><button id="parametric-new">新建草稿</button></div>
    <label for="parametric-template">零件类型</label><select id="parametric-template"></select>
    <p id="parametric-template-help" class="hint"></p>
    <label for="parametric-unit">尺寸显示单位</label><select id="parametric-unit"><option value="m">米 m</option><option value="mm">毫米 mm</option></select>
    <div id="parametric-fields" class="parametric-fields"></div>
    <label for="parametric-name">零件名称</label><input id="parametric-name" maxlength="80">
    <label for="parametric-method">用于哪种模拟</label><select id="parametric-method"><option value="mpm">MPM 固体 · CPU</option><option value="fem">FEM 四面体 · CPU</option><option value="pbf">PBF 流体 · CPU</option></select>
    <div id="parametric-mesh-fields"><label for="parametric-mesh-size">FEM 目标网格尺寸（m）</label><input id="parametric-mesh-size" type="number" value="0.15" min="0.005" max="12" step="0.01"><p class="hint">实际网格由 SMLib / TetGen 生成。材料和固定面可在上方“编辑项目部件”中调整；新 FEM 默认固定 y-。</p></div>
    <details><summary>放置位置与方向</summary><p id="parametric-placement-help" class="hint">世界坐标。已有部件的放置在本次尺寸修改中保持不变；需要移动时使用项目部件编辑器。</p>
    <label id="parametric-center-label">中心位置（m）</label><div class="gravity-coordinates">${['X','Y','Z'].map((k,i)=>`<label>${k}<input id="parametric-center-${i}" type="number" step="0.01" value="${i===1?.7:0}" aria-label="参数化零件中心 ${k}"></label>`).join('')}</div>
    <label>XYZ 旋转（°）</label><div class="gravity-coordinates">${['X','Y','Z'].map((k,i)=>`<label>${k}<input id="parametric-rotation-${i}" type="number" step="1" value="0" aria-label="参数化零件旋转 ${k}"></label>`).join('')}</div></details>
    <div class="buttons"><button id="parametric-preview">预览建模 / 修改</button><button id="parametric-reset">丢弃草稿修改</button></div>
    <p id="parametric-status" class="hint" role="status" aria-live="polite">选择零件类型，修改尺寸后生成预览。当前项目保持不变。</p>
    <canvas id="parametric-canvas" aria-label="参数化 CAD 实体预览"></canvas>
    <label id="parametric-show-mesh-label"><input id="parametric-show-mesh" type="checkbox">显示四面体网格</label>
    <div id="parametric-diff" aria-label="参数修改对照"></div>
    <div class="buttons"><button id="parametric-apply" disabled>应用到项目</button><button id="parametric-undo" disabled>撤销本次修改</button></div>
    <button id="parametric-ai">交给 AI 继续建模</button>
    <p id="parametric-description" class="hint"></p>`;
  parent.prepend(section);const $=id=>section.querySelector('#'+id),preview=mountCADPreview($('parametric-canvas'));
  $('parametric-template').replaceChildren(...PARAMETRIC_TEMPLATES.map(t=>new Option(t.label,t.id)));
  let sourceId=null,sourceSignature='',unit='m',working=false,plan=null,undo=null,listSignature='',controller=null;
  const sourceVersion=p=>JSON.stringify(p?{modeling:p.modeling,name:p.name,method:p.method,center:p.geometry.center,rotation:p.geometry.rotation,size:p.geometry.size,meshOptions:p.discretization?.cadMeshOptions}:null);
  const sourceChanged=()=>sourceId&&sourceSignature!==sourceVersion(getProject()?.parts?.find(p=>p.id===sourceId));
  const factor=()=>unit==='mm'?.001:1;
  const fields=()=>PARAMETRIC_TEMPLATES.find(t=>t.id===$('parametric-template').value).fields;
  const status=(text,error=false)=>{$('parametric-status').textContent=text;$('parametric-status').classList.toggle('cad-error',error);};
  function issue(error){const {issues}=assistantErrorDiagnostics(error);status(issues.map(i=>`${i.field?i.field+'：':''}${i.message}`).join('\n')||error.message,true);}
  function invalidate(){plan=null;preview.clear();$('parametric-diff').replaceChildren();refresh();}
  function numbers(prefix){return [0,1,2].map(i=>$(prefix+i).valueAsNumber);}
  function values(){return Object.fromEntries(fields().map(f=>[f.key,Number((section.querySelector(`[data-param="${f.key}"]`).valueAsNumber*(f.unit==='m'?factor():1)).toPrecision(12))]));}
  function getContext(){
    if(sourceId&&!getProject()?.parts?.find(p=>p.id===sourceId)?.modeling)return {sourcePartId:sourceId,unsavedChanges:true,previewCurrent:false,error:'来源部件已删除或改为自由建模，请读取其他参数化部件或新建草稿。'};
    if(sourceChanged())return {sourcePartId:sourceId,unsavedChanges:true,previewCurrent:false,error:'此部件已在其他入口修改。请重新读取部件，再编辑参数，避免覆盖新设置。'};
    try{return {sourcePartId:sourceId,name:$('parametric-name').value,method:$('parametric-method').value,modeling:createParametricSpec($('parametric-template').value,values()),center:numbers('parametric-center-').map(x=>x*factor()),rotation:numbers('parametric-rotation-'),unsavedChanges:!!sourceId&&JSON.stringify(values())!==JSON.stringify(getProject().parts.find(p=>p.id===sourceId)?.modeling?.parameters),previewCurrent:!!plan};}
    catch(error){return {sourcePartId:sourceId,unsavedChanges:true,previewCurrent:false,error:error.message};}
  }
  function drawFields(parameters){
    $('parametric-fields').replaceChildren();
    for(const f of fields()){
      const label=document.createElement('label'),input=document.createElement('input');input.type='number';input.dataset.param=f.key;input.id='parametric-field-'+f.key;label.htmlFor=input.id;
      const scale=f.unit==='m'?factor():1;label.textContent=`${f.label}（${f.unit==='m'?unit:f.unit}）`;input.value=String(Number((parameters[f.key]/scale).toPrecision(12)));input.min=String(f.min/scale);input.max=String(f.max/scale);input.step=String((f.step??.01)/scale);
      input.addEventListener('input',()=>{invalidate();status('尺寸已修改，重新预览后再应用。');});label.append(input);$('parametric-fields').append(label);
    }
    $('parametric-template-help').textContent=PARAMETRIC_TEMPLATES.find(t=>t.id===$('parametric-template').value).description;
    $('parametric-center-label').textContent=`中心位置（${unit}）`;
  }
  function setDraft(spec,{name,method='mpm',center=[0,.7,0],rotation=[0,0,0],meshSize=.15}={}){
    $('parametric-template').value=spec.template;drawFields(spec.parameters);$('parametric-name').value=name??PARAMETRIC_TEMPLATES.find(t=>t.id===spec.template).label;$('parametric-method').value=method;$('parametric-mesh-size').value=String(meshSize);
    center.forEach((v,i)=>$('parametric-center-'+i).value=String(v/factor()));rotation.forEach((v,i)=>$('parametric-rotation-'+i).value=String(v));invalidate();
  }
  function loadPart(id){
    if(working){status('请等待当前建模操作完成',true);return false;}
    const part=getProject()?.parts?.find(p=>p.id===id);
    if(!part?.modeling){status('此部件没有参数化来源。请在高级建模中编辑其原始特征；不会从几何猜测参数。',true);return false;}
    sourceId=id;sourceSignature=sourceVersion(part);setDraft(part.modeling,{name:part.name,method:part.method,center:part.geometry.center,rotation:part.geometry.rotation,meshSize:part.discretization?.cadMeshOptions?.targetSize??.15});
    $('parametric-source').value=id;section.open=true;preview.show(part.geometry.cad);status(`已读取 ${part.name}。修改尺寸后点击预览，应用时更新同一个部件。`);return true;
  }
  function newDraft(){sourceId=null;sourceSignature='';$('parametric-source').value='';setDraft(createParametricSpec($('parametric-template').value));status('新建草稿；项目中的现有部件保持不变。');}
  function description(){
    const part=getProject()?.parts?.find(p=>p.id===sourceId),title=part?'当前已应用':'待创建草稿',model=part?.modeling;
    const el=$('parametric-description');el.replaceChildren();el.append(title+'：');
    const strong=document.createElement('strong');strong.textContent=(part?.method??$('parametric-method').value).toUpperCase()+' · CPU CAD';el.append(strong);
    if(model){el.append(' · '+PARAMETRIC_TEMPLATES.find(t=>t.id===model.template).label+' · ');const defs=PARAMETRIC_TEMPLATES.find(t=>t.id===model.template).fields;el.append(defs.map(f=>`${f.label} ${model.parameters[f.key]} ${f.unit}`).join('，'));}
    else el.append('。参数尚未加入项目。');
  }
  function refresh(){
    const parts=(getProject()?.parts??[]).filter(p=>p.modeling),signature=JSON.stringify(parts.map(p=>[p.id,p.name]));
    if(signature!==listSignature){listSignature=signature;$('parametric-source').replaceChildren(new Option('＋ 新建零件',''),...parts.map(p=>new Option(p.name+' · '+p.method.toUpperCase(),p.id)));}
    $('parametric-source').value=sourceId??'';
    section.querySelectorAll('input,select,button').forEach(e=>e.disabled=working);
    $('parametric-template').disabled=working||!!sourceId;$('parametric-method').disabled=working||!!sourceId;
    for(const prefix of ['parametric-center-','parametric-rotation-'])for(let i=0;i<3;i++)$(prefix+i).disabled=working||!!sourceId;
    $('parametric-mesh-fields').hidden=$('parametric-method').value!=='fem';
    const stale=sourceId&&!parts.some(p=>p.id===sourceId)||sourceChanged();if(stale){plan=null;status(getContext().error,true);}
    $('parametric-preview').disabled=working||!!stale;$('parametric-ai').disabled=working||!!stale;
    $('parametric-apply').disabled=working||!plan;$('parametric-undo').disabled=working||!undo;
    $('parametric-show-mesh-label').hidden=!plan?.meshPreviews?.length;description();
  }
  function displayDiff(prepared){
    const target=$('parametric-diff');target.replaceChildren();
    for(const entry of prepared.parameterChanges??[]){const title=document.createElement('strong');title.textContent=entry.operation==='create'?'新零件参数':'本次参数变化';target.append(title);
      const list=document.createElement('ul');for(const diff of entry.changes){const li=document.createElement('li'),old=document.createElement('span'),next=document.createElement('strong');const scale=diff.unit==='m'?factor():1,displayUnit=diff.unit==='m'?unit:diff.unit==='deg'?'°':diff.unit,format=n=>`${Number((n/scale).toPrecision(10))} ${displayUnit}`;old.className='parametric-before';next.className='parametric-after';old.textContent=diff.before===null?'新建':format(diff.before);next.textContent=format(diff.after);li.append(diff.label+'：',old,' → ',next);list.append(li);}target.append(list);}
  }
  const run=fn=>async()=>{if(working)return;working=true;refresh();try{await fn();}catch(error){issue(error);}finally{working=false;refresh();}};
  const host={getProject,load,loadStrict:loadFEM,busy:()=>busy(),assertApplied};
  $('parametric-template').onchange=newDraft;$('parametric-source').onchange=()=>{$('parametric-source').value?loadPart($('parametric-source').value):newDraft();};
  $('parametric-new').onclick=newDraft;$('parametric-read').onclick=()=>loadPart(document.getElementById('unified-edit').value);
  $('parametric-reset').onclick=()=>sourceId?loadPart(sourceId):newDraft();
  $('parametric-unit').onchange=()=>{
    try{const params=values(),center=numbers('parametric-center-').map(v=>v*factor());if(!Object.values(params).every(Number.isFinite)||!center.every(Number.isFinite))throw Error('请先填完整坐标和尺寸，再切换显示单位');unit=$('parametric-unit').value;drawFields(params);center.forEach((v,i)=>$('parametric-center-'+i).value=String(Number((v/factor()).toPrecision(12))));invalidate();}
    catch(error){$('parametric-unit').value=unit;issue(error);}
  };
  for(const id of ['parametric-name','parametric-method','parametric-mesh-size',...['center','rotation'].flatMap(k=>[0,1,2].map(i=>'parametric-'+k+'-'+i))])$(id).addEventListener('input',invalidate);
  $('parametric-preview').onclick=run(async()=>{
    if(busy())throw Error('请先暂停并等待当前模拟子步完成');assertApplied();
    const context=getContext();if(!context.modeling)throw Error(context.error);const project=getProject();let id=sourceId;
    if(!id){let i=1;while(project.parts.some(p=>p.id==='parametric-'+i))i++;id='parametric-'+i;}
    const old=project.parts.find(p=>p.id===sourceId),parameters=old?Object.fromEntries(Object.entries(context.modeling.parameters).filter(([k,v])=>v!==old.modeling.parameters[k])):context.modeling.parameters;
    const args={id,name:context.name,parameters,...(!sourceId?{template:context.modeling.template,method:context.method,center:context.center,rotation:context.rotation}:{}),...(context.method==='fem'?{meshOptions:{kind:'volume',targetSize:$('parametric-mesh-size').valueAsNumber}}:{})};
    plan=null;preview.clear();$('parametric-diff').replaceChildren();status('正在构建参数化实体并检查离散；项目尚未修改…');controller=new AbortController();
    try{
      const prepared=await prepareAssistantPlan(project,{reply:'参数化建模预览',commands:[{command:'cad.parametric.'+(sourceId?'update':'create'),args}]},{buildCAD,buildMesh,signal:controller.signal});
      if(JSON.stringify(getProject())!==prepared.before)throw Error('预览期间项目已改变，请重新生成预览');plan=prepared;preview.show(plan.cadPreviews[0].cad);$('parametric-show-mesh').checked=false;displayDiff(plan);
      const cad=plan.cadPreviews[0].cad,mesh=plan.meshPreviews?.[0]?.mesh;status(`预览已通过 · 体积 ${cad.volume.toPrecision(6)} m³${mesh?` · ${mesh.nodes.length} 节点 / ${mesh.elements.length} Tet4`:''}\n${sourceId?'应用后更新原部件，保留位置、材料和接触设置。':'应用后新增部件。'} 当前项目尚未修改。`);
    }finally{controller=null;}
  });
  $('parametric-apply').onclick=run(async()=>{
    if(!plan)throw Error('请先生成预览');const prepared=plan,before=clone(getProject()),id=prepared.cadPreviews[0].id;
    await executePlan(prepared,host);undo={before,after:JSON.stringify(getProject())};plan=null;sourceId=id;editPart(id);
    const part=getProject().parts.find(p=>p.id===id);sourceSignature=sourceVersion(part);setDraft(part.modeling,{name:part.name,method:part.method,center:part.geometry.center,rotation:part.geometry.rotation,meshSize:$('parametric-mesh-size').valueAsNumber});preview.show(part.geometry.cad);status('参数化模型已应用。命名参数随项目保存，可以继续修改同一个部件。');
  });
  $('parametric-undo').onclick=run(async()=>{
    if(!undo)throw Error('没有可撤销的修改');if(busy())throw Error('请先暂停模拟');assertApplied();if(JSON.stringify(getProject())!==undo.after)throw Error('项目已有其他修改，不能覆盖；请读取部件继续编辑');
    await load(undo.before);undo=null;sourceId=null;newDraft();status('已恢复修改前的模型；旧求解时程不恢复。');
  });
  $('parametric-show-mesh').onchange=()=>{if(plan){const mesh=plan.meshPreviews?.[0]?.mesh;if($('parametric-show-mesh').checked&&mesh)preview.showMesh(mesh);else preview.show(plan.cadPreviews[0].cad);}};
  $('parametric-ai').onclick=()=>{try{const context=getContext();if(!context.modeling)throw Error(context.error);window.dispatchEvent(new CustomEvent('cad-parametric-assistant-request',{detail:context}));status('已附上参数化草稿。可以让 AI 修改指定尺寸、查看参数或生成网格。');}catch(error){issue(error);}};
  section.addEventListener('toggle',preview.resize);newDraft();
  return {loadPart,getContext,refresh,dispose(){controller?.abort();preview.dispose();section.remove();}};
}
