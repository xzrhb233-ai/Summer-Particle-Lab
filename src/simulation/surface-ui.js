import {listPartSurfaces,resolveSurfaceSelection} from './surface-selections.js';
import {boxMesh} from '../fem/mesh.js';
import {prepareAssistantPlan,executePlan} from './assistant-commands.js';
import {mountSurfacePreview} from './surface-preview.js';

export function wireSurfaceSelections({parent,getProject,load,busy,assertApplied,loadExample}){
  const panel=document.createElement('details');panel.id='project-surfaces';panel.className='instrument';panel.dataset.userContent='';
  panel.innerHTML=`<summary>命名面与载荷</summary><p class="hint">选择实际网格上的面 → 命名 → 绑定约束、压力或热源。橙色为当前选择；拖动旋转，点击网格可选面。尺寸修改后按语义重新匹配，失效引用会阻止求解。</p>
    <button id="surface-example">载入孔壁受压与加热示例</button>
    <label for="surface-part">FEM 部件</label><select id="surface-part"></select>
    <label for="surface-selection">命名选择集</label><select id="surface-selection"></select>
    <label for="surface-name">选择集名称</label><input id="surface-name" maxlength="80" value="受载面">
    <label for="surface-key">几何面</label><select id="surface-key"></select>
    <canvas id="surface-canvas" aria-label="FEM 命名面选择预览"></canvas><p id="surface-measure" class="hint"></p>
    <button id="surface-preview-set">预览选择集修改</button>
    <details open><summary>绑定物理条件</summary>
      <label for="surface-load">载荷 / 约束</label><select id="surface-load"></select>
      <label for="surface-load-name">条件名称</label><input id="surface-load-name" value="面载荷" maxlength="80">
      <label for="surface-kind">类型</label><select id="surface-kind"><option value="fem-fixed">固定所选面</option><option value="fem-force">面总力（N，世界 XYZ）</option><option value="fem-pressure">压力（Pa，正值向内）</option><option value="thermal-power">总热功率（W，负值冷却）</option><option value="thermal-temperature">恒温（°C）</option><option value="thermal-convection">对流换热</option></select>
      <div id="surface-force-row" class="gravity-coordinates">${['X','Y','Z'].map((v,k)=>`<label>${v}<input id="surface-force-${k}" aria-label="面总力 ${v}" type="number" step="any" value="${k===1?-10:0}"></label>`).join('')}</div>
      <label id="surface-value-label" for="surface-value">数值</label><input id="surface-value" type="number" step="any" value="1000">
      <label id="surface-coefficient-label" for="surface-coefficient">对流系数（W/m²/K）</label><input id="surface-coefficient" type="number" step="any" min="0" value="100">
      <p class="hint">总功率按所选面的实际面积分配；同一命名选择集可绑定多个条件。更新现有条件保留其时间曲线。添加热源会启用瞬态温度场。</p>
      <button id="surface-preview-load">预览条件修改</button>
    </details>
    <p id="surface-status" role="status" class="hint" aria-live="polite"></p>
    <div class="buttons"><button id="surface-apply" disabled>应用预览并重置</button><button id="surface-read">重新读取项目</button></div>`;
  parent.append(panel);const $=id=>panel.querySelector('#'+id);let working=false,plan=null,mesh=null,meshSignature='',projectSignature='';
  const status=(s,error=false)=>{$('surface-status').textContent=s;$('surface-status').classList.toggle('cad-error',error);};
  const preview=mountSurfacePreview($('surface-canvas'),key=>{if(working)return;if([...$('surface-key').options].some(o=>o.value===key)){$('surface-key').value=key;invalidate();display();}});
  const part=()=>getProject()?.parts.find(p=>p.id===$('surface-part').value&&p.method==='fem');
  const unique=(items,prefix)=>{let n=1;while(items.some(i=>i.id===prefix+n))n++;return prefix+n;};
  const options=(el,entries,first=null)=>{const before=el.value;el.replaceChildren(...(first?[new Option(first,'')]:[]),...entries.map(x=>new Option(x.label??x.name??x.id,x.key??x.id)));if([...el.options].some(x=>x.value===before))el.value=before;};
  function invalidate(){plan=null;$('surface-apply').disabled=true;}
  function modes(){const k=$('surface-kind').value;$('surface-force-row').hidden=k!=='fem-force';const value=['fem-pressure','thermal-power','thermal-temperature','thermal-convection'].includes(k);$('surface-value').hidden=$('surface-value-label').hidden=!value;$('surface-value-label').textContent=({ 'fem-pressure':'压力（Pa，正值向内）','thermal-power':'所选面总热功率（W）','thermal-temperature':'边界温度（°C）','thermal-convection':'环境温度（°C）'})[k]??'数值';$('surface-coefficient').hidden=$('surface-coefficient-label').hidden=k!=='thermal-convection';}
  function display(){
    try{const p=part();if(!p){preview.clear();$('surface-measure').textContent='请先创建 FEM 部件，或载入上方示例。';return;}
      const signature=JSON.stringify([p.geometry,p.discretization,p.modeling]);if(signature!==meshSignature){mesh=boxMesh(p);meshSignature=signature;}
      if(!$('surface-key').value){preview.show(mesh);$('surface-measure').textContent='此部件尚无可追踪命名面；旧的包围盒面设置仍可使用。';return;}
      const selected=resolveSurfaceSelection(p,mesh,{type:'surface',surface:$('surface-key').value});preview.show(mesh,selected.triangleIndices);
      $('surface-measure').textContent=`${selected.label} · ${selected.triangles.length} 个边界三角形 · ${selected.nodes.length} 节点 · 面积 ${selected.area.toPrecision(6)} m²\n语义标识：${selected.key}`;
    }catch(e){preview.clear();$('surface-measure').textContent='面选择失效：'+e.message;status(e.message,true);}
  }
  function readSelection(){const p=part(),s=getProject()?.selectionSets.find(s=>s.id===$('surface-selection').value);options($('surface-key'),p?listPartSurfaces(p):[]);$('surface-name').value=s?.name??'受载面';if(s?.region.type==='surface')$('surface-key').value=s.region.surface;invalidate();display();}
  function readLoad(){const l=getProject()?.loads.find(l=>l.id===$('surface-load').value);if(l){$('surface-load-name').value=l.name??l.id;$('surface-kind').value=l.type;$('surface-value').value=String(l.pressure??l.power??l.temperature??1000);$('surface-coefficient').value=String(l.coefficient??100);(l.force??[0,-10,0]).forEach((v,k)=>$('surface-force-'+k).value=String(v));if(l.selection){$('surface-selection').value=l.selection;readSelection();}}invalidate();modes();}
  function refresh(){
    const p=getProject();if(!p)return;const signature=JSON.stringify(p);if(projectSignature&&projectSignature!==signature&&plan){invalidate();status('项目已改变，请重新预览。',true);}projectSignature=signature;
    options($('surface-part'),p.parts.filter(p=>p.method==='fem'));const b=part();options($('surface-selection'),p.selectionSets.filter(s=>s.part===b?.id&&s.region.type==='surface'),'＋ 新建命名选择集');
    options($('surface-load'),p.loads.filter(l=>l.target===b?.id&&['fem-fixed','fem-force','fem-pressure','thermal-power','thermal-temperature','thermal-convection'].includes(l.type)),'＋ 新建物理条件');
    readSelection();readLoad();panel.querySelectorAll('input,select,button').forEach(e=>e.disabled=working);$('surface-apply').disabled=working||!plan;for(const id of ['surface-preview-set','surface-preview-load'])$(id).disabled=working||!b||!$('surface-key').value;
  }
  function selectionCommand(){const p=getProject(),b=part();if(!b||!$('surface-key').value)throw Error('请先选择支持命名面的 FEM 部件');const existing=$('surface-selection').value,id=existing||unique(p.selectionSets,'surface-');return {command:'selection.'+(existing?'update':'create'),args:{id,name:$('surface-name').value,part:b.id,entity:'face',region:{type:'surface',surface:$('surface-key').value}}};}
  const host={getProject,load,loadStrict:load,busy:()=>busy(),assertApplied};
  const run=fn=>async()=>{if(working)return;working=true;panel.querySelectorAll('button,input,select').forEach(e=>e.disabled=true);try{await fn();}catch(e){status(e.message,true);}finally{working=false;panel.querySelectorAll('button,input,select').forEach(e=>e.disabled=false);$('surface-apply').disabled=!plan;modes();}};
  async function prepare(withLoad){if(busy())throw Error('请先暂停并等待当前求解结束');assertApplied();invalidate();const p=getProject(),set=selectionCommand(),commands=[set];
    if(withLoad){const existing=$('surface-load').value,type=$('surface-kind').value,args={id:existing||unique(p.loads,'surface-load-'),name:$('surface-load-name').value,type,target:part().id,selection:set.args.id};
      if(type==='fem-force')args.force=[0,1,2].map(k=>$('surface-force-'+k).valueAsNumber);
      if(type==='fem-pressure')args.pressure=$('surface-value').valueAsNumber;
      if(type==='thermal-power')args.power=$('surface-value').valueAsNumber;
      if(['thermal-temperature','thermal-convection'].includes(type))args.temperature=$('surface-value').valueAsNumber;
      if(type==='thermal-convection')args.coefficient=$('surface-coefficient').valueAsNumber;
      if(type.startsWith('thermal-')&&!p.solver.thermal)commands.unshift({command:'solver.configure',args:{thermal:true}});
      commands.push({command:'load.'+(existing?'update':'create'),args});
    }
    const prepared=await prepareAssistantPlan(p,{reply:'命名面与物理条件预览',commands});if(JSON.stringify(getProject())!==prepared.before)throw Error('项目已改变，请重新预览');
    const b=prepared.project.parts.find(b=>b.id===part().id),selected=resolveSurfaceSelection(b,boxMesh(b),set.args.region);plan=prepared;
    const condition=commands.find(c=>c.command.startsWith('load.'))?.args,value=condition?.force?.join(', ')??condition?.pressure??condition?.power??condition?.temperature;
    status(`${withLoad?'条件与选择集':'选择集'}校验通过：${set.args.name}\n${selected.label} · ${selected.nodes.length} 节点 · ${selected.area.toPrecision(6)} m²${withLoad?'\n'+$('surface-kind').selectedOptions[0].textContent+(value!==undefined?'：'+value:'')+(condition?.coefficient!==undefined?'；换热系数 '+condition.coefficient+' W/m²/K':''):''}${commands.some(c=>c.command==='solver.configure')?'\n同时启用瞬态温度场':''}\n当前项目尚未改变，应用会重置计算结果。`);display();
  }
  $('surface-preview-set').onclick=run(()=>prepare(false));$('surface-preview-load').onclick=run(()=>prepare(true));
  $('surface-apply').onclick=run(async()=>{if(!plan)throw Error('请先预览');const p=plan,set=p.commands.find(c=>c.command.startsWith('selection.')),l=p.commands.find(c=>c.command.startsWith('load.'));await executePlan(p,host);plan=null;refresh();$('surface-selection').value=set.args.id;readSelection();if(l){$('surface-load').value=l.args.id;readLoad();}status('已应用命名选择和物理条件。面引用随项目保存；修改几何后会重新检查。');});
  $('surface-example').onclick=run(async()=>{if(busy())throw Error('请先暂停求解');assertApplied();await loadExample();refresh();status('已载入孔壁受压与加热示例。选择孔壁可查看绑定，运行后查询真实温度和位移。');});
  $('surface-read').onclick=()=>{refresh();status('已读取项目中的命名选择与绑定条件。');};
  $('surface-part').onchange=()=>{options($('surface-selection'),[],'＋ 新建命名选择集');options($('surface-load'),[],'＋ 新建物理条件');refresh();};$('surface-selection').onchange=readSelection;$('surface-key').onchange=()=>{invalidate();display();};$('surface-load').onchange=readLoad;$('surface-kind').onchange=()=>{invalidate();modes();};
  panel.addEventListener('input',invalidate);panel.addEventListener('toggle',()=>{if(panel.open)preview.resize();});refresh();modes();
  return {refresh,dispose(){preview.dispose();panel.remove();}};
}
