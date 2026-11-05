import {buildMesh} from './cad-client.js';
import {mountCADPreview} from './cad-preview.js';
import {validateMeshOptions,meshToVTK,meshToOBJ} from '../three/cad-tools.js';
import {addCADFEM} from './cad-mesh-model.js';

const $=id=>document.getElementById(id);
const download=(name,text,type='text/plain')=>{const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
export function wireCADMesh({parent,getContext,getProject,load,busy,assertApplied,editPart}){
  const panel=document.createElement('details');panel.id='cad-mesh-modeler';panel.innerHTML=`<summary>表面网格与 FEM 体网格</summary>
    <p class="hint">使用上方已保存的实体步骤。网格坐标对应原始 CAD，整体变换请在生成 FEM 后设置。曲线本身不构成实体。</p>
    <label for="cad-mesh-kind">网格类型</label><select id="cad-mesh-kind"><option value="surface">表面三角形 · SMLib</option><option value="volume">四面体 Tet4 · TetGen</option></select>
    <label for="cad-mesh-size">目标单元边长（m）</label><input id="cad-mesh-size" type="number" min="0.005" max="12" step="0.01" value="0.15">
    <details><summary>曲面逼近精度</summary><label for="cad-mesh-angle">角度容差（°）</label><input id="cad-mesh-angle" type="number" min="3" max="45" value="15"><label for="cad-mesh-chord">弦高容差（m）</label><input id="cad-mesh-chord" type="number" min="0.00001" max="0.1" step="0.001" value="0.002"></details>
    <p class="hint">目标尺寸是细化尺度，非严格最大边长。体网格上限 5000 节点 / 24000 单元；减小尺寸会增加计算量。</p>
    <button id="cad-mesh-build">生成网格</button><canvas id="cad-mesh-canvas" aria-label="CAD 网格线框预览"></canvas>
    <label for="cad-mesh-cut">体网格 Y 向剖切（按单元中心筛选）</label><input id="cad-mesh-cut" type="range" min="0.05" max="1" step="0.05" value="1">
    <p id="cad-mesh-status" role="status" class="hint">先生成网格，再检查质量与导出。</p>
    <div class="buttons"><button id="cad-mesh-vtk" disabled>导出 VTK</button><button id="cad-mesh-obj" disabled>导出表面 OBJ</button></div>
    <details><summary>加入 CPU FEM</summary><p class="hint">创建新部件，保留原部件。重叠副本需在计算前自行处理。固定面按 CAD 包围盒极值面选择；球面等无平面支撑的实体暂不支持。</p>
    <label for="cad-fem-name">FEM 部件名称</label><input id="cad-fem-name" value="CAD 四面体部件" maxlength="80">
    <label for="cad-fem-young">杨氏模量（Pa）</label><input id="cad-fem-young" type="number" value="100000" min="1" step="10000">
    <label for="cad-fem-poisson">泊松比</label><input id="cad-fem-poisson" type="number" value="0.3" min="0" max="0.49" step="0.01">
    <label for="cad-fem-density">密度（kg/m³）</label><input id="cad-fem-density" type="number" value="1000" min="0.001">
    <label for="cad-fem-fixed">固定面</label><select id="cad-fem-fixed">${['x-','x+','y-','y+','z-','z+'].map(v=>`<option ${v==='y-'?'selected':''}>${v}</option>`).join('')}</select><button id="cad-mesh-fem" disabled>新增 FEM 部件</button></details>`;
  parent.append(panel);const preview=mountCADPreview($('cad-mesh-canvas'));let mesh=null,signature='',working=false;
  const options=()=>validateMeshOptions({kind:$('cad-mesh-kind').value,targetSize:$('cad-mesh-size').valueAsNumber,angleTolerance:$('cad-mesh-angle').valueAsNumber,chordTolerance:$('cad-mesh-chord').valueAsNumber});
  const current=()=>{try{return mesh&&!getContext().unsavedChanges&&signature===JSON.stringify({recipe:getContext().recipe,options:options()});}catch{return false;}};
  const status=(s,error=false)=>{$('cad-mesh-status').textContent=s;$('cad-mesh-status').classList.toggle('cad-error',error);};
  function refresh(){for(const id of ['cad-mesh-build','cad-mesh-kind','cad-mesh-size','cad-mesh-angle','cad-mesh-chord'])$(id).disabled=working;for(const id of ['cad-mesh-vtk','cad-mesh-obj'])$(id).disabled=working||!current();$('cad-mesh-fem').disabled=working||!current()||mesh?.kind!=='volume';$('cad-mesh-cut').disabled=working||mesh?.kind!=='volume';}
  const run=fn=>async()=>{if(working)return;working=true;refresh();try{await fn();}catch(e){status(e.message,true);}finally{working=false;refresh();}};
  $('cad-mesh-build').onclick=run(async()=>{
    const ctx=getContext();if(ctx.unsavedChanges)throw Error('请先保存实体步骤');const requested={recipe:ctx.recipe,options:options()};signature='';mesh=null;preview.clear();status('正在生成网格并检查单元质量…');
    const built=await buildMesh(requested.recipe,requested.options);if(JSON.stringify({recipe:getContext().recipe,options:options()})!==JSON.stringify(requested)||getContext().unsavedChanges)throw Error('建模步骤已改变，请重新生成网格');
    mesh=built;signature=JSON.stringify(requested);$('cad-mesh-cut').value='1';preview.showMesh(mesh);
    status(`${mesh.generator} · ${mesh.nodes.length} 节点 · ${mesh.elements.length} ${mesh.kind==='volume'?'四面体':'三角形'}`+(mesh.kind==='volume'?`\n体积 ${mesh.volume.toPrecision(6)} m³ · 相对 CAD 体积误差 ${(mesh.volumeRelativeError*100).toFixed(3)}%\n最小形状质量 ${mesh.quality.minMeanRatio.toFixed(3)}（1为正四面体）· 最小高度 ${mesh.quality.minAltitude.toPrecision(3)} m\n翻转 ${mesh.quality.negativeElements} · 退化 ${mesh.quality.degenerateElements}`:'\n这是表面网格，不能直接当作 FEM 体单元。'));
  });
  $('cad-mesh-cut').oninput=()=>{if(mesh)preview.showMesh(mesh,{cut:$('cad-mesh-cut').valueAsNumber});};
  for(const id of ['cad-mesh-kind','cad-mesh-size','cad-mesh-angle','cad-mesh-chord'])$(id).addEventListener('input',()=>{mesh=null;signature='';preview.clear();status('参数已改变，请重新生成网格。');refresh();});
  $('cad-mesh-vtk').onclick=run(async()=>{if(!current())throw Error('请重新生成匹配当前步骤的网格');download('summer-'+mesh.kind+'.vtk',meshToVTK(mesh));});
  $('cad-mesh-obj').onclick=run(async()=>{if(!current())throw Error('请重新生成匹配当前步骤的网格');download('summer-surface.obj',meshToOBJ(mesh));});
  $('cad-mesh-fem').onclick=run(async()=>{if(!current())throw Error('请先生成当前实体的四面体网格');if(busy())throw Error('请先暂停模拟');assertApplied();const before=getProject(),draft=addCADFEM(before,mesh,{name:$('cad-fem-name').value,young:$('cad-fem-young').valueAsNumber,poisson:$('cad-fem-poisson').valueAsNumber,density:$('cad-fem-density').valueAsNumber,fixedFace:$('cad-fem-fixed').value});const part=draft.parts.find(p=>!before.parts.some(b=>b.id===p.id));await load(draft);editPart(part.id);status(`已加入 ${part.name}；在求解目录运行 CPU FEM。`);});
  panel.addEventListener('toggle',preview.resize);refresh();return {refresh,dispose(){preview.dispose();panel.remove();}};
}
