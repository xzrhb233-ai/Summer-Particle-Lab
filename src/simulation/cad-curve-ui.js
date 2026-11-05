import {buildCurve} from './cad-client.js';
import {validateCurveSpec,validateCurve} from '../three/cad-tools.js';
import {mountCADPreview} from './cad-preview.js';

const clone=value=>structuredClone(value);
const vector=(id,label,value)=>`<label>${label}</label><div class="gravity-coordinates">${['X','Y','Z'].map((axis,k)=>`<label>${axis}<input id="${id}${k}" type="number" step="0.01" value="${value[k]}" aria-label="${label} ${axis}"></label>`).join('')}</div>`;
const fingerprint=curve=>JSON.stringify(curve?{name:curve.name,spec:curve.data?.spec,length:curve.data?.length,points:curve.data?.points?.length}:null);

// Construction geometry uses the same fixed native CAD service as the solid
// modeler. Curves are saved independently of physical parts and load histories.
export function wireCADCurves({parent,getProject,load,busy,assertApplied}){
  const panel=document.createElement('details');panel.id='cad-curve-modeler';panel.className='cad-curve-modeler';
  panel.innerHTML=`<summary>曲线建模</summary>
    <p class="hint">创建空间曲线并保存到项目。曲线是构造几何，不会自动成为实体、有限元梁或载荷曲线。坐标单位 m，角度单位 °。</p>
    <label for="cad-curve-saved">项目中的曲线</label><select id="cad-curve-saved" aria-label="项目中的曲线"></select>
    <div class="buttons"><button id="cad-curve-read">读取所选曲线</button><button id="cad-curve-delete">删除所选曲线</button><button id="cad-curve-new">新建曲线</button></div>
    <label for="cad-curve-name">曲线名称</label><input id="cad-curve-name" value="SMLib 空间曲线" maxlength="80">
    <label for="cad-curve-kind">曲线类型</label><select id="cad-curve-kind"><option value="line">直线段</option><option value="circle">圆</option><option value="arc">圆弧</option><option value="bezier" selected>Bézier 曲线</option><option value="bspline">B 样条曲线</option></select>
    <div id="cad-curve-control-fields"><label for="cad-curve-points">控制点（每行 X, Y, Z）</label><textarea id="cad-curve-points" rows="5" spellcheck="false" aria-label="曲线控制点，每行三个米制坐标">-0.6, 0.3, 0
-0.2, 1.2, 0
0.2, 0.2, 0.3
0.6, 0.8, 0</textarea><p id="cad-curve-point-hint" class="hint"></p></div>
    <div id="cad-curve-round-fields" hidden>${vector('cad-curve-center','圆心（m）',[0,.7,0])}<label for="cad-curve-radius">半径（m）</label><input id="cad-curve-radius" type="number" value="0.4" min="0.001" max="12" step="0.01">${vector('cad-curve-rotation','XYZ 旋转（°）',[0,0,0])}<p class="hint">圆和圆弧初始位于 XY 平面，以圆心为中心按 X → Y → Z 顺序旋转。</p></div>
    <div id="cad-curve-arc-fields" hidden><label for="cad-curve-start">起始角（°）</label><input id="cad-curve-start" type="number" value="0" min="-360" max="360"><label for="cad-curve-end">终止角（°）</label><input id="cad-curve-end" type="number" value="180" min="-360" max="360"><p class="hint">终止角须大于起始角，跨度小于 360°；完整一圈请选择“圆”。</p></div>
    <div id="cad-curve-degree-fields" hidden><label for="cad-curve-degree">B 样条次数</label><input id="cad-curve-degree" type="number" value="3" min="1" max="5" step="1"><p class="hint">使用夹持均匀节点，次数须小于控制点个数。</p></div>
    <label for="cad-curve-samples">显示 / 导出分段数</label><input id="cad-curve-samples" type="number" value="64" min="8" max="512" step="1"><p class="hint">分段仅影响曲线显示与 JSON 采样；长度由 SMLib 原生曲线计算。</p>
    <button id="cad-curve-build">生成曲线</button><canvas id="cad-curve-canvas" aria-label="SMLib 曲线预览；拖动旋转，滚轮缩放"></canvas>
    <p id="cad-curve-status" class="hint" role="status" aria-live="polite">设置曲线后点击“生成曲线”。</p>
    <div class="buttons"><button id="cad-curve-save" disabled>保存到项目</button><button id="cad-curve-export" disabled>导出曲线 JSON</button></div><button id="cad-curve-ai">交给 AI 编辑曲线</button>`;
  parent.append(panel);
  const $=id=>panel.querySelector(`#${id}`),preview=mountCADPreview($('cad-curve-canvas'));
  let working=false,result=null,signature='',sourceId=null,sourceSignature='',savedSignature='',dirty=false,disposed=false,controller=null,revision=0;
  const status=(message,error=false)=>{$('cad-curve-status').textContent=message;$('cad-curve-status').classList.toggle('cad-error',error);};
  const readVector=id=>[0,1,2].map(k=>$(id+k).valueAsNumber);
  const putVector=(id,value)=>value.forEach((x,k)=>{$(id+k).value=x;});
  const saved=()=>getProject()?.cadCurves??[];
  const name=()=>{const value=$('cad-curve-name').value.trim();if(!value)throw Error('请填写曲线名称');return value.slice(0,80);};
  function readSpec(){
    const kind=$('cad-curve-kind').value,samples=$('cad-curve-samples').valueAsNumber;
    if(kind==='circle'||kind==='arc')return validateCurveSpec({kind,samples,center:readVector('cad-curve-center'),radius:$('cad-curve-radius').valueAsNumber,rotation:readVector('cad-curve-rotation'),...(kind==='arc'?{startAngle:$('cad-curve-start').valueAsNumber,endAngle:$('cad-curve-end').valueAsNumber}:{})});
    const points=$('cad-curve-points').value.trim().split(/\r?\n/).filter(line=>line.trim()).map(line=>{
      const tokens=line.trim().split(/[,，\s]+/);if(tokens.length!==3)throw Error('控制点每行必须填写三个坐标，例如 0.2, 0.8, 0');
      const values=tokens.map(Number);if(values.some(x=>!Number.isFinite(x)))throw Error('控制点必须使用有限数值');return values;
    });
    return validateCurveSpec({kind,samples,...(kind==='line'?{points}:{controlPoints:points}),...(kind==='bspline'?{degree:$('cad-curve-degree').valueAsNumber}:{})});
  }
  const current=()=>{try{return !!result&&signature===JSON.stringify(readSpec());}catch{return false;}};
  function updateFields(){
    const kind=$('cad-curve-kind').value,round=kind==='circle'||kind==='arc';
    $('cad-curve-control-fields').hidden=round;$('cad-curve-round-fields').hidden=!round;$('cad-curve-arc-fields').hidden=kind!=='arc';$('cad-curve-degree-fields').hidden=kind!=='bspline';
    $('cad-curve-point-hint').textContent=kind==='line'?'填写两个端点。':kind==='bezier'?'填写 2–9 个控制点；首尾点是曲线端点，中间点控制弯曲。':'填写 2–32 个控制点；曲线一般不经过中间控制点。';
  }
  function refresh(){
    if(disposed)return;
    const curves=saved(),next=JSON.stringify(curves.map(c=>[c.id,c.name,fingerprint(c)])),chosen=$('cad-curve-saved').value;
    if(next!==savedSignature){
      savedSignature=next;$('cad-curve-saved').replaceChildren(new Option('请选择已保存曲线',''),...curves.map(c=>new Option(c.name,c.id)));
      if(curves.some(c=>c.id===chosen))$('cad-curve-saved').value=chosen;
      else if(sourceId&&curves.some(c=>c.id===sourceId))$('cad-curve-saved').value=sourceId;
    }
    for(const input of panel.querySelectorAll('input,textarea,select,button'))input.disabled=working;
    const selected=curves.some(c=>c.id===$('cad-curve-saved').value),hasPreview=current();
    $('cad-curve-read').disabled=working||!selected;$('cad-curve-delete').disabled=working||!selected;
    $('cad-curve-save').disabled=working||!hasPreview;$('cad-curve-export').disabled=working||!hasPreview;
    $('cad-curve-save').textContent=sourceId?'更新项目曲线':'保存到项目';updateFields();
  }
  function invalidate(){revision++;controller?.abort();result=null;signature='';preview.clear();dirty=true;}
  function fill(entry){
    const data=validateCurve(clone(entry.data)),spec=data.spec;
    $('cad-curve-name').value=entry.name;$('cad-curve-kind').value=spec.kind;$('cad-curve-samples').value=spec.samples;
    if(spec.kind==='circle'||spec.kind==='arc'){
      putVector('cad-curve-center',spec.center);putVector('cad-curve-rotation',spec.rotation??[0,0,0]);$('cad-curve-radius').value=spec.radius;
      if(spec.kind==='arc'){$('cad-curve-start').value=spec.startAngle;$('cad-curve-end').value=spec.endAngle;}
    }else{$('cad-curve-points').value=(spec.points??spec.controlPoints).map(p=>p.join(', ')).join('\n');if(spec.kind==='bspline')$('cad-curve-degree').value=spec.degree;}
    sourceId=entry.id;sourceSignature=fingerprint(entry);result=data;signature=JSON.stringify(readSpec());dirty=false;revision++;preview.showCurve(result);refresh();
  }
  const run=fn=>async()=>{if(working)return;working=true;refresh();try{await fn();}catch(error){if(error.name!=='AbortError')status(error.message,true);}finally{working=false;controller=null;refresh();}};
  $('cad-curve-build').onclick=run(async()=>{
    const spec=readSpec(),key=JSON.stringify(spec),projectKey=JSON.stringify(getProject()),token=++revision;
    result=null;signature='';preview.clear();controller=new AbortController();status('SMLib 正在构建原生曲线…');
    const built=validateCurve(await buildCurve(spec,{signal:controller.signal}));
    if(disposed||token!==revision||key!==JSON.stringify(readSpec())||JSON.stringify(getProject())!==projectKey)throw Error('曲线输入或项目已变化，请重新生成曲线');
    result=built;signature=key;preview.showCurve(result);
    status(`SMLib 曲线有效 · 长度 ${result.length.toPrecision(7)} m · ${result.points.length-1} 段 · ${result.closed?'闭合':'开放'}曲线。预览包围盒来自采样点。`);
  });
  $('cad-curve-save').onclick=run(async()=>{
    if(!current())throw Error('请先生成与输入一致的曲线预览');if(busy())throw Error('请先暂停并等待当前模拟结束');assertApplied();
    const project=getProject(),curves=clone(project.cadCurves??[]),index=curves.findIndex(c=>c.id===sourceId),curveName=name();
    if(sourceId&&(index<0||fingerprint(curves[index])!==sourceSignature))throw Error('原曲线已被其他操作修改或删除，请重新读取后编辑，或点击“新建曲线”另存');
    if(index<0&&curves.length>=32)throw Error('每个项目最多保存 32 条构造曲线');
    const entry={id:sourceId??`curve-${crypto.randomUUID().replace(/-/g,'')}`,name:curveName,data:clone(result)};
    if(index<0)curves.push(entry);else curves[index]=entry;
    await load({...project,cadCurves:curves});sourceId=entry.id;sourceSignature=fingerprint(entry);dirty=false;refresh();$('cad-curve-saved').value=entry.id;
    status(`已${index<0?'保存':'更新'}“${entry.name}”。它是构造曲线，不参与物理求解。`);
  });
  $('cad-curve-read').onclick=()=>{
    if(working)return;if(dirty){status('当前曲线有未保存输入。请先生成并保存；或者点击“新建曲线”保留当前输入为新草稿后再选择读取。',true);return;}
    const entry=saved().find(c=>c.id===$('cad-curve-saved').value);if(!entry)return;
    try{fill(entry);status(`已读取“${entry.name}” · 长度 ${result.length.toPrecision(7)} m`);}catch(error){status(error.message,true);}
  };
  $('cad-curve-new').onclick=()=>{if(working)return;sourceId=null;sourceSignature='';dirty=false;$('cad-curve-saved').value='';refresh();status('已切换为新曲线草稿，保留当前参数。可修改后生成，也可读取已有曲线。');};
  $('cad-curve-delete').onclick=run(async()=>{
    if(busy())throw Error('请先暂停并等待当前模拟结束');assertApplied();
    const project=getProject(),id=$('cad-curve-saved').value,entry=(project.cadCurves??[]).find(c=>c.id===id);if(!entry)throw Error('请选择要删除的项目曲线');
    await load({...project,cadCurves:project.cadCurves.filter(c=>c.id!==id)});
    if(sourceId===id){sourceId=null;sourceSignature='';dirty=true;}refresh();status(`已删除项目曲线“${entry.name}”。当前编辑参数保留，可另存为新曲线。`);
  });
  $('cad-curve-export').onclick=()=>{
    try{if(!current())throw Error('请先生成与输入一致的曲线预览');const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='summer-cad-curve.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('已导出曲线定义及采样点 JSON；精确长度由 SMLib 计算。');}catch(error){status(error.message,true);}
  };
  $('cad-curve-ai').onclick=()=>{try{window.dispatchEvent(new CustomEvent('cad-curve-assistant-request',{detail:{spec:readSpec(),name:name(),...(sourceId?{id:sourceId}:{})}}));status('已将曲线定义交给 AI。请描述需要的端点、控制点、半径或旋转。');}catch(error){status(error.message,true);}};
  for(const input of panel.querySelectorAll('input,textarea,select')){
    if(input.id==='cad-curve-saved'){input.addEventListener('change',refresh);continue;}
    input.addEventListener('input',()=>{if(input.id==='cad-curve-name')dirty=true;else invalidate();refresh();});
  }
  panel.addEventListener('toggle',preview.resize);refresh();
  return {refresh,getContext(){try{return {spec:readSpec(),name:$('cad-curve-name').value,...(sourceId?{id:sourceId}:{}),unsavedChanges:dirty,previewCurrent:current()};}catch{return {invalidDraft:true,unsavedChanges:true};}},dispose(){disposed=true;revision++;controller?.abort();panel.removeEventListener('toggle',preview.resize);preview.dispose();panel.remove();}};
}
