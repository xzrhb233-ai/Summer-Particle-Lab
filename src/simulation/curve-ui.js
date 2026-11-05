import {normalizeCurves,curveValue,bindingUnit,curveBounds} from './curves.js';
import {toLegacy} from './project.js';

const hint='绑定输出 = 偏置 + 倍率 × 曲线值，替换所选载荷分量。曲线结束后保持末值；需要停止时，请将末值设为零。编辑后重置试验。';
export function mountCurvePanels(folder){
  const field=(id,label,value,type='number')=>`<label for="${id}">${label}</label><input id="${id}" type="${type}" value="${value}" ${type==='number'?'step="any"':''}>`;
  const select=(id,label,items=[])=>`<label for="${id}">${label}</label><select id="${id}">${items.map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select>`;
  folder('loads','project-curves-panel','时间曲线').innerHTML+=
    select('curve-edit','已有时间曲线')+field('curve-name','曲线名称','新曲线','text')+
    select('curve-type','插值方式',[['linear','分段线性'],['smooth','平滑斜坡'],['step','阶跃保持'],['sine','正弦']])+
    '<div id="curve-table-fields"><label for="curve-points">时间表（每行：秒, 值）</label><textarea id="curve-points" rows="6" spellcheck="false">0, 0\n1, 1\n2, 0</textarea></div>'+
    '<div id="curve-sine-fields" hidden>'+field('curve-start','开始时间（s）',0)+field('curve-end','结束时间（s）',2)+field('curve-amplitude','正弦幅值',1)+field('curve-frequency','频率（Hz）',1)+field('curve-phase','相位（度）',0)+field('curve-offset','正弦偏置',0)+'</div>'+
    '<canvas id="curve-preview" aria-label="时间曲线预览" style="width:100%;height:150px"></canvas><p id="curve-preview-status" class="hint" role="status"></p>'+
    '<div class="buttons"><button id="curve-add">添加曲线并重置</button><button id="curve-update">更新曲线并重置</button><button id="curve-remove">删除曲线及其绑定</button></div>'+
    `<p class="hint">${hint}</p>`;
  folder('loads','project-load-bindings','曲线载荷绑定').innerHTML+=
    select('binding-edit','已有曲线绑定')+field('binding-name','绑定名称','新绑定','text')+
    select('binding-curve','使用时间曲线')+select('binding-kind','绑定载荷类型',[
      ['region-heat','粒子区域热功率'],['body-heat','刚体热功率'],['motor-target','关节驱动目标'],['body-force','刚体力'],['body-torque','刚体力矩'],['fem-force','FEM 面力'],['fem-pressure','FEM 面压力']])+
    select('binding-target','载荷目标')+select('binding-load','FEM 目标面载荷')+select('binding-component','世界坐标分量',[['0','X'],['1','Y'],['2','Z']])+
    field('binding-scale','载荷倍率',1)+field('binding-offset','载荷偏置',0)+
    '<label class="check"><input id="binding-enabled" type="checkbox" checked>启用曲线绑定</label><p id="binding-unit" class="hint" role="status"></p>'+
    '<div class="buttons"><button id="binding-add">添加绑定并重置</button><button id="binding-update">更新绑定并重置</button><button id="binding-remove">删除绑定并重置</button></div>'+
    '<p class="hint">热源区域沿用“热源与降温”的位置和半径。在线手动加热或降温会停用该热源的曲线绑定。位置驱动通过电机施力，实际位置可能滞后。</p>';
  folder('results','project-load-results','载荷指令与响应').innerHTML+=
    select('load-result','测量曲线绑定')+
    '<canvas id="load-command-chart" aria-label="载荷指令与施加值" style="width:100%;height:150px"></canvas>'+
    '<canvas id="load-response-chart" aria-label="实际动力学与温度响应" style="width:100%;height:150px"></canvas>'+
    '<p id="load-readout" class="hint" role="status" style="white-space:pre-line;font-variant-numeric:tabular-nums"></p><button id="load-export">导出载荷响应 CSV</button>'+
    '<p class="hint">青色为当前指令，橙色为最近物理步施加值；响应另图显示，各图独立单位。指令积分不是机械功。热源指令积分与实际热输入可能因温度下限或空区域而不同。</p>';
}
// All series in one chart must share units. A separate chart carries the response.
export function plot(canvas,series,unit){
  const width=Math.floor(canvas.getBoundingClientRect().width);if(width<20)return;
  const height=150,dpr=window.devicePixelRatio||1;canvas.width=width*dpr;canvas.height=height*dpr;
  const c=canvas.getContext('2d');c.scale(dpr,dpr);c.clearRect(0,0,width,height);
  const points=series.flatMap(s=>s.points).filter(p=>Number.isFinite(p[1]));
  if(!points.length)return;
  let lo=Math.min(...points.map(p=>p[1])),hi=Math.max(...points.map(p=>p[1]));
  const maxT=Math.max(.001,...points.map(p=>p[0])),pad=(hi-lo)*.08||Math.max(1,Math.abs(lo)*.05);lo-=pad;hi+=pad;
  const color=getComputedStyle(canvas).color;c.strokeStyle=color;c.globalAlpha=.2;c.strokeRect(54,18,width-64,107);c.globalAlpha=1;
  c.fillStyle=color;c.font='10px monospace';c.fillText(`${unit}`,4,11);c.fillText(hi.toPrecision(3),2,27);c.fillText(lo.toPrecision(3),2,124);c.fillText('0 s',54,143);c.fillText(maxT.toFixed(3)+' s',width-65,143);
  for(const s of series){c.beginPath();c.strokeStyle=s.color;c.lineWidth=1.7;let active=false;for(const [t,v] of s.points){if(!Number.isFinite(v)){active=false;continue;}const x=54+t/maxT*(width-64),y=125-(v-lo)/(hi-lo)*107;if(active)c.lineTo(x,y);else c.moveTo(x,y);active=true;}c.stroke();}
}
const csvCell=v=>typeof v==='string'?'"'+(/^[=+\-@\t\r]/.test(v)?"'":'')+v.replaceAll('"','""')+'"':v??'';
export function loadCSV(frames){
  const rows=[['time_s','binding_id','target','kind','command_unit','requested','applied_last_step','step_start_s','step_end_s','command_integral_unit_s','response_unit','response','actual_total_external_heat_J','thermal_residual_J']];
  for(const f of frames)for(const r of f.loadResponses??[])rows.push([f.time,r.id,r.target,r.kind,r.unit,r.requested,r.applied,r.intervalStart,r.intervalEnd,r.commandIntegral,r.responseUnit,r.response,f.coupling?.externalHeat,f.coupling?.thermalResidual]);
  return rows.map(row=>row.map(csvCell).join(',')).join('\n');
}
export function wireCurves({getProject,load,guard,download,getHistory}){
  const $=id=>document.getElementById(id),n=id=>$(id).valueAsNumber,en=()=>document.documentElement.lang==='en';
  let lastFrame=null,lastDraw=0;
  function options(id,items){
    const old=$(id).value;$(id).replaceChildren(...items.map(x=>{const o=document.createElement('option');o.value=x.id;o.textContent=x.name??x.id;o.dataset.userContent='';return o;}));
    if(items.some(x=>x.id===old))$(id).value=old;
  }
  function next(items,prefix){let i=1;while(items.some(x=>x.id===prefix+i))i++;return prefix+i;}
  function curveFields(id){
    const c={id,name:$('curve-name').value,type:$('curve-type').value};
    if(c.type==='sine')for(const k of ['start','end','amplitude','frequency','phase','offset'])c[k]=n('curve-'+k);
    else c.points=$('curve-points').value.trim().split(/\r?\n/).map(row=>row.trim().split(/[,\s]+/).map(Number));
    return normalizeCurves([c])[0];
  }
  function preview(){
    $('curve-table-fields').hidden=$('curve-type').value==='sine';$('curve-sine-fields').hidden=!$('curve-table-fields').hidden;
    try{
      const c=curveFields('preview'),end=c.type==='sine'?c.end:c.points.at(-1)[0],ts=Array.from({length:321},(_,i)=>i*end/320);
      if(c.points)for(const [t] of c.points)ts.push(Math.max(0,t-1e-9),t);
      plot($('curve-preview'),[{color:'#22a9b6',points:ts.sort((a,b)=>a-b).map(t=>[t,curveValue(c,t)])}],en()?'value':'曲线值');
      $('curve-preview-status').textContent=en()?'Preview · endpoints held outside range':'预览 · 范围外保持端点值';
    }catch(e){$('curve-preview-status').textContent=e.message;$('curve-preview').getContext('2d').clearRect(0,0,$('curve-preview').width,$('curve-preview').height);}
  }
  function readCurve(){
    const c=getProject().curves.find(c=>c.id===$('curve-edit').value);if(!c){preview();return;}
    $('curve-name').value=c.name;$('curve-type').value=c.type;
    if(c.type==='sine')for(const k of ['start','end','amplitude','frequency','phase','offset'])$('curve-'+k).value=c[k];
    else $('curve-points').value=c.points.map(p=>p.join(', ')).join('\n');preview();
  }
  function targets(){
    const project=getProject(),fem=project.solver.adapter.startsWith('cpu-fem-');
    const select=$('binding-kind');
    for(const o of select.options)o.hidden=o.disabled=fem?!o.value.startsWith('fem-'):o.value.startsWith('fem-');
    if(select.selectedOptions[0]?.disabled)select.value=fem?'fem-force':'region-heat';
    const kind=select.value;
    $('binding-load').hidden=$('binding-load').previousElementSibling.hidden=!fem;
    if(fem){options('binding-target',project.parts.filter(p=>p.method==='fem'));faceLoads();$('binding-component').disabled=kind!=='fem-force';units();return;}
    const m=toLegacy(project);
    const items=kind==='region-heat'?(m.coupling?.parts.length?[{id:'mpm',name:en()?'Particle heat region':'粒子热源区域'}]:[]):kind==='motor-target'?m.joints.filter(j=>j.motor):m.bodies.filter(b=>kind==='body-heat'||b.type==='dynamic');
    options('binding-target',items);$('binding-component').disabled=!['body-force','body-torque'].includes(kind);units();
  }
  function faceLoads(){const p=getProject();options('binding-load',p.loads.filter(l=>l.target===$('binding-target').value&&l.type===$('binding-kind').value).map(l=>({id:l.id,name:l.id+' / '+p.selectionSets.find(s=>s.id===l.selection)?.region.face})));}
  function fields(id){return {id,name:$('binding-name').value,kind:$('binding-kind').value,target:$('binding-target').value,load:$('binding-load').value,curve:$('binding-curve').value,component:Number($('binding-component').value),scale:n('binding-scale'),offset:n('binding-offset'),enabled:$('binding-enabled').checked};}
  function units(){
    const p=getProject(),b=fields('preview'),c=p.curves.find(c=>c.id===b.curve),unit=bindingUnit(b,p.connections);
    const values=c?curveBounds(c).map(v=>b.offset+b.scale*v).sort((a,b)=>a-b):[];
    $('binding-unit').textContent=`${en()?'Output':'输出'} ${unit}${values.length?` · ${values[0].toPrecision(4)} … ${values[1].toPrecision(4)}`:''}`;
  }
  function readBinding(){
    const b=getProject().loadBindings.find(b=>b.id===$('binding-edit').value);
    if(!b){targets();return;}
    $('binding-name').value=b.name;$('binding-kind').value=b.kind;targets();
    for(const k of ['curve','target','scale','offset'])$('binding-'+k).value=b[k];
    if(b.kind.startsWith('fem-')){faceLoads();$('binding-load').value=b.load;}
    $('binding-component').value=String(b.component??0);$('binding-enabled').checked=b.enabled;units();
  }
  for(const id of ['curve-type','curve-points','curve-start','curve-end','curve-amplitude','curve-frequency','curve-phase','curve-offset'])$(id).addEventListener('input',preview);
  $('curve-edit').onchange=readCurve;$('binding-edit').onchange=readBinding;$('binding-kind').onchange=targets;
  for(const id of ['binding-target','binding-curve','binding-scale','binding-offset'])$(id).addEventListener('input',()=>{if(id==='binding-target')faceLoads();units();});
  for(const what of ['curve','binding']){
    const key=what==='curve'?'curves':'loadBindings',read=what==='curve'?curveFields:fields;
    $(what+'-add').onclick=guard(async()=>{const p=getProject(),id=next(p[key],what+'-');p[key].push(read(id));await load(p);$(what+'-edit').value=id;(what==='curve'?readCurve:readBinding)();});
    $(what+'-update').onclick=guard(()=>{const p=getProject(),i=p[key].findIndex(x=>x.id===$(what+'-edit').value);if(i<0)throw Error(en()?'Select an existing item first':'请先选择已有条目');p[key][i]=read(p[key][i].id);return load(p);});
    $(what+'-remove').onclick=guard(()=>{const p=getProject(),id=$(what+'-edit').value;p[key]=p[key].filter(x=>x.id!==id);if(what==='curve')p.loadBindings=p.loadBindings.filter(b=>b.curve!==id);return load(p);});
  }
  $('load-export').onclick=guard(()=>download('\ufeff'+loadCSV(getHistory()),'summer-load-responses.csv','text/csv;charset=utf-8'));
  $('load-result').onchange=()=>{lastDraw=0;if(lastFrame)display(lastFrame);};
  new ResizeObserver(()=>{preview();lastDraw=0;}).observe($('curve-preview'));
  window.addEventListener('workbench-languagechange',()=>{preview();targets();lastDraw=0;if(lastFrame)display(lastFrame);});
  function refresh(){
    const p=getProject();options('curve-edit',p.curves);options('binding-curve',p.curves);options('binding-edit',p.loadBindings);options('load-result',p.loadBindings);
    readCurve();readBinding();lastDraw=0;
  }
  function display(f){
    lastFrame=f;if(!$('project-load-results').open||performance.now()-lastDraw<150)return;lastDraw=performance.now();
    const id=$('load-result').value,r=f.loadResponses?.find(x=>x.id===id);
    if(!r){$('load-readout').textContent=en()?'No active binding in this frame (manual heat overrides disable bindings).':'此帧无启用绑定（手动热源操作会停用对应绑定）。';for(const id of ['load-command-chart','load-response-chart']){$(id).getContext('2d').clearRect(0,0,$(id).width,$(id).height);}return;}
    const frames=getHistory().filter(x=>x.time<=f.time+1e-9),points=key=>frames.map(x=>[x.time,x.loadResponses?.find(r=>r.id===id)?.[key]??NaN]);
    plot($('load-command-chart'),[{color:'#22a9b6',points:points('requested')},{color:'#e3a048',points:points('applied')}],r.unit);
    plot($('load-response-chart'),[{color:'#b08de2',points:points('response')}],r.responseUnit);
    const fmt=v=>Number.isFinite(v)?v.toPrecision(6):'—';
    $('load-readout').textContent=`t = ${f.time.toFixed(4)} s\n${en()?'Requested / applied':'当前指令 / 最近步施加'} ${fmt(r.requested)} / ${fmt(r.applied)} ${r.unit}\n${en()?'Physical interval':'物理步区间'} ${r.intervalStart.toFixed(6)} → ${r.intervalEnd.toFixed(6)} s\n${en()?'Actual response':'实际响应'} ${fmt(r.response)} ${r.responseUnit}\n${en()?'Command integral':'指令积分'} ${fmt(r.commandIntegral)} ${r.unit}·s`+
      (r.kind.endsWith('heat')&&f.coupling?`\n${en()?'Total external heat / balance residual':'总外部热输入 / 平衡残差'} ${fmt(f.coupling.externalHeat)} / ${fmt(f.coupling.thermalResidual)} J`:'');
  }
  return {refresh,display};
}
