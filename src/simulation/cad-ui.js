import {requestCAD,buildCAD} from './cad-client.js';
import {mountCADPreview} from './cad-preview.js';
import {CAD_TEMPLATES,createCADTemplate,moveCADStep,deleteCADStep} from './cad-templates.js';
import {validateCADRecipe} from '../three/cad-geometry.js';
import {addProjectPart} from './part-builder.js';
import {domainParameters,geometryParameters,geometryPoints} from '../three/discretization.js';
import {wireCADCurves} from './cad-curve-ui.js';
import {wireCADMesh} from './cad-mesh-ui.js';
import {wireCADSurfaces} from './cad-surface-ui.js';
import {wireCADProfileEditor} from './cad-profile-editor.js';
import {wireParametricCAD} from './cad-parametric-ui.js';

const $=id=>document.getElementById(id),clone=v=>structuredClone(v);
const vector=(id,label,value)=>`<label>${label}</label><div class="gravity-coordinates">${['X','Y','Z'].map((a,k)=>`<label>${a}<input id="${id}${k}" type="number" step="0.01" value="${value[k]}" aria-label="${label} ${a}"></label>`).join('')}</div>`;

export function wireCAD({getProject,load,loadFEM=load,busy,assertApplied,editPart}){
  const panel=document.createElement('details');panel.id='cad-modeler';panel.className='cad-modeler';panel.dataset.userContent='';panel.dataset.study='project';
  panel.innerHTML=`<summary>SMLib CAD 建模</summary><p class="hint">先选参数化零件，通过尺寸建模；需要自定义轮廓、曲线或曲面时展开高级工具。CAD 仿真目前使用 CPU。</p><div id="cad-simple-slot"></div><details id="cad-advanced-modeler"><summary>自由建模与高级几何</summary>
    <div class="buttons"><button id="cad-jump-curve">曲线建模 ↓</button><button id="cad-jump-surface">自由曲面 ↓</button><button id="cad-jump-mesh">表面 / 体网格 ↓</button></div>
    <div class="buttons"><button id="cad-health">检查内核</button><button id="cad-read-part">读取选中 CAD 部件</button></div>
    <label for="cad-template">常用建模模板</label><div class="cad-template-row"><select id="cad-template">${CAD_TEMPLATES.map(t=>`<option value="${t.id}">${t.label}</option>`).join('')}</select><button id="cad-demo">载入模板</button></div><p id="cad-template-info" class="hint"></p>
    <label for="cad-feature">建模步骤</label><select id="cad-feature"></select><p class="hint">步骤按顺序计算；差集是“已有实体 − 当前工具体”。最多 8 步。</p>
    <label for="cad-operation">当前步骤运算</label><select id="cad-operation"><option value="base">初始实体</option><option value="union">并集 · 添加</option><option value="difference">差集 · 切除</option><option value="intersection">交集 · 保留重合</option></select>
    <label for="cad-shape">工具体</label><select id="cad-shape"><option value="box">长方体</option><option value="sphere">球</option><option value="cylinder">Y 轴圆柱</option><option value="extrude">闭合轮廓 → 拉伸实体</option><option value="revolve">闭合轮廓 → 旋转实体</option></select>
    ${vector('cad-center','中心 / 轮廓位置偏移（m）',[0,.7,0])}<div id="cad-size-fields">${vector('cad-size','尺寸 / 直径（m）',[.8,.5,.6])}</div>
    <div id="cad-profile-slot"></div>
    <details><summary>工具体旋转</summary>${vector('cad-rotation','XYZ 旋转（°）',[0,0,0])}</details>
    <div class="buttons"><button id="cad-save-feature">保存此步骤</button><button id="cad-add-feature">添加步骤</button><button id="cad-delete-feature">删除此步骤</button></div>
    <div class="buttons"><button id="cad-move-up">步骤上移</button><button id="cad-move-down">步骤下移</button></div>
    <p id="cad-draft-status" class="hint"></p><button id="cad-build">生成 CAD 预览</button>
    <canvas id="cad-canvas" aria-label="SMLib 实体预览；拖动旋转，滚轮缩放"></canvas><p class="hint">拖动旋转，滚轮缩放；此窗口是 CAD 预览，不是模拟结果。</p>
    <p id="cad-status" class="hint" role="status" aria-live="polite">点击“检查内核”确认 SMLib 运行环境。</p>
    <label for="cad-name">部件名称</label><input id="cad-name" value="SMLib 打孔块" maxlength="80">
    <label for="cad-method">离散方法</label><select id="cad-method"><option value="mpm">MPM 固体（CPU）</option><option value="pbf">PBF 流体（CPU）</option><option value="fem">FEM（使用下方体网格入口）</option></select>
    <button id="cad-ask-ai">让 AI 编辑这些步骤</button><p class="hint">把已保存的步骤、名称与方法交给 AI。AI 会先生成建模提案；检查预览后再应用到项目。</p>
    <div class="buttons"><button id="cad-insert" disabled>添加到项目</button><button id="cad-export" disabled>导出 CAD（USDA）</button></div>
    <p class="hint">沿用当前粒子间距；生成后在“编辑项目部件”调整位置、尺寸与材料。孔径建议至少为粒子间距的 3 倍。CAD 特征和网格随项目 JSON 保存。</p></details>`;
  $('unified-parts').after(panel);
  let recipe=createCADTemplate('through-hole').recipe,selected=0,result=null,signature='',working=false,sourcePartId=null,parametricUI=null;
  const preview=mountCADPreview($('cad-canvas'));
  const read=id=>[0,1,2].map(k=>$(id+k).valueAsNumber),put=(id,v)=>v.forEach((x,k)=>$(id+k).value=x);
  const dirty=()=>{try{const input=readFeature(),saved=recipe[selected];return [...new Set([...Object.keys(input),...Object.keys(saved)])].some(k=>JSON.stringify(input[k])!==JSON.stringify(saved[k]));}catch{return true;}};
  const current=()=>result&&signature===JSON.stringify(recipe)&&!dirty();
  const status=(s,error=false)=>{$('cad-status').textContent=s;$('cad-status').classList.toggle('cad-error',error);};
  const invalidate=()=>{result=null;signature='';preview.clear();};
  const profileEditor=wireCADProfileEditor({parent:$('cad-profile-slot'),onChange(){invalidate();refresh();}});
  const requireSaved=()=>{if(dirty()){status('请先保存当前步骤，避免丢失输入',true);return false;}return true;};
  const context=()=>{
    const source=getProject().parts.find(p=>p.id===sourcePartId&&p.geometry.shape==='cad');
    return {recipe:clone(recipe),name:$('cad-name').value,method:$('cad-method').value,selectedStep:selected,unsavedChanges:dirty(),previewCurrent:!!current(),...(source?{sourcePartId:source.id,sourceGeometry:Object.fromEntries(['center','size','rotation'].map(k=>[k,clone(source.geometry[k])]))}:{})};
  };
  function readFeature(){const shape=$('cad-shape').value;return {operation:$('cad-operation').value,shape,center:read('cad-center'),rotation:read('cad-rotation'),...(['extrude','revolve'].includes(shape)?profileEditor.read():{size:read('cad-size')})};}
  function refresh(){
    for(const e of panel.querySelectorAll('input,select,button,textarea'))if(!e.closest('#cad-parametric-modeler,#cad-curve-modeler,#cad-mesh-modeler,#cad-surface-modeler'))e.disabled=working;
    profileEditor.refresh(working);
    $('cad-insert').disabled=working||!current()||$('cad-method').value==='fem';$('cad-export').disabled=working||!current();
    $('cad-delete-feature').disabled=working||selected===0;
    $('cad-move-up').disabled=working||selected<=1;
    $('cad-move-down').disabled=working||selected===0||selected===recipe.length-1;
    $('cad-add-feature').disabled=working||recipe.length>=8;
    $('cad-draft-status').textContent=dirty()?'当前输入尚未保存。点击“保存此步骤”，再生成预览。':current()?'预览对应已保存步骤。':'步骤已改变，请重新生成预览。';
    for(const o of $('cad-operation').options)o.disabled=selected===0?o.value!=='base':o.value==='base';
  }
  function choose(){
    $('cad-feature').replaceChildren(...recipe.map((r,i)=>new Option(`${i+1}. ${r.operation} · ${r.shape}`,String(i))));$('cad-feature').value=String(selected);
    const r=recipe[selected];$('cad-operation').value=r.operation;$('cad-shape').value=r.shape;put('cad-center',r.center);put('cad-size',r.size??[.8,.5,.6]);put('cad-rotation',r.rotation);$('cad-size-fields').hidden=['extrude','revolve'].includes(r.shape);profileEditor.setFeature(r);refresh();
  }
  function loadPart(id){
    if(working){status('请等待当前 CAD 操作完成',true);return false;}
    const part=getProject().parts.find(p=>p.id===id);
    if(part?.modeling&&parametricUI){panel.open=true;$('cad-advanced-modeler').open=false;return parametricUI.loadPart(id);}
    if(!requireSaved())return false;
    if(!part?.geometry.cad){status('请在上方部件列表选择一个 CAD 部件',true);return false;}
    try{
      const savedRecipe=validateCADRecipe(part.geometry.cad.recipe);
      recipe=savedRecipe;result=clone(part.geometry.cad);signature=JSON.stringify(recipe);selected=0;sourcePartId=part.id;
      $('cad-name').value=part.name;$('cad-method').value=part.method;choose();panel.open=true;$('cad-advanced-modeler').open=true;preview.show(result);
      status('已读取原始 CAD 步骤（不含部件后来施加的整体平移、缩放和旋转）。手动添加会创建新部件；交给 AI 时可指定更新此部件。');return true;
    }catch(error){status(error.message,true);return false;}
  }
  const run=fn=>async()=>{if(working)return;working=true;refresh();try{await fn();}catch(e){status(e.message,true);}finally{working=false;refresh();}};
  $('cad-health').onclick=run(async()=>{const r=await requestCAD('health');status(`${r.kernel} · usd-brep ${r.version} · 内核就绪（CPU CAD，独立于物理 GPU）`);});
  $('cad-template').onchange=()=>{$('cad-template-info').textContent=CAD_TEMPLATES.find(t=>t.id===$('cad-template').value).description;};
  $('cad-demo').onclick=()=>{if(!requireSaved())return;const template=createCADTemplate($('cad-template').value);recipe=template.recipe;selected=0;sourcePartId=null;$('cad-name').value=template.name;invalidate();choose();status(`${template.label}步骤已载入，点击“生成 CAD 预览”。当前项目没有被替换。`);};
  $('cad-read-part').onclick=()=>loadPart($('unified-edit').value);
  $('cad-shape').addEventListener('change',()=>{const shape=$('cad-shape').value;$('cad-size-fields').hidden=['extrude','revolve'].includes(shape);profileEditor.setFeature({shape});invalidate();refresh();});
  $('cad-feature').onchange=()=>{if(dirty()){$('cad-feature').value=String(selected);status('请先保存当前步骤，再切换步骤',true);return;}selected=Number($('cad-feature').value);choose();};
  $('cad-save-feature').onclick=()=>{try{const next=clone(recipe);next[selected]=readFeature();recipe=validateCADRecipe(next);invalidate();choose();status('当前步骤已保存，请重新生成预览。');}catch(error){status(error.message,true);}};
  $('cad-add-feature').onclick=()=>{if(!requireSaved()||recipe.length>=8)return;recipe.push({operation:'difference',shape:'cylinder',center:[0,.7,0],size:[.3,.8,.3],rotation:[0,0,0]});selected=recipe.length-1;invalidate();choose();};
  $('cad-delete-feature').onclick=()=>{if(!requireSaved()||selected===0)return;recipe=deleteCADStep(recipe,selected);selected=Math.min(selected,recipe.length-1);invalidate();choose();};
  for(const [id,direction] of [['cad-move-up',-1],['cad-move-down',1]])$(id).onclick=()=>{if(!requireSaved())return;recipe=moveCADStep(recipe,selected,direction);selected+=direction;invalidate();choose();};
  $('cad-ask-ai').onclick=()=>{if(!requireSaved())return;try{validateCADRecipe(recipe);window.dispatchEvent(new CustomEvent('cad-assistant-request',{detail:context()}));status('已将当前 CAD 步骤交给 AI 助手。请描述想修改的位置、尺寸或孔槽；应用提案前项目保持不变。');}catch(error){status(error.message,true);}};
  for(const e of panel.querySelectorAll('input,select'))if(!e.closest('#cad-profile-editor'))e.addEventListener('input',()=>{if(dirty())invalidate();refresh();});
  $('cad-build').onclick=run(async()=>{
    if(dirty())throw Error('请先保存当前步骤');status('SMLib 正在构建实体并生成显示网格…');
    invalidate();result=await buildCAD(recipe);signature=JSON.stringify(recipe);preview.show(result);
    const p=getProject(),d=p.discretization?.mpm??{lower:[-3,-1,-3],upper:[3,4,3],cellSize:.2,particlesPerAxis:2};
    let note='';try{const domain=domainParameters({...d,lower:d.lower.map(x=>x/.025),upper:d.upper.map(x=>x/.025),cellSize:d.cellSize/.025}),geometry={shape:'cad',cad:result,center:result.lower.map((x,k)=>(x+result.upper[k])/2/.025),size:result.upper.map((x,k)=>(x-result.lower[k])/.025)};note=` · 当前网格采样 ${geometryPoints(geometryParameters(geometry,domain),16384).length} 点`;}catch(e){note=' · 离散提示：'+e.message;}
    status(`SMLib 实体有效 · 体积 ${result.volume.toPrecision(6)} m³ · ${result.indices.length/3} 三角形${note}`);
  });
  $('cad-insert').onclick=run(async()=>{
    if($('cad-method').value==='fem')throw Error('请在下方生成四面体网格，再加入 CPU FEM');if(!current())throw Error('先生成与当前步骤一致的 CAD 预览');if(busy())throw Error('请先暂停并等待当前模拟结束');assertApplied();
    const before=getProject();if(before.solver.adapter==='taichi-coupled'||before.solver.computeBackend==='gpu')throw Error('CAD 初始采样暂未接入 GPU。请在“求解与性能”选择 CPU 并应用，再添加。');
    const draft=addProjectPart(before,{method:$('cad-method').value,name:$('cad-name').value,geometry:{shape:'cad',cad:clone(result),center:result.lower.map((x,k)=>(x+result.upper[k])/2),size:result.upper.map((x,k)=>x-result.lower[k]),rotation:[0,0,0]},discretization:{sampling:{enabled:false}}});
    const id=draft.parts.find(b=>!before.parts.some(a=>a.id===b.id)).id;
    await load(draft);sourcePartId=id;editPart(id);status('CAD 部件已加入项目；在上方编辑材料，在“求解与性能”开始模拟。');
  });
  $('cad-export').onclick=run(async()=>{if(!current())throw Error('请先重新生成 CAD 预览');status('正在导出 SMLib BRep…');const r=await requestCAD('export',recipe),url=URL.createObjectURL(new Blob([r.usda],{type:'text/plain'})),a=document.createElement('a');a.href=url;a.download='summer-cad.usda';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('已导出 USDA，包含精确 BRep；它不是 FEM 体网格或 STEP 文件。');});
  panel.addEventListener('toggle',preview.resize);$('cad-template').onchange();choose();
  parametricUI=wireParametricCAD({parent:$('cad-simple-slot'),getProject,load,loadFEM,busy,assertApplied,editPart});
  const advanced=$('cad-advanced-modeler');
  const curveUI=wireCADCurves({parent:advanced,getProject,load,busy,assertApplied});
  const surfaceUI=wireCADSurfaces({parent:advanced,getProject,load,busy,assertApplied});
  const meshUI=wireCADMesh({parent:advanced,getContext:context,getProject,load:loadFEM,busy,assertApplied,editPart});
  const editParametric=e=>{if(typeof e.detail?.id==='string')loadPart(e.detail.id);};window.addEventListener('cad-parametric-edit',editParametric);
  for(const [button,id] of [['cad-jump-curve','cad-curve-modeler'],['cad-jump-surface','cad-surface-modeler'],['cad-jump-mesh','cad-mesh-modeler']])$(button).onclick=()=>{$(id).open=true;$(id).scrollIntoView({block:'start',behavior:'smooth'});};
  return {getContext:()=>({...context(),parametricDraft:parametricUI.getContext(),curveDraft:curveUI.getContext(),surfaceDraft:surfaceUI.getContext()}),loadPart,refresh(){parametricUI.refresh();curveUI.refresh();surfaceUI.refresh();meshUI.refresh();},dispose(){window.removeEventListener('cad-parametric-edit',editParametric);panel.removeEventListener('toggle',preview.resize);preview.dispose();parametricUI.dispose();curveUI.dispose();surfaceUI.dispose();meshUI.dispose();panel.remove();}};
}
