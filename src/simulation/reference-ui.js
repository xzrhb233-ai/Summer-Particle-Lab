import {removeReference,ReferenceResults,convertConnectionToReferences} from './references.js';

export function mountReferencePanels(folder) {
  const field=(id,label,value='')=>`<label for="${id}">${label}</label><input id="${id}" type="text" value="${value}">`;
  const select=(id,label,options='')=>`<label for="${id}">${label}</label><select id="${id}">${options}</select>`;
  const vector=(id,label,values)=>`<label>${label}</label><div class="gravity-coordinates">${values.map((v,k)=>`<label>${'XYZ'[k]}<input id="${id}${k}" aria-label="${label} ${'XYZ'[k]}" type="number" step="any" value="${v}"></label>`).join('')}</div>`;
  folder('geometry','project-frames-panel','参考点与局部坐标系').innerHTML+=
    '<p class="hint">部件参考点使用局部坐标；世界参考点使用世界坐标。方向采用 XYZ 旋转角，关节轴取参考点 Z 轴。</p>'+
    select('ref-edit','已有参考点')+field('ref-name','参考点名称','Reference')+select('ref-part','参考点所属部件')+
    vector('ref-position','参考点位置（m）',[0,0,0])+vector('ref-rotation','参考点方向（°）',[0,0,0])+
    '<div class="buttons"><button id="ref-read">读取参考点</button><button id="ref-add">添加参考点</button><button id="ref-update">更新参考点</button></div><button id="ref-remove">删除参考点及关联连接</button><label class="check"><input id="ref-show" type="checkbox" checked>显示所选参考点坐标轴</label><p id="ref-info" class="hint" role="status"></p>';
  folder('geometry','project-selections-panel','部件区域与选择集').innerHTML+=
    '<p class="hint">按初始局部坐标选取材料点；运动后仍跟踪同一批粒子。改变网格或几何后会重新采样。</p>'+
    select('selection-edit','已有选择集')+field('selection-name','选择集名称','Region')+select('selection-part','选择集所属部件')+
    select('selection-type','选择区域','<option value="box">局部包围盒</option><option value="whole">整个部件</option>')+
    vector('selection-lower','局部下限（m）',[-.5,-.5,-.5])+vector('selection-upper','局部上限（m）',[.5,0,.5])+
    '<button id="selection-bounds">填入部件局部范围</button><div class="buttons"><button id="selection-read">读取选择集</button><button id="selection-add">添加选择集</button><button id="selection-update">更新选择集</button></div><button id="selection-remove">删除选择集及关联边界</button><label class="check"><input id="selection-show" type="checkbox" checked>显示所选区域与材料点</label><p id="selection-info" class="hint" role="status"></p>';
  folder('loads','project-region-boundary-panel','选择集边界条件').innerHTML+=
    select('selection-fixed','固定区域选择集')+'<div class="buttons"><button id="selection-pin">固定区域并重置</button><button id="selection-unpin">移除区域固定并重置</button></div><p class="hint">当前支持 MPM 选区 XYZ 固定。CPU 与 GPU 使用相同初始材料点；PBF 不支持固定。FEM 区域耦合尚未接入。</p><p id="selection-fixed-info" class="hint" role="status"></p>';
  const joint=document.getElementById('mbd-joint-add');
  joint.insertAdjacentHTML('beforebegin','<label class="check"><input id="ref-joint-mode" type="checkbox">使用参考点定义连接</label>'+
    select('ref-joint-a','连接端 A 参考点')+select('ref-joint-b','连接端 B 参考点')+
    '<p class="hint">选择两个刚体参考点；转动轴取 Z 轴。允许不同部件姿态，连接轴须在世界坐标中对齐。</p>');
  document.getElementById('mbd-joint-info').insertAdjacentHTML('afterend','<button id="ref-joint-convert">将所选连接转换为参考点连接</button>');
  folder('results','project-reference-results-panel','参考点与区域测量').innerHTML+=
    '<p class="hint">参考点随刚体运动。粒子部件参考点仅表示初始建模位置；变形后的区域位置由材料点选择集测量。</p>'+
    '<p id="reference-measurement" class="hint" role="status"></p><button id="reference-export">导出参考点与选择集 CSV</button>';
}

