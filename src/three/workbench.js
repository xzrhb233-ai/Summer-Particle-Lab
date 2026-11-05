// Archive-style navigation inspired by RhineLabUI; native DOM controls stay mounted.
import {installIndexWave} from './index-wave.js';
import {installDisplaySettings} from './display-settings.js';
import {CHAPTERS as chapters,mountProjectWorkflow,applyStudyVisibility} from '../simulation/workflow.js';
import {installGridCoordinates} from './grid-coordinates.js';
import {simplifyWorkspace} from '../simulation/simple-workspace-ui.js';

const entries4=[
  ['geometry','01','模型','MODEL','部件 / 几何 / 材料'],
  ['loads','02','物理条件','PHYSICS','重力 / 接触 / 温度'],
  ['solver','03','求解','SOLVE','CPU / GPU / 时间'],
  ['results','04','结果','RESULTS','场量 / 曲线 / 回放'],
];

export function installWorkbench(renderer,getCoordinateContext=()=>({renderer,domain:renderer.domain,unit:'simulation',project:false})){
  const $=id=>document.getElementById(id), main=document.querySelector('main'),aside=document.querySelector('aside'),controls=$('controls');
  document.body.classList.add('archive-workbench');
  function moveRange(first,last,target){
    let node=first;while(node){const next=node.nextSibling;target.append(node);if(node===last)break;node=next;}
  }
  function label(id){return document.querySelector(`label[for="${id}"]`);}
  function group(parent,title){const node=document.createElement('section');node.className='archive-group';const h=document.createElement('h3');h.textContent=title;node.append(h);parent.append(node);return node;}
  const capacityNote=controls.querySelector(':scope > p:last-child'),sections=new Map();
  for(const [id,,title] of chapters){const section=document.createElement('section');section.id='chapter-'+id;section.className='archive-chapter';section.setAttribute('role','tabpanel');section.setAttribute('aria-labelledby','index-'+id);section.tabIndex=0;sections.set(id,section);}
  controls.append(...sections.values());
  const setup=sections.get('setup'),geometry=sections.get('geometry'),parts=sections.get('parts'),loads=sections.get('loads'),solver=sections.get('solver'),results=sections.get('results');
  const setupScene=group(setup,'预设实验');moveRange(label('scene3'),$('scene-note3'),setupScene);
  const setupBackend=group(setup,'计算设备');moveRange(label('backend3'),$('reconnect3'),setupBackend);
  geometry.append($('domain-panel3'));
  const material=group(geometry,'01 / 材料与本构');moveRange(label('material3'),$('phase-material-controls'),material);
  const temperature=$('temperature3').parentElement;material.append(temperature);
  moveRange(label('stiffness3'),$('stiffness3'),material);
  const stiffnessNote=document.createElement('p');stiffnessNote.className='hint';stiffnessNote.textContent='刚度系数作用于整个场景；材料、本构和初始温度用于新建粒子。';material.append(stiffnessNote);
  geometry.append($('geometry-panel3'));$('geometry-panel3').open=true;
  const drawing=group(geometry,'03 / 拖绘体积');drawing.append($('plane3').parentElement);moveRange(label('position3'),$('depth3'),drawing);
  $('geometry-create3').before($('fixed3').parentElement);
  const drawAction=document.createElement('button');drawAction.textContent='进入拖绘模式 ↗';drawAction.onclick=()=>document.querySelector('[data-tool="create"]').click();drawing.append(drawAction);
  parts.append($('parts-panel3'));
  loads.append($('gravity-panel3'),$('press-panel3'));
  const heat=group(loads,'热传导与相变');heat.append($('thermal3').parentElement);
  const pressNote=document.createElement('p');pressNote.className='hint';pressNote.textContent='压板仅适用于容器实验；星球和百万粒子场景中不显示压板控制。';heat.append(pressNote);
  solver.append($('run-panel3'),$('performance-title3').closest('details'));
  results.append($('history-panel3'));
  const display=group(results,'场量与剖切');moveRange(label('mechanics3'),$('mechanics-max3'),display);moveRange($('heatmap3').parentElement,$('cutz3'),display);
  moveRange(label('marker-scale3'),$('marker-note3'),group(results,'物质点观察'));
  if(capacityNote)group(setup,'运行说明').append(capacityNote);

  // Split part editing into distinct steps before making the secondary directory.
  const partRoot=$('parts-panel3'),partHint=partRoot.querySelector('p');
  partRoot.querySelector('summary').textContent='部件选择与命名';
  const initial=group(parts,'平动与转动初速');
  moveRange($('part-v0').closest('.gravity-coordinates').previousElementSibling,$('part-velocity3'),initial);initial.append(partHint);
  group(parts,'固定与释放').append($('part-pin3').parentElement);
  mountProjectWorkflow(sections);
  const coordinates=installGridCoordinates({parent:geometry,getContext:getCoordinateContext});
  geometry.prepend($('unified-parts'));
  const simple=simplifyWorkspace(sections);
  const sectionsByChapter=new Map();
  for(const [id,section] of sections){
    const folders=[];
    for(const child of [...section.children]){
      let folder=child;
      if(child.tagName==='SECTION'){
        folder=document.createElement('details');folder.className=child.className;folder.dataset.study=child.dataset.study;
        const title=child.querySelector('h3'),summary=document.createElement('summary');summary.textContent=title.textContent;title.remove();folder.append(summary,...child.childNodes);child.replaceWith(folder);
      }
      if(folder.tagName!=='DETAILS')continue;
      folder.classList.add('subdirectory');folder.open=false;
      folder.querySelector('summary').textContent=folder.querySelector('summary').textContent.replace(/^\d{2} \/ /,'');
      folder.setAttribute('name','subdirectory-'+id);
      folder.dataset.order=String(folders.length+1).padStart(2,'0');folder.querySelector('summary').dataset.order=folder.dataset.order;folders.push(folder);
      folder.addEventListener('toggle',()=>{
        if(!folder.open)return;
        for(const other of folders)if(other!==folder)other.open=false;
        // Closing a tall sibling changes the scroll range. Keep the new title
        // inside this inspector instead of scrolling the whole folder/page.
        requestAnimationFrame(()=>{
          if(!folder.open||folder.hidden||section.hidden)return;
          const title=folder.querySelector('summary').getBoundingClientRect(),port=controls.getBoundingClientRect();
          if(title.top<port.top+12||title.bottom>port.bottom-12)controls.scrollTop+=title.top-port.top-12;
        });
      });
    }
    sectionsByChapter.set(id,folders);
  }

  // Move the existing transport and tools, preserving their listeners and values.
  const transport=$('pause3').parentElement;transport.classList.add('transport');document.querySelector('header').append(transport);
  const tools=document.querySelector('.tools'),toolsLabel=tools.previousElementSibling;
  const toolstrip=document.createElement('div');toolstrip.className='viewport-tools';toolstrip.append(tools,$('tool-description'));main.append(toolstrip);toolsLabel.remove();
  $('experiment3').remove();controls.replaceChildren(...[...sections].filter(([id])=>id!=='setup').map(([,section])=>section));
  const nav=document.createElement('nav');nav.className='archive-index';nav.setAttribute('aria-label','实验台目录');
  nav.innerHTML=`<div class="index-heading"><span>WORKSPACE / INDEX</span><strong>实验台目录<span>04</span></strong></div>
    <div class="index-search"><label for="index-search3">检索目录</label><div><input id="index-search3" type="search" placeholder="检索功能…" autocomplete="off"><button id="index-clear3" aria-label="清空目录检索" hidden>×</button></div></div>
    <div class="index-entries" role="tablist" aria-label="实验流程" aria-orientation="vertical">${entries4.map(([id,number,title,en,desc])=>`<button id="index-${id}" role="tab" aria-controls="chapter-${id}" aria-selected="false" tabindex="-1" data-chapter="${id}"><span class="index-number">${number}</span><span class="index-entry-text"><small>${en}</small><strong>${title}</strong><em>${desc}</em></span><span class="index-arrow" aria-hidden="true">↗</span></button>`).join('')}</div>
    <p id="index-empty3" role="status" hidden>未找到对应功能。试试“重力”“材料”或“CSV”。</p>
    <div class="index-bottom"><span>MPM / MBD / FEM / THERMAL</span><span>SIMULATION LAB · V0.71.0</span><span>SUMMER PARTICLE LAB</span></div>`;
  main.append(nav);
  nav.querySelector('.index-bottom').before(simple.partTree);
  const wave=installIndexWave(nav.querySelector('.index-entries'));
  const head=document.querySelector('.panel-head');head.querySelector('strong').innerHTML='<span id="chapter-number3">00</span><span><small id="chapter-english3">EXPERIMENT</small><span id="chapter-title3">实验配置</span></span>';
  const collapse=$('collapse');document.querySelector('header').append(collapse);
  collapse.textContent='收起参数';collapse.setAttribute('aria-label','收起参数面板');collapse.setAttribute('aria-controls','controls');
  collapse.onclick=()=>{const closed=document.body.classList.toggle('inspector-hidden');collapse.textContent=closed?'展开参数':'收起参数';collapse.setAttribute('aria-expanded',String(!closed));collapse.setAttribute('aria-label',closed?'展开参数面板':'收起参数面板');};
  const summary=document.querySelector('.summary');summary.innerHTML='<span class="eyebrow">SIMULATION / LIVE VIEW</span><h1 id="viewport-title3">三维实验</h1><p id="phase-readout3" role="status"></p><details class="telemetry"><summary>实时统计</summary></details>';
  // #live belonged to the old summary; restore the status element without changing its API.
  const live=document.createElement('div');live.id='live';live.textContent='正在连接求解器…';summary.querySelector('details').append(live);
  const notice=document.createElement('div');notice.id='backend-notice3';notice.setAttribute('role','alert');notice.hidden=true;
  notice.innerHTML='<p id="backend-notice-message3"></p><button id="backend-settings3">查看计算后端</button>';summary.append(notice);
  const footer=document.querySelector('footer');footer.innerHTML='<span id="workspace-status3">等待计算后端…</span><span>右键旋转 / 滚轮缩放 / 空格暂停</span>';
  const search=$('index-search3'),entries=[...nav.querySelectorAll('[role="tab"]')],scroll=new Map();let active='geometry',study='particles';
  function show(id,focus=false){
    if(id==='setup'){sections.get('setup').hidden=false;if(!simple.dialog.open)simple.dialog.showModal();return;}
    if(id==='parts')id='geometry';
    const chapter=entries4.find(c=>c[0]===id);if(!chapter)return;
    scroll.set(active,controls.scrollTop);active=id;
    for(const [key,node] of sections)if(key!=='setup')node.hidden=key!==id;
    for(const b of entries){const selected=b.dataset.chapter===id;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;}
    $('chapter-number3').textContent=chapter[1];$('chapter-title3').textContent=chapter[2];$('chapter-english3').textContent=chapter[3];
    if(document.body.classList.contains('inspector-hidden'))collapse.click();
    controls.scrollTop=scroll.get(id)||0;
    const url=new URL(location.href);url.hash=id;history.replaceState(null,'',url);
    if(focus)sections.get(id).focus({preventScroll:true});
    window.dispatchEvent(new CustomEvent('workbench-chapter',{detail:id}));
  }
  function filter(){
    wave.reset();
    const q=search.value.trim().toLocaleLowerCase();let matches=0;
    entries.forEach((button,i)=>{button.hidden=!(entries4[i].join(' ')+' '+sections.get(entries4[i][0]).textContent).toLocaleLowerCase().includes(q);if(!button.hidden)matches++;});
    $('index-empty3').hidden=matches>0;$('index-clear3').hidden=!q;
    const visible=entries.filter(b=>!b.hidden),target=visible.find(b=>b.dataset.chapter===active)||visible[0];entries.forEach(b=>b.tabIndex=b===target?0:-1);
  }
  const compact=matchMedia('(max-width:760px)');compact.addEventListener('change',()=>{if(compact.matches){search.value='';filter();}});
  search.oninput=filter;$('index-clear3').onclick=()=>{search.value='';filter();search.focus();};
  entries.forEach(button=>button.onclick=()=>show(button.dataset.chapter));
  nav.addEventListener('keydown',e=>{
    const visible=entries.filter(b=>!b.hidden),i=visible.indexOf(document.activeElement);if(!visible.length)return;
    if(document.activeElement===search){if(e.key==='Enter'){e.preventDefault();show(visible[0].dataset.chapter,true);}if(e.key==='Escape'){search.value='';filter();}return;}
    let next;if(e.key==='ArrowDown'||e.key==='ArrowRight')next=(i+1)%visible.length;else if(e.key==='ArrowUp'||e.key==='ArrowLeft')next=(i-1+visible.length)%visible.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=visible.length-1;else return;
    e.preventDefault();visible[next].focus();show(visible[next].dataset.chapter);
  });
  document.addEventListener('click',e=>{const jump=e.target.closest('[data-jump]');if(jump){show(jump.dataset.jump,true);const first=sectionsByChapter.get(jump.dataset.jump)?.find(f=>!f.hidden);if(first)first.open=true;}});
  window.addEventListener('workbench-reveal',e=>{const {chapter,folder}=e.detail;show(chapter);if($(folder)){if($(folder).dataset.advancedModeling==='true'){document.body.classList.add('modeling-advanced');$('unified-advanced').checked=true;applyStudyVisibility(study);}if($(folder).dataset.simpleAdvanced)$(folder).closest('.archive-chapter').classList.add('simple-expanded');$(folder).open=true;$(folder).querySelector('summary').scrollIntoView({block:'nearest'});}});
  window.addEventListener('keydown',e=>{if(e.key==='/'&&search.getClientRects().length&&!['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)){e.preventDefault();search.focus();}});
  window.addEventListener('hashchange',()=>show(location.hash.slice(1)));
  show(['geometry','parts','loads','solver','results'].includes(location.hash.slice(1))?location.hash.slice(1):'geometry');
  function chooseStudy(){
    study=$('study-kind').value;applyStudyVisibility(study);
    $('study-description').textContent=study==='project'?'当前项目：共享部件、几何、载荷与结果定义，按所选求解方案运行。':'当前方案：使用原有粒子 CPU / GPU 求解器；刚体耦合请切换至统一项目。';
    const url=new URL(location.href);url.searchParams.set('study',study);history.replaceState(null,'',url);
    window.dispatchEvent(new CustomEvent('workbench-study',{detail:study}));
    const visible=sectionsByChapter.get(active).filter(f=>!f.hidden);if(!visible.some(f=>f.open)&&visible.length)visible[0].open=true;
  }
  const query=new URLSearchParams(location.search);
  $('study-kind').value=query.get('study')==='particles'?'particles':query.get('study')==='project'||query.has('mbd')||!query.has('scene')||(query.get('scene')==='empty'&&query.get('backend')!=='gpu')?'project':'particles';
  $('study-kind').onchange=chooseStudy;chooseStudy();
  installDisplaySettings(renderer);
  $('backend-settings3').onclick=()=>{if(study==='project')show('solver',true);else{show('setup',true);$('backend3').closest('details').open=true;}};
  return {
    drawCoordinates(){coordinates.update();},
    connection(state,message){
      if(study==='project')return;
      notice.hidden=state==='ready';$('backend-notice-message3').textContent=message;$('backend-settings3').hidden=state!=='failed';
      if(state!=='ready'){
        $('phase-readout3').textContent='';$('viewport-title3').textContent=$('scene3').selectedOptions[0].textContent.split(' · ')[0];
        $('workspace-status3').textContent=state==='failed'?'计算后端未连接':'正在连接求解器…';$('live').textContent=message;
        $('part-info3').textContent='等待部件数据…';$('performance3').textContent=message;
      }
    },
    update(s){if(study==='project')return;$('phase-readout3').textContent=`MPM 固体 ${s.solids.toLocaleString()} · PBF 流体 / 气体 ${s.liquids.toLocaleString()}`;$('viewport-title3').textContent=$('scene3').selectedOptions[0].textContent.split(' · ')[0];$('workspace-status3').textContent=`${s.paused?'PAUSED':'RUNNING'} / ${s.count.toLocaleString()} 粒子 / ${s.time.toFixed(3)} s / ${s.backend?.arch?.toUpperCase()||'CPU'}`;}
  };
}
