import {plot} from './curve-ui.js';
export function mountContactPanels(folder){
  const select=(id,label)=>`<label for="${id}">${label}</label><select id="${id}"></select>`;
  folder('loads','project-contact-pairs','部件接触对').innerHTML+=
    '<p class="hint">显式接触对覆盖默认接触参数；未指定的部件对继续继承默认值。机械接触与界面换热可分别启用。</p>'+
    select('pair-edit','已有接触对')+'<label for="pair-name">接触对名称</label><input id="pair-name" type="text" value="新接触对">'+
    select('pair-a','部件 A（刚体 / MPM / PBF）')+select('pair-b','部件 B（MPM / PBF）')+
    '<label class="check"><input id="pair-mechanical" type="checkbox" checked>启用该对力学接触</label>'+
    '<label for="pair-friction">接触对摩擦系数</label><input id="pair-friction" type="number" step="0.05" min="0" max="2" value="0.3">'+
    '<div id="pair-fem-settings" hidden><label for="pair-stiffness">法向接触刚度（N/m）</label><input id="pair-stiffness" type="number" min="1" max="1e10" step="any" value="100000"><label for="pair-damping">压缩接触阻尼（N·s/m）</label><input id="pair-damping" type="number" min="0" max="1e6" step="any" value="20"><label for="pair-thermal-area">等效接触传热面积（m²）</label><input id="pair-thermal-area" type="number" min="1e-12" step="any" value="0.001"><p id="pair-fem-hint" class="hint"></p></div>'+
    '<label class="check"><input id="pair-thermal" type="checkbox" checked>启用该对界面换热</label>'+
    '<label for="pair-conductance">界面换热系数（W/m²/K）</label><input id="pair-conductance" type="number" min="0" max="100000" step="100" value="1000">'+
    '<div class="buttons"><button id="pair-add">添加接触对并重置</button><button id="pair-update">更新接触对并重置</button></div>'+
    '<button id="pair-remove">删除接触对并恢复默认</button>'+
    '<p class="hint">摩擦系数为零表示无摩擦；关闭换热或系数为零表示该界面绝热。刚体接触沿用刚体恢复系数；MPM—MPM 接触不额外施加回弹，反弹来自材料弹性。粒子内部导热使用默认传热开关。</p>'+
    '<p class="hint">多部件项目采用独立 MPM 网格速度场，支持接触、摩擦与自由分离。间隙由局部粒子域近似；MPM—MPM 力学接触仅在双方固态时生效，熔化后沿用 PBF 压力耦合。</p>';
  folder('results','project-contact-results','接触对结果').innerHTML+=
    select('pair-result','测量接触对')+
    '<label for="pair-result-field">接触曲线变量</label><select id="pair-result-field"><option value="normalForce">法向接触力（N）</option><option value="tangentialForce">切向接触力（N）</option><option value="slipSpeed">平均滑移速度（m/s）</option><option value="heatRate">传导进入 A 的热流（W）</option><option value="accumulatedHeat">传导进入 A 的累计热量（J）</option><option value="maxPenetration">最大接触重叠深度（m）</option></select>'+
    '<canvas id="pair-chart" aria-label="接触对时程曲线"></canvas><p id="pair-readout" class="hint" role="status" style="white-space:pre-line;font-variant-numeric:tabular-nums"></p>'+
    '<button id="pair-export">导出接触对 CSV</button>'+
    '<p class="hint">力、力矩和热流作用于 A，B 接受反向作用；法向力为压缩冲量大小之和除以记录时长。滑移为接触采样平均值，采样次数不是接触面积或唯一粒子数。分离后接触力与热流归零，累计热量保留。</p>'+
    '<p class="hint">重叠深度：刚体接触显示位置修正前的穿透；MPM—MPM 显示粒子域的估计重叠，不代表精确表面穿透。</p>';
}
const quote=v=>typeof v==='string'?'"'+(/^[=+\-@\t\r]/.test(v)?"'":'')+v.replaceAll('"','""')+'"':v??'';
export function contactCSV(frames){
  const rows=[['time_s','pair_id','body_A','part_B','mechanical','thermal','fx_on_A_N','fy_on_A_N','fz_on_A_N','tx_on_A_Nm','ty_on_A_Nm','tz_on_A_Nm','normal_force_N','tangent_fx_on_A_N','tangent_fy_on_A_N','tangent_fz_on_A_N','mean_slip_m_s','mechanical_samples','max_penetration_m','heat_into_A_W','interval_heat_into_A_J','cumulative_heat_into_A_J','thermal_samples']];
  rows[0].push('contact_spring_J','dashpot_loss_J','friction_loss_J','body_A_x_m','body_A_y_m','body_A_z_m','body_A_vx_m_s','body_A_vy_m_s','body_A_vz_m_s','position_correction_work_J','total_jx_on_A_Ns','total_jy_on_A_Ns','total_jz_on_A_Ns','support_jx_Ns','support_jy_Ns','support_jz_Ns','friction_generated_heat_J','friction_heat_into_A_J','friction_heat_into_B_J');
  for(const f of frames)for(const r of f.contactPairs??[]){const b=f.bodies?.find(b=>b.id===r.a);rows.push([f.time,r.id,r.a,r.b,r.mechanical?1:0,r.thermal?1:0,...r.force,...r.torque,r.normalForce,...r.tangentialForce,r.slipSpeed,r.samples,r.maxPenetration,r.heatRate,r.heat,r.accumulatedHeat,r.thermalSamples,r.contactEnergy,r.normalLoss,r.frictionLoss,...(b?.position??[null,null,null]),...(b?.velocity??[null,null,null]),r.correctionWork,...(r.totalImpulse??[null,null,null]),...(r.supportImpulse??[null,null,null]),r.frictionHeat,r.frictionHeatIntoA,r.frictionHeatIntoB]);}
  return rows.map(row=>row.map(quote).join(',')).join('\n');
}
export function wireContacts({getProject,load,guard,download,getHistory}){
  const $=id=>document.getElementById(id),en=()=>document.documentElement.lang==='en';let last=null,drawn=0;
  const isMixed=()=>getProject().solver.adapter==='cpu-fem-mpm';
  const isFourGPU=()=>getProject().solver.computeBackend==='gpu'&&getProject().parts.some(b=>b.method==='pbf'||b.method==='rigid');
  const isMixedGPU=()=>isMixed()&&getProject().solver.computeBackend==='gpu';
  const isFEM=()=>['cpu-fem-dynamic','cpu-fem-mpm'].includes(getProject().solver.adapter);
  $('project-contact-pairs').insertAdjacentHTML('beforeend','<div id="pair-mixed-settings" hidden><label for="pair-thermal-tolerance">热接触检测容差（粒子半径 %）</label><input id="pair-thermal-tolerance" type="number" min="0" max="25" step="0.5" value="5"></div><p id="pair-mixed-hint" class="hint" hidden></p>');
  $('pair-mixed-settings').insertAdjacentHTML('beforeend','<div id="pair-friction-heating" hidden><label for="pair-friction-heat-fraction">摩擦功转热比例 η（0–1）</label><input id="pair-friction-heat-fraction" type="number" min="0" max="1" step="0.05" value="0"><label for="pair-friction-heat-to-a">摩擦热分给 A（MPM）的比例（0–1）</label><input id="pair-friction-heat-to-a" type="number" min="0" max="1" step="0.05" value="0.5"><p id="pair-friction-heat-hint" class="hint"></p></div>');
  $('pair-friction').insertAdjacentHTML('afterend','<p id="pair-interface-kind" class="hint" hidden></p>');
  for(const [value,label] of [['sphereY','球心 Y 位置（m）'],['sphereVy','球心 Y 速度（m/s）'],['contactEnergy','接触弹簧储能（J）'],['normalLoss','接触阻尼耗散（J）'],['frictionLoss','摩擦耗散（J）']]){const o=document.createElement('option');o.value=value;o.textContent=label;o.dataset.femContact='true';$('pair-result-field').append(o);}
  for(const [value,label] of [['frictionHeat','累计摩擦生热（J）'],['frictionHeatIntoA','分给 A 的累计摩擦热（J）'],['frictionHeatIntoB','分给 B 的累计摩擦热（J）']]){const o=document.createElement('option');o.value=value;o.textContent=label;o.dataset.mixedHeat='true';$('pair-result-field').append(o);}
  function options(id,items){
    const previous=$(id).value;$(id).replaceChildren(...items.map(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name;o.dataset.userContent='';return o;}));if(items.some(p=>p.id===previous))$(id).value=previous;
  }
  const femPair=()=>getProject().parts.find(x=>x.id===$('pair-a').value)?.method==='fem'&&getProject().parts.find(x=>x.id===$('pair-b').value)?.method==='fem';
  const penalty=()=>isFEM()&&(!isMixed()||femPair());
  const fluidSolidPair=()=>{const p=getProject(),m=[$('pair-a').value,$('pair-b').value].map(id=>p.parts.find(b=>b.id===id)?.method);return m.includes('mpm')&&m.includes('pbf');};
  function mode(){
    const p=getProject(),a=p.parts.find(x=>x.id===$('pair-a').value),b=p.parts.find(x=>x.id===$('pair-b').value),fluid=a?.method==='pbf'&&b?.method==='fem';
    $('pair-friction').disabled=!$('pair-mechanical').checked;$('pair-conductance').disabled=!$('pair-thermal').checked;$('pair-friction-heat-fraction').disabled=!$('pair-mechanical').checked;$('pair-friction-heat-to-a').disabled=!$('pair-mechanical').checked||!($('pair-friction-heat-fraction').valueAsNumber>0);
    $('pair-interface-kind').hidden=!fluid;$('pair-interface-kind').textContent=en()?'PBF–FEM uses normal contact, Coulomb wall friction and heat exchange. Set friction to zero for free slip.':'PBF–FEM 支持法向接触、库仑壁面摩擦与换热；摩擦系数为零时自由滑移。';
    $('pair-mixed-hint').hidden=!isMixed()||femPair();$('pair-fem-settings').hidden=!penalty();$('pair-mixed-settings').hidden=!isMixed()||femPair();
    $('pair-thermal-area').hidden=femPair();document.querySelector('label[for="pair-thermal-area"]').hidden=femPair();
    $('pair-fem-hint').textContent=femPair()?(en()?'FEM–FEM uses deformed surfaces, compression-only penalty contact, Coulomb friction and conservative heat exchange. Contact area comes from the surface mesh. Linear Tet4 remains limited to small strains.':'FEM–FEM 使用变形后的表面、仅受压的罚函数接触、库仑摩擦与守恒换热。传热面积来自表面网格，线弹性 Tet4 仍适用于小应变。'):(en()?'Compression-only normal spring and damping, Coulomb friction, free separation. Thermal area is an effective contact area.':'仅受压的法向弹簧与阻尼、库仑摩擦、自由分离；传热面积为等效接触面积。');
    $('pair-remove').textContent=isFEM()?(en()?'Delete contact pair and reset':'删除接触对并重置'):(en()?'Delete pair and restore defaults':'删除接触对并恢复默认');
    if(fluidSolidPair()){
      $('pair-remove').textContent=en()?'Delete pair and restore neighborhood defaults':'删除接触对并恢复邻域默认耦合';
      $('pair-friction').disabled=true;$('pair-friction').value=0;$('pair-mixed-settings').hidden=true;$('pair-mixed-hint').hidden=true;
      $('pair-interface-kind').hidden=false;$('pair-interface-kind').textContent=en()?'MPM–PBF: pressure boundary with free slip (no Coulomb friction). Contact off excludes this pair from density projection. Heat is independent; conductivity and interface conductance both limit exchange. Deleting restores legacy neighborhood coupling; disable both switches to isolate.':'MPM–PBF：PBF 压力边界，自由滑移（暂不支持库仑摩擦）。关闭力学后，该对不参与密度投影；换热可独立开启，并受材料导热率及界面换热系数限制。删除后恢复旧版邻域耦合；完全隔离请关闭两个开关。';
    }
  }
  function targets(){
    const p=getProject(),a=p.parts.find(p=>p.id===$('pair-a').value);
    options('pair-b',p.parts.filter(b=>b.id!==a?.id&&(isMixed()&&(!isMixedGPU()||isFourGPU())?
      (b.method==='fem'||a?.method==='rigid'&&['mpm','pbf'].includes(b.method)||a?.method==='mpm'&&['mpm','pbf'].includes(b.method)||a?.method==='pbf'&&b.method==='mpm'):
      isFEM()?b.method==='fem':a?.method==='pbf'?b.method==='mpm':['mpm','pbf'].includes(b.method))));
    $('pair-add').disabled=!a||!$('pair-b').options.length;
    mode();
  }
  function read(){
    const d=getProject().contactPairs.find(p=>p.id===$('pair-edit').value);
    if(d){$('pair-name').value=d.name;$('pair-a').value=d.a;targets();$('pair-b').value=d.b;$('pair-mechanical').checked=d.mechanical;$('pair-thermal').checked=d.thermal;$('pair-friction').value=d.friction;$('pair-conductance').value=d.contactConductance;$('pair-stiffness').value=d.stiffness??1e5;$('pair-damping').value=d.damping??20;$('pair-thermal-area').value=d.thermalArea??.001;$('pair-thermal-tolerance').value=100*(d.thermalToleranceRatio??.05);$('pair-friction-heat-fraction').value=d.frictionHeatFraction??0;$('pair-friction-heat-to-a').value=d.frictionHeatToA??.5;}mode();
  }
  function fields(id){return {id,name:$('pair-name').value,a:$('pair-a').value,b:$('pair-b').value,mechanical:$('pair-mechanical').checked,thermal:$('pair-thermal').checked,friction:$('pair-friction').valueAsNumber,contactConductance:$('pair-conductance').valueAsNumber,...(isMixed()&&!femPair()&&!fluidSolidPair()?{thermalToleranceRatio:$('pair-thermal-tolerance').valueAsNumber/100,frictionHeatFraction:isMixedGPU()&&!isFourGPU()&&$('pair-mechanical').checked?$('pair-friction-heat-fraction').valueAsNumber:0,frictionHeatToA:$('pair-friction-heat-to-a').valueAsNumber}:{}),...(penalty()?{...(!femPair()?{thermalArea:$('pair-thermal-area').valueAsNumber}:{}),stiffness:$('pair-stiffness').valueAsNumber,damping:$('pair-damping').valueAsNumber}:{})};}
  $('pair-edit').onchange=read;$('pair-mechanical').onchange=mode;$('pair-thermal').onchange=mode;
  $('pair-friction-heat-fraction').oninput=mode;
  $('pair-a').onchange=targets;
  $('pair-b').onchange=mode;
  $('pair-add').onclick=guard(async()=>{const p=getProject();let n=1;while(p.contactPairs.some(p=>p.id==='contact-'+n))n++;const id='contact-'+n;p.contactPairs.push(fields(id));if(isFEM()&&(p.contactPairs.at(-1).thermal||p.contactPairs.at(-1).frictionHeatFraction))p.solver.thermal=true;await load(p);$('pair-edit').value=id;read();});
  $('pair-update').onclick=guard(()=>{const p=getProject(),i=p.contactPairs.findIndex(p=>p.id===$('pair-edit').value);if(i<0)throw Error(en()?'Select a contact pair first':'请先选择已有接触对');p.contactPairs[i]=fields(p.contactPairs[i].id);if(isFEM()&&(p.contactPairs[i].thermal||p.contactPairs[i].frictionHeatFraction))p.solver.thermal=true;return load(p);});
  $('pair-remove').onclick=guard(()=>{const p=getProject();p.contactPairs=p.contactPairs.filter(p=>p.id!==$('pair-edit').value);return load(p);});
  $('pair-export').onclick=guard(()=>download('\ufeff'+contactCSV(getHistory()),'summer-contact-pairs.csv','text/csv;charset=utf-8'));
  for(const id of ['pair-result','pair-result-field'])$(id).onchange=()=>{drawn=0;if(last)display(last);};
  function labels(){
    const fem=isFEM();$('pair-fem-settings').hidden=!fem||isMixed();
    for(const node of [...$('project-contact-pairs').children,...$('project-contact-results').children])if(node.matches('p.hint'))node.hidden=fem;
    $('pair-thermal').closest('label').hidden=false;$('pair-conductance').hidden=false;document.querySelector('label[for="pair-conductance"]').hidden=false;
    $('pair-readout').hidden=false;
    document.querySelector('label[for="pair-a"]').textContent=isMixed()?(en()?'Part A (MPM / PBF / rigid / FEM)':'部件 A（MPM / PBF / 刚体 / FEM）'):fem?(en()?'Part A (FEM / spherical rigid body)':'部件 A（FEM / 球形刚体）'):(en()?'Part A (rigid / MPM / PBF)':'部件 A（刚体 / MPM / PBF）');
    document.querySelector('label[for="pair-b"]').textContent=isMixed()&&(!isMixedGPU()||isFourGPU())?(en()?'Part B (compatible parts)':'部件 B（可耦合部件）'):fem?(en()?'Part B (FEM)':'部件 B（FEM）'):(en()?'Part B (MPM / PBF)':'部件 B（MPM / PBF）');
    $('pair-remove').textContent=fem?(en()?'Delete contact pair and reset':'删除接触对并重置'):(en()?'Delete pair and restore defaults':'删除接触对并恢复默认');
    $('pair-fem-hint').textContent=en()?'Only explicit sphere–FEM pairs interact. Contact uses the deformed surface at true scale. Compression-only normal spring/dashpot, Coulomb friction, free separation. Heat flows only during contact, using the specified effective area (not a resolved Hertz contact patch). Zero conductivity makes the interface adiabatic. No rigid–rigid contact in this solver.':'仅显式球体–FEM 接触对参与相互作用。接触使用真实变形后的表面；法向弹簧与压缩阻尼、库仑摩擦，可自由分离。接触时按指定等效面积换热（未求解赫兹接触斑），分离后停止；任一侧导热率为零时绝热。本求解器暂不计算刚体之间的碰撞。';
    $('pair-mixed-settings').hidden=!isMixed();$('pair-mixed-hint').hidden=!isMixed();$('pair-mixed-hint').textContent=en()?'MPM–FEM: explicit pairs only; equal and opposite impulses, APIC spin for solid friction, and free separation. PBF also supports Coulomb wall friction. Box, cylinder and disc rigid bodies contact FEM through their oriented shape. Heat area is estimated from particle volume. Thermal contact fades to zero within the specified radius tolerance (default 5%); larger gaps are adiabatic. This approximates the particle surface, not gas-gap conduction. Fixed supports receive their impulse share. CPU: 16384 particles. CUDA: 50000 elastic / thermal plastic / creep MPM particles, with plastic and friction heating; unsupported features are rejected.':'MPM–FEM：仅显式接触对生效；等量反向冲量、固体 APIC 旋转摩擦、自由分离。PBF 也支持库仑壁面摩擦；长方体、圆柱与圆盘刚体按真实朝向与 FEM 接触。面积按粒子体积估计，换热在指定检测容差内衰减（默认半径 5%），超过容差的间隙绝热；这是粒子表面近似，不是气隙导热，固定支承接收对应冲量。CPU 最多 16384 粒子；CUDA 最多 50000 弹性 / 热塑性 / 蠕变物质点，支持塑性与摩擦生热；不支持的功能会明确拒绝。';
    if(isFourGPU())$('pair-mixed-hint').textContent=en()?'Resident GPU: sphere, MPM points, PBF and Tet4 contact exchange impulses and heat. FEM mappings preserve force and torque. Particle contact acts at its center; MPM retains APIC grid transfer. Friction-to-heat and the complete mechanical ledger are unavailable.':'四方法驻留 GPU：球体、MPM 物质点、PBF 和 Tet4 交换冲量与热量。FEM 映射保持合力与力矩；粒子接触作用于质心，MPM 的网格传递仍为 APIC。暂未覆盖摩擦转热和完整机械能账本。';
    $('pair-friction-heating').hidden=(!isMixedGPU()||isFourGPU());
    $('pair-friction-heat-hint').textContent=en()?'Converts the specified fraction of friction work to heat. The split sends the selected share to A (MPM) and the remainder to B (FEM). This is separate from conductive exchange: an insulating interface can generate friction heat. Requires mechanical contact; applying a nonzero fraction enables the temperature field. Disabling mechanical contact also disables friction heating.':'将所选比例的摩擦功转为热量，按比例分给 A（MPM），其余分给 B（FEM）。摩擦生热与界面传热独立，绝热界面仍可生热。需要力学接触；应用非零比例会启用温度场。关闭力学接触也会关闭摩擦生热。';
    for(const o of $('pair-result-field').options)o.hidden=o.dataset.mixedHeat?(!isMixedGPU()||isFourGPU()):o.dataset.femContact?(!fem||isMixed()&&['sphereY','sphereVy'].includes(o.value)):false;
    if($('pair-result-field').selectedOptions[0]?.hidden)$('pair-result-field').value='normalForce';
  }
  window.addEventListener('workbench-languagechange',()=>{labels();mode();drawn=0;if(last)display(last);});
  function refresh(){
    const p=getProject();options('pair-edit',p.contactPairs);options('pair-result',p.contactPairs);
    options('pair-a',p.parts.filter(p=>isMixed()?(isMixedGPU()&&!isFourGPU()?['mpm']:['mpm','pbf','rigid','fem']).includes(p.method):isFEM()?['rigid','fem'].includes(p.method):['rigid','mpm','pbf'].includes(p.method)));targets();read();labels();mode();drawn=0;
    $('pair-update').disabled=!p.contactPairs.length;$('pair-remove').disabled=!p.contactPairs.length;
  }
  function display(f){
    last=f;if(!$('project-contact-results').open||performance.now()-drawn<150)return;drawn=performance.now();
    const id=$('pair-result').value,r=f.contactPairs?.find(p=>p.id===id);
    if(!r){$('pair-readout').textContent=en()?'Create an explicit contact pair to record its results.':'创建显式接触对后，可记录该对的独立结果。';$('pair-chart').getContext('2d').clearRect(0,0,$('pair-chart').width,$('pair-chart').height);return;}
    const key=$('pair-result-field').value,unit={normalForce:'N',tangentialForce:'N',slipSpeed:'m/s',heatRate:'W',accumulatedHeat:'J',maxPenetration:'m',sphereY:'m',sphereVy:'m/s',contactEnergy:'J',normalLoss:'J',frictionLoss:'J',frictionHeat:'J',frictionHeatIntoA:'J',frictionHeatIntoB:'J'}[key];
    const points=getHistory().filter(x=>x.time<=f.time+1e-9).map(x=>{const r=x.contactPairs?.find(r=>r.id===id),b=x.bodies?.find(b=>b.id===r?.a);return [x.time,key==='sphereY'?b?.position[1]:key==='sphereVy'?b?.velocity[1]:r?(key==='tangentialForce'?Math.hypot(...r[key]):r[key]):NaN];});
    plot($('pair-chart'),[{color:'#22a9b6',points}],unit);
    const fmt=v=>Number.isFinite(v)?v.toPrecision(5):'—',vec=v=>v?Array.from(v,fmt).join(', '):'—';
    $('pair-readout').textContent=`t = ${f.time.toFixed(4)} s · ${r.a} ↔ ${r.b}\n${en()?'Normal / tangential':'法向 / 切向'} ${fmt(r.normalForce)} / ${fmt(Math.hypot(...r.tangentialForce))} N\nF(A) = (${vec(r.force)}) N\n${en()?'Mean slip':'平均滑移'} ${fmt(r.slipSpeed)} m/s\n${en()?'Max overlap':'最大重叠'} ${fmt(Number.isFinite(r.maxPenetration)?r.maxPenetration*1000:null)} mm\n${en()?'Conductive heat into A':'传导进入 A 的热流'} ${fmt(r.heatRate)} W\n${en()?'Cumulative conductive heat into A':'传导进入 A 的累计热量'} ${fmt(r.accumulatedHeat)} J\n${en()?'Mechanical / thermal samples':'力学 / 换热采样'} ${r.samples} / ${r.thermalSamples}`;
    if(r.scheme==='mpm-pbf-pressure/1')$('pair-readout').textContent+='\n'+(en()?'PBF pressure impulse / output time; free slip. No geometric penetration or full dissipation ledger. Torque about the reference centre of A.':'PBF 压力冲量 / 输出时长；自由滑移。未测量几何穿透或完整耗散账本。力矩以 A 初始几何中心为基准。')+'\nF(B) = ('+vec(r.oppositeForce)+') N\n'+(en()?'Total impulse on A':'A 累计压力冲量')+' ('+vec(r.totalImpulse)+') N·s';
    if(r.scheme==='mpm-pbf-contact/2')$('pair-readout').textContent+='\n'+(en()?'GPU pressure + two-way normal contact; free slip. Overlap is the cumulative peak between discretization spheres, not a reconstructed surface. Position cleanup is excluded from impulse.':'GPU 压力 + 双向法向接触；自由滑移。重叠为离散粒子球的累计峰值，并非重建表面；位置修正不计入冲量。');
    if(f.mixed&&r.scheme!=='mpm-pbf-pressure/1'&&r.oppositeForce&&r.scheme!=='fem-vertex-triangle/1'){
      $('pair-readout').textContent+=`\nF(B) = (${vec(r.oppositeForce)}) N\n${en()?'Total impulse on A':'A 累计接触冲量'} (${vec(r.totalImpulse)}) N·s\n${en()?'Normal / friction loss':'法向冲击 / 摩擦耗散'} ${fmt(r.normalLoss)} / ${fmt(r.frictionLoss)} J\n${en()?'Position correction work (numerical)':'位置修正功（数值项）'} ${fmt(r.correctionWork)} J\n${en()?'Impulse into fixed supports':'固定支承接收冲量'} (${vec(r.supportImpulse)}) N·s`;
      if(f.mixed.backend)$('pair-readout').textContent+=`\n${en()?'Generated friction heat':'累计摩擦生热'} ${fmt(r.frictionHeat)} J\n${en()?'Friction heat to A / B':'摩擦热分给 A / B'} ${fmt(r.frictionHeatIntoA)} / ${fmt(r.frictionHeatIntoB)} J`;
    }else if(f.fem&&(!f.mixed||r.scheme==='fem-vertex-triangle/1')){
      const thermalText=`\n${en()?'Heat into A / cumulative heat':'进入 A 的热流 / 累计热量'} ${fmt(r.heatRate)} W / ${fmt(r.accumulatedHeat)} J`;
      const body=f.bodies.find(b=>b.id===r.a);
      $('pair-readout').textContent=`t = ${f.time.toFixed(4)} s · ${r.a} ↔ ${r.b}\n${en()?'Interval mean normal / tangential force':'输出区间平均法向 / 切向力'} ${fmt(r.normalForce)} / ${fmt(Math.hypot(...r.tangentialForce))} N\nF(A) = (${vec(r.force)}) N\nF(B) = (${vec(r.oppositeForce)}) N\n${en()?'Interval max penetration':'区间最大穿透'} ${fmt(Number.isFinite(r.maxPenetration)?r.maxPenetration*1000:null)} mm\n${en()?'Contact spring energy':'接触弹簧储能'} ${fmt(r.contactEnergy)} J\n${en()?'Dashpot / friction loss':'接触阻尼 / 摩擦耗散'} ${fmt(r.normalLoss)} / ${fmt(r.frictionLoss)} J`+(r.totalImpulse?`\n${en()?'Total impulse on A':'A 累计接触冲量'} (${vec(r.totalImpulse)}) N·s`:'')+(body?`\n${en()?'Sphere position':'球心位置'} (${vec(body.position)}) m\n${en()?'Sphere velocity':'球心速度'} (${vec(body.velocity)}) m/s`:'')+thermalText;
    }
  }
  return {refresh,display};
}
