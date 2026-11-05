export function mountAttachmentPanels(folder){
  const select=(id,label,options='')=>`<label for="${id}">${label}</label><select id="${id}">${options}</select>`;
  folder('loads','project-attachments-panel','参考点—材料区域连接').innerHTML+=
    '<p class="hint">CPU 与 Taichi GPU 均支持初始为固态的 MPM 选区，暂不支持断裂选区。粒子熔化后永久释放连接，冷却凝固不会自动重新绑定。</p>'+
    select('region-edit','已有区域连接')+'<label for="region-name">区域连接名称</label><input id="region-name" value="区域连接">'+
    select('region-frame','夹具参考点')+select('region-selection','材料区域选择集')+
    select('region-mode','区域连接方式','<option value="bind">刚性绑定</option><option value="elastic">弹性连接</option><option value="slide">沿参考点 Z 轴滑移</option>')+
    '<label for="region-stiffness">区域总刚度（N/m）</label><input id="region-stiffness" type="number" step="any" value="20000"><label for="region-damping">区域总阻尼（N·s/m）</label><input id="region-damping" type="number" step="any" value="100">'+
    '<p class="hint">刚度与阻尼仅用于弹性连接，按选区点数分配。绑定和滑移采用迭代约束，允许小量数值误差；滑移轴上的运动不受此连接约束。</p>'+
    '<div class="buttons"><button id="region-add">添加区域连接并重置</button><button id="region-update">更新区域连接并重置</button><button id="region-remove">删除区域连接</button></div>';
  folder('results','project-attachment-results','区域连接反力与做功').innerHTML+=
    select('region-result','测量区域连接')+'<p id="region-readout" role="status" class="hint" style="white-space:pre-line;font-variant-numeric:tabular-nums"></p><button id="region-export">导出区域连接 CSV</button>'+
    '<p class="hint">力和力矩作用于夹具，使用世界坐标；力矩关于夹具质心。净功来自连接冲量，含误差修正，不是完整系统能量守恒残差。</p>';
}
export function attachmentCSV(frames){
  const rows=['time_s,id,mode,count,error_m,fx_N,fy_N,fz_N,tx_Nm,ty_Nm,tz_Nm,net_power_W,body_power_W,net_work_J,positive_stabilization_work_J,elastic_energy_J,initial_count,released_count,state'];
  for(const f of frames)for(const j of f.joints.filter(j=>j.type==='region'))rows.push([f.time,j.id,j.mode,j.count,j.error,...j.force,...j.torque,j.power,j.bodyPower,j.work,j.positiveWork,j.elasticEnergy,j.initialCount??j.count,j.releasedCount??0,j.state??'active'].join(','));
  return rows.join('\n');
}
export function wireAttachments({getProject,load,guard,download,getHistory}){
  const $=id=>document.getElementById(id),options=(id,items)=>{
    const old=$(id).value;$(id).replaceChildren(...items.map(x=>{const o=document.createElement('option');o.value=x.id;o.textContent=x.name;o.dataset.userContent='';return o;}));
    if(items.some(x=>x.id===old))$(id).value=old;
  };
  const mode=()=>{for(const id of ['region-stiffness','region-damping'])$(id).disabled=$('region-mode').value!=='elastic';};
  function read(){const j=getProject().connections.find(j=>j.id===$('region-edit').value);if(!j)return;
    $('region-name').value=j.name;$('region-frame').value=j.endpoints.a.frame;$('region-selection').value=j.endpoints.b.selection;
    $('region-mode').value=j.mode;$('region-stiffness').value=j.stiffness;$('region-damping').value=j.damping;mode();
  }
  function fields(p,id){
    const f=p.frames.find(f=>f.id===$('region-frame').value),s=p.selectionSets.find(s=>s.id===$('region-selection').value);
    if(!f||!s)throw Error('请先创建刚体参考点与 MPM 选择集');
    return {id,name:$('region-name').value,type:'region',a:f.part,b:s.part,mode:$('region-mode').value,stiffness:$('region-stiffness').valueAsNumber,damping:$('region-damping').valueAsNumber,endpoints:{a:{frame:f.id},b:{selection:s.id}}};
  }
  $('region-mode').onchange=mode;$('region-edit').onchange=read;
  $('region-add').onclick=guard(async()=>{const p=getProject();let n=1;while(p.connections.some(j=>j.id==='region-'+n))n++;const id='region-'+n;p.connections.push(fields(p,id));await load(p);$('region-edit').value=id;read();});
  $('region-update').onclick=guard(()=>{const p=getProject(),i=p.connections.findIndex(j=>j.id===$('region-edit').value);if(i<0)throw Error('请先选择区域连接');p.connections[i]=fields(p,p.connections[i].id);return load(p);});
  $('region-remove').onclick=guard(()=>{const p=getProject();p.connections=p.connections.filter(j=>j.id!==$('region-edit').value);return load(p);});
  $('region-export').onclick=guard(()=>download('\ufeff'+attachmentCSV(getHistory()),'summer-region-connections.csv','text/csv;charset=utf-8'));
  return {
    refresh(){const p=getProject(),connections=p.connections.filter(j=>j.type==='region');
      options('region-edit',connections);options('region-result',connections);
      options('region-frame',p.frames.filter(f=>p.parts.find(b=>b.id===f.part)?.method==='rigid'));
      options('region-selection',p.selectionSets.filter(s=>p.parts.find(b=>b.id===s.part)?.method==='mpm'));
      read();mode();
    },
    display(frame){
      const j=frame.joints.find(j=>j.id===$('region-result').value),en=document.documentElement.lang==='en',fmt=v=>v.map(x=>x.toFixed(3)).join(', ');
      const text=j?`${j.name} · ${j.count} ${en?'points':'粒子'}\n${en?'Error':'误差'} ${(j.error*1000).toFixed(3)} mm\nF (${fmt(j.force)}) N\nM (${fmt(j.torque)}) N·m\n${en?'Net power':'连接净功率'} ${j.power.toFixed(4)} W\n${en?'Clamp power':'夹具功率'} ${j.bodyPower.toFixed(4)} W\n${en?'Cumulative net work':'累计连接净功'} ${j.work.toFixed(5)} J\n${en?'Positive stabilization work / step':'本步正向修正功'} ${j.positiveWork.toExponential(2)} J\n${en?'Spring energy':'连接弹性能'} ${j.elasticEnergy.toFixed(5)} J`:(en?'No region connection':'尚无区域连接');
      const released=j?`\n${en?'Connected / initial':'仍连接 / 初始'} ${j.count} / ${j.initialCount??j.count} · ${en?'Released':'已释放'} ${j.releasedCount??0}`:'';
      if($('region-readout').textContent!==text+released)$('region-readout').textContent=text+released;
    }
  };
}
