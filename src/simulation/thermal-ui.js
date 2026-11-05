import {isThermalLoad} from './thermal-loads.js';
import {listPartSurfaces} from './surface-selections.js';
import {plot} from './curve-ui.js';
import {partTemperature,interfaceHeat,thermalHistoryCSV} from './thermal-history.js';
const $=id=>document.getElementById(id),en=()=>document.documentElement.lang==='en',tr=(a,b)=>en()?b:a;
const select=(id,label,values=[])=>`<label for="${id}">${label}</label><select id="${id}">${values.map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select>`;
const field=(id,label,value)=>`<label for="${id}">${label}</label><input id="${id}" type="number" step="any" value="${value}">`;
export function mountThermalPanels(folder){
  folder('loads','project-thermal-loads','部件热载荷').innerHTML+=
    select('heat-edit','已有热载荷')+select('heat-target','接收热量的部件')+
    select('heat-region','热边界区域',[['whole','整个部件'],...['x-','x+','y-','y+','z-','z+'].map(x=>[x,x.toUpperCase()])])+
    select('heat-type','热载荷类型',[['thermal-power','总热功率（W，可为负）'],['thermal-temperature','指定温度（°C）'],['thermal-convection','环境对流']])+
    field('heat-power','总热功率（W）',1000)+field('heat-temperature','边界 / 环境温度（°C）',100)+field('heat-coefficient','对流系数（W/m²/K）',100)+
    select('heat-program-type','热边界时间表',[['none','恒定值'],['linear','线性插值'],['smooth','平滑插值'],['step','阶跃保持']])+'<label for="heat-program-points">时间表：每行 时间(s), 功率(W)或温度(°C)</label><textarea id="heat-program-points" rows="5" placeholder="0,20&#10;1,140&#10;2,20"></textarea>'+
    '<label class="check"><input id="heat-enabled" type="checkbox" checked>启用热载荷</label><div class="buttons"><button id="heat-add">添加热载荷并重置</button><button id="heat-update">更新热载荷并重置</button></div><button id="heat-remove">删除热载荷并重置</button><p id="heat-help" class="hint"></p>';
  folder('results','project-thermal-results','温度与热量收支').innerHTML+=
    '<p id="heat-mode-note" class="hint"></p>'+select('heat-temperature-part','温度测量部件')+
    select('heat-temperature-view','温度曲线显示',[['absolute','绝对温度（°C）'],['rise','相对初始温升（mK）']])+
    '<canvas id="heat-temperature-chart" aria-label="部件温度时程"></canvas><p id="heat-temperature-legend" class="hint"></p><p id="heat-temperature-readout" class="hint" style="white-space:pre-line" role="status"></p>'+
    select('heat-interface-pair','热流测量接触对')+'<canvas id="heat-interface-chart" aria-label="界面热流时程"></canvas><p id="heat-interface-readout" class="hint"></p><button id="heat-history-csv">导出温度与界面热流 CSV</button>'+
    '<div id="heat-generation-results" hidden><canvas id="heat-generation-chart" aria-label="耗散生热时程"></canvas><p id="heat-generation-legend" class="hint"></p><p id="heat-generation-readout" class="hint" style="white-space:pre-line" role="status"></p></div>'+
    select('heat-result','热量测量载荷')+'<canvas id="heat-chart" aria-label="Thermal boundary cumulative heat"></canvas><p id="heat-readout" class="hint" style="white-space:pre-line" role="status"></p><button id="heat-csv">导出热载荷时程 CSV</button>';
}
export function wireThermal({getProject,load,guard,getHistory,download}){
  let frame=null,drawn=0;
  const options=(id,items)=>{const before=$(id).value;$(id).replaceChildren(...items.map(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name??p.id;o.dataset.userContent='';return o;}));if(items.some(x=>x.id===before))$(id).value=before;};
  function regions(value=$('heat-region').value){
    const project=getProject(),part=project.parts.find(p=>p.id===$('heat-target').value),items=[{id:'whole',name:tr('整个部件','Whole part')}];
    if(part?.method!=='rigid'&&(part?.geometry.shape==='box'||part?.method==='fem'&&part?.geometry.shape==='cad'))items.push(...['x-','x+','y-','y+','z-','z+'].map(face=>({id:face,name:face.toUpperCase()})));
    if(part?.method==='fem'){
      items.push(...project.selectionSets.filter(s=>s.part===part.id&&s.entity==='face').map(s=>({id:'selection:'+s.id,name:tr('命名选择：','Selection: ')+s.name})));
      items.push(...listPartSurfaces(part).map(s=>({id:'surface:'+s.key,name:s.label})));
    }
    options('heat-region',items);$('heat-region').value=items.some(x=>x.id===value)?value:'whole';
  }
  const mode=()=>{
    $('heat-program-points').hidden=$('heat-program-type').value==='none';document.querySelector('label[for="heat-program-points"]').hidden=$('heat-program-points').hidden;
    const kind=$('heat-type').value;
    for(const [id,show] of [['heat-power',kind==='thermal-power'],['heat-temperature',kind!=='thermal-power'],['heat-coefficient',kind==='thermal-convection']]){$(id).hidden=!show;document.querySelector(`label[for="${id}"]`).hidden=!show;}
    regions();
  };
  const read=()=>{const l=getProject().loads.find(l=>l.id===$('heat-edit').value);if(l){$('heat-target').value=l.target;regions(l.selection?'selection:'+l.selection:l.region.type==='surface'?'surface:'+l.region.surface:l.region.type==='face'?l.region.face:'whole');$('heat-type').value=l.type;$('heat-power').value=l.power??1000;$('heat-temperature').value=l.temperature??100;$('heat-coefficient').value=l.coefficient??100;$('heat-enabled').checked=l.enabled;$('heat-program-type').value=l.program?.type??'none';$('heat-program-points').value=l.program?.points?.map(p=>p.join(',')).join('\n')??'';}mode();};
  function regionDefinition(){const value=$('heat-region').value;if(value.startsWith('selection:')){const selection=value.slice(10),set=getProject().selectionSets.find(s=>s.id===selection);if(!set)throw Error('命名选择已失效');return {selection,region:structuredClone(set.region)};}return {region:value.startsWith('surface:')?{type:'surface',surface:value.slice(8)}:value==='whole'?{type:'whole'}:{type:'face',face:value}};}
  const definition=id=>({id,name:id,...($('heat-program-type').value==='none'?{}:{program:{type:$('heat-program-type').value,points:$('heat-program-points').value.trim().split(/\n/).map(row=>row.split(/[,，\s]+/).map(Number))}}),target:$('heat-target').value,type:$('heat-type').value,...regionDefinition(),enabled:$('heat-enabled').checked,...($('heat-type').value==='thermal-power'?{power:$('heat-power').valueAsNumber}:{temperature:$('heat-temperature').valueAsNumber,...($('heat-type').value==='thermal-convection'?{coefficient:$('heat-coefficient').valueAsNumber}:{})})});
  function enable(p){if(['cpu-fem-dynamic','cpu-fem-mpm'].includes(p.solver.adapter))p.solver.thermal=true;return p;}
  $('heat-add').onclick=guard(async()=>{const p=getProject();let n=1;while(p.loads.some(l=>l.id==='heat-'+n))n++;const d=definition('heat-'+n);p.loads.push(d);await load(enable(p));$('heat-edit').value=d.id;read();});
  $('heat-update').onclick=guard(()=>{const p=getProject(),i=p.loads.findIndex(l=>l.id===$('heat-edit').value);if(i<0)throw Error(tr('请先选择热载荷','Select a thermal boundary'));p.loads[i]={...definition(p.loads[i].id),name:p.loads[i].name};return load(enable(p));});
  $('heat-remove').onclick=guard(()=>{const p=getProject();p.loads=p.loads.filter(l=>l.id!==$('heat-edit').value);return load(p);});
  $('heat-program-type').onchange=mode;$('heat-edit').onchange=read;$('heat-type').onchange=mode;$('heat-target').onchange=mode;$('heat-result').onchange=()=>{drawn=0;display(frame);};
  for(const id of ['heat-temperature-part','heat-temperature-view','heat-interface-pair'])$(id).onchange=()=>{drawn=0;display(frame);};
  $('heat-history-csv').onclick=guard(()=>download(thermalHistoryCSV(getHistory(),$('heat-temperature-part').value,$('heat-interface-pair').value),'temperature-interface-history.csv','text/csv'));
  $('heat-csv').onclick=guard(()=>{const rows=['time_s,load_id,target_id,heat_rate_W,interval_heat_J,cumulative_heat_J,requested_heat_J'];for(const f of getHistory())for(const l of f.thermalLoads??[])rows.push([f.time,l.id,l.target,l.heatRate,l.intervalHeat,l.heat,l.requestedHeat].join(','));download(rows.join('\n'),'part-thermal-loads.csv','text/csv');});
  function refresh(){const p=getProject(),ls=p.loads.filter(isThermalLoad);options('heat-edit',ls);options('heat-result',ls);options('heat-temperature-part',p.parts);options('heat-interface-pair',p.contactPairs.filter(c=>c.thermal));options('heat-target',p.parts.filter(b=>['mpm','pbf','fem'].includes(b.method)||b.method==='rigid'&&(p.solver.adapter==='cpu-fem-dynamic'||p.solver.mpmEnabled)));read();drawn=0;
    $('heat-help').textContent=tr('MPM / PBF / FEM 使用同一热载荷定义。功率为所选区域的总瓦数；负值冷却。定温边界记录实际补入或移出的热量。面沿部件局部坐标，随材料移动。MPM 整体对流按初始表面积和质量分配；相变更新焓。添加或编辑会重置试验。','MPM / PBF / FEM share this thermal boundary contract. Power is total W over the selected region; negative power cools. Prescribed temperature records actual reservoir heat. Local faces follow material points. Whole-body MPM convection uses reference area and mass weighting; phase changes update enthalpy. Editing resets the experiment.');}
  function display(f){if(!f)return;frame=f;if(!$('project-thermal-results').open||performance.now()-drawn<200)return;drawn=performance.now();const fmt=v=>Number.isFinite(v)?v.toPrecision(f.mixed?10:6):'—',l=f.thermalLoads?.find(l=>l.id===$('heat-result').value),balance=f.thermal??{residual:f.coupling?.thermalResidual,externalHeat:f.coupling?.externalHeat};
    const samples=getHistory().filter(x=>x.time<=f.time+1e-9),part=$('heat-temperature-part').value,pair=$('heat-interface-pair').value,T=partTemperature(f,part),T0=partTemperature(samples[0]??f,part),q=interfaceHeat(f,pair),d=getProject().contactPairs.find(p=>p.id===pair);
    const fixed=f.mixed?.thermalMode==='fixed-geometry';$('heat-mode-note').hidden=!fixed;
    $('heat-mode-note').textContent=tr('固定几何传热：热块由夹具保持接触，恒温热源的补热计入收支。此模式只推进温度，不计算压紧力、变形或热膨胀；可在求解设置切回力热耦合。','Fixed-geometry conduction: a fixture maintains contact; thermostat energy is accounted for. Only temperature advances; clamp force, deformation and expansion are not solved. Switch to thermomechanical coupling in solver settings.');
    const rise=$('heat-temperature-view').value==='rise';
    $('heat-temperature-legend').textContent=tr('蓝：最低 · 橙：质量加权平均 · 红：最高','Blue: minimum · orange: mass-weighted mean · red: maximum')+(rise?tr('；各自减去初始值，1 mK = 0.001°C','; each relative to its initial value, 1 mK = 0.001°C'):' (°C)');
    $('heat-temperature-readout').textContent=T?`t = ${f.time.toFixed(2)} s\n${tr('最低 / 平均 / 最高','Minimum / mean / maximum')}: ${[T.min,T.mean,T.max].map(x=>Number.isFinite(x)?x.toFixed(6):'—').join(' / ')} °C\n${tr('平均升温','Mean temperature rise')}: ${T0?((T.mean-T0.mean)*1000).toPrecision(6):'—'} mK`:tr('尚无温度记录','No temperature records');
    plot($('heat-temperature-chart'),[['min','#559dd5'],['mean','#e89942'],['max','#d86563']].map(([key,color])=>({color,points:samples.map(x=>{const v=partTemperature(x,part)?.[key];return [x.time,Number.isFinite(v)&&(!rise||Number.isFinite(T0?.[key]))?(rise?(v-T0[key])*1000:v):NaN];})})),rise?'mK':'°C');
    plot($('heat-interface-chart'),[{color:'#26a8ad',points:samples.filter(x=>x.time>0).map(x=>[x.time,interfaceHeat(x,pair)?.rate??NaN])}],'W');
    $('heat-interface-readout').textContent=q&&d?`${tr('正值表示热量进入','Positive heat enters')} ${getProject().parts.find(p=>p.id===d.b)?.name??d.b}: ${q.rate.toFixed(3)} W · ${tr('累计','total')} ${q.heat.toFixed(3)} J`:tr('未启用接触传热','No thermal contact enabled');
    const temperatures=(f.results?.parts??[]).map(p=>`${getProject().parts.find(b=>b.id===p.id)?.name??p.id}: ${fmt(p.values.temperature)} °C`).join('\n');
    $('heat-readout').textContent=`t = ${fmt(f.time)} s\n${temperatures}\n${tr('外界净供热 / 热量残差','Net external heat / heat residual')}: ${fmt(balance.externalHeat)} / ${fmt(balance.residual)} J`+(l?`\n${l.id} → ${l.target}\n${tr('当前区间热流 / 累计热量','Interval heat rate / cumulative heat')}: ${fmt(l.heatRate)} W / ${fmt(l.heat)} J`:'');
    if(f.mixed)$('heat-readout').textContent+='\n'+tr('界面进入 MPM 的累计热量','Cumulative interface heat into MPM')+': '+fmt(balance.interfaceHeatIntoMPM)+' J';
    $('heat-generation-results').hidden=!Number.isFinite(balance.generatedHeat);
    if(Number.isFinite(balance.generatedHeat)){
      const g=balance.generated;
      $('heat-generation-legend').textContent=tr('橙：塑性 / 蠕变生热 · 蓝：摩擦生热 · 青：总生热（J）','Orange: plastic / creep heat · blue: friction heat · teal: total generation (J)');
      $('heat-generation-readout').textContent=`${tr('内部累计生热','Cumulative generated heat')}: ${fmt(balance.generatedHeat)} J\n${tr('塑性功 → 转热','Plastic work → heat')}: ${fmt(balance.plasticWork)} → ${fmt(g?.plastic)} J\n${tr('摩擦损失 → 转热','Friction loss → heat')}: ${fmt(balance.frictionLoss)} → ${fmt(g?.friction)} J\n${tr('生热分配 MPM / FEM','Generated heat into MPM / FEM')}: ${fmt(g?.mpm)} / ${fmt(g?.fem)} J`;
      plot($('heat-generation-chart'),[['plastic','#e89942'],['friction','#559dd5'],['total','#26a8ad']].map(([key,color])=>({color,points:samples.map(x=>[x.time,key==='total'?x.thermal?.generatedHeat:x.thermal?.generated?.[key]])})),'J');
    }
    if(f.mixed?.backend)$('heat-readout').textContent+='\n'+tr('热量残差 = 热能变化 − 外界净供热 − 内部生热。接触传热是内部交换，不重复计入。完整热力学总能量尚未闭合。','Heat residual = thermal energy change − external heat − generated heat. Interface conduction is internal exchange, counted once. Full thermodynamic energy is not yet closed.');
    else if(f.fem&&!fixed)$('heat-readout').textContent+='\n'+tr('弱热弹性耦合：温度驱动热应变；暂不反算变形或摩擦生热。','Weak thermoelastic coupling: temperature drives thermal strain; deformation and friction do not generate heat.');
    plot($('heat-chart'),[{color:'#e89942',points:getHistory().filter(x=>x.time<=f.time+1e-9).map(x=>[x.time,x.thermalLoads?.find(l=>l.id===$('heat-result').value)?.heat??NaN])}],'J');
  }
  window.addEventListener('workbench-languagechange',()=>{refresh();display(frame);});
  return {refresh,display};
}
