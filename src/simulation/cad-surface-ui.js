import {buildSurface} from './cad-client.js';
import {mountCADPreview} from './cad-preview.js';
import {createSurfaceTemplate,validateSurfaceSpec,validateSurface,surfaceToOBJ,surfaceToVTK} from '../three/cad-surfaces.js';

const clone=value=>structuredClone(value),fingerprint=e=>JSON.stringify(e?{name:e.name,spec:e.data.spec,area:e.data.area}:null);
const download=(text,ext)=>{const url=URL.createObjectURL(new Blob([text],{type:ext==='json'?'application/json':'text/plain'})),a=document.createElement('a');a.href=url;a.download='summer-surface.'+ext;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
export function wireCADSurfaces({parent,getProject,load,busy,assertApplied}){
  const panel=document.createElement('details');panel.id='cad-surface-modeler';panel.innerHTML=`<summary>自由曲面建模</summary>
    <p class="hint">SMLib 原生参数曲面，坐标单位 m。编辑控制点决定形状，U / V 分段数决定导出网格精度。开放曲面可保存为参考几何，尚不能直接作为实体、接触物体或 FEM 壳单元。</p>
    <label for="cad-surface-saved">项目中的曲面</label><select id="cad-surface-saved"></select><div class="buttons"><button id="cad-surface-read">读取曲面</button><button id="cad-surface-new">新建曲面</button><button id="cad-surface-delete">删除曲面</button></div>
    <label for="cad-surface-name">曲面名称</label><input id="cad-surface-name" value="SMLib 马鞍曲面" maxlength="80">
    <label for="cad-surface-kind">曲面类型</label><select id="cad-surface-kind"><option value="bilinear">四角曲面 · 2 × 2</option><option value="bezier" selected>Bézier 曲面 · 双三次 4 × 4</option><option value="bspline">B 样条曲面 · 双三次 4–8 × 4–8</option></select>
    <label for="cad-surface-template">起始形状</label><select id="cad-surface-template"><option value="saddle">马鞍面</option><option value="dome">拱顶</option><option value="wave">波浪</option></select>
    <div class="gravity-coordinates"><label>U 控制点数<input id="cad-surface-rows" type="number" value="4" min="4" max="8"></label><label>V 控制点数<input id="cad-surface-cols" type="number" value="4" min="4" max="8"></label></div><button id="cad-surface-template-load">重建草稿控制网</button><p class="hint">重建或切换类型会替换当前草稿控制网，已保存曲面保持不变。</p>
    <div class="gravity-coordinates"><label>编辑第 U 行<select id="cad-surface-u"></select></label><label>第 V 列<select id="cad-surface-v"></select></label></div>
    <div class="gravity-coordinates">${['X','Y','Z'].map((a,k)=>`<label>${a}（m）<input id="cad-surface-point${k}" type="number" step="0.05" aria-label="曲面控制点 ${a}"></label>`).join('')}</div>
    <details><summary>完整控制网 JSON</summary><p class="hint">数组格式为 [U行][V列][X,Y,Z]。读取参数后编辑，再点击应用。</p><button id="cad-surface-net-read">读取控制网</button><textarea id="cad-surface-net" rows="6" spellcheck="false" aria-label="曲面控制网 JSON"></textarea><button id="cad-surface-net-apply">应用控制网输入</button></details>
    <div class="gravity-coordinates"><label>U 网格分段<input id="cad-surface-segments-u" type="number" min="4" max="64" value="16"></label><label>V 网格分段<input id="cad-surface-segments-v" type="number" min="4" max="64" value="16"></label></div>
    <button id="cad-surface-build">生成曲面与网格</button><canvas id="cad-surface-canvas" aria-label="SMLib 自由曲面预览；拖动旋转、滚轮缩放"></canvas>
    <div class="buttons"><label class="check"><input id="cad-surface-wire" type="checkbox" checked>显示网格</label><label class="check"><input id="cad-surface-controls" type="checkbox" checked>显示控制网</label></div>
    <p id="cad-surface-status" role="status" class="hint">设置控制点，生成曲面后可保存或导出。</p>
    <button id="cad-surface-save" disabled>保存参考曲面</button><div class="buttons"><button id="cad-surface-obj" disabled>导出 OBJ</button><button id="cad-surface-vtk" disabled>导出 VTK</button><button id="cad-surface-json" disabled>导出定义 JSON</button></div><button id="cad-surface-ai">交给 AI 编辑曲面</button>`;
  parent.append(panel);const $=id=>panel.querySelector('#'+id),preview=mountCADPreview($('cad-surface-canvas'));
  let points=createSurfaceTemplate().controlPoints,result=null,signature='',sourceId=null,sourceSignature='',savedSignature='',working=false,dirty=false,controller=null,revision=0,disposed=false,netSnapshot='';
  const saved=()=>getProject()?.cadSurfaces??[],status=(s,error=false)=>{$('cad-surface-status').textContent=s;$('cad-surface-status').classList.toggle('cad-error',error);};
  const name=()=>{const n=$('cad-surface-name').value.trim();if(!n)throw Error('请填写曲面名称');return n;};
  const pendingNet=()=>$('cad-surface-net').value!==netSnapshot;
  const pendingGrid=()=>$('cad-surface-rows').valueAsNumber!==points.length||$('cad-surface-cols').valueAsNumber!==points[0].length;
  const requireApplied=()=>{if(pendingNet())throw Error('控制网 JSON 有未应用修改，请先点击“应用控制网输入”');if(pendingGrid())throw Error('控制点数量已改变，请先点击“重建草稿控制网”');};
  const spec=()=>{requireApplied();return validateSurfaceSpec({kind:$('cad-surface-kind').value,controlPoints:points,segmentsU:$('cad-surface-segments-u').valueAsNumber,segmentsV:$('cad-surface-segments-v').valueAsNumber});};
  const current=()=>{try{return !!result&&signature===JSON.stringify(spec());}catch{return false;}};
  const show=()=>{if(result)preview.showSurface(result,{wireframe:$('cad-surface-wire').checked,controlNet:$('cad-surface-controls').checked});};
  function fillPoint(){const p=points[Number($('cad-surface-u').value)]?.[Number($('cad-surface-v').value)];if(p)p.forEach((x,k)=>{$('cad-surface-point'+k).value=x;});}
  function fillNet(){
    for(const [id,count] of [['cad-surface-u',points.length],['cad-surface-v',points[0].length]]){const old=$(id).value;$(id).replaceChildren(...Array.from({length:count},(_,i)=>new Option(String(i+1),String(i))));if(Number(old)<count)$(id).value=old||'0';}
    $('cad-surface-rows').value=points.length;$('cad-surface-cols').value=points[0].length;fillPoint();netSnapshot=JSON.stringify(points,null,2);$('cad-surface-net').value=netSnapshot;
  }
  function refresh(){
    if(disposed)return;
    const list=saved(),next=JSON.stringify(list.map(e=>[e.id,fingerprint(e)])),chosen=$('cad-surface-saved').value;
    if(savedSignature!==next){savedSignature=next;$('cad-surface-saved').replaceChildren(new Option('请选择已保存曲面',''),...list.map(e=>new Option(e.name,e.id)));if(list.some(e=>e.id===chosen))$('cad-surface-saved').value=chosen;else if(list.some(e=>e.id===sourceId))$('cad-surface-saved').value=sourceId;}
    for(const el of panel.querySelectorAll('input,select,textarea,button'))el.disabled=working;
    for(const id of ['cad-surface-save','cad-surface-obj','cad-surface-vtk','cad-surface-json'])$(id).disabled=working||!current();
    const chosenExists=list.some(e=>e.id===$('cad-surface-saved').value);for(const id of ['cad-surface-read','cad-surface-delete'])$(id).disabled=working||!chosenExists;
    for(const id of ['cad-surface-rows','cad-surface-cols'])$(id).disabled=working||$('cad-surface-kind').value!=='bspline';
    $('cad-surface-save').textContent=sourceId?'更新参考曲面':'保存参考曲面';
  }
  function invalidate(){revision++;controller?.abort();result=null;signature='';dirty=true;preview.clear();}
  const run=fn=>async()=>{if(working)return;working=true;refresh();try{await fn();}catch(e){if(e.name!=='AbortError')status(e.message,true);}finally{working=false;controller=null;refresh();}};
  function rebuild(){
    try{const draft=createSurfaceTemplate($('cad-surface-kind').value,$('cad-surface-rows').valueAsNumber,$('cad-surface-cols').valueAsNumber,$('cad-surface-template').value);points=draft.controlPoints;invalidate();fillNet();refresh();status('已重建草稿控制网，请重新生成曲面。');}catch(e){status(e.message,true);}
  }
  $('cad-surface-saved').onchange=refresh;
  $('cad-surface-net').oninput=()=>{dirty=true;refresh();status('控制网 JSON 有未应用修改；请应用输入后再生成。');};
  for(const id of ['cad-surface-rows','cad-surface-cols'])$(id).oninput=()=>{dirty=true;refresh();status('控制点数量已改动；点击重建草稿控制网后才能生成。');};
  $('cad-surface-template-load').onclick=rebuild;
  $('cad-surface-kind').onchange=()=>{if($('cad-surface-kind').value==='bspline'){$('cad-surface-rows').value=Math.max(4,points.length);$('cad-surface-cols').value=Math.max(4,points[0].length);}rebuild();};
  for(const id of ['cad-surface-u','cad-surface-v'])$(id).onchange=fillPoint;
  for(let k=0;k<3;k++)$('cad-surface-point'+k).oninput=()=>{if(pendingNet()||pendingGrid()){fillPoint();status('请先应用控制网 JSON 或重建控制网，再编辑单个控制点。',true);return;}points[Number($('cad-surface-u').value)][Number($('cad-surface-v').value)][k]=$('cad-surface-point'+k).valueAsNumber;invalidate();netSnapshot=JSON.stringify(points,null,2);$('cad-surface-net').value=netSnapshot;refresh();status('控制点已改变，请重新生成曲面。');};
  for(const id of ['cad-surface-segments-u','cad-surface-segments-v'])$(id).oninput=()=>{invalidate();refresh();status('网格分段已改变，请重新生成曲面。');};
  $('cad-surface-name').oninput=()=>{dirty=true;};
  for(const id of ['cad-surface-wire','cad-surface-controls'])$(id).onchange=show;
  $('cad-surface-net-read').onclick=()=>{netSnapshot=JSON.stringify(points,null,2);$('cad-surface-net').value=netSnapshot;refresh();status('已用当前控制点填入 JSON，未应用的文本已还原。');};
  $('cad-surface-net-apply').onclick=()=>{try{if($('cad-surface-net').value.length>20000)throw Error('控制网输入过长');const candidate=JSON.parse($('cad-surface-net').value),next=validateSurfaceSpec({kind:$('cad-surface-kind').value,segmentsU:$('cad-surface-segments-u').valueAsNumber,segmentsV:$('cad-surface-segments-v').valueAsNumber,controlPoints:candidate});points=next.controlPoints;invalidate();fillNet();refresh();status('控制网输入已应用，请生成曲面。');}catch(e){status(e.message,true);}};
  $('cad-surface-build').onclick=run(async()=>{
    const input=spec(),key=JSON.stringify(input),before=JSON.stringify(getProject()),token=++revision;result=null;signature='';preview.clear();controller=new AbortController();status('SMLib 正在构建曲面并采样三角网格…');
    const surface=validateSurface(await buildSurface(input,{signal:controller.signal}));
    if(disposed||token!==revision||JSON.stringify(spec())!==key||JSON.stringify(getProject())!==before)throw Error('曲面输入或项目已改变，请重新生成');
    result=surface;signature=key;show();status(`SMLib · U/V 次数 ${surface.degreeU}/${surface.degreeV} · ${surface.nodes.length} 节点 · ${surface.elements.length} 三角形\n离散面积 ${surface.area.toPrecision(6)} m²（网格近似）\n开放参考曲面，尚未作为物理部件加入求解。`);
  });
  $('cad-surface-save').onclick=run(async()=>{
    if(!current())throw Error('请先生成与输入一致的曲面预览');if(busy())throw Error('请先暂停并等待当前求解结束');assertApplied();
    const project=getProject(),list=clone(project.cadSurfaces??[]),i=list.findIndex(e=>e.id===sourceId);
    if(sourceId&&(i<0||fingerprint(list[i])!==sourceSignature))throw Error('原曲面已被修改或删除，请重新读取或另存');
    if(i<0&&list.length>=16)throw Error('最多保存 16 个参考曲面');
    const entry={id:sourceId??'surf-'+crypto.randomUUID().replace(/-/g,''),name:name(),data:clone(result)};if(i<0)list.push(entry);else list[i]=entry;
    await load({...project,cadSurfaces:list});sourceId=entry.id;sourceSignature=fingerprint(entry);dirty=false;refresh();$('cad-surface-saved').value=entry.id;status(`已保存“${entry.name}”，主视图显示为参考曲面；物理部件未增加。`);
  });
  $('cad-surface-read').onclick=()=>{
    if(dirty||pendingNet()||pendingGrid()){status('草稿有未保存修改，请先保存；或点击“新建曲面”解除编辑身份，再读取。',true);return;}
    const entry=saved().find(e=>e.id===$('cad-surface-saved').value);if(!entry)return;
    try{result=clone(validateSurface(entry.data));const s=result.spec;points=clone(s.controlPoints);$('cad-surface-kind').value=s.kind;$('cad-surface-name').value=entry.name;$('cad-surface-segments-u').value=s.segmentsU;$('cad-surface-segments-v').value=s.segmentsV;sourceId=entry.id;sourceSignature=fingerprint(entry);fillNet();signature=JSON.stringify(spec());show();refresh();status('已读取参考曲面，可以修改控制点后重新生成。');}catch(e){status(e.message,true);}
  };
  $('cad-surface-new').onclick=()=>{sourceId=null;sourceSignature='';dirty=false;fillNet();refresh();$('cad-surface-saved').value='';status('当前已应用参数已作为新草稿，未应用的控制网输入已还原；保存时将创建另一曲面。');};
  $('cad-surface-delete').onclick=run(async()=>{if(busy())throw Error('请先暂停模拟');assertApplied();const p=getProject(),id=$('cad-surface-saved').value;if(!p.cadSurfaces?.some(e=>e.id===id))throw Error('请选择已有曲面');await load({...p,cadSurfaces:p.cadSurfaces.filter(e=>e.id!==id)});if(sourceId===id){sourceId=null;sourceSignature='';}status('参考曲面已删除；当前草稿保留，可重新保存。');});
  for(const ext of ['obj','vtk','json'])$('cad-surface-'+ext).onclick=()=>{try{if(!current())throw Error('请重新生成曲面');download(ext==='obj'?surfaceToOBJ(result):ext==='vtk'?surfaceToVTK(result):JSON.stringify(result,null,2),ext);}catch(e){status(e.message,true);}};
  $('cad-surface-ai').onclick=()=>{try{window.dispatchEvent(new CustomEvent('cad-surface-assistant-request',{detail:{spec:spec(),name:name(),...(sourceId?{id:sourceId}:{})}}));}catch(e){status(e.message,true);}};
  panel.addEventListener('toggle',preview.resize);fillNet();refresh();
  return {refresh,getContext(){try{return {spec:spec(),name:$('cad-surface-name').value,...(sourceId?{id:sourceId}:{}),unsavedChanges:dirty,previewCurrent:current()};}catch{return {invalidDraft:true,unsavedChanges:true};}},dispose(){disposed=true;controller?.abort();panel.removeEventListener('toggle',preview.resize);preview.dispose();panel.remove();}};
}
