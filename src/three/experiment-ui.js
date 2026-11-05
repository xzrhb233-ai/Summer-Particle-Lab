import {TimeHistory,aggregateParts} from './time-history.js';

export function installExperiment({send,renderer,materialOptions,toast}){
  const $=id=>document.getElementById(id),history=new TimeHistory();
  let latest=null,signature='',selected=-1;
  const vector=(prefix,label,value,min,max,step=1)=>`<label>${label}</label><div class="gravity-coordinates">${['X','Y','Z'].map((a,k)=>`<label>${a}<input id="${prefix}${k}" aria-label="${label} ${a}" type="number" min="${min}" max="${max}" step="${step}" value="${value[k]}"></label>`).join('')}</div>`;
  const panel=document.createElement('div');panel.id='experiment3';
  panel.innerHTML=`<details class="instrument" id="parts-panel3" open><summary>部件与初始条件</summary>
    <label for="part-select3">作用部件</label><select id="part-select3"><option value="-1">全部部件</option></select>
    <div id="part-info3" class="hint">等待部件数据…</div>
    <label for="part-name3">部件名称</label><input id="part-name3" type="text" maxlength="48" placeholder="输入名称"><button id="part-rename3">重命名所选</button>
    ${vector('part-v','平动速度（单位/s）',[0,0,0],-80,80)}${vector('part-w','角速度（rad/s）',[0,0,0],-1,1,.05)}
    <button id="part-velocity3">赋予所选部件速度</button><div class="buttons"><button id="part-pin3">固定所选</button><button id="part-release3">释放所选</button></div>
    <p class="hint">围绕所选部件总质心转动。赋速替换当前速度；固定点保持不动。释放时速度归零。建议暂停后设置初始条件。</p></details>
    <details class="instrument" id="geometry-panel3"><summary>02 / 精确几何建模</summary>
    <label for="geometry-shape3">几何形状</label><select id="geometry-shape3"><option value="box">长方体</option><option value="ellipsoid">球体 / 椭球</option><option value="cylinder">Y 轴圆柱 / 椭圆柱</option></select>
    ${vector('geometry-c','几何中心',[0,12,0],-238,238)}${vector('geometry-size','几何尺寸（直径 / 高度）',[24,24,24],4,400,4)}
    <label class="check"><input id="sampling-enabled3" type="checkbox" checked>生成时添加随机扰动</label>
    <label for="sampling-strength3">扰动强度（占粒子间距） <output id="sampling-strength3-value">20%</output></label><input id="sampling-strength3" type="range" min="0" max="35" step="1" value="20">
    <label for="sampling-seed3">随机种子</label><input id="sampling-seed3" type="number" min="0" max="2147483647" step="1" value="42"><button id="sampling-reseed3" type="button">换一组随机分布</button>
    <p class="hint">仅在新建时扰动位置，精确建模和拖绘共用此设置。最大位移为粒子间距乘以扰动强度；不改变粒子数量与质量。同一种子可复现分布，关闭或设为 0 恢复规则点阵。</p>
    <p class="hint">初始扰动不保证运动后仍均匀分布。压缩后显示球可能重叠，可在“结果与显示 → 物质点观察”检查点中心。</p>
    <p class="hint">使用本页的材料、本构和温度；名称与平动初速沿用部件设置。采样间距来自已应用的网格参数，旋转后的几何须完全位于计算域内。体积按解析几何计算，总质量不随采样细化改变；曲面边界由有限粒子近似。</p><button class="chapter-jump" data-jump="parts">设置名称与初速 ↗</button>
    <button id="geometry-create3">创建精确几何</button></details>
    <details class="instrument" id="run-panel3" open><summary>求解控制</summary>
    <label for="run-duration3">追加模拟时长（s）</label><input id="run-duration3" type="number" min="0.001" max="600" step="0.1" value="1">
    <div class="buttons"><button id="run-start3">定时求解</button><button id="run-step3">单步推进</button></div>
    <p class="hint">单次最多推进 1/60 模拟秒；触及子步预算时推进更短，以实际时间为准。</p>
    <label for="step-scale3">稳定时间步系数 <output id="step-scale3-value">1.0</output></label><input id="step-scale3" type="range" min="0.1" max="1" step="0.1" value="1">
    <label for="pbf-iterations3">PBF 迭代次数</label><input id="pbf-iterations3" type="number" min="1" max="8" step="1" value="3">
    <label class="check"><input id="pbf-anticlump3" type="checkbox" checked>流体短程抗聚集</label><p class="hint">缓解液面粒子串珠与团聚。仅作用于 PBF 液体，可能使液滴更分散。</p>
    <label class="check"><input id="solid-anticlump3" type="checkbox" checked>固体采样防聚集</label><p class="hint">缓慢整理同一部件中过密的 MPM 固体采样点，保持速度和本构历史。属于数值稳定化，可能改变局部形变；精确力学对比可关闭。</p>
    <p class="hint" id="run-info3">到达目标模拟时间自动暂停。</p></details>
    <details class="instrument" id="history-panel3" open><summary>部件时程</summary>
    <p class="hint" id="history-target3">曲线跟随当前选中的部件。</p><button class="chapter-jump" data-jump="parts">选择作用部件 ↗</button>
    <label for="history-metric3">曲线变量</label><select id="history-metric3"><option value="11">最大位移</option><option value="10">最大速度</option><option value="9">动能（模拟单位）</option><option value="12">最大相对应力</option><option value="13">最大塑性历史</option></select>
    <label for="history-interval3">最小采样间隔（模拟 s）</label><input id="history-interval3" type="number" min="0.01" max="1" step="0.01" value="0.05">
    <svg id="part-chart3" viewBox="0 0 240 100" role="img" aria-label="所选部件时程曲线"><path d="M28 12V74H232" fill="none" stroke="#50626b"/><polyline id="part-curve3" fill="none" stroke="#78d6d1" stroke-width="1.6"/><text id="part-curve-scale3" x="28" y="10"></text><text id="part-curve-time3" x="28" y="91"></text></svg>
    <div class="buttons"><button id="history-clear3">清空曲线</button><button id="history-export3">导出 CSV</button></div><p class="hint">记录实际收到的模拟时刻，最多保留 2,000 点。统计覆盖全部物理粒子；位移相对于创建位置，动能不含弹性能。切换部件或重置场景会清空曲线。</p></details>`;
  $('gravity-panel3').before(panel);
  function samplingControls(){const disabled=!$('sampling-enabled3').checked;for(const id of ['sampling-strength3','sampling-seed3','sampling-reseed3'])$(id).disabled=disabled;$('sampling-strength3-value').textContent=$('sampling-strength3').value+'%';}
  $('sampling-enabled3').onchange=samplingControls;$('sampling-strength3').oninput=samplingControls;
  $('sampling-reseed3').onclick=()=>{const previous=Number($('sampling-seed3').value);let seed=crypto.getRandomValues(new Uint32Array(1))[0]&0x7fffffff;if(seed===previous)seed=(seed+1)&0x7fffffff;$('sampling-seed3').value=seed;};
  samplingControls();
  function values(prefix,max){const out=[0,1,2].map(a=>$(prefix+a).valueAsNumber);if(!out.every(x=>Number.isFinite(x)&&Math.abs(x)<=max))throw Error('请输入范围内的三个有限数值');return out;}
  function action(fn){try{fn();}catch(e){toast(e.message);}}
  function draw(){
    const rows=history.rows,k=Number($('history-metric3').value),top=Math.max(1e-9,...rows.map(r=>r[k])),lo=rows[0]?.[0]??0,hi=rows.at(-1)?.[0]??0;
    $('part-curve3').setAttribute('points',rows.map(r=>`${28+(r[0]-lo)/Math.max(.001,hi-lo)*204},${74-r[k]/top*56}`).join(' '));
    $('part-curve-scale3').textContent=top.toPrecision(3);$('part-curve-time3').textContent=`${lo.toFixed(3)} → ${hi.toFixed(3)} s · ${rows.length} 点`;
    $('history-export3').disabled=!rows.length;
  }
  function update(s){
    latest=s;const parts=s.parts||[],key=JSON.stringify(parts.map(p=>[p.id,p.name,p.count]));
    if(key!==signature){signature=key;$('part-select3').replaceChildren(new Option('全部部件','-1'),...parts.map(p=>new Option(`${p.name} · ${p.count.toLocaleString()}`,String(p.id))));if(selected>=0&&!parts.some(p=>p.id===selected)){selected=-1;history.reset(selected);}$('part-select3').value=String(selected);}
    const p=selected<0?aggregateParts(parts):parts.find(p=>p.id===selected);renderer.selection=p?.bounds??null;
    if(p){const name=document.createElement('span');name.dataset.userContent='';name.textContent=p.name==='全部部件'?'':p.name;
      $('history-target3').replaceChildren(document.createTextNode(p.name==='全部部件'?'当前对象：全部部件':'当前对象：'),name,document.createTextNode(` · ${p.count.toLocaleString()} 粒子`));
    }else $('history-target3').textContent='暂无部件数据';
    $('part-rename3').disabled=selected<0;
    $('part-info3').textContent=p?`${p.count.toLocaleString()} 粒子 · ${p.mass.toFixed(2)} kg · 固定 ${p.pinned}\n质心 (${p.center.map(x=>x.toFixed(1)).join(', ')})\n最大速度 ${p.maxSpeed.toFixed(2)} · 最大位移 ${p.displacement.toFixed(2)}`:'暂无粒子';
    if(p?.geometry){const g=p.geometry;$('part-info3').textContent+=`\n${g.shape} · V ${g.volume.toFixed(3)}\nC (${g.center.join(', ')}) · L (${g.size.join(', ')})\nXYZ° (${g.rotation.join(', ')}) · Δp ${g.spacing.toFixed(3)} · n³ ${g.particlesPerCell}`;}
    $('run-step3').disabled=!s.paused;
    $('run-info3').textContent=s.run?.status==='completed'?'定时求解完成，已自动暂停。':s.run?.end!=null?`目标 ${s.run.end.toFixed(3)} s · 当前 ${s.time.toFixed(3)} s${s.paused?' · 已暂停':''}`:`${s.paused?'暂停中':'连续求解'} · 系数越小、迭代越多，计算越慢。`;
    const interval=Number($('history-interval3').value);const previous=history.rows.at(-1);history.sample(s.time,p,s.paused?0:Number.isFinite(interval)?Math.max(.01,Math.min(1,interval)):.05);if(previous!==history.rows.at(-1))draw();
  }
  $('part-select3').onchange=()=>{selected=Number($('part-select3').value);history.reset(selected);if(latest)update(latest);};
  $('part-rename3').onclick=()=>send({type:'part',id:selected,action:'rename',name:$('part-name3').value});
  $('part-velocity3').onclick=()=>action(()=>send({type:'part',id:selected,action:'velocity',velocity:values('part-v',80),angular:values('part-w',1)}));
  for(const name of ['pin','release'])$('part-'+name+'3').onclick=()=>send({type:'part',id:selected,action:name});
  $('geometry-create3').onclick=()=>action(()=>{
    const c=values('geometry-c',238),size=values('geometry-size',400);if(size.some(x=>x<4))throw Error('各方向尺寸至少为 4');
    send({type:'geometry',...materialOptions(),a:c.map((x,a)=>x-size[a]/2),b:c.map((x,a)=>x+size[a]/2),shape:$('geometry-shape3').value,name:$('part-name3').value,velocity:values('part-v',80)});
  });
  $('run-start3').onclick=()=>action(()=>{const duration=$('run-duration3').valueAsNumber;if(!Number.isFinite(duration)||duration<=0||duration>600)throw Error('模拟时长需大于 0 且不超过 600 秒');history.reset(selected);if(latest)update(latest);send({type:'run',duration});});
  $('run-step3').onclick=()=>send({type:'step'});
  $('step-scale3').oninput=()=>{$('step-scale3-value').textContent=$('step-scale3').value;send({type:'settings',value:{timeStepScale:Number($('step-scale3').value)}});};
  $('pbf-iterations3').onchange=()=>{const v=$('pbf-iterations3').valueAsNumber;$('pbf-iterations3').value=Number.isFinite(v)?Math.round(Math.min(8,Math.max(1,v))):3;send({type:'settings',value:{pbfIterations:Number($('pbf-iterations3').value)}});};
  $('pbf-anticlump3').onchange=()=>send({type:'settings',value:{pbfAntiClump:$('pbf-anticlump3').checked}});
  $('solid-anticlump3').onchange=()=>send({type:'settings',value:{solidAntiClump:$('solid-anticlump3').checked}});
  $('history-metric3').onchange=draw;$('history-clear3').onclick=()=>{history.reset(selected);draw();};
  $('history-export3').onclick=()=>{const url=URL.createObjectURL(new Blob([history.csv()],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='particle-time-history.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return {update,created(id){selected=id;history.reset(id);},reset(){selected=-1;history.reset(-1);signature='';renderer.selection=null;},sampling(){return $('sampling-enabled3').checked?{enabled:true,strength:Number($('sampling-strength3').value)/100,seed:$('sampling-seed3').valueAsNumber}:{enabled:false};},settings(){return {timeStepScale:Number($('step-scale3').value),pbfIterations:Number($('pbf-iterations3').value),pbfAntiClump:$('pbf-anticlump3').checked,solidAntiClump:$('solid-anticlump3').checked};}};
}