export function wireReferences({getProject,load,guard,download,getHistory}) {
  const $=id=>document.getElementById(id),read=id=>[0,1,2].map(k=>$(id+k).valueAsNumber),put=(id,v)=>v.forEach((x,k)=>$(id+k).value=Number(x.toPrecision(12)));
  const next=(items,prefix)=>{let n=1;while(items.some(x=>x.id===prefix+n))n++;return prefix+n;};
  const options=(id,items)=>{const old=$(id).value;$(id).replaceChildren(...items.map(item=>{const o=document.createElement('option');o.value=item.id;o.textContent=item.name;o.dataset.userContent='';return o;}));if(items.some(x=>x.id===old))$(id).value=old;};
  const en=()=>document.documentElement.lang==='en';
  let project=null,tracker=null;
  function frameFields(){return {name:$('ref-name').value,part:$('ref-part').value||null,position:read('ref-position'),rotation:read('ref-rotation')};}
  function setFields(){return {name:$('selection-name').value,part:$('selection-part').value,region:$('selection-type').value==='whole'?{type:'whole'}:{type:'box',lower:read('selection-lower'),upper:read('selection-upper')}};}
  function edit(kind,id,fields){const p=getProject(),items=p[kind];if(id){const index=items.findIndex(x=>x.id===id);if(index<0)throw Error('请先选择对象');items[index]={id,...fields};}else items.push({id:next(items,kind==='frames'?'ref-':'region-'),...fields});return load(p);}
  function selectLast(kind){const items=getProject()[kind],id=items.at(-1)?.id;if(id){$(kind==='frames'?'ref-edit':'selection-edit').value=id;(kind==='frames'?readFrame:readSet)();}}
  $('ref-add').onclick=guard(async()=>{await edit('frames',null,frameFields());selectLast('frames');});
  $('ref-update').onclick=guard(()=>{if(!$('ref-edit').value)throw Error('请先选择参考点');return edit('frames',$('ref-edit').value,frameFields());});
  function readFrame(){const f=getProject().frames.find(f=>f.id===$('ref-edit').value);if(!f)throw Error('请先选择参考点');$('ref-name').value=f.name;$('ref-part').value=f.part??'';put('ref-position',f.position);put('ref-rotation',f.rotation);}
  $('ref-read').onclick=guard(readFrame);
  $('ref-remove').onclick=guard(()=>load(removeReference(getProject(),'frame',$('ref-edit').value)));
  $('selection-add').onclick=guard(async()=>{await edit('selectionSets',null,setFields());selectLast('selectionSets');});
  $('selection-update').onclick=guard(()=>{if(!$('selection-edit').value)throw Error('请先选择选择集');return edit('selectionSets',$('selection-edit').value,setFields());});
  function readSet(){const s=getProject().selectionSets.find(s=>s.id===$('selection-edit').value);if(!s)throw Error('请先选择选择集');$('selection-name').value=s.name;$('selection-part').value=s.part;$('selection-type').value=s.region.type;if(s.region.type==='box'){put('selection-lower',s.region.lower);put('selection-upper',s.region.upper);}}
  $('selection-read').onclick=guard(readSet);
  $('selection-remove').onclick=guard(()=>load(removeReference(getProject(),'selection',$('selection-edit').value)));
  $('selection-bounds').onclick=guard(()=>{const b=getProject().parts.find(b=>b.id===$('selection-part').value);if(!b)throw Error('请先选择部件');put('selection-lower',b.geometry.size.map(x=>-x/2));put('selection-upper',b.geometry.size.map(x=>x/2));});
  $('ref-edit').onchange=()=>$('ref-read').click();
  $('selection-edit').onchange=()=>$('selection-read').click();
  $('selection-pin').onclick=guard(()=>{const p=getProject(),s=p.selectionSets.find(s=>s.id===$('selection-fixed').value);if(!s)throw Error('请先创建 MPM 选择集');if(!p.loads.some(l=>l.type==='fixed-selection'&&l.selection===s.id))p.loads.push({id:next(p.loads,'fixed-region-'),type:'fixed-selection',target:s.part,selection:s.id});return load(p);});
  $('selection-unpin').onclick=guard(()=>{const p=getProject();p.loads=p.loads.filter(l=>!(l.type==='fixed-selection'&&l.selection===$('selection-fixed').value));return load(p);});
  $('ref-joint-convert').onclick=guard(()=>{
    const p=getProject(),j=p.connections.find(j=>j.id===$('mbd-joint-edit').value);if(!j||j.type==='gear')throw Error('请选择非齿轮连接');
    if(j.endpoints){$('ref-joint-mode').checked=true;$('ref-joint-a').value=j.endpoints.a.frame;$('ref-joint-b').value=j.endpoints.b.frame;return;}
    return load(convertConnectionToReferences(p,j.id));
  });
  $('reference-export').onclick=guard(()=>{
    if(!tracker)throw Error('项目尚未初始化');
    const rows=['time_s,type,id,part,x_m,y_m,z_m,particle_count,mean_temperature_C'];
    for(const frame of getHistory()){
      const sample=tracker.sample(frame);
      for(const f of sample.frames)rows.push([frame.time,f.initialOnly?'initial-frame':'frame',f.id,f.part??'',...f.position,'',''].join(','));
      for(const s of sample.selections)rows.push([frame.time,'selection',s.id,s.part,...(s.position??['','','']),s.count??'',s.temperature??''].join(','));
    }
    download('\ufeff'+rows.join('\n'),'summer-reference-results.csv','text/csv;charset=utf-8');
  });
  return {
    refresh(initial) {
      project=getProject();tracker=new ReferenceResults(project,initial);
      options('ref-edit',project.frames);options('ref-part',[{id:'',name:'World / 世界'},...project.parts]);
      options('selection-edit',project.selectionSets);options('selection-part',project.parts);
      const rigid=project.frames.filter(f=>project.parts.find(p=>p.id===f.part)?.method==='rigid');
      options('ref-joint-a',rigid);options('ref-joint-b',rigid);
      if($('ref-joint-a').value===$('ref-joint-b').value&&rigid.length>1)$('ref-joint-b').value=rigid[1].id;
      options('selection-fixed',project.selectionSets.filter(s=>project.parts.find(p=>p.id===s.part)?.method==='mpm'));
      if($('ref-edit').value)readFrame();
      if($('selection-edit').value)readSet();
      $('selection-fixed-info').textContent=project.loads.filter(l=>l.type==='fixed-selection').map(l=>`${l.selection} → ${l.target} · XYZ`).join('\n')||(en()?'No region constraints':'尚无区域固定');
    },
    attach(j) {
      if(!$('ref-joint-mode').checked)return j;
      const p=getProject(),A=p.frames.find(f=>f.id===$('ref-joint-a').value),B=p.frames.find(f=>f.id===$('ref-joint-b').value);
      if(!A||!B||A.part===B.part)throw Error('请选择两个不同刚体上的参考点');
      return {...j,a:A.part,b:B.part,endpoints:{a:{frame:A.id},b:{frame:B.id}}};
    },
    display(frame,view) {
      if(!tracker)return;
      const sample=tracker.sample(frame,{frameID:$('ref-edit').value,setID:$('selection-edit').value}),f=sample.frames[0],s=sample.selections[0];
      const fmt=p=>p?p.map(x=>x.toFixed(4)).join(', '):'—';
      const fi=f?`${f.name} · ${f.initialOnly?(en()?'Initial only':'初始位置'):'World'} (${fmt(f.position)}) m`:(en()?'No reference points':'尚无参考点');
      const si=s?`${s.name} · ${s.count??'—'} ${en()?'points':'粒子'}\n(${fmt(s.position)}) m · ${s.temperature?.toFixed(2)??'—'} °C`:(en()?'No selection sets':'尚无选择集');
      for(const [id,text] of [['ref-info',fi],['selection-info',si],['reference-measurement',fi+'\n'+si]])if($(id).textContent!==text)$(id).textContent=text;
      view.referenceAxes=$('ref-show').checked&&f?[f]:[];
      const set=project.selectionSets.find(x=>x.id===$('selection-edit').value);
      view.referenceSelection=$('selection-show').checked&&set?{set,part:project.parts.find(p=>p.id===set.part),indices:tracker.members.get(set.id)??[]}:null;
    }
  };
}
